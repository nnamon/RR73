<script lang="ts" module>
  import type { IconName } from './icons';

  /** One button in the bottom bar's row, drawn from data so the row can gain buttons. */
  export interface BarButton {
    id: string;
    /** The visible text; for an icon button, its accessible name. */
    label: string;
    icon?: IconName;
    /** A small glyph after the text, such as the chevrons of a button that opens a choice. */
    trail?: IconName;
    /** plain: grey; soft: a light accent tint (armed); selected: solid accent (active); air: solid red; run: green; halt: a red tint. */
    tone?: 'plain' | 'soft' | 'selected' | 'air' | 'run' | 'halt';
    /** A toggle's state, for aria-pressed. */
    pressed?: boolean;
    /** A dot before the text: still, or blinking (static with reduced motion). */
    dot?: 'still' | 'blink';
    /** Takes the rest of the row. */
    grow?: boolean;
    /** Opens a menu: aria-haspopup, and whether it is open. */
    menu?: { open: boolean };
    /** A key that does the same, shown on the button with a keyboard and a pointer ("esc"). */
    kbd?: string;
    onclick: () => void;
  }
</script>

<script lang="ts">
  /**
   * The bottom bar's row of buttons: 36 pt capsules inside 44 pt targets, side by side. A button
   * with `grow` takes the rest of the row.
   *
   * Larger windows: `panel` and `side` put the growing button (Halt) on a line of its own across
   * the column, 64 and 54 pt high; `bottom` gives it 240 x 64 pt at the end of the row. The other
   * buttons keep their own width.
   */
  import Icon from './Icon.svelte';

  let { buttons, variant = 'phone' }: { buttons: BarButton[]; variant?: 'phone' | 'panel' | 'bottom' | 'side' } = $props();
</script>

<div class="ctl {variant}">
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
        {#if b.trail}<Icon name={b.trail} size={12} class="trail" />{/if}
        {#if b.kbd}<kbd aria-hidden="true">{b.kbd}</kbd>{/if}
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
    padding: 0 var(--rr-space-3);
    border-radius: var(--rr-radius-pill);
    background: var(--rr-fill-bg);
    color: var(--rr-label);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-semibold);
    white-space: nowrap;
  }

  .b.icon .face {
    padding: 0;
  }

  .face :global(.trail) {
    margin-left: calc(-1 * var(--rr-space-half));
    color: var(--rr-label2);
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
    color: var(--rr-on-fill);
    font-weight: var(--rr-weight-bold);
  }

  /* Halt: SwiftUI's tinted style, a red tint with red text, the same in every state. */
  .halt .face {
    background: var(--rr-tx-soft);
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

  /* Larger windows: 46 pt faces at body size, Halt on a line of its own or at the end of the row. */
  .ctl:not(.phone) {
    flex-wrap: wrap;
    gap: var(--rr-space-2);
    height: auto;
  }

  .panel .b,
  .bottom .b {
    height: var(--rr-button);
  }

  .panel .face,
  .bottom .face {
    height: var(--rr-button);
    padding: 0 var(--rr-space-4);
    font-size: var(--rr-text-body);
  }

  .side .face {
    height: var(--rr-tap);
    padding: 0 var(--rr-space-3);
  }

  .panel .b.grow,
  .side .b.grow {
    flex: 1 0 100%;
  }

  .panel .b.grow,
  .bottom .b.grow,
  .panel .b.grow .face,
  .bottom .b.grow .face {
    height: var(--rr-button-halt);
  }

  .side .b.grow,
  .side .b.grow .face {
    height: var(--rr-button-large);
  }

  .bottom .b.grow {
    flex: none;
    width: var(--rr-halt-wide);
    margin-left: auto;
  }

  .panel .halt .face,
  .bottom .halt .face {
    position: relative;
    font-size: var(--rr-text-halt);
  }

  .side .halt .face {
    font-size: var(--rr-text-body);
  }

  kbd {
    position: absolute;
    right: var(--rr-space-4);
    padding: var(--rr-space-px) var(--rr-space-1-5);
    border: var(--rr-hairline) solid currentcolor;
    border-radius: var(--rr-radius-s);
    font-family: var(--rr-sans);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-tag);
    opacity: 0.8;
  }

  @media (hover: hover) {
    .ctl:not(.phone) .b:hover .face {
      filter: brightness(0.94);
    }
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
