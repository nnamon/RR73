<script lang="ts">
  /**
   * The desktop app's port chooser for Connect radio (lib/state/desktop-serial.svelte.ts): the
   * serial ports there are now, with their USB IDs. The browser shows its own chooser instead.
   */
  import Sheet from './Sheet.svelte';
  import { portChooser, settleChooser } from '../lib/state/desktop-serial.svelte';
  import type { NativePortInfo } from '../lib/cat/native';

  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
  const sub = (p: NativePortInfo) =>
    [p.label, p.usbVendorId !== null && p.usbProductId !== null ? `USB ${hex(p.usbVendorId)}:${hex(p.usbProductId)}` : null].filter(Boolean).join(' · ');

  let open = $state(false);
  $effect(() => {
    open = portChooser.open;
  });
</script>

<Sheet bind:open title="Choose the radio’s port" done={false} onclose={() => settleChooser(null)}>
  {#if portChooser.ports.length}
    <ul class="card" data-testid="port-list">
      {#each portChooser.ports as p (p.name)}
        <li>
          <button class="row pick" onclick={() => settleChooser(p)}>
            <span class="row-main">
              <span class="row-title mono">{p.name}</span>
              {#if sub(p)}<span class="row-sub">{sub(p)}</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="lead">No serial ports found. Connect the radio’s USB cable, then choose Connect radio again.</p>
  {/if}
  <button class="btn cancel" onclick={() => settleChooser(null)}>Cancel</button>
</Sheet>

<style>
  .lead {
    margin: var(--rr-space-3) var(--rr-space-4) 0;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }

  .card {
    margin-top: var(--rr-space-3);
    overflow: hidden;
    border-radius: var(--rr-radius-xl);
    background: var(--rr-sheet-card);
  }

  .pick {
    color: var(--rr-label);
  }

  li {
    position: relative;
  }

  li + li::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: var(--rr-space-4);
    height: var(--rr-hairline);
    background: var(--rr-sep-strong);
    transform: scaleY(0.5);
    transform-origin: 0 0;
  }

  .cancel {
    width: 100%;
    margin-top: var(--rr-space-3);
    background: transparent;
    color: var(--rr-accent);
  }
</style>
