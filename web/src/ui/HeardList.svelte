<script lang="ts">
  /**
   * Spots › Heard you: the stations that reported the operator's signal to PSK Reporter in the
   * last 30 min, newest first, live from its MQTT feed (lib/state/heard.svelte.ts). Each row: the
   * receiver, its grid and distance, the band, the SNR it heard and the time.
   */
  import { utcHm } from '../lib/clock/format';
  import { gridPath, normaliseGrid } from '../lib/reference/grid';
  import { heard } from '../lib/state/heard.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { settings } from '../lib/state/settings.svelte';

  const km = (locator: string) => {
    const p = gridPath(settings.grid, locator);
    return p ? `${Math.round(p.km).toLocaleString('en-GB')} km` : null;
  };
  const snr = (db: number | null) => (db === null ? '' : `${db < 0 ? '−' : '+'}${String(Math.abs(Math.round(db))).padStart(2, '0')} dB`);

  const empty = $derived.by(() => {
    if (!settings.callsign.trim()) return 'Set your callsign in Settings to see who hears you.';
    if (practice.on) return 'Paused while the practice band is on.';
    if (heard.feed === 'refused') return 'PSK Reporter’s feed refused the connection.';
    if (heard.feed === 'retrying') return 'PSK Reporter’s feed is unreachable. Trying again.';
    if (heard.feed === 'connecting') return 'Connecting to PSK Reporter’s feed.';
    return 'Stations that report your signal to PSK Reporter appear here within minutes of each transmission.';
  });
</script>

<div class="section">
  <h2 class="section-head">Heard you{heard.list.length ? ` · ${heard.list.length}` : ''}</h2>
  {#if heard.list.length}
    <ul class="group" aria-label="Stations that heard you in the last 30 minutes">
      {#each heard.list as h (`${h.receiver}|${h.band}`)}
        {@const dist = km(h.locator)}
        <li class="row hr">
          <span class="row-main">
            <span class="row-title mono">{h.receiver}</span>
            <span class="row-sub">{[normaliseGrid(h.locator) || h.locator.slice(0, 4), dist, h.band].filter(Boolean).join(' · ')}</span>
          </span>
          <span class="side">
            <span class="snr mono">{snr(h.snrDb)}</span>
            <span class="row-sub mono">{utcHm(h.atS * 1000)}</span>
          </span>
        </li>
      {/each}
    </ul>
    <p class="section-foot">Last 30 min, from PSK Reporter. Times are UTC.</p>
  {:else}
    <div class="group"><p class="none" role="status">{empty}</p></div>
  {/if}
</div>

<style>
  .side {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: flex-end;
  }

  .snr {
    font-size: var(--rr-text-body);
    color: var(--rr-label);
  }

  .none {
    padding: var(--rr-space-3) var(--rr-space-4);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }
</style>
