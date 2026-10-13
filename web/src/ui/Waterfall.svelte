<script lang="ts">
  /**
   * The live waterfall: newest time at the top, 0 to 3000 Hz across, slot lines labelled with
   * their UTC start, the frequency labels over its bottom edge. Drawing happens in the waterfall
   * worker; this component sizes the canvas, feeds it audio and places the overlays.
   *
   * The red line is Tx, the green line Rx. Dragging sideways anywhere moves Tx, with the
   * frequency on a label, and lifting the finger sets it; a drag that starts on the green line
   * moves Rx. A tap sets Tx where it lands. A vertical movement is left to the page. Without a
   * pointer, two sliders (hidden until focused) set Tx and Rx.
   */
  import { onMount } from 'svelte';
  import { WaterfallClient } from '../lib/waterfall/client';
  import { paletteFrom } from '../lib/waterfall/colormap';
  import type { FrameInfo } from '../lib/waterfall/renderer';
  import { FREQ_LIMITS, SIGNAL_HZ, xOfHz } from '../lib/waterfall/pick';
  import { STEP_HZ, classify, dragHz, grabbed, isTap, labelLeft, type Gesture, type Marker } from '../lib/waterfall/drag';
  import { ticks } from '../lib/waterfall/axis';
  import { utcTime } from '../lib/clock/format';
  import { SLOT_MS, type Mode } from '../lib/clock/slots';
  import { onAudioChunk } from '../lib/state/station.svelte';
  import { practice } from '../lib/state/practice.svelte';

  let {
    mode,
    rxHz,
    txHz,
    txSlots = [],
    stoppedAtUtcMs = null,
    hint = false,
    onset,
  }: {
    mode: Mode;
    rxHz: number;
    txHz: number;
    /** Starts of the slots RR73 transmitted in, UTC ms: tinted red. */
    txSlots?: number[];
    stoppedAtUtcMs?: number | null;
    /** Shows the pill that says how to move Tx and Rx: until the first drag or tap. */
    hint?: boolean;
    onset: (f: { rxHz?: number; txHz?: number }) => void;
  } = $props();

  let box: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let client: WaterfallClient | null = null;
  let frame = $state<FrameInfo | null>(null);
  let dpr = $state(1);
  let width = $state(0);
  let height = $state(0);
  let started = $state(false);
  let announce = $state('');

  const slotMs = $derived(SLOT_MS[mode]);
  const marks = $derived((frame?.boundaries ?? []).map((b) => ({ utcMs: b.utcMs, y: b.y / dpr })));
  const sent = $derived(new Set(txSlots));
  // Each label sits 14 px above its line; a label that would cross the top edge is dropped.
  const labels = $derived(marks.map((b) => ({ key: b.utcMs, text: `${utcTime(b.utcMs)}${sent.has(b.utcMs) ? ' Tx' : ''}`, top: b.y - 14 })).filter((l) => l.top >= 0));
  // A slot RR73 transmitted in spans from its start line up to the next slot's line.
  const txBands = $derived.by(() => {
    const at = new Map(marks.map((b) => [b.utcMs, b.y]));
    return txSlots.flatMap((s) => {
      const bottom = at.get(s);
      const top = at.get(s + slotMs);
      if (bottom === undefined && top === undefined) return [];
      const y0 = top ?? 0;
      const y1 = bottom ?? height;
      return y1 > y0 ? [{ key: s, top: y0, height: y1 - y0 }] : [];
    });
  });
  const axis = ticks().filter((t) => t.label);

  /** The press in progress, and the marker it moves once it is a drag. */
  let press: { id: number; x0: number; y0: number; t0: number; which: Marker; g: Gesture } | null = null;
  let live = $state<{ which: Marker; hz: number } | null>(null);
  let tagWidth = $state(96);
  const shownRx = $derived(live?.which === 'rx' ? live.hz : rxHz);
  const shownTx = $derived(live?.which === 'tx' ? live.hz : txHz);
  const tagLeft = $derived(live ? labelLeft(xOfHz(live.hz) * width, tagWidth, width) : 0);
  const limits = $derived(FREQ_LIMITS[mode]);

  $effect(() => {
    client?.setMode(mode);
  });

  function set(which: Marker, hz: number) {
    onset(which === 'tx' ? { txHz: hz } : { rxHz: hz });
    announce = which === 'tx' ? `Transmit ${hz} Hz.` : `Receive ${hz} Hz.`;
  }

  function at(e: PointerEvent): number {
    return e.clientX - box.getBoundingClientRect().left;
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || press) return;
    press = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, which: grabbed(at(e), width, rxHz, txHz), g: 'pending' };
  }

  function move(e: PointerEvent) {
    const p = press;
    if (!p || p.id !== e.pointerId) return;
    p.g = classify(e.clientX - p.x0, e.clientY - p.y0, p.g);
    if (p.g === 'scroll') {
      press = null;
      live = null;
      return;
    }
    if (p.g !== 'drag') return;
    if (!live) box.setPointerCapture?.(e.pointerId);
    live = { which: p.which, hz: dragHz(at(e), width, mode) };
  }

  function up(e: PointerEvent) {
    const p = press;
    if (!p || p.id !== e.pointerId) return;
    press = null;
    const l = live;
    live = null;
    if (p.g === 'drag' && l) set(l.which, l.hz);
    else if (p.g === 'pending' && isTap(e.clientX - p.x0, e.clientY - p.y0, e.timeStamp - p.t0)) set('tx', dragHz(at(e), width, mode));
  }

  function cancel(e: PointerEvent) {
    if (press?.id !== e.pointerId) return;
    press = null;
    live = null;
  }

  /** The quietest Tx frequency in the last slots, Hz, or null with less than 2 slots of audio. */
  export function quietest(): Promise<number | null> {
    return client ? client.quietest(Date.now(), txHz) : Promise.resolve(null);
  }

  onMount(() => {
    const style = getComputedStyle(document.documentElement);
    const palette = paletteFrom((t) => style.getPropertyValue(t));
    let size = { w: 0, h: 0 };
    const measure = () => {
      dpr = Math.min(3, window.devicePixelRatio || 1);
      const r = box.getBoundingClientRect();
      width = r.width;
      height = r.height;
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
    const off = onAudioChunk((c) => {
      started = true;
      client?.push(c.samples, c.utcMs, c.index);
    });
    return () => {
      off();
      ro.disconnect();
      client?.destroy();
      client = null;
    };
  });
</script>

<figure class="wf-wrap" aria-label="Waterfall, 0 to 3000 Hz, newest at the top">
  <!-- svelte-ignore a11y_no_static_element_interactions (the sliders below are the way in without a pointer) -->
  <div class="wf" class:dragging={!!live} bind:this={box} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} data-testid="waterfall-area">
    <canvas bind:this={canvas} data-testid="waterfall"></canvas>
    {#each txBands as b (b.key)}
      <i class="txslot" style:top="{b.top}px" style:height="{b.height}px" aria-hidden="true"></i>
    {/each}
    {#each labels as l (l.key)}
      <span class="tl" style:top="{l.top}px" aria-hidden="true">{l.text}</span>
    {/each}
    {#if stoppedAtUtcMs !== null}
      <span class="gap">No audio since {utcTime(stoppedAtUtcMs)}</span>
    {:else if !started}
      <span class="gap">{practice.on ? 'The waterfall starts with the audio. The practice band plays here. It needs no radio or microphone.' : 'The waterfall starts with the audio. RR73 listens to the radio through the headset microphone contact.'}</span>
    {/if}
    {#if hint && !live}
      <span class="hint" data-testid="drag-hint">Drag to move Tx. Drag the green line to move Rx.</span>
    {/if}
    <i class="mark rx" data-testid="rx-marker" style:left="{xOfHz(shownRx) * 100}%" aria-hidden="true"></i>
    {#if live}
      <i class="band {live.which}" style:left="{xOfHz(live.hz) * 100}%" style:width="{(SIGNAL_HZ[mode] / 3000) * 100}%" aria-hidden="true"></i>
    {/if}
    <i class="mark tx" data-testid="tx-marker" style:left="{xOfHz(shownTx) * 100}%" aria-hidden="true"></i>
    {#if live}
      <span class="tag {live.which}" bind:clientWidth={tagWidth} style:left="{tagLeft}px" data-testid="drag-label">{live.which === 'tx' ? 'Tx' : 'Rx'} {live.hz} Hz</span>
    {/if}
    <span class="scrim" aria-hidden="true"></span>
    {#each axis as t (t.hz)}
      <span class="ax" style:left="{t.x * 100}%" aria-hidden="true">{t.label}</span>
    {/each}
  </div>
  <input
    class="visually-hidden slider"
    type="range"
    min={limits.minHz}
    max={limits.maxHz}
    step={STEP_HZ}
    value={txHz}
    aria-label="Transmit frequency, Hz"
    aria-valuetext="{txHz} Hz"
    onchange={(e) => set('tx', Number(e.currentTarget.value))}
  />
  <input
    class="visually-hidden slider"
    type="range"
    min={limits.minHz}
    max={limits.maxHz}
    step={STEP_HZ}
    value={rxHz}
    aria-label="Receive frequency, Hz"
    aria-valuetext="{rxHz} Hz"
    onchange={(e) => set('rx', Number(e.currentTarget.value))}
  />
  <p class="visually-hidden" aria-live="polite">{announce}</p>
</figure>

<style>
  .wf-wrap {
    position: relative;
    flex: none;
    margin: 0;
  }

  .wf {
    position: relative;
    height: var(--rr-waterfall);
    overflow: hidden;
    background: var(--rr-wf-bg);
    cursor: crosshair;

    /* Vertical pans scroll the page; sideways moves drag the markers. */
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .wf.dragging {
    cursor: ew-resize;
  }

  canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  .txslot {
    position: absolute;
    right: 0;
    left: 0;
    background: var(--rr-wf-tx-slot);
  }

  .tl,
  .ax {
    position: absolute;
    height: 13px;
    font-family: var(--rr-mono);
    font-size: var(--rr-text-axis);
    line-height: 13px;
    letter-spacing: 0;
    color: var(--rr-wf-text);
    white-space: nowrap;
  }

  .tl {
    left: 6px;
  }

  .ax {
    bottom: 2px;
    transform: translateX(-50%);
  }

  .scrim {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 16px;
    background: linear-gradient(180deg, transparent, var(--rr-wf-scrim));
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

  /* A small pill at the bottom left, above the frequency labels. */
  .hint {
    position: absolute;
    bottom: 18px;
    left: var(--rr-space-1-5);
    max-width: calc(100% - 2 * var(--rr-space-1-5));
    padding: var(--rr-space-half) var(--rr-space-2);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-wf-tag-bg);
    color: var(--rr-wf-text);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
  }

  .mark {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: calc(-1 * var(--rr-space-px));
  }

  .mark.rx {
    background: var(--rr-wf-rx);
  }

  .mark.tx {
    background: var(--rr-wf-tx);
  }

  .band {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--rr-wf-tx-band);
  }

  .band.rx {
    background: var(--rr-wf-rx-band);
  }

  .tag {
    position: absolute;
    top: var(--rr-space-4);
    padding: var(--rr-space-half) var(--rr-space-1-5);
    border-radius: var(--rr-radius-s);
    background: var(--rr-tx-fill);
    color: var(--rr-on-fill);
    font-family: var(--rr-mono);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-leading-foot);
    white-space: nowrap;
  }

  .tag.rx {
    background: var(--rr-ic-green);
  }
</style>
