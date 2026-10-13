<script lang="ts">
  /**
   * One line above the tab bar when the app cannot work as usual until something changes: the
   * database waits for an older copy of RR73 to close, a newer version owns it, or this build's
   * files are gone from the server. The line goes away by itself when the cause does.
   */
  import { applyUpdate, update } from '../lib/app/update.svelte';
  import { busy } from '../lib/state/station.svelte';
  import { storage } from '../lib/state/storage.svelte';

  const line = $derived.by((): { text: string; action: string; run: () => void } | null => {
    const retry = () => location.reload();
    if (storage.state === 'blocked') return { text: 'Close other copies of RR73 to finish updating.', action: 'Try again', run: retry };
    if (storage.state === 'stalled') return { text: 'RR73 cannot open its storage. Close other copies of RR73, then try again.', action: 'Try again', run: retry };
    if (storage.state === 'replaced') return { text: 'A newer version of RR73 is open in another window.', action: 'Reload', run: () => applyUpdate() };
    if (update.stale) return { text: busy() ? 'A new version of RR73 is ready. It loads when audio stops.' : 'A new version of RR73 is ready.', action: 'Reload', run: () => applyUpdate() };
    return null;
  });
</script>

<div class="wrap" role="status">
  {#if line}
    <div class="toast" data-testid="status-notice">
      <span class="msg">{line.text}</span>
      <button class="act" onclick={line.run}>{line.action}</button>
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
    gap: var(--rr-space-2);
    min-height: var(--rr-tap);
    margin: 0 var(--rr-space-4) var(--rr-space-1);
    padding: var(--rr-space-1) var(--rr-space-1) var(--rr-space-1) var(--rr-space-4);
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
  }

  .act {
    display: inline-flex;
    flex: none;
    align-items: center;
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-2);
    font-weight: var(--rr-weight-bold);
    color: var(--rr-toast-link);
  }
</style>
