<script lang="ts">
  /**
   * Frequency axis under the waterfall: 100 Hz and 500 Hz ticks, green Rx and red Tx brackets as
   * in WSJT-X. A tap on it picks the frequency under the finger (the waterfall handles the
   * pointer); screen readers get the frequencies from the waterfall's Set frequencies button.
   */
  import { bracket, ticks } from '../lib/waterfall/axis';
  import { SIGNAL_HZ } from '../lib/waterfall/pick';
  import type { Mode } from '../lib/clock/slots';

  let { rxHz, txHz, mode }: { rxHz: number; txHz: number; mode: Mode } = $props();
  const all = ticks();
  const width = $derived(SIGNAL_HZ[mode]);
  const rx = $derived(bracket(rxHz, width));
  const tx = $derived(bracket(txHz, width));
  // When the brackets overlap, Tx sits lower with shorter legs so both stay visible.
  const same = $derived(Math.abs(rxHz - txHz) < width);
</script>

<div class="axis" data-testid="freq-axis" aria-hidden="true">
  <span class="marks">
    {#each all as t (t.hz)}
      <i class="tick" class:major={t.major} style:left="{t.x * 100}%"></i>
      {#if t.label}<span class="label" style:left="{t.x * 100}%">{t.label}</span>{/if}
    {/each}
    <i class="bracket tx" class:same data-testid="tx-bracket" style:left="{tx.x0 * 100}%" style:width="{(tx.x1 - tx.x0) * 100}%"></i>
    <i class="bracket rx" class:same data-testid="rx-bracket" style:left="{rx.x0 * 100}%" style:width="{(rx.x1 - rx.x0) * 100}%"></i>
  </span>
</div>

<style>
  .axis {
    position: relative;
    flex: none;
    height: var(--rr-axis);
    background: var(--rr-plain);
    box-shadow: inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
  }

  .marks {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .tick {
    position: absolute;
    top: 0;
    width: 1px;
    height: 3.5px;
    transform: translateX(-50%);
    background: var(--rr-label3);
    opacity: 0.6;
  }

  .tick.major {
    height: 6px;
    opacity: 1;
  }

  .label {
    position: absolute;
    bottom: 3px;
    font-family: var(--rr-mono);
    font-size: var(--rr-text-axis);
    line-height: 12px;
    letter-spacing: 0;
    color: var(--rr-label3);
    transform: translateX(-50%);
  }

  .bracket {
    position: absolute;
    top: 0;
    height: 7.5px;
    border: 2px solid currentcolor;
    border-bottom: 0;
  }

  .bracket.rx {
    color: var(--rr-cq);
  }

  .bracket.tx {
    color: var(--rr-tx);
  }

  .bracket.rx.same {
    height: 3.5px;
  }

  .bracket.tx.same {
    top: 4.5px;
    height: 5px;
  }
</style>
