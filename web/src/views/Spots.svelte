<script lang="ts">
  /**
   * Spots, with the parts turned on in Settings › Optional features. The activation sits at the
   * top: a Start activation row when none runs, else the running activation. Spots follow below;
   * they arrive in a later version.
   */
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

<section class="screen" aria-labelledby="spots-title">
  <BackLink to={href('operate')} label="Operate" title="Spots" id="spots-title" />

  {#if features.activations && log.ready && log.current}
    <ActivationPanel activation={log.current} />
  {:else if features.activations && log.ready}
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
  {/if}

  {#if sources}
    <div class="section">
      <h2 class="section-head">Spots</h2>
      <div class="group">
        <p class="none">No spots yet. {sources} spots on your bands will appear here in a later version, refreshed every minute while online.</p>
      </div>
    </div>
  {/if}
</section>

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

  .none {
    padding: var(--rr-space-3) var(--rr-space-4);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }
</style>
