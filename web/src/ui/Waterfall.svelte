<script lang="ts">
  /**
   * The live waterfall: newest time at the top, 0 to 3000 Hz across, slot lines labelled with
   * their UTC start. Drawing happens in the waterfall worker; this component sizes the canvas,
   * feeds it audio and places the labels.
   */
  import { onMount } from 'svelte';
  import { WaterfallClient } from '../lib/waterfall/client';
  import { paletteFrom } from '../lib/waterfall/colormap';
  import type { FrameInfo } from '../lib/waterfall/renderer';
  import { utcTime } from '../lib/clock/format';
  import type { Mode } from '../lib/clock/slots';
  import { onAudioChunk } from '../lib/state/station.svelte';
  import FreqAxis from './FreqAxis.svelte';

  let { mode, rxHz, txHz, stoppedAtUtcMs = null }: { mode: Mode; rxHz: number; txHz: number; stoppedAtUtcMs?: number | null } = $props();

  let box: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let client: WaterfallClient | null = null;
  let frame = $state<FrameInfo | null>(null);
  let dpr = $state(1);
  let started = $state(false);

  // Each label sits 14 px above its line; a label that would cross the top edge is dropped.
  const labels = $derived((frame?.boundaries ?? []).map((b) => ({ key: b.utcMs, text: utcTime(b.utcMs), top: b.y / dpr - 14 })).filter((l) => l.top >= 0));

  $effect(() => {
    client?.setMode(mode);
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
  <div class="wf" bind:this={box}>
    <canvas bind:this={canvas} data-testid="waterfall"></canvas>
    {#each labels as l (l.key)}
      <span class="tl" style:top="{l.top}px" aria-hidden="true">{l.text}</span>
    {/each}
    {#if stoppedAtUtcMs !== null}
      <span class="gap">No audio since {utcTime(stoppedAtUtcMs)}</span>
    {:else if !started}
      <span class="gap">The waterfall starts with the audio.</span>
    {/if}
  </div>
  <FreqAxis {rxHz} {txHz} />
</figure>

<style>
  .wf-wrap {
    display: flex;
    flex: none;
    flex-direction: column;
    margin: 0;
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
    right: 0;
    left: 0;
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
    color: var(--rr-wf-text);
    text-align: center;
  }
</style>
