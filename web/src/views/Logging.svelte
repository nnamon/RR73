<script lang="ts">
  /**
   * Settings › Logging: the destinations, how sending runs, and the backup. Back up the log
   * shares one JSON file (lib/log/backup.ts); Import a log takes that file or ADIF from any
   * logger, and says what came in with Undo. Both act on the log, so they wait while the
   * practice band is on.
   */
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { utcHm } from '../lib/clock/format';
  import { backupFile, importLog, log, setFileDestination, setLoggingSettings, wavelogReady } from '../lib/log/log.svelte';
  import { shareFile } from '../lib/log/files';
  import { practice } from '../lib/state/practice.svelte';
  import type { FileDestinationId } from '../lib/log/types';
  import { hostOf } from '../lib/log/wavelog';
  import { features } from '../lib/state/features.svelte';

  const w = $derived(log.wavelog);
  const ready = $derived(wavelogReady(w));
  const station = $derived(w.stations.find((s) => s.id === w.stationId) ?? null);
  /** The latest refusal for the whole destination, which outranks an older successful test. */
  const refusal = $derived(
    log.ledger
      .filter((e) => e.destinationId === 'wavelog' && e.state === 'refused' && e.refusal?.scope === 'destination')
      .sort((a, b) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0))[0] ?? null,
  );
  const refused = $derived(refusal !== null);
  const wavelogState = $derived.by(() => {
    if (!w.url || !w.apiKey) return { text: 'Not set up', tone: '' };
    if (!w.enabled) return { text: 'Off', tone: '' };
    if ((refused && (!w.lastTest || (refusal?.lastAttemptAt ?? 0) >= w.lastTest.at)) || (w.lastTest && !w.lastTest.ok)) return { text: 'Refused', tone: 'bad' };
    if (w.lastTest?.ok) return { text: 'Connected', tone: 'ok' };
    return { text: 'Not tested', tone: '' };
  });

  // Backup and import.
  let status = $state('');
  let failed = $state(false);

  async function backUp() {
    const file = backupFile();
    const r = await shareFile(file);
    failed = false;
    status = r.kind === 'downloaded' ? `Downloaded ${file.name}` : r.kind === 'shared' ? `Shared ${file.name}` : '';
  }

  async function pick(e: Event & { currentTarget: HTMLInputElement }) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      failed = true;
      status = `${file.name} could not be read.`;
      return;
    }
    const r = await importLog(text);
    failed = !r.ok;
    status = r.ok ? '' : r.reason;
  }

  const files: { id: FileDestinationId; title: string; sub: string; icon: 'doc' | 'tree' | 'mountain'; bg: string }[] = [
    { id: 'pota-file', title: 'POTA', sub: 'File to upload at pota.app', icon: 'tree', bg: 'green' },
    { id: 'sota-file', title: 'SOTA', sub: 'File for the SOTA database', icon: 'mountain', bg: 'orange' },
    { id: 'wwff-file', title: 'WWFF', sub: 'File for your WWFF coordinator', icon: 'tree', bg: 'teal' },
    { id: 'adif-file', title: 'ADIF file', sub: 'One per activation, all fields', icon: 'doc', bg: 'grey' },
  ];
</script>

<section class="screen sub" aria-labelledby="logging-title">
  <BackLink to={href('settings')} label="Settings" title="Logging" id="logging-title" />

  <div class="section">
    <h2 class="section-head">Destinations</h2>
    <div class="group">
      <a class="row link" href={href('settings', 'logging', 'wavelog')}>
        <span class="ic blue" data-letter="W" aria-hidden="true"></span>
        <span class="row-main">
          <span class="row-title">Wavelog</span>
          {#if w.url}<span class="row-sub">{hostOf(w.url)}{log.settings.sendAutomatically ? ' · sends automatically' : ''}</span>{/if}
          {#if refusal && (!w.lastTest || (refusal.lastAttemptAt ?? 0) >= w.lastTest.at)}
            <span class="row-sub badt">Refused at {utcHm(refusal.lastAttemptAt ?? 0)} UTC: {refusal.lastError}</span>
          {:else if w.lastTest}
            <span class="row-sub" class:okt={w.lastTest.ok} class:badt={!w.lastTest.ok}>
              Tested {utcHm(w.lastTest.at)} UTC · {w.lastTest.ok ? 'can read and write' : w.lastTest.message}
            </span>
          {/if}
        </span>
        <span class="row-value {wavelogState.tone}">{wavelogState.text}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
      {#if ready}
        <a class="row link indent" href={href('settings', 'logging', 'wavelog')}>
          <span class="row-main">
            <span class="row-title">Station location</span>
            <span class="row-sub">{station ? `${station.name} · ${station.callsign}` : 'Not chosen'}</span>
          </span>
          <Icon name="chevright" size={13} class="row-chevron" />
        </a>
      {/if}
      <!-- Activation files belong to Activations (Settings › Optional features). -->
      {#each features.activations ? files : [] as f (f.id)}
        <label class="row">
          <span class="ic {f.bg}" aria-hidden="true"><Icon name={f.icon} size={20} /></span>
          <span class="row-main">
            <span class="row-title">{f.title}</span>
            <span class="row-sub">{f.sub}</span>
          </span>
          <input type="checkbox" role="switch" class="switch" checked={log.files[f.id].enabled} onchange={(e) => void setFileDestination(f.id, e.currentTarget.checked)} />
        </label>
      {/each}
    </div>
    {#if features.activations}<p class="section-foot">Files take only QSOs made in an activation.</p>{/if}
  </div>

  <div class="section">
    <h2 class="section-head">Sending</h2>
    <div class="group">
      <label class="row">
        <span class="row-main">
          <span class="row-title">Send automatically</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={log.settings.sendAutomatically} onchange={(e) => void setLoggingSettings({ sendAutomatically: e.currentTarget.checked })} />
      </label>
      <label class="row">
        <span class="row-main">
          <span class="row-title">Send edits to QSOs already sent</span>
          <span class="row-sub">Where the destination accepts changes</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={log.settings.sendEdits} onchange={(e) => void setLoggingSettings({ sendEdits: e.currentTarget.checked })} />
      </label>
    </div>
    <p class="section-foot">Wavelog takes no edits, so repeat each edit in Wavelog.</p>
  </div>

  <div class="section">
    <h2 class="section-head">Backup</h2>
    <div class="group">
      <button class="row act" disabled={practice.on || !log.qsos.length} onclick={() => void backUp()}>
        <span class="row-main">
          <span class="row-title">Back up the log</span>
          <span class="row-sub">QSOs, activations and what Wavelog holds</span>
        </span>
      </button>
      <label class="row act" class:off={practice.on}>
        <span class="row-main">
          <span class="row-title">Import a log</span>
          <span class="row-sub">A backup or an ADIF file</span>
        </span>
        <input class="visually-hidden" type="file" accept=".json,.adi,.adif,application/json,text/plain" disabled={practice.on} onchange={(e) => void pick(e)} data-testid="import-file" />
      </label>
    </div>
    {#if practice.on}
      <p class="section-foot">Turn off the practice band to back up or import the log.</p>
    {:else}
      <p class="section-foot" class:err={failed} role="status">{status || 'Imported QSOs are not sent to Wavelog.'}</p>
    {/if}
  </div>

</section>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

  .link {
    color: var(--rr-label);
  }

  .link :global(.row-chevron) {
    color: var(--rr-chev);
  }

  label.row {
    cursor: pointer;
  }

  .act {
    width: 100%;
    text-align: left;
  }

  .act .row-title {
    color: var(--rr-accent);
  }

  .act:disabled .row-title,
  .act.off .row-title {
    opacity: 0.4;
  }

  .err {
    color: var(--rr-tx-text);
  }

  .indent {
    padding-left: calc(var(--rr-space-4) + var(--rr-row-icon) + var(--rr-space-3));
  }

  .indent + :global(.row)::before {
    left: calc(var(--rr-space-4) + var(--rr-row-icon) + var(--rr-space-3));
  }

  .ic {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-row-icon);
    height: var(--rr-row-icon);
    border-radius: var(--rr-radius-m);
    color: var(--rr-on-fill);
  }

  .ic[data-letter]::before {
    content: attr(data-letter);
    font-size: var(--rr-text-callout);
    font-weight: var(--rr-weight-bold);
  }

  .blue {
    background: var(--rr-ic-blue);
  }

  .green {
    background: var(--rr-ic-green);
  }

  .orange {
    background: var(--rr-ic-orange);
  }

  .teal {
    background: var(--rr-ic-teal);
  }

  .grey {
    background: var(--rr-ic-grey);
  }

  .okt,
  .ok {
    color: var(--rr-ok);
  }

  .badt,
  .bad {
    color: var(--rr-tx-text);
  }

  .row-value {
    max-width: 40%;
  }
</style>
