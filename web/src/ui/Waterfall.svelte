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
   *
   * RTTY (`pair`) shows 0 to 3000 Hz over 30 s with no slot lines, and marks the pair it receives
   * and transmits on: two lines at mark and space, labelled M and S, with a light fill between,
   * green while receiving and red on air. A tap tunes to the strongest signal near it (`onfind`);
   * a drag moves the pair with the finger, keeping the shift (`ontune` on each move). With the
   * keyboard up it shrinks to a 48 pt strip without its ruler (`strip`).
   *
   * FT8 and FT4 can write the callsigns of a slot's decodes over their signals (`setCalls`,
   * lib/waterfall/calls.ts): a row at the bottom of the slot, beside its time, and a second row
   * above where the slot is tall enough. A label with a decode colour carries it on its left edge,
   * and a message to the operator a red one.
   */
  import { onMount } from 'svelte';
  import { WaterfallClient } from '../lib/waterfall/client';
  import { paletteFrom, type PaletteId } from '../lib/waterfall/colormap';
  import type { FrameInfo } from '../lib/waterfall/renderer';
  import { placeCalls, type WaterfallCall } from '../lib/waterfall/calls';
  import { FREQ_LIMITS, hzAtX, xOfHz } from '../lib/waterfall/pick';
  import { STEP_HZ_OF, classify, dragHz, grabbed, isTap, labelLeft, type Gesture, type Marker } from '../lib/waterfall/drag';
  import { bracket, denseRuler, ruler } from '../lib/waterfall/axis';
  import { layout } from '../lib/app/layout.svelte';
  import { viewOf } from '../lib/waterfall/spectrum';
  import type { Contrast } from '../lib/waterfall/levels';
  import { utcHm, utcTime } from '../lib/clock/format';
  import { SLOT_MS, type Mode } from '../lib/clock/slots';
  import { onAudioChunk, onTxWave, recentTxWaves } from '../lib/state/station.svelte';
  import { utcNow } from '../lib/clock/utc';

  let {
    mode,
    rxHz,
    txHz,
    markHz = null,
    txSlots = [],
    contrast = 'normal',
    palette = 'rr73',
    stoppedAtUtcMs = null,
    hint = false,
    onset,
    pair = null,
    ontune,
    onfind,
    strip = false,
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
    /** The colormap (Settings › Radio and audio › Waterfall colours). */
    palette?: PaletteId;
    stoppedAtUtcMs?: number | null;
    /** Shows the pill that says how to move Tx and Rx: until the first drag or tap. */
    hint?: boolean;
    onset: (f: { rxHz?: number; txHz?: number }) => void;
    /** RTTY's pair, Hz, and whether it is on air: replaces the Tx and Rx markers. */
    pair?: { markHz: number; spaceHz: number; air: boolean } | null;
    /** A drag on the pair: the new mark, Hz; `done` when the finger lifts. */
    ontune?: (markHz: number, done: boolean) => void;
    /** A tap with a pair: the frequency under the finger, Hz. */
    onfind?: (hz: number) => void;
    /** The keyboard is up: a 48 pt strip without the ruler. */
    strip?: boolean;
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

  // Callsigns over their signals. The label font is monospaced: a hidden probe of 10 characters,
  // padded as a label, and one of 20 give a character's width and the padding.
  let calls = $state.raw<WaterfallCall[]>([]);
  let probe10 = $state(0);
  let probe20 = $state(0);
  /** The callsigns to write over the slots on screen, highest rank first; [] for none. */
  export function setCalls(c: WaterfallCall[]) {
    calls = c;
  }
  const placed = $derived(
    calls.length && frame && !strip && mode !== 'WSPR' && mode !== 'RTTY' && probe20 > probe10
      ? placeCalls(calls, {
          lines: marks,
          slotPx: SLOT_MS[mode] / frame.rowMs / dpr,
          width,
          bottom: height - rulerH,
          charPx: (probe20 - probe10) / 10,
          padPx: probe10 - (probe20 - probe10),
          // The time label: 6 px in, "13:14:15" in the same monospaced size.
          timeRight: 6 + timeText(0).length * ((probe20 - probe10) / 10),
          xOf: (hz) => xOfHz(hz, mode),
        })
      : [],
  );
  // Regular width: labels as dense as 12 pt numbers allow, and four FT8 slots in the picture.
  const regular = $derived(layout.size === 'regular');
  const axis = $derived(regular && width ? denseRuler(mode, width) : ruler(mode));
  const spanS = $derived(regular && mode !== 'WSPR' ? 60 : null);
  const view = $derived(viewOf(mode));
  const step = $derived(STEP_HZ_OF[mode]);

  /** The press in progress, and the marker it moves once it is a drag. */
  let press: { id: number; x0: number; y0: number; t0: number; which: Marker; g: Gesture; mark0: number } | null = null;
  let live = $state<{ which: Marker; hz: number } | null>(null);
  let tagWidth = $state(96);
  const shownRx = $derived(live?.which === 'rx' ? live.hz : rxHz);
  const shownTx = $derived(live?.which === 'tx' ? live.hz : txHz);
  const tagLeft = $derived(live ? labelLeft(xOfHz(live.hz, mode) * width, tagWidth, width) : 0);
  const limits = $derived(FREQ_LIMITS[mode]);
  const rxBand = $derived(shownRx === null ? null : bracket(shownRx, mode));
  const txBand = $derived(bracket(shownTx, mode));
  const markBand = $derived(markHz === null ? null : bracket(markHz, mode));
  // RTTY's pair: the two lines, left to right, and which is mark.
  const pairLines = $derived(
    pair
      ? [
          { key: 'M', x: xOfHz(pair.markHz, mode) },
          { key: 'S', x: xOfHz(pair.spaceHz, mode) },
        ]
      : [],
  );
  const pairBand = $derived(pairLines.length ? { x0: Math.min(pairLines[0].x, pairLines[1].x), x1: Math.max(pairLines[0].x, pairLines[1].x) } : null);

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
    const p = palette;
    client?.setPalette(colours(p));
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

  /** The mark a drag puts the pair on: it moves with the finger from where the drag started. */
  function pairMark(e: PointerEvent, p: { x0: number; mark0: number }): number {
    const span = view.maxHz - view.minHz;
    return Math.round(p.mark0 + ((e.clientX - p.x0) / Math.max(1, width)) * span);
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || press) return;
    press = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, which: grabbed(at(e), width, rxHz, txHz, mode), g: 'pending', mark0: pair?.markHz ?? 0 };
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
    if (pair) {
      box.setPointerCapture?.(e.pointerId);
      ontune?.(pairMark(e, p), false);
      return;
    }
    if (!live) box.setPointerCapture?.(e.pointerId);
    live = { which: p.which, hz: dragHz(at(e), width, mode) };
  }

  function up(e: PointerEvent) {
    const p = press;
    if (!p || p.id !== e.pointerId) return;
    press = null;
    if (pair) {
      if (p.g === 'drag') ontune?.(pairMark(e, p), true);
      else if (p.g === 'pending' && isTap(e.clientX - p.x0, e.clientY - p.y0, e.timeStamp - p.t0)) onfind?.(hzAtX(at(e), width, mode));
      return;
    }
    const l = live;
    live = null;
    if (p.g === 'drag' && l) set(l.which, l.hz);
    else if (p.g === 'pending' && isTap(e.clientX - p.x0, e.clientY - p.y0, e.timeStamp - p.t0)) set(e.shiftKey && rxHz !== null ? 'rx' : 'tx', dragHz(at(e), width, mode));
  }

  function cancel(e: PointerEvent) {
    if (press?.id !== e.pointerId) return;
    press = null;
    live = null;
  }

  /** The quietest Tx frequency in the last slots, Hz, or null with less than 2 slots of audio. */
  export function quietest(): Promise<number | null> {
    return client ? client.quietest(utcNow(), txHz) : Promise.resolve(null);
  }

  /** A palette's colours, from the tokens. */
  function colours(id: PaletteId) {
    const style = getComputedStyle(document.documentElement);
    return paletteFrom((t) => style.getPropertyValue(t), id);
  }

  onMount(() => {
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
        client = new WaterfallClient(canvas, colours(palette), mode, w, h, (info) => (frame = info));
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
  <div class="wf" class:strip class:dragging={!!live} bind:this={box} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} data-testid="waterfall-area">
    <div class="pic" bind:this={pic}>
      <canvas bind:this={canvas} data-testid="waterfall"></canvas>
      {#each labels as l (l.key)}
        <span class="tl" style:top="{l.top}px" aria-hidden="true">{l.text}</span>
      {/each}
      {#each placed as c (c.key)}
        <span class="wc" class:edge={c.you || !!c.colour} style:--rr-wc-edge={c.you ? 'var(--rr-wf-tx)' : c.colour} style:left="{c.x}px" style:top="{c.top}px" aria-hidden="true" data-testid="wf-call">{c.text}</span>
      {/each}
      <span class="wc probe" aria-hidden="true" bind:clientWidth={probe10}>0000000000</span>
      <span class="wc probe" aria-hidden="true" bind:clientWidth={probe20}>00000000000000000000</span>
      {#if stoppedAtUtcMs !== null}
        <span class="gap">No audio since {utcTime(stoppedAtUtcMs)}</span>
      {/if}
      {#if hint && !live && !strip}
        <span class="hint" data-testid="drag-hint">{pair ? 'Tap a signal to tune' : rxHz === null ? 'Drag to move Tx.' : 'Drag to move Tx. Drag the green marker to move Rx.'}</span>
      {/if}
    </div>
    <div class="ruler" class:gone={strip} aria-hidden="true" bind:clientHeight={rulerH}>
      {#each axis.ticks as t (t.hz)}
        <i class="tick" class:major={t.major} style:left="{t.x * 100}%"></i>
      {/each}
      {#each axis.labels as l (l.hz)}
        <span class="rl" class:start={l.align === 'start'} class:end={l.align === 'end'} style:left="{l.x * 100}%">{l.text}</span>
      {/each}
    </div>
    {#if pairBand}
      <i class="pair" class:air={pair?.air} data-testid="pair-marker" style:left="{pairBand.x0 * 100}%" style:width="{(pairBand.x1 - pairBand.x0) * 100}%" aria-hidden="true"></i>
      {#each pairLines as l (l.key)}
        <i class="pl" class:air={pair?.air} style:left="calc({l.x * 100}% - 1px)" aria-hidden="true"></i>
        <span class="pt" style:left="{l.x * 100}%" aria-hidden="true">{l.key}</span>
      {/each}
    {:else if rxBand}
      <i class="mark rx" data-testid="rx-marker" style:left="calc({rxBand.x0 * 100}% - 1px)" style:width="calc({(rxBand.x1 - rxBand.x0) * 100}% + 2px)" aria-hidden="true"></i>
    {/if}
    {#if markBand}
      <i class="mark sel" data-testid="selected-marker" style:left="calc({markBand.x0 * 100}% - 1px)" style:width="calc({(markBand.x1 - markBand.x0) * 100}% + 2px)" aria-hidden="true"></i>
    {/if}
    {#if !pair}
      <i class="mark tx" data-testid="tx-marker" style:left="calc({txBand.x0 * 100}% - 1px)" style:width="calc({(txBand.x1 - txBand.x0) * 100}% + 2px)" aria-hidden="true"></i>
    {/if}
    {#if live}
      <span class="tag {live.which}" bind:clientWidth={tagWidth} style:left="{tagLeft}px" data-testid="drag-label">{live.which === 'tx' ? 'Tx' : 'Rx'} {live.hz} Hz</span>
    {/if}
  </div>
  {#if pair}
    <input
      class="visually-hidden slider"
      type="range"
      min={limits.minHz}
      max={limits.maxHz}
      step="1"
      value={pair.markHz}
      aria-label="Mark tone, Hz"
      aria-valuetext="{Math.round(pair.markHz)} Hz"
      onchange={(e) => ontune?.(Number(e.currentTarget.value), true)}
    />
  {:else}
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
  {/if}
  {#if rxHz !== null && !pair}
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

  .wf.strip {
    height: var(--rr-wf-strip);
  }

  .ruler.gone {
    display: none;
  }

  /* RTTY's pair: a light fill between mark and space over the picture, a 2 pt line at each tone
     through the picture and the ruler, and M and S at the top. */
  .pair {
    position: absolute;
    top: 0;
    bottom: var(--rr-ruler);
    z-index: 1;
    background: var(--rr-wf-rx-band);
    pointer-events: none;
  }

  .wf.strip .pair {
    bottom: 0;
  }

  .pair.air {
    background: var(--rr-wf-tx-band);
  }

  .pl {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 1;
    width: 2px;
    background: var(--rr-wf-rx);
    pointer-events: none;
  }

  .pl.air {
    background: var(--rr-wf-tx);
  }

  .pt {
    position: absolute;
    top: var(--rr-space-half);
    z-index: 2;
    padding: 0 var(--rr-space-half);
    border-radius: var(--rr-radius-xs);
    background: var(--rr-wf-tag-bg);
    color: var(--rr-wf-text);
    font-family: var(--rr-mono);
    font-size: var(--rr-text-ruler);
    font-weight: var(--rr-weight-semibold);
    line-height: 13px;
    transform: translateX(-50%);
    pointer-events: none;
  }

  .wf.strip .pt {
    display: none;
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

  /* In Sun the time sits on a dark tag, 2 px wider all round, which leaves its place as it is. */
  .tl {
    left: 6px;
    border-radius: var(--rr-radius-xs);
    background: var(--rr-wf-time-bg);
    box-shadow: 0 0 0 var(--rr-space-half) var(--rr-wf-time-bg);
    color: var(--rr-wf-text);
  }

  /* A callsign over its signal: as the time labels, on a tag, with the decode colour on its edge. */
  .wc {
    position: absolute;
    height: 13px;
    padding: 0 var(--rr-space-half);
    border-radius: var(--rr-radius-xs);
    background: var(--rr-wf-tag-bg);
    color: var(--rr-wf-text);
    font-family: var(--rr-mono);
    font-size: var(--rr-text-ruler);
    font-weight: var(--rr-weight-semibold);
    line-height: 13px;
    white-space: nowrap;
    pointer-events: none;
  }

  .wc.edge {
    border-radius: 0 var(--rr-radius-xs) var(--rr-radius-xs) 0;
    box-shadow: inset 2px 0 0 var(--rr-wc-edge);
  }

  .wc.probe {
    visibility: hidden;
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

  /* Over the callsign labels, on a scrim of its own. */
  .gap {
    position: absolute;
    top: var(--rr-space-4);
    left: 50%;
    z-index: 1;
    padding: 0 var(--rr-space-2);
    border-radius: var(--rr-radius-xs);
    background: var(--rr-wf-scrim);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    color: var(--rr-wf-text);
    white-space: nowrap;
    transform: translateX(-50%);
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
