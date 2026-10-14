<script lang="ts">
  /**
   * The log: every QSO on this phone by UTC day, the To do list (not sent, waiting, refused and changed
   * QSOs and files not yet submitted) and the activations with their files. Export ADIF shares
   * what is shown.
   */
  import ActivationCard from '../ui/ActivationCard.svelte';
  import Icon from '../ui/Icon.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import BackLink from '../ui/BackLink.svelte';
  import QsoRow from '../ui/QsoRow.svelte';
  import StationSheet from '../ui/StationSheet.svelte';
  import { go, href, route } from '../lib/app/router.svelte';
  import { buildExport, shareFile } from '../lib/log/files';
  import SendBar from '../ui/SendBar.svelte';
  import { log, markQsoHandled, openEditor, retryQso } from '../lib/log/log.svelte';
  import { activationFiles, groupByDay, matches, todoQsos } from '../lib/log/view';
  import type { LedgerEntry, Qso } from '../lib/log/types';
  import { features } from '../lib/state/features.svelte';
  import { clock } from '../lib/state/now.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { storageWaiting } from '../lib/state/storage.svelte';

  type View = 'all' | 'todo' | 'activations';
  const PAGE = 100;

  let view = $state<View>(route.path[1] === 'todo' || (route.path[1] === 'activations' && features.activations) ? route.path[1] : 'all');
  let query = $state('');
  let shown = $state(PAGE);
  let stationOpen = $state(false);
  let stationQso = $state<Qso | null>(null);
  let status = $state('');

  const found = $derived(log.live.filter((q) => matches(q, query)));
  const groups = $derived(groupByDay(found.slice(0, shown), clock.ms));
  const todo = $derived(todoQsos(log.qsos, log.index, log.facts).filter((q) => matches(q, query)));
  // Activation files are part of Activations (Settings › Optional features).
  const fileActivations = $derived(features.activations ? log.activations.filter((a) => activationFiles(a, log.qsos, log.index, log.facts).some((f) => f.state !== 'submitted')) : []);
  const todoCount = $derived(todo.length + fileActivations.reduce((n, a) => n + activationFiles(a, log.qsos, log.index, log.facts).filter((f) => f.state !== 'submitted').length, 0));
  const activations = $derived(
    log.activations.filter((a) => !query.trim() || a.refs.some((r) => r.ref.includes(query.trim().toUpperCase())) || log.live.some((q) => q.activationId === a.id && matches(q, query))),
  );

  const views = $derived<{ id: View; label: string }[]>([
    { id: 'all', label: 'All' },
    { id: 'todo', label: 'To do' },
    ...(features.activations ? [{ id: 'activations' as const, label: 'Activations' }] : []),
  ]);
  // Turning Activations off while its view shows goes back to All.
  $effect(() => {
    if (view === 'activations' && !features.activations) view = 'all';
  });

  function fix(qso: Qso, e: LedgerEntry) {
    if (e.state === 'changed') return void markQsoHandled(qso.id, e.destinationId);
    const kind = e.refusal?.fix;
    if (kind === 'resend') return void retryQso(qso.id, e.destinationId);
    if (kind === 'edit-qso') return openEditor(qso.id);
    if (kind === 'wavelog-station' && log.wavelog.stations.length) {
      stationQso = qso;
      stationOpen = true;
      return;
    }
    go('settings', 'logging', 'wavelog');
  }

  /** Exports what the current view shows, built before the share sheet opens. */
  async function exportAdif() {
    const list = view === 'todo' ? todo.filter((q) => q.deletedAt === null) : view === 'activations' ? log.live.filter((q) => q.activationId !== null && matches(q, query)) : found;
    const file = buildExport(list, settings.callsign, { programVersion: __APP_VERSION__, now: Date.now() });
    const r = await shareFile(file);
    status = r.kind === 'downloaded' ? `Downloaded ${file.name}` : r.kind === 'shared' ? `Shared ${file.name}` : '';
  }

</script>

<section class="screen" aria-labelledby="log-title">
  <BackLink to={href('operate')} label="Operate" title={practice.on ? 'Practice log' : 'Log'} id="log-title">
    {#snippet trailing()}
      <button class="bar-button" aria-label="Add QSO" onclick={() => openEditor(null)}><Icon name="plus" size={24} /></button>
      <button class="bar-button" aria-label="Export ADIF" disabled={!log.live.length} onclick={() => void exportAdif()}><Icon name="share" size={24} /></button>
    {/snippet}
  </BackLink>

  {#if log.storageError}
    <p class="banner" role="alert">{log.storageError}</p>
  {/if}

  <div class="section">
    <label class="search">
      <Icon name="search" size={17} />
      <span class="visually-hidden">Search the log</span>
      <input type="search" bind:value={query} placeholder="Callsign, grid or park" autocomplete="off" spellcheck="false" autocapitalize="characters" />
    </label>
  </div>

  <div class="section">
    <div class="seg" role="radiogroup" aria-label="Show">
      {#each views as v (v.id)}
        <label class="seg-i" class:on={view === v.id}>
          <input class="visually-hidden" type="radio" name="log-view" value={v.id} checked={view === v.id} onchange={() => ((view = v.id), (shown = PAGE))} />
          {v.label}{#if v.id === 'todo' && todoCount}<span class="n">&nbsp;{todoCount}</span>{/if}
        </label>
      {/each}
    </div>
  </div>

  {#if !log.ready}
    <p class="loading">{storageWaiting() ? 'The log opens when other copies of RR73 close.' : 'Loading the log'}</p>
  {:else if view === 'all'}
    {#if !log.live.length}
      <div class="empty">
        <h2>No QSOs yet</h2>
        <p>QSOs you log on Operate appear here, newest first. Add one by hand with Add QSO.</p>
      </div>
    {:else}
      <SendBar />
      {#if !found.length}
        <div class="empty"><h2>No QSOs match “{query.trim()}”</h2><p>Search by callsign, grid, park or summit.</p></div>
      {:else}
        {#each groups as g (g.key)}
          <div class="section">
            <h2 class="section-head">{g.label}</h2>
            <ul class="group">
              {#each g.qsos as q (q.id)}<QsoRow qso={q} onfix={fix} />{/each}
            </ul>
          </div>
        {/each}
        {#if found.length > shown}
          <div class="section more"><button class="btn" onclick={() => (shown += PAGE)}>Show {Math.min(PAGE, found.length - shown)} older QSOs</button></div>
        {/if}
        {#if features.activations && activations.length && !query.trim()}
          <div class="section">
            <h2 class="section-head">Activations</h2>
            {#each activations.slice(0, 3) as a (a.id)}<div class="group card"><ActivationCard activation={a} /></div>{/each}
          </div>
        {/if}
      {/if}
    {/if}
  {:else if view === 'todo'}
    <SendBar />
    {#if !todo.length && !fileActivations.length}
      <div class="empty">
        <h2>Nothing to do</h2>
        <p>QSOs not sent to Wavelog, refused or changed, and activation files not yet submitted, appear here.</p>
      </div>
    {:else}
      {#if todo.length}
        <div class="section">
          <h2 class="section-head">QSOs</h2>
          <ul class="group">
            {#each todo as q (q.id)}<QsoRow qso={q} onfix={fix} />{/each}
          </ul>
        </div>
      {/if}
      {#if fileActivations.length}
        <div class="section">
          <h2 class="section-head">Files</h2>
          {#each fileActivations as a (a.id)}<div class="group card"><ActivationCard activation={a} /></div>{/each}
        </div>
      {/if}
    {/if}
  {:else if !activations.length}
    <div class="empty">
      <h2>No activations yet</h2>
      <p>Activations you start in Spots appear here with their QSOs and files.</p>
    </div>
  {:else}
    {#each activations as a (a.id)}
      {@const qsos = log.live.filter((q) => q.activationId === a.id)}
      <div class="section">
        <div class="group card"><ActivationCard activation={a} /></div>
        {#if qsos.length}
          <ul class="group sub">
            {#each qsos as q (q.id)}<QsoRow qso={q} onfix={fix} />{/each}
          </ul>
        {/if}
      </div>
    {/each}
  {/if}
  <p class="visually-hidden" role="status">{status}</p>
</section>

<StationSheet bind:open={stationOpen} qso={stationQso} />

<style>



  .search {
    display: flex;
    gap: var(--rr-space-1-5);
    align-items: center;
    height: var(--rr-tap);
    padding: 0 var(--rr-space-2);
    border-radius: var(--rr-radius-l);
    background: var(--rr-fill3);
    color: var(--rr-label3);
  }

  .search:has(:focus-visible) {
    outline: 2px solid var(--rr-accent);
    outline-offset: 2px;
  }

  .search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--rr-label);
    font-size: var(--rr-text-body);
    outline: none;
    appearance: none;
  }

  .search input::placeholder {
    color: var(--rr-label2);
  }

  .seg .n {
    color: var(--rr-label2);
    font-weight: var(--rr-weight-regular);
  }

  .card + .card {
    margin-top: var(--rr-space-3);
  }

  .sub {
    margin-top: var(--rr-space-2);
  }

  .more {
    display: flex;
  }

  .banner {
    margin: var(--rr-space-2) var(--rr-space-4) 0;
    padding: var(--rr-space-2) var(--rr-space-3);
    border-radius: var(--rr-radius-xl);
    background: var(--rr-tx-soft);
    color: var(--rr-tx-text);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }


  .loading {
    padding: var(--rr-space-8) var(--rr-space-4);
    color: var(--rr-label2);
    text-align: center;
  }
</style>
