<script lang="ts">
  /**
   * The night display over Operate: black, with the UTC clock, the next transmission or the
   * one on air, and the newest slot's stations in dim red (lib/display/night.ts). The text moves
   * a few points each minute so no pixel stays lit. A tap anywhere wakes Operate. Halt stays on
   * it, as everywhere output can play, while Tx or the beacon is on. A key wakes it as well.
   */
  import { onDestroy } from 'svelte';
  import { clock } from '../lib/state/now.svelte';
  import { familyOf } from '../views/operate/panes';
  import { ftNight, wsprNight } from '../lib/display/night';
  import { night, wakeNight } from '../lib/state/night.svelte';
  import { qso } from '../lib/state/qso.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { band, halt, tx } from '../lib/state/station.svelte';
  import { wspr } from '../lib/state/wspr.svelte';

  const family = $derived(familyOf(settings.mode));
  const view = $derived(
    family === 'wspr'
      ? wsprNight(clock.ms, { nextSlotMs: wspr.next?.slotStartMs ?? null, onAir: !!wspr.onAir }, wspr.slots.find((s) => s.spots.length) ?? null)
      : ftNight(clock.ms, { next: qso.st.next && !qso.onAir ? { text: qso.st.next.text, slotStartMs: qso.st.next.slotStartMs } : null, onAir: qso.onAir ? { text: qso.onAir.text } : null }, band.slots.find((s) => s.decodes.length) ?? null, settings.callsign),
  );
  // Output can play: Halt shows.
  const live = $derived(tx.tuning || (family === 'wspr' ? wspr.beacon.on || !!wspr.onAir : qso.st.txEnabled || !!qso.onAir));
  // A few points each minute, back and forth, so no pixel stays lit.
  const shift = $derived(Math.floor(clock.ms / 60_000) % 8);

  // Leaving Operate or switching to a keyboard mode ends it, so it never waits behind another screen.
  onDestroy(wakeNight);
</script>

{#if night.on}
  <div class="night" role="dialog" aria-modal="true" aria-label="Night display" data-testid="night-display">
    <button class="wake" aria-label="Wake the display" onclick={wakeNight}>
      <span class="body" style:transform="translate({(shift % 4) * 6}px, {Math.floor(shift / 4) * 10}px)">
        <span class="clock">{view.clock}</span>
        <span class="utc">UTC</span>
        {#if view.tx}<span class="tx" class:air={view.onAir}>{view.tx}</span>{/if}
        {#if view.heard.length}
          <span class="heard-at">Heard at {view.heardAt}</span>
          {#each view.heard as h (h)}<span class="heard">{h}</span>{/each}
        {/if}
        <span class="hint">Tap to wake</span>
      </span>
    </button>
    {#if live}<button class="halt" onclick={() => halt()}>Halt</button>{/if}
  </div>
{/if}

<style>
  .night {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    padding: calc(var(--rr-safe-top) + var(--rr-space-6)) var(--rr-space-4) calc(var(--rr-safe-bottom) + var(--rr-space-4));
    background: var(--rr-night-bg);
    color: var(--rr-night-text);
    color-scheme: dark;
  }

  .wake {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: stretch;
    color: inherit;
    text-align: left;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--rr-space-1);
  }

  .clock {
    font-size: var(--rr-text-countdown);
    font-weight: var(--rr-weight-medium);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .utc {
    font-size: var(--rr-text-sub);
  }

  .tx {
    margin-top: var(--rr-space-4);
    font-size: var(--rr-text-body);
    font-family: var(--rr-mono);
  }

  .tx.air {
    font-weight: var(--rr-weight-bold);
  }

  .heard-at {
    margin-top: var(--rr-space-4);
    font-size: var(--rr-text-foot);
  }

  .heard {
    font-family: var(--rr-mono);
    font-size: var(--rr-text-sub);
  }

  .hint {
    margin-top: var(--rr-space-4);
    font-size: var(--rr-text-foot);
  }

  .halt {
    flex: none;
    min-height: var(--rr-button-large);
    border-radius: var(--rr-radius-pill);
    box-shadow: inset 0 0 0 2px var(--rr-night-line);
    color: var(--rr-night-text);
    font-size: var(--rr-text-halt);
    font-weight: var(--rr-weight-bold);
  }
</style>
