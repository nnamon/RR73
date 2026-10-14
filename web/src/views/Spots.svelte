<script lang="ts">
  /**
   * Spots, with the parts turned on in Settings › Optional features. The activation sits at the
   * top: a Start activation row when none runs, else the running activation. Spots follow below;
   * they arrive in a later version.
   *
   * Beside the list (compact height and regular width) Spots follows the Log: the list on the
   * left, the running activation in the detail pane on the right.
   */
  import { layout, split } from '../lib/app/layout.svelte';
  import { refsLabel } from '../lib/log/activation';
  import ActivationPanel from '../ui/ActivationPanel.svelte';
  import ActivationSheet from '../ui/ActivationSheet.svelte';
  import Icon from '../ui/Icon.svelte';
  import BackLink from '../ui/BackLink.svelte';
  import { href } from '../lib/app/router.svelte';
  import { log } from '../lib/log/log.svelte';
  import { features } from '../lib/state/features.svelte';

  let starting = $state(false);
  const sources = $derived([features.potaSpots && 'POTA', features.clusterSpots && 'DX cluster'].filter(Boolean).join(' and '));
</script>

{#snippet startRow()}
  <div class="section">
    <h2 class="section-head">Activation</h2>
    <div class="group">
      <button class="row start" onclick={() => (starting = true)}>
        <span class="ic" aria-hidden="true"><Icon name="mountain" size={20} /></span>
        <span class="row-main">
          <span class="row-title">Start activation</span>
          <span class="row-sub">POTA, SOTA, WWFF and IOTA</span>
        </span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </button>
    </div>
  </div>
{/snippet}

{#snippet sourcesNote()}
  {#if sources}
    <div class="section">
      <h2 class="section-head">Spots</h2>
      <div class="group">
        <p class="none">No spots yet. {sources} spots on your bands will appear here in a later version, refreshed every minute while online.</p>
      </div>
    </div>
  {/if}
{/snippet}

{#if split()}
  <section class="split" aria-labelledby="spots-title">
    {#if layout.size === 'compact-height'}
      <BackLink to={href('operate')} label="Operate" title="Spots" id="spots-title" />
    {/if}
    <div class="cols">
      <div class="list-col">
        {#if layout.size === 'regular'}<h1 class="large-title" id="spots-title">Spots</h1>{/if}
        {#if features.activations && log.ready && log.current}
          <div class="section">
            <h2 class="section-head">Activation</h2>
            <div class="group">
              <div class="row running" aria-current="true">
                <span class="ic" aria-hidden="true"><Icon name="mountain" size={20} /></span>
                <span class="row-main">
                  <span class="row-title">{refsLabel(log.current.refs)}</span>
                  <span class="row-sub">Running, as {log.current.callsign}</span>
                </span>
              </div>
            </div>
          </div>
        {:else if features.activations && log.ready}
          {@render startRow()}
        {/if}
        {@render sourcesNote()}
      </div>
      <div class="detail-col">
        {#if features.activations && log.ready && log.current}
          <div class="detail"><ActivationPanel activation={log.current} /></div>
        {:else}
          <div class="empty">
            <h2>No activation running</h2>
            <p>Activations you start appear here with their QSOs and files.</p>
          </div>
        {/if}
      </div>
    </div>
  </section>
{:else}
  <section class="screen" aria-labelledby="spots-title">
    <BackLink to={href('operate')} label="Operate" title="Spots" id="spots-title" />

    {#if features.activations && log.ready && log.current}
      <ActivationPanel activation={log.current} />
    {:else if features.activations && log.ready}
      {@render startRow()}
    {/if}

    {@render sourcesNote()}
  </section>
{/if}

<ActivationSheet bind:open={starting} />

<style>
  .start {
    color: var(--rr-label);
  }

  .start :global(.row-chevron) {
    color: var(--rr-chev);
  }

  .ic {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--rr-row-icon);
    height: var(--rr-row-icon);
    border-radius: var(--rr-radius-m);
    background: var(--rr-ic-orange);
    color: var(--rr-on-fill);
  }

  .split {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding-top: var(--rr-safe-top);
    background: var(--rr-bg);
  }

  :global([data-size='regular']) .split {
    padding-top: 0;
  }

  .cols {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .list-col {
    flex: none;
    width: clamp(var(--rr-list-column-narrow), 30vw, var(--rr-list-column));
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 0 var(--rr-space-8) var(--rr-safe-left);
    box-shadow: inset calc(-1 * var(--rr-hairline)) 0 0 var(--rr-sep-strong);
  }

  .list-col .large-title {
    padding-top: var(--rr-space-3);
  }

  .running {
    background: var(--rr-sel-tint);
  }

  .detail-col {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .detail {
    max-width: var(--rr-form);
    margin: 0 auto;
    padding-bottom: var(--rr-space-8);
  }

  .none {
    padding: var(--rr-space-3) var(--rr-space-4);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }
</style>
