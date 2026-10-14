<script lang="ts">
  /**
   * The live waterfall: newest time at the top, 0 to 3000 Hz across, slot lines labelled with
   * their UTC start, and a ruler strip under it with a tick every 100 Hz, a taller one every
   * 500 Hz and labels from 500 to 3000. Drawing happens in the waterfall worker; this component
   * sizes the canvas, feeds it audio and places the overlays. Slots RR73 transmitted in show
   * the transmitted audio and are labelled Tx.
   *
   * Tx (red) and Rx (green) show as two lines at the signal's lowest and highest tone with a
   * light fill, through the picture and the ruler. Dragging sideways anywhere moves Tx, with the
   * lowest tone's frequency on a label, and lifting the finger sets it; a drag that starts on the
   * green marker moves Rx. A tap sets Tx where it lands. A mostly vertical movement does nothing:
   * the waterfall takes every touch, so a drag never scrolls the screen.
   * Without a pointer, two sliders (hidden until focused) set Tx and Rx.
   *
   * WSPR shows 1400 to 1600 Hz over two 2-minute slots, with its own ruler (a tick every 10 Hz, a
   * label every 50 Hz) and a 6 Hz Tx marker around the signal centre. It has no Rx marker: the
   * decoder searches the whole window.
   */
  import { onMount } from 'svelte';
  import { WaterfallClient } from '../lib/waterfall/client';
  import { paletteFrom } from '../lib/waterfall/colormap';
  import type { FrameInfo } from '../lib/waterfall/renderer';
  import { FREQ_LIMITS, xOfHz } from '../lib/waterfall/pick';
  import { STEP_HZ_OF, classify, dragHz, grabbed, isTap, labelLeft, type Gesture, type Marker } from '../lib/waterfall/drag';
  import { bracket, denseRuler, ruler } from '../lib/waterfall/axis';
  import { layout } from '../lib/app/layout.svelte';
  import { viewOf } from '../lib/waterfall/spectrum';
  import type { Contrast } from '../lib/waterfall/levels';
  import { utcHm, utcTime } from '../lib/clock/format';
  import type { Mode } from '../lib/clock/slots';
  import { onAudioChunk, onTxWave, recentTxWaves } from '../lib/state/station.svelte';

  let {
    mode,
    rxHz,
    txHz,
    markHz = null,
    txSlots = [],
    contrast = 'normal',
    stoppedAtUtcMs = null,
    hint = false,
    onset,
  }: {
    mode: Mode;
    /** Null hides the Rx marker (WSPR). */
    rxHz: number | null;
    txHz: number;
    /** A selected signal's frequency, Hz, marked in the accent colour (a WSPR spot); null for none. */
    markHz?: number | null;
    /** Starts of the slots RR73 transmitted in, UTC ms: drawn from the transmitted audio. */
    txSlots?: number[];
    contrast?: Contrast;
    stoppedAtUtcMs?: number | null;
    /** Shows the pill that says how to move Tx and Rx: until the first drag or tap. */
    hint?: boolean;
    onset: (f: { rxHz?: number; txHz?: number }) => void;
  } = $props();

  let box: HTMLDivElement;
  let pic: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let client: WaterfallClient | null = null;
  let frame = $state<FrameInfo | null>(null);
  let dpr = $state(1);
  let width = $state(0);
  let height = $state(0);
  let announce = $state('');

  const marks = $derived((frame?.boundaries ?? []).map((b) => ({ utcMs: b.utcMs, y: b.y / dpr })));
  const sent = $derived(new Set(txSlots));
  let rulerH = $state(0);
  // Each label sits 14 px above its line; a label that would cross the top edge or reach the ruler is dropped.
  // WSPR slots start on whole minutes: "14:04".
  const timeText = $derived(mode === 'WSPR' ? utcHm : utcTime);
  const labels = $derived(
    marks.map((b) => ({ key: b.utcMs, text: `${timeText(b.utcMs)}${sent.has(b.utcMs) ? ' Tx' : ''}`, top: b.y - 14 })).filter((l) => l.top >= 0 && l.top + 13 <= height - rulerH),
  );
  // Regular width: labels as dense as 12 pt numbers allow, and four FT8 slots in the picture.
  const regular = $derived(layout.size === 'regular');
  const axis = $derived(regular && width ? denseRuler(mode, width) : ruler(mode));
  const spanS = $derived(regular && mode !== 'WSPR' ? 60 : null);
  const view = $derived(viewOf(mode));
  const step = $derived(STEP_HZ_OF[mode]);

  /** The press in progress, and the marker it moves once it is a drag. */
  let press: { id: number; x0: number; y0: number; t0: number; which: Marker; g: Gesture } | null = null;
  let live = $state<{ which: Marker; hz: number } | null>(null);
  let tagWidth = $state(96);
  const shownRx = $derived(live?.which === 'rx' ? live.hz : rxHz);
  const shownTx = $derived(live?.which === 'tx' ? live.hz : txHz);
  const tagLeft = $derived(live ? labelLeft(xOfHz(live.hz, mode) * width, tagWidth, width) : 0);
  const limits = $derived(FREQ_LIMITS[mode]);
  const rxBand = $derived(shownRx === null ? null : bracket(shownRx, mode));
  const txBand = $derived(bracket(shownTx, mode));
  const markBand = $derived(markHz === null ? null : bracket(markHz, mode));

  // Each effect reads its value first: `client?.` skips its arguments while there is no client,
  // and an effect that read nothing would never run again.
  $effect(() => {
    const m = mode;
    client?.setMode(m);
  });

  $effect(() => {
    const c = contrast;
    client?.setContrast(c);
  });

  $effect(() => {
    const s = spanS;
    client?.setSpan(s);
  });

  $effect(() => {
    const s = txSlots;
    client?.setTxSlots(s);
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
    press = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, which: grabbed(at(e), width, rxHz, txHz, mode), g: 'pending' };
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
      width = box.getBoundingClientRect().width;
      const r = pic.getBoundingClientRect();
      height = r.height;
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (!w || !h || (w === size.w && h === size.h)) return;
      size = { w, h };
      if (!client) {
        client = new WaterfallClient(canvas, palette, mode, w, h, (info) => (frame = info));
        client.setContrast(contrast);
        client.setSpan(spanS);
        client.setTxSlots(txSlots);
        for (const w of recentTxWaves()) client.setTxWave(w);
      } else client.resize(w, h);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(pic);
    measure();
    const off = onAudioChunk((c) => {
      client?.push(c.samples, c.utcMs, c.index);
    });
    const offTx = onTxWave((w) => client?.setTxWave(w));
    return () => {
      off();
      offTx();
      ro.disconnect();
      client?.destroy();
      client = null;
    };
  });
</script>

<figure class="wf-wrap" aria-label="Waterfall, {view.minHz} to {view.maxHz} Hz, newest at the top">
  <!-- svelte-ignore a11y_no_static_element_interactions (the sliders below are the way in without a pointer) -->
  <div class="wf" class:dragging={!!live} bind:this={box} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} data-testid="waterfall-area">
    <div class="pic" bind:this={pic}>
      <canvas bind:this={canvas} data-testid="waterfall"></canvas>
      {#each labels as l (l.key)}
        <span class="tl" style:top="{l.top}px" aria-hidden="true">{l.text}</span>
      {/each}
      {#if stoppedAtUtcMs !== null}
        <span class="gap">No audio since {utcTime(stoppedAtUtcMs)}</span>
      {/if}
      {#if hint && !live}
        <span class="hint" data-testid="drag-hint">{rxHz === null ? 'Drag to move Tx.' : 'Drag to move Tx. Drag the green marker to move Rx.'}</span>
      {/if}
    </div>
    <div class="ruler" aria-hidden="true" bind:clientHeight={rulerH}>
      {#each axis.ticks as t (t.hz)}
        <i class="tick" class:major={t.major} style:left="{t.x * 100}%"></i>
      {/each}
      {#each axis.labels as l (l.hz)}
        <span class="rl" class:start={l.align === 'start'} class:end={l.align === 'end'} style:left="{l.x * 100}%">{l.text}</span>
      {/each}
    </div>
    {#if rxBand}
      <i class="mark rx" data-testid="rx-marker" style:left="calc({rxBand.x0 * 100}% - 1px)" style:width="calc({(rxBand.x1 - rxBand.x0) * 100}% + 2px)" aria-hidden="true"></i>
    {/if}
    {#if markBand}
      <i class="mark sel" data-testid="selected-marker" style:left="calc({markBand.x0 * 100}% - 1px)" style:width="calc({(markBand.x1 - markBand.x0) * 100}% + 2px)" aria-hidden="true"></i>
    {/if}
    <i class="mark tx" data-testid="tx-marker" style:left="calc({txBand.x0 * 100}% - 1px)" style:width="calc({(txBand.x1 - txBand.x0) * 100}% + 2px)" aria-hidden="true"></i>
    {#if live}
      <span class="tag {live.which}" bind:clientWidth={tagWidth} style:left="{tagLeft}px" data-testid="drag-label">{live.which === 'tx' ? 'Tx' : 'Rx'} {live.hz} Hz</span>
    {/if}
  </div>
  <input
    class="visually-hidden slider"
    type="range"
    min={limits.minHz}
    max={limits.maxHz}
    {step}
    value={txHz}
    aria-label="Transmit frequency, Hz"
    aria-valuetext="{txHz} Hz"
    onchange={(e) => set('tx', Number(e.currentTarget.value))}
  />
  {#if rxHz !== null}
    <input
      class="visually-hidden slider"
      type="range"
      min={limits.minHz}
      max={limits.maxHz}
      {step}
      value={rxHz}
      aria-label="Receive frequency, Hz"
      aria-valuetext="{rxHz} Hz"
      onchange={(e) => set('rx', Number(e.currentTarget.value))}
    />
  {/if}
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

    /* A drag surface: the browser pans or zooms nothing here, so a drag never moves the screen. */
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .wf.dragging {
    cursor: ew-resize;
  }

  /* The picture fills the waterfall; the ruler lies over its bottom edge. */
  .pic {
    position: absolute;
    inset: 0;
  }

  canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  .tl,
  .rl {
    position: absolute;
    height: 13px;
    font-family: var(--rr-mono);
    font-size: var(--rr-text-ruler);
    line-height: 13px;
    letter-spacing: 0;
    white-space: nowrap;
  }

  .tl {
    left: 6px;
    color: var(--rr-wf-text);
  }

  /* The ruler over the bottom of the picture: ticks on the bottom edge, a tick every 100 Hz and a
     taller one every 500 Hz, labels over the tall ones. It sits above the Tx and Rx markers, so
     their lines pass behind the numbers. */
  .ruler {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 2;
    height: var(--rr-ruler);
    background: var(--rr-wf-ruler-veil);
    pointer-events: none;
  }

  .tick {
    position: absolute;
    bottom: 0;
    width: var(--rr-hairline);
    height: 4px;
    background: var(--rr-wf-tick);
  }

  .tick.major {
    height: 7px;
    background: var(--rr-wf-tick-major);
  }

  .rl {
    bottom: 7px;
    color: var(--rr-wf-ruler-text);
    text-shadow:
      0 0 2px var(--rr-wf-bg),
      0 0 2px var(--rr-wf-bg);
    transform: translateX(-50%);
  }

  .rl.end {
    transform: translateX(calc(-100% - var(--rr-space-half)));
  }

  .rl.start {
    transform: translateX(var(--rr-space-half));
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

  /* A small pill at the bottom left of the picture, above the ruler. */
  .hint {
    position: absolute;
    bottom: calc(var(--rr-ruler) + var(--rr-space-1-5));
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

  /* A line at the lowest and the highest tone, through the picture and the ruler; a light fill
     between them over the picture. */
  .mark {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 1;
    border-right: 2px solid;
    border-left: 2px solid;
    pointer-events: none;
  }

  .mark::before {
    content: '';
    position: absolute;
    inset: 0 0 var(--rr-ruler) 0;
  }

  .mark.rx {
    border-color: var(--rr-wf-rx);
  }

  .mark.rx::before {
    background: var(--rr-wf-rx-band);
  }

  .mark.tx {
    border-color: var(--rr-wf-tx);
  }

  /* A selected spot: dashed accent lines, no fill, so its trace shows between them. */
  .mark.sel {
    border-style: dashed;
    border-color: var(--rr-accent);
  }

  .mark.tx::before {
    background: var(--rr-wf-tx-band);
  }

  .tag {
    position: absolute;
    top: var(--rr-space-4);
    z-index: 3;
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
    background: var(--rr-run);
  }

  /* Regular width: a taller ruler with 12 pt labels. */
  :global([data-size='regular']) .wf {
    --rr-ruler: var(--rr-ruler-regular);
  }

  :global([data-size='regular']) .rl {
    font-size: var(--rr-text-ruler-regular);
  }
</style>
