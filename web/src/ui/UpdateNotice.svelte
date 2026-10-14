<script lang="ts">
  /**
   * "Updated to x.y.z" after an update: floats over the screen below the top bar, so nothing moves,
   * and goes by itself after NOTICE_MS. Show changes opens the version history.
   */
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { dismissNotice } from '../lib/app/update.svelte';

  /** How long the notice stays, ms. */
  const NOTICE_MS = 4000;

  let { version }: { version: string } = $props();

  onMount(() => {
    const t = setTimeout(dismissNotice, NOTICE_MS);
    return () => clearTimeout(t);
  });
</script>

<div class="float" role="status">
  <div class="toast">
    <span class="msg">Updated to {version}</span>
    <a class="act" href={href('settings', 'versions', version)} onclick={dismissNotice}>Show changes</a>
    <button class="close" aria-label="Dismiss the update notice" onclick={dismissNotice}><Icon name="xmark" size={18} /></button>
  </div>
</div>

<style>
  .float {
    position: fixed;
    top: calc(var(--rr-safe-top) + var(--rr-tap) + var(--rr-space-2));
    right: 0;
    left: 0;
    z-index: 30;
    display: flex;
    justify-content: center;
    padding: 0 var(--rr-space-4);
    pointer-events: none;
  }

  .toast {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--rr-space-2);
    max-width: var(--rr-reading);
    min-height: var(--rr-tap);
    padding-left: var(--rr-space-4);
    border-radius: var(--rr-radius-l);
    background: var(--rr-toast);
    color: var(--rr-toast-text);
    box-shadow: 0 var(--rr-space-1) var(--rr-space-4) var(--rr-shadow-thumb);
    font-size: var(--rr-text-row);
    letter-spacing: -0.01em;
    pointer-events: auto;
  }

  @media (prefers-reduced-motion: no-preference) {
    .toast {
      animation: drop 180ms ease-out;
    }
  }

  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(calc(-1 * var(--rr-space-2)));
    }
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
