<script lang="ts">
  /**
   * One QSO in the log: callsign, destination tags and UTC time, then band, mode, frequency, grid
   * and reports. Tapping it opens the QSO sheet. A refused or changed QSO shows why, with Fix,
   * Send again or Mark handled.
   */
  import StatusTag from './StatusTag.svelte';
  import { log, openEditor } from '../lib/log/log.svelte';
  import { qsoLine, rowProblem, rowTags, rowTime } from '../lib/log/view';
  import type { LedgerEntry, Qso } from '../lib/log/types';

  let { qso, onfix }: { qso: Qso; onfix: (qso: Qso, entry: LedgerEntry) => void } = $props();

  const entries = $derived(log.index.get(qso.id));
  const tags = $derived(rowTags(entries, log.facts));
  const problem = $derived(rowProblem(entries, log.facts));
  const action = $derived.by(() => {
    if (!problem) return null;
    if (problem.state === 'changed') return { text: 'Mark handled', label: `Mark the change to the QSO with ${qso.call} handled` };
    if (problem.refusal?.fix === 'resend') return { text: 'Send again', label: `Send the QSO with ${qso.call} again` };
    return { text: 'Fix', label: `Fix the QSO with ${qso.call}` };
  });
</script>

<li class="lr" class:deleted={qso.deletedAt !== null}>
  <button class="lr-main" onclick={() => openEditor(qso.id)}>
    <span class="lr-1">
      <span class="lr-call mono">{qso.call}</span>
      <span class="lr-r">
        {#if qso.deletedAt !== null}<span class="gone">Deleted</span>{/if}
        {#each tags as t (t.destination)}<StatusTag tag={t} />{/each}
        <span class="lr-time">{rowTime(qso)}<span class="visually-hidden"> UTC</span></span>
      </span>
    </span>
    <span class="lr-2">{qsoLine(qso)}</span>
  </button>
  {#if problem && action}
    <div class="lr-err" class:note={problem.state === 'changed'}>
      <span class="msg">{problem.lastError}</span>
      <button class="btn compact fix" class:primary={problem.state === 'refused'} aria-label={action.label} onclick={() => onfix(qso, problem)}>{action.text}</button>
    </div>
  {/if}
</li>

<style>
  .lr {
    position: relative;
  }

  .lr + :global(.lr)::before {
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

  .lr-main {
    display: block;
    width: 100%;
    min-height: var(--rr-tap);
    padding: var(--rr-space-2) var(--rr-space-4) var(--rr-space-2);
    color: var(--rr-label);
    text-align: left;
  }

  .lr-1 {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    justify-content: space-between;
    min-height: 24px;
  }

  .lr-call {
    min-width: 0;
    overflow: hidden;
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-bold);
    line-height: var(--rr-leading-body);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deleted .lr-call {
    color: var(--rr-label3);
    text-decoration: line-through;
  }

  .lr-r {
    display: flex;
    flex: none;
    gap: var(--rr-space-1-5);
    align-items: center;
  }

  .gone {
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    color: var(--rr-label2);
  }

  .lr-time {
    min-width: 42px;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    letter-spacing: -0.015em;
    color: var(--rr-label2);
    text-align: right;
  }

  .lr-2 {
    display: block;
    margin-top: var(--rr-space-half);
    overflow: hidden;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-row);
    letter-spacing: -0.006em;
    color: var(--rr-label2);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lr-err {
    display: flex;
    gap: var(--rr-space-3);
    align-items: center;
    padding: 0 var(--rr-space-4) var(--rr-space-2);
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    letter-spacing: -0.006em;
    color: var(--rr-tx-text);
  }

  .lr-err.note {
    color: var(--rr-label2);
  }

  .msg {
    flex: 1;
    min-width: 0;
  }

  .fix {
    min-width: 58px;
  }
</style>
