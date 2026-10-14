<script lang="ts">
  /**
   * Spots, with the parts turned on in Settings › Optional features. The activation sits at the
   * top: a Start activation row when none runs, else the running activation. Spots from POTA and
   * the DX cluster follow below, polled while this screen is shown. Go on a spot chases its
   * station (lib/state/spots.svelte.ts). The practice band pauses spots.
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
  import SpotList from '../ui/SpotList.svelte';
  import { spotFeed } from '../lib/spots/feed.svelte';
  import { isNewSpot, spotBadge, spotLog } from '../lib/spots/log';
  import { goTarget, goToSpot, spots } from '../lib/state/spots.svelte';
  import { clock } from '../lib/state/now.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import type { Spot } from '../lib/spots/types';

  let starting = $state(false);
  const spotsOn = $derived(features.potaSpots || features.clusterSpots);

  // The feed polls while this screen is shown.
  $effect(() => spotFeed.start());

  // Ages count whole minutes and Worked today the UTC day: the list follows the clock once a second.
  const secondMs = $derived(Math.floor(clock.ms / 1000) * 1000);
  const dayMs = $derived(Math.floor(clock.ms / 86_400_000) * 86_400_000);
  const book = $derived(spotLog(log.live, dayMs, settings.band));
  const isNew = (s: Spot) => isNewSpot(s, book);
  const badge = (s: Spot) => spotBadge(s, book);
  const canGo = (s: Spot) => goTarget(s) !== null;
  const onGo = (s: Spot) => void goToSpot(s);
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

{#snippet spotSection()}
  {#if spotsOn}
    <div class="section">
      <h2 class="section-head">Spots</h2>
      {#if practice.on}
        <div class="group">
          <p class="none">Spots pause while the practice band is on. Turn it off in Settings › Practice band.</p>
        </div>
      {:else}
        <SpotList
          spots={spotFeed.spots}
          feed={spotFeed.view}
          now={secondMs}
          bind:filter={spots.filter}
          bind:selected={spots.selected}
          myBands={book.bands}
          {isNew}
          {badge}
          {canGo}
          {onGo}
        />
      {/if}
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
        {@render spotSection()}
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

    {@render spotSection()}
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
