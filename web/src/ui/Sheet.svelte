<script lang="ts">
  /**
   * Bottom sheet on a modal <dialog>: focus stays inside, Escape and a tap outside close it, and
   * the screen behind is inert.
   */
  import type { Snippet } from 'svelte';

  let { open = $bindable(false), title, onclose, children }: { open: boolean; title: string; onclose?: () => void; children: Snippet } = $props();

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
</style>
