<script lang="ts">
  /**
   * Bottom sheet on a modal <dialog>: focus stays inside, Escape and a tap outside close it, and
   * the screen behind is inert.
   *
   * In regular width it is a form sheet, 540 pt wide and centred over the dimmed screen; on a
   * phone on its side, 540 pt wide at the full height. Both have Done in place of the grabber,
   * unless the sheet brings its own way out (`done` false).
   */
  import type { Snippet } from 'svelte';
  import { layout } from '../lib/app/layout.svelte';

  let {
    open = $bindable(false),
    title,
    onclose,
    done = true,
    children,
  }: { open: boolean; title: string; onclose?: () => void; done?: boolean; children: Snippet } = $props();

  let dlg: HTMLDialogElement;
  let heading: HTMLHeadingElement;
  const id = `sheet-${Math.random().toString(36).slice(2, 8)}`;

  let notified = false;

  // Focus starts on the title, so a screen reader reads it first and no control shows a ring.
  $effect(() => {
    if (open && !dlg.open) {
      notified = false;
      dlg.showModal();
      heading.focus();
    } else if (!open && dlg.open) dlg.close();
  });

  /**
   * Tells the owner at once. The dialog's close event arrives a task after the dialog hides, and
   * a sheet that transmits must halt before that.
   */
  function notify() {
    if (notified) return;
    notified = true;
    open = false;
    onclose?.();
  }

  function dismiss() {
    notify();
    dlg.close();
  }
</script>

<dialog
  bind:this={dlg}
  class="sheet"
  aria-labelledby={id}
  oncancel={(e) => {
    e.preventDefault();
    dismiss();
  }}
  onclose={notify}
  onclick={(e) => {
    if (e.target === dlg) dismiss();
  }}
>
  <div class="body">
    <div class="grab" aria-hidden="true"></div>
    <h2 {id} class="title" tabindex="-1" bind:this={heading}>{title}</h2>
    {#if done && layout.size !== 'compact'}<button type="button" class="done" onclick={dismiss}>Done</button>{/if}
    {@render children()}
  </div>
</dialog>

<style>
  .sheet {
    position: fixed;
    inset: auto 0 0;
    width: 100%;
    max-width: none;
    max-height: calc(100dvh - var(--rr-safe-top) - var(--rr-space-6));
    margin: 0;
    padding: 0;
    overflow: auto;
    border: 0;
    border-radius: var(--rr-radius-sheet) var(--rr-radius-sheet) 0 0;
    background: var(--rr-sheet);
    color: var(--rr-label);
  }

  .sheet::backdrop {
    background: var(--rr-dim);
  }

  .body {
    max-width: var(--rr-reading);
    margin: 0 auto;
    padding: 0 calc(var(--rr-space-4) + var(--rr-safe-right)) calc(var(--rr-space-6) + var(--rr-safe-bottom)) calc(var(--rr-space-4) + var(--rr-safe-left));
  }

  .grab {
    width: 36px;
    height: 5px;
    margin: var(--rr-space-1-5) auto 0;
    border-radius: 3px;
    background: var(--rr-grab);
  }

  .title {
    margin-top: var(--rr-space-3);
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-semibold);
    line-height: 26px;
    text-align: center;
  }

  /* Regular width: a form sheet, centred. A phone on its side: the full height, 540 pt wide. */
  :global([data-size='regular']) .sheet,
  :global([data-size='compact-height']) .sheet {
    right: 0;
    left: 0;
    width: min(var(--rr-form-sheet), 100vw);
    margin: auto;
  }

  :global([data-size='regular']) .sheet {
    top: 0;
    bottom: 0;
    height: fit-content;
    max-height: calc(100dvh - 2 * var(--rr-space-12));
    border-radius: var(--rr-radius-sheet);
    box-shadow: 0 24px 64px var(--rr-shadow-thumb);
  }

  :global([data-size='compact-height']) .sheet {
    top: var(--rr-space-2);
    bottom: 0;
    max-height: none;
    margin-bottom: 0;
  }

  :global([data-size='regular']) .body,
  :global([data-size='compact-height']) .body {
    position: relative;
    max-width: none;
    padding: 0 var(--rr-space-4) var(--rr-space-5);
  }

  :global([data-size='regular']) .grab,
  :global([data-size='compact-height']) .grab {
    display: none;
  }

  :global([data-size='regular']) .title,
  :global([data-size='compact-height']) .title {
    margin: 0;
    padding: 0 var(--rr-tap);
    line-height: var(--rr-top-regular);
  }

  .done {
    position: absolute;
    top: calc((var(--rr-top-regular) - var(--rr-tap)) / 2);
    right: var(--rr-space-2);
    min-width: var(--rr-tap);
    height: var(--rr-tap);
    padding: 0 var(--rr-space-2);
    color: var(--rr-accent);
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-semibold);
  }

  .done:focus-visible {
    outline: 2px solid var(--rr-accent);
    outline-offset: -2px;
    border-radius: var(--rr-radius-l);
  }
</style>
