<script lang="ts">
  import Icon from './Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { dismissNotice } from '../lib/app/update.svelte';

  let { version }: { version: string } = $props();
</script>

<div class="toast" role="status">
  <span class="msg">Updated to {version}</span>
  <a class="act" href={href('settings', 'versions', version)} onclick={dismissNotice}>What’s new</a>
  <button class="close" aria-label="Dismiss the update notice" onclick={dismissNotice}><Icon name="xmark" size={18} /></button>
</div>

<style>
  .toast {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--rr-space-2);
    min-height: var(--rr-tap);
    margin: 0 var(--rr-space-4) var(--rr-space-1);
    padding-left: var(--rr-space-4);
    border-radius: var(--rr-radius-l);
    background: var(--rr-toast);
    color: var(--rr-toast-text);
    font-size: var(--rr-text-row);
    letter-spacing: -0.01em;
  }

  .msg {
    flex: 1;
    min-width: 0;
  }

  .act {
    display: inline-flex;
    align-items: center;
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-1);
    font-weight: var(--rr-weight-bold);
    color: var(--rr-toast-link);
  }

  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--rr-tap);
    height: var(--rr-tap);
    color: var(--rr-toast-text);
  }
</style>
