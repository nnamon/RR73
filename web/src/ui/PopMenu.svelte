<script lang="ts" module>
  /** One item of a menu by a control or a word. */
  export interface PopMenuItem {
    id: string;
    label: string;
    /** A trailing checkmark: the chosen item. */
    checked?: boolean;
    /** The suggested item, in the accent colour. */
    strong?: boolean;
    onclick: () => void;
  }
</script>

<script lang="ts">
  /**
   * A menu by the control or the word that opened it, as the tuning row's chips and the received
   * text use: under it where it fits, else above, inside the screen's 16 pt margins. A scrim
   * closes it, Escape closes it and the arrow keys move through the items. An optional header
   * says something about the choice ("QWU reads 127 in figures").
   */
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    items,
    label,
    header = null,
    anchor,
    onclose,
  }: {
    items: PopMenuItem[];
    label: string;
    header?: string | null;
    /** The opener's box, in viewport pixels. */
    anchor: { top: number; bottom: number; left: number; right: number };
    onclose: (focus: boolean) => void;
  } = $props();

  let el: HTMLDivElement | undefined = $state();
  let h = $state(0);
  let w = $state(0);

  const MARGIN = 16;
  const pos = $derived.by(() => {
    const vw = typeof window === 'undefined' ? 375 : window.innerWidth;
    const vh = typeof window === 'undefined' ? 667 : window.innerHeight;
    const below = anchor.bottom + 4;
    const top = below + h <= vh - MARGIN || anchor.top - 4 - h < MARGIN ? below : anchor.top - 4 - h;
    const left = Math.max(MARGIN, Math.min(anchor.left, vw - MARGIN - w));
    return { top, left };
  });

  $effect(() => {
    void tick().then(() => {
      const chosen = el?.querySelector<HTMLElement>('[aria-checked=true]');
      (chosen ?? el?.querySelector<HTMLElement>('[role^=menuitem]'))?.focus({ preventScroll: true });
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

  function act(item: PopMenuItem) {
    onclose(false);
    item.onclick();
  }
</script>

<div class="scrim" aria-hidden="true" onclick={() => onclose(false)}></div>
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="menu" role="menu" aria-label={label} tabindex="-1" bind:this={el} bind:offsetHeight={h} bind:offsetWidth={w} style:top="{pos.top}px" style:left="{pos.left}px" onkeydown={key}>
  {#if header}<p class="head">{header}</p>{/if}
  {#each items as item (item.id)}
    <button class="mi" class:strong={item.strong} role={item.checked !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={item.checked} data-id={item.id} onclick={() => act(item)}>
      {item.label}
      {#if item.checked}<Icon name="check" size={18} class="chk" />{/if}
    </button>
  {/each}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 30;
  }

  .menu {
    position: fixed;
    z-index: 31;
    width: min(250px, calc(100vw - 2 * var(--rr-space-4)));
    max-height: calc(100dvh - 2 * var(--rr-space-4));
    overflow: hidden auto;
    overscroll-behavior: contain;
    border-radius: var(--rr-radius-sheet);
    background: var(--rr-sheet-card);
    box-shadow: 0 12px 40px var(--rr-shadow-thumb);
  }

  .head {
    padding: var(--rr-space-3) var(--rr-space-4) var(--rr-space-2);
    box-shadow: inset 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
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

  .mi.strong {
    font-weight: var(--rr-weight-semibold);
    color: var(--rr-accent);
  }

  .mi:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
  }

  .mi :global(.chk) {
    color: var(--rr-accent);
  }
</style>
