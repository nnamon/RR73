<script lang="ts">
  /**
   * "Logged ZL1TQK 20m FT8 −08 / −11" with Edit and Undo, shown for 10 s after each QSO is
   * logged (log.svelte.ts showLogged). Also confirms a delete with Undo, and an Undo with Restore.
   */
  import Icon from './Icon.svelte';
  import { dismissNotice, log, openEditor, qsoById, restoreQso, undoQso } from '../lib/log/log.svelte';

  const n = $derived(log.notice);
  const call = $derived(n?.qsoId ? (qsoById(n.qsoId)?.call ?? '') : '');

  function edit(id: string) {
    dismissNotice();
    openEditor(id);
  }
</script>

<div class="wrap" role="status">
  {#if n}
    <div class="toast" data-testid="log-notice">
      <span class="msg">{n.text}</span>
      {#if n.qsoId && n.kind === 'logged'}
        {@const id = n.qsoId}
        <button class="act" aria-label="Edit the QSO with {call}" onclick={() => edit(id)}>Edit</button>
        <button class="act" aria-label="Undo the QSO with {call}" onclick={() => void undoQso(id)}>Undo</button>
      {:else if n.qsoId && n.kind === 'deleted'}
        {@const id = n.qsoId}
        <button class="act" aria-label="Undo deleting the QSO with {call}" onclick={() => void restoreQso(id)}>Undo</button>
      {:else if n.qsoId && n.kind === 'removed'}
        {@const id = n.qsoId}
        <button class="act" aria-label="Restore the QSO with {call}" onclick={() => void restoreQso(id)}>Restore</button>
      {/if}
      <button class="close" aria-label="Dismiss the notice" onclick={dismissNotice}><Icon name="xmark" size={18} /></button>
    </div>
  {/if}
</div>

<style>
  .wrap {
    flex: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--rr-space-1);
    min-height: var(--rr-tap);
    margin: 0 var(--rr-space-4) var(--rr-space-1);
    padding-left: var(--rr-space-4);
    border-radius: var(--rr-radius-l);
    background: var(--rr-toast);
    color: var(--rr-toast-text);
    font-size: var(--rr-text-row);
    line-height: var(--rr-leading-row);
    letter-spacing: -0.01em;
  }

  .msg {
    flex: 1;
    min-width: 0;
    padding: var(--rr-space-1) 0;
  }

  .act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--rr-tap);
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-1);
    color: var(--rr-toast-link);
    font-weight: var(--rr-weight-bold);
  }

  .close {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    color: var(--rr-toast-text);
  }
</style>
