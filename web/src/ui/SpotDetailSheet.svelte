<script lang="ts">
  /**
   * A WSPR spot's details, from touch and hold: the frequency on air to 1 Hz, DT, drift, distance
   * and bearing, the reported power in watts, and how often the station was heard in the slots
   * Operate keeps.
   */
  import Sheet from './Sheet.svelte';
  import { MINUS, dt, signed, utcHm } from '../lib/clock/format';
  import { powerText } from '../lib/wspr/power';
  import type { Spot } from '../lib/wspr/spots';
  import { heard } from '../lib/state/wspr.svelte';

  let { open = $bindable(false), spot }: { open: boolean; spot: Spot | null } = $props();

  const mhz = (hz: number) => `${(hz / 1e6).toFixed(6)} MHz`;
  const drift = (hz: number) => {
    const v = Math.round(hz);
    return `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v)} Hz`;
  };
  const times = $derived(spot?.call ? heard(spot.call) : null);
</script>

<Sheet bind:open title={spot?.call ?? 'Unknown callsign'}>
  {#if spot}
    <p class="sub">
      {[spot.grid, spot.km === null ? null : `${Math.round(spot.km).toLocaleString('en-GB')} km`, spot.bearingDeg === null ? null : `${Math.round(spot.bearingDeg)}°`].filter(Boolean).join(' · ') || 'No grid received'}
    </p>
    <ul class="group facts">
      <li class="row">
        <span class="row-title">Frequency</span>
        <span class="row-value mono">{mhz(spot.freqHz)}</span>
      </li>
      <li class="row">
        <span class="row-title">SNR</span>
        <span class="row-value">{signed(Math.round(spot.snrDb))} dB</span>
      </li>
      <li class="row">
        <span class="row-title">DT</span>
        <span class="row-value">{dt(spot.dtS)} s</span>
      </li>
      <li class="row">
        <span class="row-title">Drift</span>
        <span class="row-value">{drift(spot.driftHz)}</span>
      </li>
      <li class="row">
        <span class="row-title">Power</span>
        <span class="row-value">{spot.powerDbm === null ? '' : powerText(spot.powerDbm)}</span>
      </li>
      {#if times && times.sinceMs !== null}
        <li class="row">
          <span class="row-title">Heard</span>
          <span class="row-value">{times.count === 1 ? 'Once' : `${times.count} times`} since {utcHm(times.sinceMs)}</span>
        </li>
      {/if}
      <li class="row">
        <span class="row-main"><span class="row-title">Message</span><span class="row-sub mono">{spot.text}</span></span>
      </li>
    </ul>
  {/if}
</Sheet>

<style>
  .sub {
    margin-top: var(--rr-space-1);
    font-size: var(--rr-text-sub);
    color: var(--rr-label2);
    text-align: center;
  }

  .facts {
    margin-top: var(--rr-space-3);
    background: var(--rr-sheet-card);
  }

  .row-value {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
</style>
