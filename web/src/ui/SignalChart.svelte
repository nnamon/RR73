<script lang="ts">
  /**
   * A station's SNR over its last slots (lib/decode/signal.ts), oldest on the left: a line through
   * the slots it was decoded in, a dashed mark where it was not, the latest point larger. Grid
   * lines every 10 dB, labelled on the right; the first and last slot times under it. Screen
   * readers get the values in order.
   */
  import { utcTime } from '../lib/clock/format';
  import type { SignalPoint } from '../lib/decode/signal';

  let { points }: { points: readonly SignalPoint[] } = $props();

  const H = 104;
  /** Room above, below (the times), left and right (the dB labels), px. */
  const TOP = 8;
  const BOTTOM = 18;
  const LEFT = 8;
  const RIGHT = 30;

  let width = $state(0);
  const snrs = $derived(points.flatMap((p) => (p.snrDb === null ? [] : [p.snrDb])));
  // The scale: whole 5 dB steps, at least −25 to 0 dB.
  const lo = $derived(Math.min(-25, Math.floor((Math.min(...snrs) - 3) / 5) * 5));
  const hi = $derived(Math.max(0, Math.ceil((Math.max(...snrs) + 3) / 5) * 5));
  const x = (i: number) => LEFT + (points.length > 1 ? (i / (points.length - 1)) * (width - LEFT - RIGHT) : 0);
  const y = (v: number) => TOP + ((hi - v) / (hi - lo)) * (H - TOP - BOTTOM);
  const grid = $derived(Array.from({ length: Math.floor((hi - lo) / 10) + 1 }, (_, i) => Math.floor(hi / 10) * 10 - i * 10).filter((v) => v > lo && v < hi));
  // Runs of decoded slots, each drawn as one line.
  const runs = $derived.by(() => {
    const out: string[] = [];
    let cur: string[] = [];
    points.forEach((p, i) => {
      if (p.snrDb === null) {
        if (cur.length) out.push(cur.join(' '));
        cur = [];
      } else cur.push(`${x(i).toFixed(1)},${y(p.snrDb).toFixed(1)}`);
    });
    if (cur.length) out.push(cur.join(' '));
    return out;
  });
  const minus = (v: number) => (v < 0 ? `−${-v}` : `${v}`);
  const spoken = $derived(`SNR over the last ${points.length} slots, oldest first: ${points.map((p) => (p.snrDb === null ? 'no decode' : `${minus(Math.round(p.snrDb))} dB`)).join(', ')}`);
</script>

<figure class="card">
  <figcaption class="head"><span>Signal over the last {points.length} slots</span><span class="unit">SNR, dB</span></figcaption>
  <div class="plot" bind:clientWidth={width}>
    {#if width}
      <svg {width} height={H} viewBox="0 0 {width} {H}" role="img" aria-label={spoken} data-testid="signal-chart">
        {#each grid as v (v)}
          <line class="grid" x1={LEFT} x2={width - RIGHT + 4} y1={y(v)} y2={y(v)} />
          <text class="yl" x={width} y={y(v) + 4}>{minus(v)}</text>
        {/each}
        {#each runs as r, i (i)}
          <polyline class="ln" points={r} />
        {/each}
        {#each points as p, i (p.slotStartMs)}
          {#if p.snrDb === null}
            <line class="miss" x1={x(i)} x2={x(i)} y1={TOP + 3} y2={H - BOTTOM - 1} />
          {:else}
            <circle class="pt" class:last={i === points.length - 1} cx={x(i)} cy={y(p.snrDb)} r={i === points.length - 1 ? 4.5 : 2.6} />
          {/if}
        {/each}
        <text class="xl" x={LEFT} y={H - 3}>{utcTime(points[0].slotStartMs)}</text>
        <text class="xl end" x={x(points.length - 1)} y={H - 3}>{utcTime(points[points.length - 1].slotStartMs)}</text>
      </svg>
    {/if}
  </div>
</figure>

<style>
  .card {
    margin: var(--rr-space-3) 0 0;
    padding: var(--rr-space-3) var(--rr-space-4);
    border-radius: var(--rr-radius-l);
    background: var(--rr-sheet-card);
  }

  .head {
    display: flex;
    justify-content: space-between;
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
  }

  .unit {
    font-weight: var(--rr-weight-regular);
    color: var(--rr-label2);
  }

  .plot {
    margin-top: var(--rr-space-2);
  }

  svg {
    display: block;
    overflow: visible;
  }

  .grid {
    stroke: var(--rr-sep);
    stroke-width: 1;
  }

  .yl,
  .xl {
    fill: var(--rr-label2);
    font-size: var(--rr-text-axis);
    font-variant-numeric: tabular-nums;
  }

  .yl,
  .xl.end {
    text-anchor: end;
  }

  .ln {
    fill: none;
    stroke: var(--rr-accent);
    stroke-width: 2;
    stroke-linejoin: round;
  }

  .pt {
    fill: var(--rr-accent);
  }

  .pt.last {
    stroke: var(--rr-sheet-card);
    stroke-width: 2;
  }

  .miss {
    stroke: var(--rr-label3);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
</style>
