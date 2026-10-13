<script lang="ts">
  /**
   * Fix for a QSO Wavelog refused for its station location: choose the station location for the
   * QSO's activation, or the default for QSOs outside one. Refused QSOs go again at once.
   */
  import Sheet from './Sheet.svelte';
  import { href } from '../lib/app/router.svelte';
  import { refsLabel } from '../lib/log/activation';
  import { chooseStation, log, stationFor } from '../lib/log/log.svelte';
  import type { Qso } from '../lib/log/types';

  let { open = $bindable(false), qso }: { open: boolean; qso: Qso | null } = $props();

  const activation = $derived(qso?.activationId ? log.activations.find((a) => a.id === qso.activationId) : undefined);
  const current = $derived(qso ? stationFor(qso) : null);
  const call = $derived(qso?.stationCallsign ?? '');
  const matching = $derived(log.wavelog.stations.filter((s) => s.callsign === call));

  async function pick(id: string) {
    if (!qso) return;
    open = false;
    await chooseStation(id, activation?.id ?? null);
  }
</script>

<Sheet bind:open title="Choose a station location">
  {#if qso}
    <p class="lead">
      The QSO with {qso.call} was made as <b class="mono">{call}</b>. Wavelog takes it only under a station location for {call}.
      {activation ? `The choice applies to the activation ${refsLabel(activation.refs)}.` : 'The choice applies to QSOs outside an activation.'}
    </p>
    {#if log.wavelog.stations.length}
      <ul class="card">
        {#each log.wavelog.stations as s (s.id)}
          <li>
            <button class="row pick" aria-pressed={s.id === current} onclick={() => void pick(s.id)}>
              <span class="row-main">
                <span class="row-title">{s.name}</span>
                <span class="row-sub">{s.callsign}{s.grid ? ` · ${s.grid}` : ''}{s.id === current ? ' · in use' : ''}</span>
              </span>
              {#if s.callsign === call}<span class="match">For {call}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if !matching.length}
      <p class="lead">No station location in Wavelog is for {call}. Create one in Wavelog, then run Test connection.</p>
      <a class="text-button open-settings" href={href('settings', 'logging', 'wavelog')} onclick={() => (open = false)}>Open Wavelog settings</a>
    {/if}
  {/if}
  <button class="btn cancel" onclick={() => (open = false)}>Cancel</button>
</Sheet>

<style>
  .lead {
    margin: var(--rr-space-3) var(--rr-space-1) 0;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }

  .lead b {
    color: var(--rr-label);
  }

  .card {
    margin-top: var(--rr-space-3);
    overflow: hidden;
    border-radius: var(--rr-radius-xl);
    background: var(--rr-sheet-card);
  }

  .pick {
    color: var(--rr-label);
  }

  .pick[aria-pressed='true'] .row-title {
    font-weight: var(--rr-weight-semibold);
  }

  .match {
    flex: none;
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-semibold);
    color: var(--rr-ok);
  }

  .open-settings {
    display: flex;
    justify-content: center;
  }

  li + li {
    box-shadow: inset 0 var(--rr-hairline) 0 var(--rr-sep);
  }

  .cancel {
    width: 100%;
    margin-top: var(--rr-space-3);
    background: transparent;
    color: var(--rr-accent);
  }
</style>
