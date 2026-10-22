<script lang="ts">
  /** Settings › Guide: the pages of docs/guide in the order index.md lists them, bundled with the app. */
  import files from 'virtual:guide';
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { guidePages } from '../lib/app/guide';

  const pages = guidePages(files);
</script>

<section class="screen sub" aria-labelledby="guide-title">
  <BackLink to={href('settings')} label="Settings" title="Guide" id="guide-title" />

  {#if pages.length === 0}
    <div class="empty">
      <h2>No guide in this build</h2>
      <p>The guide's pages appear here in builds that include them.</p>
    </div>
  {:else}
    <div class="section">
      <div class="group">
        {#each pages as p (p.slug)}
          <a class="row link" href={href('settings', 'guide', p.slug)}>
            <span class="row-main"><span class="row-title">{p.title}</span></span>
            <Icon name="chevright" size={13} class="row-chevron" />
          </a>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

  .link {
    color: var(--rr-label);
  }
</style>
