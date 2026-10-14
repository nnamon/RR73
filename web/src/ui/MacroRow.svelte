<script lang="ts">
  /**
   * The macro row: one row of capsules that scrolls sideways, about 6 at 393 pt. A tap adds the
   * macro's text to the queue at once.
   */
  import type { Macro } from '../lib/keyboard/macros';

  let { macros, ontap }: { macros: readonly Macro[]; ontap: (m: Macro) => void } = $props();
</script>

<div class="mr" role="toolbar" aria-label="Macros" data-scroll-x>
  {#each macros as m (m.id)}
    <button class="mc" onclick={() => ontap(m)} onpointerdown={(e) => e.preventDefault()}><span class="face">{m.label}</span></button>
  {/each}
</div>

<style>
  .mr {
    display: flex;
    flex: none;
    gap: var(--rr-space-1);
    align-items: center;
    height: 52px;
    padding: 0 calc(var(--rr-space-3) + var(--rr-safe-right)) 0 calc(var(--rr-space-3) + var(--rr-safe-left));
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .mr::-webkit-scrollbar {
    display: none;
  }

  .mc {
    display: flex;
    flex: none;
    align-items: center;
    min-width: var(--rr-tap);
    height: var(--rr-tap);
    padding: 0 var(--rr-space-half);
  }

  .face {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: var(--rr-bar-button);
    padding: 0 var(--rr-space-3);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-fill-bg);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    white-space: nowrap;
  }

  .mc:focus-visible {
    outline: none;
  }

  .mc:focus-visible .face {
    outline: 2px solid var(--rr-accent);
    outline-offset: 2px;
  }
</style>
