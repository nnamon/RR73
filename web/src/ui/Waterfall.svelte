<script lang="ts">
  /**
   * The live waterfall: newest time at the top, 0 to 3000 Hz across, slot lines labelled with
   * their UTC start. Drawing happens in the waterfall worker; this component sizes the canvas,
   * feeds it audio and places the labels.
   *
   * A tap on the waterfall or the axis picks the frequency under the finger: a guide line marks
   * it and a bar below the axis offers Receive here, Transmit here and Both, and a search for a
   * clear Tx frequency. Without a pointer, the Set frequencies button (hidden until focused)
   * opens the bar at the Rx frequency, and its field takes a typed frequency. A tap outside the
   * bar or Escape closes it.
   */
  import { onMount, tick } from 'svelte';
  import { WaterfallClient } from '../lib/waterfall/client';
  import { paletteFrom } from '../lib/waterfall/colormap';
  import type { FrameInfo } from '../lib/waterfall/renderer';
  import { FREQ_LIMITS, SIGNAL_HZ, hzAtX, xOfHz } from '../lib/waterfall/pick';
  import { utcTime } from '../lib/clock/format';
  import type { Mode } from '../lib/clock/slots';
  import { onAudioChunk } from '../lib/state/station.svelte';
  import FreqAxis from './FreqAxis.svelte';
  import Icon from './Icon.svelte';

  let {
    mode,
    rxHz,
    txHz,
    stoppedAtUtcMs = null,
    hint = false,
    onset,
  }: {
    mode: Mode;
    rxHz: number;
    txHz: number;
    stoppedAtUtcMs?: number | null;
    /** Shows the line that says how to set the frequencies. */
    hint?: boolean;
    onset: (f: { rxHz?: number; txHz?: number }) => void;
  } = $props();

  let box: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let area: HTMLDivElement;
  let bar: HTMLDivElement | undefined = $state();
  let field: HTMLInputElement | undefined = $state();
  let setBtn: HTMLButtonElement;
  let client: WaterfallClient | null = null;
  let frame = $state<FrameInfo | null>(null);
  let dpr = $state(1);
  let started = $state(false);

  // Each label sits 14 px above its line; a label that would cross the top edge is dropped.
  const labels = $derived((frame?.boundaries ?? []).map((b) => ({ key: b.utcMs, text: utcTime(b.utcMs), top: b.y / dpr - 14 })).filter((l) => l.top >= 0));

  /** The bar: open, with the frequency as typed or picked. */
  let open = $state(false);
  let draft = $state('');
  let note = $state<string | null>(null);
  let searching = $state(false);
  let announce = $state('');
  const limits = $derived(FREQ_LIMITS[mode]);
  const typed = $derived(/^\d{1,4}$/.test(draft.trim()) ? Number(draft.trim()) : Number.NaN);
  const valid = $derived(typed >= limits.minHz && typed <= limits.maxHz);

  $effect(() => {
    client?.setMode(mode);
  });

  function openAt(hz: number, focus = false) {
    draft = String(hz);
    note = null;
    open = true;
    if (focus)
      void tick().then(() => {
        field?.focus();
        field?.select();
      });
  }

  function close() {
    const inside = !!bar && bar.contains(document.activeElement);
    open = false;
    note = null;
    // Keyboard and screen reader users go back to Set frequencies.
    if (inside) setBtn.focus();
  }

  function apply(which: 'rx' | 'tx' | 'both') {
    if (!valid) return;
    const hz = typed;
    if (which === 'rx') onset({ rxHz: hz });
    else if (which === 'tx') onset({ txHz: hz });
    else onset({ rxHz: hz, txHz: hz });
    announce = which === 'rx' ? `Receive ${hz} Hz.` : which === 'tx' ? `Transmit ${hz} Hz.` : `Receive and transmit ${hz} Hz.`;
    close();
  }

  async function findClear() {
    if (!client || searching) return;
    searching = true;
    const hz = await client.quietest(Date.now(), txHz);
    searching = false;
    if (hz === null) {
      note = 'Finding a clear frequency needs 2 slots of audio.';
      return;
    }
    onset({ txHz: hz });
    announce = `Transmit ${hz} Hz, the quietest ${SIGNAL_HZ[mode]} Hz in the last slots.`;
    close();
  }

  // A tap: a press and release within 10 px and 1 s. A drag scrolls the page and cancels it.
  let press: { id: number; x: number; y: number; t: number } | null = null;

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
  }

  function up(e: PointerEvent) {
    const p = press;
    press = null;
    if (!p || p.id !== e.pointerId) return;
    if (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10 || e.timeStamp - p.t > 1000) return;
    const r = area.getBoundingClientRect();
    openAt(hzAtX(e.clientX - r.left, r.width, mode));
  }

  // While the bar is open, a press anywhere else closes it.
  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (bar?.contains(t) || area.contains(t))) return;
      close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key);
    };
  });

  onMount(() => {
    const style = getComputedStyle(document.documentElement);
    const palette = paletteFrom((t) => style.getPropertyValue(t));
    let size = { w: 0, h: 0 };
    const measure = () => {
      dpr = Math.min(3, window.devicePixelRatio || 1);
      const r = box.getBoundingClientRect();
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (!w || !h || (w === size.w && h === size.h)) return;
      size = { w, h };
      if (!client) client = new WaterfallClient(canvas, palette, mode, w, h, (info) => (frame = info));
      else client.resize(w, h);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    measure();
    // Picking by pointer; the axis button and the bar's field are the way in without one.
    const cancel = () => (press = null);
    area.addEventListener('pointerdown', down);
    area.addEventListener('pointerup', up);
    area.addEventListener('pointercancel', cancel);
    const off = onAudioChunk((c) => {
      started = true;
      client?.push(c.samples, c.utcMs, c.index);
    });
    return () => {
      off();
      area.removeEventListener('pointerdown', down);
      area.removeEventListener('pointerup', up);
      area.removeEventListener('pointercancel', cancel);
      ro.disconnect();
      client?.destroy();
      client = null;
    };
  });
</script>

<figure class="wf-wrap" aria-label="Waterfall, 0 to 3000 Hz, newest at the top">
  <div class="pick" bind:this={area}>
    <div class="wf" bind:this={box}>
      <canvas bind:this={canvas} data-testid="waterfall"></canvas>
      {#each labels as l (l.key)}
        <span class="tl" style:top="{l.top}px" aria-hidden="true">{l.text}</span>
      {/each}
      {#if stoppedAtUtcMs !== null}
        <span class="gap">No audio since {utcTime(stoppedAtUtcMs)}</span>
      {:else if !started}
        <span class="gap">The waterfall starts with the audio. RR73 listens to the radio through the headset microphone contact.</span>
      {/if}
      {#if open && valid}
        <i class="guide" data-testid="freq-guide" style:left="{xOfHz(typed) * 100}%" aria-hidden="true"></i>
      {/if}
      {#if hint && !open}
        <span class="hint">Tap the waterfall to set the receive or transmit frequency.</span>
      {/if}
    </div>
    <FreqAxis {rxHz} {txHz} {mode} />
  </div>
  <button class="visually-hidden set-freq" bind:this={setBtn} onclick={() => openAt(rxHz, true)}>Set frequencies. Receive {rxHz} Hz, transmit {txHz} Hz.</button>
  <p class="visually-hidden" aria-live="polite">{announce}</p>
  {#if open}
    <div class="bar" bind:this={bar} role="group" aria-label="Set the frequency" data-testid="freq-bar">
      <div class="r1">
        <label class="hz">
          <span class="visually-hidden">Frequency, Hz</span>
          <input
            bind:this={field}
            bind:value={draft}
            class="hz-in mono"
            type="text"
            inputmode="numeric"
            maxlength="4"
            autocomplete="off"
            aria-invalid={!valid}
            onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
          <span class="unit" aria-hidden="true">Hz</span>
        </label>
        <button class="btn compact quiet" disabled={searching} onclick={findClear} aria-label="Find clear Tx frequency">Find clear Tx</button>
        <button class="close" aria-label="Close" onclick={close}><Icon name="xmark" size={18} /></button>
      </div>
      {#if !valid}
        <p class="note">{mode} uses {limits.minHz} to {limits.maxHz} Hz.</p>
      {:else if note}
        <p class="note">{note}</p>
      {/if}
      <div class="r2">
        <button class="btn compact here-rx" disabled={!valid} aria-label="Receive here, {valid ? typed : ''} Hz" onclick={() => apply('rx')}>Receive here</button>
        <button class="btn compact here-tx" disabled={!valid} aria-label="Transmit here, {valid ? typed : ''} Hz" onclick={() => apply('tx')}>Transmit here</button>
        <button class="btn compact both" disabled={!valid} aria-label="Both, receive and transmit at {valid ? typed : ''} Hz" onclick={() => apply('both')}>Both</button>
      </div>
    </div>
  {/if}
</figure>

<style>
  .wf-wrap {
    position: relative;
    display: flex;
    flex: none;
    flex-direction: column;
    margin: 0;
  }

  .pick {
    display: flex;
    flex-direction: column;
    cursor: crosshair;
  }

  .wf {
    position: relative;
    height: var(--rr-waterfall);
    overflow: hidden;
    background: var(--rr-wf-bg);
  }

  canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  .tl {
    position: absolute;
    left: 6px;
    height: 13px;
    font-family: var(--rr-mono);
    font-size: var(--rr-text-axis);
    line-height: 13px;
    letter-spacing: 0;
    color: var(--rr-wf-text);
    white-space: nowrap;
  }

  .gap {
    position: absolute;
    top: var(--rr-space-4);
    right: var(--rr-space-4);
    left: var(--rr-space-4);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    color: var(--rr-wf-text);
    text-align: center;
  }

  .guide {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--rr-wf-text);
    box-shadow: 0 0 0 1px var(--rr-wf-tag-bg);
  }

  /* Shown while focused from a keyboard, over the axis. */
  .set-freq:focus-visible {
    top: calc(var(--rr-waterfall) - var(--rr-tap) + var(--rr-axis));
    left: var(--rr-space-2);
    z-index: 3;
    width: auto;
    height: var(--rr-tap);
    padding: 0 var(--rr-space-3);
    border-radius: var(--rr-radius-l);
    background: var(--rr-surface);
    color: var(--rr-accent);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    clip-path: none;
  }

  /* Over the bottom of the waterfall, so it takes no height on small screens. */
  .hint {
    position: absolute;
    right: var(--rr-space-2);
    bottom: var(--rr-space-1-5);
    left: var(--rr-space-2);
    padding: var(--rr-space-half) var(--rr-space-2);
    border-radius: var(--rr-radius-s);
    background: var(--rr-wf-tag-bg);
    color: var(--rr-wf-text);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    text-align: center;
  }

  .bar {
    position: absolute;
    top: calc(var(--rr-waterfall) + var(--rr-axis) + var(--rr-space-1));
    right: var(--rr-space-2);
    left: var(--rr-space-2);
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: var(--rr-space-1-5);
    padding: var(--rr-space-2);
    border-radius: var(--rr-radius-xl);
    background: var(--rr-surface);
    box-shadow:
      0 0 0 var(--rr-hairline) var(--rr-sep-strong),
      0 6px 20px var(--rr-shadow-thumb);
  }

  .r1,
  .r2 {
    display: flex;
    gap: var(--rr-space-1-5);
    align-items: center;
  }

  .hz {
    display: flex;
    flex: 1;
    gap: var(--rr-space-1);
    align-items: center;
    min-width: 0;
  }

  .hz-in {
    width: 4.2em;
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-2);
    border: 0;
    border-radius: var(--rr-radius-l);
    background: var(--rr-fill);
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-semibold);
    text-align: right;
  }

  .hz-in[aria-invalid='true'] {
    box-shadow: inset 0 0 0 2px var(--rr-warn);
  }

  .unit {
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-semibold);
  }

  .close {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    border-radius: var(--rr-radius-l);
    color: var(--rr-label2);
  }

  .note {
    font-size: var(--rr-text-caption);
    line-height: var(--rr-leading-caption);
    color: var(--rr-label2);
  }

  .r2 .btn {
    flex: 1 1 auto;
    padding: 0 var(--rr-space-2);
  }

  .here-rx {
    background: var(--rr-ok-soft);
    color: var(--rr-ok);
  }

  .here-tx {
    background: var(--rr-tx-soft);
    color: var(--rr-tx-text);
  }

  .btn.quiet {
    padding: 0 var(--rr-space-3);
  }
</style>
