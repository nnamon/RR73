<script lang="ts">
  /**
   * Activate. With no activation running: a form to start one, and the last activation's files.
   * While one runs, the summit layout: the callsign on air, progress per reference, time left in
   * the UTC day, recent QSOs, counts by band, one line on what waits for after the activation,
   * and End activation behind a confirmation.
   */
  import ActivationCard from '../ui/ActivationCard.svelte';
  import ActivationForm from '../ui/ActivationForm.svelte';
  import Icon from '../ui/Icon.svelte';
  import Sheet from '../ui/Sheet.svelte';
  import { href } from '../lib/app/router.svelte';
  import { utcHm } from '../lib/clock/format';
  import { countsByBand, hoursMinutes, progress, utcDayLeftMs } from '../lib/log/activation';
  import { endActivation, log, openEditor, startActivation, updateActivation, type ActivationInput } from '../lib/log/log.svelte';
  import { activationDirect, activationFiles, afterLine, reportsText } from '../lib/log/view';
  import { displayMode } from '../lib/log/qso';
  import { clock } from '../lib/state/now.svelte';

  const RECENT = 4;

  let editing = $state(false);
  let ending = $state(false);

  const a = $derived(log.current);
  const qsos = $derived(a ? log.live.filter((q) => q.activationId === a.id) : []);
  const prog = $derived(a ? progress(a, log.qsos, log.activations, clock.ms) : []);
  const bands = $derived(a ? countsByBand(log.qsos, a.id) : []);
  const after = $derived(a ? afterLine(activationDirect(a, log.qsos, log.index, log.facts), activationFiles(a, log.qsos, log.index, log.facts)) : '');
  const last = $derived(log.activations.find((x) => x.endedAt !== null) ?? null);
  const gridText = $derived(a?.grid ? `${a.grid}${a.gridSource === 'gps' ? ' from GPS' : ''}` : 'no grid');

  async function start(input: ActivationInput) {
    await startActivation(input);
  }

  async function save(input: ActivationInput) {
    if (!a) return;
    await updateActivation(a.id, input);
    editing = false;
  }

  async function end() {
    if (!a) return;
    ending = false;
    await endActivation(a.id);
  }
</script>

{#if !log.ready}
  <section class="screen" aria-labelledby="activate-title">
    <h1 id="activate-title" class="large-title">Activate</h1>
  </section>
{:else if !a}
  <section class="screen" aria-labelledby="activate-title">
    <h1 id="activate-title" class="large-title">Activate</h1>
    <div class="intro">
      <h2>No activation running</h2>
      <p>Start one to count QSOs towards the POTA, SOTA, WWFF and IOTA rules. QSOs logged while it runs belong to it.</p>
    </div>
    <ActivationForm submitLabel="Start activation" onsubmit={start} />
    {#if last}
      <div class="section">
        <h2 class="section-head">Last activation</h2>
        <div class="group"><ActivationCard activation={last} /></div>
      </div>
    {/if}
  </section>
{:else if editing}
  <section class="screen" aria-labelledby="activate-title">
    <h1 id="activate-title" class="large-title">Edit activation</h1>
    <p class="opas">QSOs already logged take the new references, callsign and grid.</p>
    <ActivationForm initial={a} submitLabel="Save activation" onsubmit={save} oncancel={() => (editing = false)} />
  </section>
{:else}
  <section class="screen" aria-labelledby="activate-title">
    <div class="lt-row">
      <h1 id="activate-title" class="large-title">Activation</h1>
      <span class="trail">{hoursMinutes(clock.ms - a.startedAt)}<span class="visually-hidden"> since the start</span></span>
    </div>
    <p class="opas">Operating as <b class="mono">{a.callsign}</b> · {gridText}</p>

    <div class="section first">
      <div class="group">
        {#each prog as p (`${p.programme} ${p.ref}`)}
          <div class="prog">
            <div class="prog-1">
              <span class="ref"><span class="p">{p.programme}</span> <span class="mono">{p.ref}</span></span>
              <span class:ok={p.qualified}>{p.label}</span>
            </div>
            {#if p.target}
              <div class="bar" class:done={p.qualified} role="progressbar" aria-label="{p.programme} {p.ref}: {p.rule}" aria-valuemin="0" aria-valuemax={p.target} aria-valuenow={Math.min(p.count, p.target)}>
                <i style:width="{Math.min(100, (p.count / p.target) * 100)}%"></i>
              </div>
            {/if}
          </div>
        {/each}
        <div class="prog day">UTC day ends in {hoursMinutes(utcDayLeftMs(clock.ms))}</div>
      </div>
    </div>

    {#if !log.online}
      <div class="notice" role="status">
        <Icon name="cloudoff" size={22} class="notice-i" />
        <p>No phone signal{log.offlineSince ? ` since ${utcHm(log.offlineSince)} UTC` : ''}. All {qsos.length} {qsos.length === 1 ? 'QSO is' : 'QSOs are'} stored on this phone.</p>
      </div>
    {/if}

    <div class="section">
      <h2 class="section-head two"><span>QSOs</span>{#if bands.length}<span>By band: {bands.map(([b, n]) => `${b} ${n}`).join(' · ')}</span>{/if}</h2>
      {#if qsos.length}
        <ul class="group">
          {#each qsos.slice(0, RECENT) as q (q.id)}
            <li>
              <button class="qr" onclick={() => openEditor(q.id)}>
                <span class="c mono">{q.call}</span>
                <span class="b">{q.band} {displayMode(q)}</span>
                <span class="t">{utcHm(q.start)}<span class="visually-hidden"> UTC</span></span>
                <span class="r">{reportsText(q)}</span>
              </button>
            </li>
          {/each}
        </ul>
        {#if qsos.length > RECENT}<a class="text-button all" href={href('log', 'activations')}>Show all {qsos.length} QSOs</a>{/if}
      {:else}
        <div class="group"><p class="none">QSOs you log now appear here, newest first.</p></div>
      {/if}
    </div>

    <div class="section">
      <div class="group">
        <a class="row link" href={href('log', 'activations')}>
          <span class="row-main">
            <span class="row-title">After the activation</span>
            <span class="row-sub">{after}</span>
          </span>
          <Icon name="chevright" size={13} class="row-chevron" />
        </a>
      </div>
    </div>

    <div class="section actions">
      <button class="text-button" onclick={() => (editing = true)}>Edit activation</button>
      <button class="text-button danger" onclick={() => (ending = true)}>End activation…</button>
    </div>
  </section>

  <Sheet bind:open={ending} title="End activation?">
    <p class="confirm-text">The {qsos.length} {qsos.length === 1 ? 'QSO stays' : 'QSOs stay'} on this phone. Files and Wavelog deliveries carry on from the log.</p>
    <button class="btn tx wide" onclick={() => void end()}>End activation</button>
    <button class="btn wide keep" onclick={() => (ending = false)}>Keep operating</button>
  </Sheet>
{/if}

<style>
  .intro {
    padding: var(--rr-space-2) var(--rr-space-4) 0;
    color: var(--rr-label2);
  }

  .intro h2 {
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-semibold);
    color: var(--rr-label);
  }

  .intro p {
    margin-top: var(--rr-space-1);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  .lt-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--rr-space-3);
    padding-right: var(--rr-space-4);
  }

  .trail {
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-sub);
    letter-spacing: -0.015em;
    color: var(--rr-label2);
  }

  .opas {
    padding: 0 var(--rr-space-4);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }

  .opas b {
    font-weight: var(--rr-weight-bold);
    color: var(--rr-label);
  }

  .first {
    margin-top: var(--rr-space-3);
  }

  .prog {
    position: relative;
    padding: var(--rr-space-2) var(--rr-space-4) var(--rr-space-3);
  }

  .prog + .prog::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: var(--rr-space-4);
    height: var(--rr-hairline);
    background: var(--rr-sep-strong);
    transform: scaleY(0.5);
    transform-origin: 0 0;
  }

  .prog-1 {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--rr-space-2);
    align-items: baseline;
    justify-content: space-between;
    font-size: var(--rr-text-callout);
    line-height: var(--rr-leading-sub);
    letter-spacing: -0.02em;
  }

  .ref .mono {
    font-weight: var(--rr-weight-bold);
  }

  .p {
    margin-right: var(--rr-space-1);
    font-size: var(--rr-text-foot);
    font-weight: var(--rr-weight-bold);
    letter-spacing: 0.01em;
    color: var(--rr-label2);
  }

  .ok {
    font-weight: var(--rr-weight-bold);
    color: var(--rr-ok);
  }

  .bar {
    height: 7px;
    margin-top: var(--rr-space-2);
    overflow: hidden;
    border-radius: var(--rr-radius-xs);
    background: var(--rr-fill2);
  }

  .bar i {
    display: block;
    height: 100%;
    border-radius: var(--rr-radius-xs);
    background: var(--rr-accent-fill);
  }

  .bar.done i {
    background: var(--rr-ok-bar);
  }

  .day {
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }

  .notice {
    display: flex;
    gap: var(--rr-space-3);
    align-items: center;
    margin: var(--rr-space-3) var(--rr-space-4) 0;
    padding: var(--rr-space-2) var(--rr-space-3);
    border-radius: var(--rr-radius-xl);
    background: var(--rr-warn-soft);
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
  }

  .notice :global(.notice-i) {
    color: var(--rr-warn);
  }

  .two {
    display: flex;
    justify-content: space-between;
    gap: var(--rr-space-2);
  }

  .qr {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 46px;
    padding: 0 var(--rr-space-4);
    color: var(--rr-label);
    font-size: var(--rr-text-sub);
    letter-spacing: -0.015em;
    text-align: left;
  }

  li + li .qr::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: var(--rr-space-4);
    height: var(--rr-hairline);
    background: var(--rr-sep-strong);
    transform: scaleY(0.5);
    transform-origin: 0 0;
  }

  .qr .c {
    flex: 1.3;
    min-width: 0;
    overflow: hidden;
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-bold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .qr .b,
  .qr .t {
    flex: 1;
    color: var(--rr-label2);
    white-space: nowrap;
  }

  .qr .t {
    flex: 0.7;
  }

  .qr .r {
    flex: 1;
    color: var(--rr-label2);
    text-align: right;
    white-space: nowrap;
  }

  .all {
    padding: 0 var(--rr-space-4);
    font-size: var(--rr-text-sub);
  }

  .none {
    padding: var(--rr-space-3) var(--rr-space-4);
    font-size: var(--rr-text-sub);
    color: var(--rr-label2);
  }

  .link {
    color: var(--rr-label);
  }

  .link :global(.row-chevron) {
    color: var(--rr-chev);
  }

  .actions {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .confirm-text {
    margin: var(--rr-space-3) var(--rr-space-1) 0;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
    text-align: center;
  }

  .wide {
    width: 100%;
    margin-top: var(--rr-space-3);
  }

  .keep {
    margin-top: var(--rr-space-2);
    background: transparent;
    color: var(--rr-accent);
  }
</style>
