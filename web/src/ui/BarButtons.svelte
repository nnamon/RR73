<script lang="ts" module>
  import type { IconName } from './icons';

  /** One button in the bottom bar's row, drawn from data so the row can gain buttons. */
  export interface BarButton {
    id: string;
    /** The visible text; for an icon button, its accessible name. */
    label: string;
    icon?: IconName;
    /** plain: grey; soft: a light accent tint (armed); selected: solid accent (active); air: solid red; run: green; halt: red outline. */
    tone?: 'plain' | 'soft' | 'selected' | 'air' | 'run' | 'halt';
    /** A toggle's state, for aria-pressed. */
    pressed?: boolean;
    /** A dot before the text: still, or blinking (static with reduced motion). */
    dot?: 'still' | 'blink';
    /** Takes the rest of the row. */
    grow?: boolean;
    /** Opens a menu: aria-haspopup, and whether it is open. */
    menu?: { open: boolean };
    onclick: () => void;
  }
</script>

<script lang="ts">
  /**
   * The bottom bar's row of buttons: 36 pt faces inside 44 pt targets, side by side. A button
   * with `grow` takes the rest of the row.
   */
  import Icon from './Icon.svelte';

  let { buttons }: { buttons: BarButton[] } = $props();
</script>

<div class="ctl">
  {#each buttons as b (b.id)}
    <button
      type="button"
      class="b {b.tone ?? 'plain'}"
      class:grow={b.grow}
      class:icon={!!b.icon}
      data-id={b.id}
      aria-label={b.icon ? b.label : undefined}
      aria-pressed={b.pressed}
      aria-haspopup={b.menu ? 'menu' : undefined}
      aria-expanded={b.menu ? b.menu.open : undefined}
      onclick={b.onclick}
    >
      <span class="face" class:open={b.menu?.open}>
        {#if b.dot}<span class="dot" class:blink={b.dot === 'blink'} aria-hidden="true"></span>{/if}
        {#if b.icon}<Icon name={b.icon} size={20} />{:else}{b.label}{/if}
      </span>
    </button>
  {/each}
</div>

<style>
  .ctl {
    display: flex;
    gap: var(--rr-space-1-5);
    align-items: center;
    height: var(--rr-tap);
  }

  /* The target: 44 pt high and at least 44 pt wide; the face inside it is 36 pt. */
  .b {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-width: var(--rr-tap);
    height: var(--rr-tap);
    padding: 0;
  }

  .b.grow {
    flex: 1;
  }

  .face {
    display: flex;
    flex: 1;
    gap: var(--rr-space-1-5);
    align-items: center;
    justify-content: center;
    height: var(--rr-bar-button);
    padding: 0 calc(var(--rr-space-2) + var(--rr-space-half));
    border-radius: var(--rr-radius-m);
    background: var(--rr-fill-bg);
    color: var(--rr-label);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    white-space: nowrap;
  }

  .b.icon .face {
    padding: 0;
  }

  .b:focus-visible {
    outline: none;
  }

  .b:focus-visible .face {
    outline: 2px solid var(--rr-accent);
    outline-offset: 2px;
  }

  .face.open {
    background: var(--rr-label);
    color: var(--rr-on-strong);
  }

  .soft .face {
    background: var(--rr-accent-soft);
    color: var(--rr-accent);
  }

  .selected .face {
    background: var(--rr-accent-fill);
    color: var(--rr-on-fill);
  }

  .air .face {
    background: var(--rr-tx-fill);
    color: var(--rr-on-fill);
    font-weight: var(--rr-weight-bold);
  }

  .run .face {
    background: var(--rr-run);
    color: var(--rr-on-strong);
    font-weight: var(--rr-weight-bold);
  }

  .halt .face {
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--rr-tx);
    color: var(--rr-tx-text);
    font-size: var(--rr-text-callout);
    font-weight: var(--rr-weight-bold);
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 4px;
    background: var(--rr-label3);
  }

  .soft .dot {
    background: var(--rr-accent);
  }

  .air .dot {
    background: var(--rr-on-fill);
  }

  @media (prefers-reduced-motion: no-preference) {
    .dot.blink {
      animation: blink 1s steps(2, start) infinite;
    }
  }

  @keyframes blink {
    to {
      visibility: hidden;
    }
  }
</style>
