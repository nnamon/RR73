<script lang="ts">
  /** Run mode: the callers in answering order, with the station being worked on top. 56 px rows. */
  import { signed } from '../lib/clock/format';
  import { bare } from '../lib/qso/messages';
  import { settings, updateSettings } from '../lib/state/settings.svelte';
  import { qso } from '../lib/state/qso.svelte';
  import { orderQueue } from '../lib/qso/sequencer';

  let { onbandactivity }: { onbandactivity: () => void } = $props();

  const st = $derived(qso.st);
  const ordered = $derived(orderQueue(st.queue, st.config.order));
  const firstLive = $derived(ordered.findIndex((c) => settings.workDupes || !c.dupe));
  const ORDERS = [
    ['first', 'First'],
    ['strongest', 'Strongest'],
    ['farthest', 'Farthest'],
    ['new', 'New'],
  ] as const;
  const nth = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
</script>

<div class="qctl">
  <span class="k" id="answer-order">Answer</span>
  <div class="seg order" role="radiogroup" aria-labelledby="answer-order">
    {#each ORDERS as [id, label] (id)}
      <label class="seg-i" class:on={settings.queueOrder === id}>
        <input class="visually-hidden" type="radio" name="queue-order" value={id} checked={settings.queueOrder === id} onchange={() => void updateSettings({ queueOrder: id })} />
        {label}
      </label>
    {/each}
  </div>
</div>
<button class="link" onclick={onbandactivity}>Show band activity</button>
<ul class="queue" aria-label="Callers">
  {#if st.partner}
    <li class="cr work">
      <div class="main">
        <p class="l1"><span class="c mono">{bare(st.partner.call)}</span><span class="d">{signed(Math.round(st.partner.snrDb))}</span></p>
        <p class="l2">{st.partner.grid ?? `${Math.round(st.partner.freqHz)} Hz`}</p>
      </div>
      <div class="right"><span class="st">Working</span>{#if st.retries > 0}<span class="rt">Retries {st.retries} of {st.config.maxRetries}</span>{/if}</div>
    </li>
  {/if}
  {#each ordered as c, i (c.call)}
    <li class="cr" class:dupe={c.dupe}>
      <div class="main">
        <p class="l1">
          <span class="c mono">{bare(c.call)}</span><span class="d">{signed(Math.round(c.snrDb))}</span>
          {#if c.dupe}<span class="badge muted">Dupe</span>{:else if c.isNew}<span class="badge teal">New</span>{/if}
        </p>
        <p class="l2">{c.dupe && !settings.workDupes ? 'Worked today on this band; will be skipped' : [c.grid, c.distanceKm !== null ? `${Math.round(c.distanceKm).toLocaleString('en-GB')} km` : null].filter(Boolean).join(' · ') || `${Math.round(c.freqHz)} Hz`}</p>
      </div>
      <div class="right">
        {#if i === firstLive}<span class="st nx">Next</span>{:else if !c.dupe || settings.workDupes}<span class="st q">{nth(i - firstLive + 1)}</span>{/if}
      </div>
    </li>
  {/each}
  {#if !st.partner && !ordered.length}
    <li class="empty-q">Callers appear here as they answer the CQ.</li>
  {/if}
</ul>

<style>
  .qctl {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    padding: var(--rr-space-1) var(--rr-space-4) 0;
  }

  .k {
    font-size: var(--rr-text-foot);
    color: var(--rr-label2);
  }

  .order {
    flex: 1;
  }

  .order .seg-i {
    font-size: var(--rr-text-foot);
  }

  .link {
    display: block;
    min-height: var(--rr-tap);
    margin-left: auto;
    padding: 0 var(--rr-space-4);
    color: var(--rr-accent);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
  }

  .queue {
    margin: 0;
    padding: 0;
  }

  .cr {
    position: relative;
    display: flex;
    align-items: center;
    height: 56px;
    padding: 0 var(--rr-space-4);
  }

  .cr + .cr::before {
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

  .cr.work {
    background: var(--rr-me-tint);
    box-shadow: inset 4px 0 0 var(--rr-tx);
  }

  .main {
    flex: 1;
    min-width: 0;
  }

  .l1 {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
  }

  .c {
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-bold);
  }

  .d {
    font-size: var(--rr-text-sub);
    color: var(--rr-label2);
  }

  .l2 {
    margin-top: var(--rr-space-half);
    overflow: hidden;
    font-size: var(--rr-text-foot);
    color: var(--rr-label2);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .dupe .c,
  .dupe .d {
    color: var(--rr-label2);
  }

  .right {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: flex-end;
    margin-left: var(--rr-space-3);
  }

  .st {
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-bold);
  }

  .st.nx {
    color: var(--rr-accent);
  }

  .st.q {
    color: var(--rr-label2);
    font-weight: var(--rr-weight-medium);
  }

  .rt {
    margin-top: var(--rr-space-half);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-semibold);
    color: var(--rr-label2);
  }

  .badge {
    padding: 0 var(--rr-space-1-5);
    border-radius: var(--rr-radius-s);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: 20px;
  }

  .badge.muted {
    background: var(--rr-fill2);
    color: var(--rr-label2);
  }

  .badge.teal {
    background: var(--rr-teal);
    color: var(--rr-on-strong);
  }

  .empty-q {
    padding: var(--rr-space-6) var(--rr-space-8);
    font-size: var(--rr-text-sub);
    color: var(--rr-label2);
    text-align: center;
  }
</style>
