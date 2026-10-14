<script lang="ts" module>
  /** One item of a bottom bar menu. */
  export interface BarMenuItem {
    id: string;
    label: string;
    /** The setting's value, on the right. */
    value?: string;
    /** A trailing checkmark: the chosen item. */
    checked?: boolean;
    /** A wider separator after the item. */
    gap?: boolean;
    /** Keeps the menu open after the tap, for items that step a value. */
    stay?: boolean;
    onclick: () => void;
  }
</script>

<script lang="ts">
  /**
   * A menu over the bottom bar, as TxBar's •••: a scrim closes it, Escape closes it and the arrow
   * keys move through the items. It scrolls when it is taller than the screen allows, with the
   * chosen item in view. `align` puts it under the button that opened it.
   */
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    items,
    label,
    align = 'right',
    onclose,
  }: {
    items: BarMenuItem[];
    label: string;
    align?: 'left' | 'right';
    /** Called when the menu should close; `focus` returns focus to the button that opened it. */
    onclose: (focus: boolean) => void;
  } = $props();

  let el: HTMLDivElement | undefined = $state();

  $effect(() => {
    void tick().then(() => {
      const chosen = el?.querySelector<HTMLElement>('[aria-checked=true]');
      (chosen ?? el?.querySelector<HTMLElement>('[role^=menuitem]'))?.focus({ preventScroll: true });
      chosen?.scrollIntoView({ block: 'center' });
    });
  });

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...(el?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
  }

  function act(item: BarMenuItem) {
    if (!item.stay) onclose(false);
    item.onclick();
  }
</script>

<div class="scrim" aria-hidden="true" onclick={() => onclose(false)}></div>
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="menu {align}" role="menu" aria-label={label} tabindex="-1" bind:this={el} onkeydown={key}>
  {#each items as item (item.id)}
    <button
      class="mi"
      class:gap={item.gap}
      role={item.checked !== undefined ? 'menuitemradio' : 'menuitem'}
      aria-checked={item.checked}
      data-id={item.id}
      onclick={() => act(item)}
    >
      {item.label}
      {#if item.value}<span class="v">{item.value}</span>{/if}
      {#if item.checked}<Icon name="check" size={18} class="chk" />{/if}
    </button>
  {/each}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 4;
    background: var(--rr-dim);
    opacity: 0.4;
  }

  .menu {
    position: absolute;
    bottom: calc(100% + var(--rr-space-1));
    z-index: 5;
    width: min(268px, calc(100vw - 2 * var(--rr-space-3)));
    max-height: calc(100dvh - var(--rr-safe-top) - 180px);
    overflow: hidden auto;
    overscroll-behavior: contain;
    border-radius: var(--rr-radius-sheet);
    background: var(--rr-sheet-card);
    box-shadow: 0 12px 40px var(--rr-shadow-thumb);
  }

  .menu.right {
    right: calc(var(--rr-space-3) + var(--rr-safe-right));
  }

  .menu.left {
    left: calc(var(--rr-space-3) + var(--rr-safe-left));
    width: min(180px, calc(100vw - 2 * var(--rr-space-3)));
  }

  .mi {
    display: flex;
    gap: var(--rr-space-2);
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: var(--rr-tap);
    padding: 0 var(--rr-space-4);
    box-shadow: inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
    font-size: var(--rr-text-body);
    text-align: left;
  }

  .mi:last-child {
    box-shadow: none;
  }

  .mi.gap {
    border-bottom: var(--rr-space-2) solid var(--rr-fill);
  }

  .mi:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
  }

  .v {
    margin-left: auto;
    font-size: var(--rr-text-sub);
    color: var(--rr-label2);
  }

  .mi :global(.chk) {
    color: var(--rr-accent);
  }
</style>
