<script lang="ts">
  /**
   * The macro row: one row of capsules that scrolls sideways, about 6 at 393 pt. A tap adds the
   * macro's text to the queue at once. With `keys` (a keyboard and a pointer) each shows the
   * function key that sends it, F1 to F12.
   */
  import type { Macro } from '../lib/keyboard/macros';
  import { MACRO_KEYS } from '../lib/app/shortcuts';

  let { macros, ontap, keys = false }: { macros: readonly Macro[]; ontap: (m: Macro) => void; keys?: boolean } = $props();
</script>

<div class="mr" role="toolbar" aria-label="Macros" data-scroll-x>
  {#each macros as m, i (m.id)}
    <button class="mc" onclick={() => ontap(m)} onpointerdown={(e) => e.preventDefault()} aria-keyshortcuts={keys && i < MACRO_KEYS ? `F${i + 1}` : undefined}>
      <span class="face"><span class="l">{m.label}</span>{#if keys && i < MACRO_KEYS}<kbd aria-hidden="true">F{i + 1}</kbd>{/if}</span>
    </button>
  {/each}
</div>

<style>
  /* Scrolls sideways only, as the filter chips do. */
  .mr {
    display: flex;
    flex: none;
    gap: var(--rr-space-1);
    align-items: center;
    height: 52px;
    padding: 0 calc(var(--rr-space-3) + var(--rr-safe-right)) 0 calc(var(--rr-space-3) + var(--rr-safe-left));
    overflow: auto hidden;
    overscroll-behavior: contain;
    touch-action: pan-x;
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
    gap: var(--rr-space-1-5);
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

  .l {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  kbd {
    flex: none;
    padding: var(--rr-space-px) var(--rr-space-1-5);
    border: var(--rr-hairline) solid currentcolor;
    border-radius: var(--rr-radius-s);
    color: var(--rr-label2);
    font-family: var(--rr-sans);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-tag);
  }

  .mc:focus-visible {
    outline: none;
  }

  .mc:focus-visible .face {
    outline: 2px solid var(--rr-accent);
    outline-offset: 2px;
  }
</style>
