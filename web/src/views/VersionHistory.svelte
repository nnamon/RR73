<script lang="ts">
  /** Version history from CHANGELOG.md: one section per version, entries as plain text. */
  import { tick } from 'svelte';
  import changelog from 'virtual:changelog';
  import BackLink from '../ui/BackLink.svelte';
  import { href } from '../lib/app/router.svelte';
  import { longDate, parseChangelog } from '../lib/app/changelog';

  let { focus = null }: { focus?: string | null } = $props();

  const releases = parseChangelog(changelog, { includeUnreleased: import.meta.env.DEV });

  $effect(() => {
    const v = focus;
    if (!v) return;
    void tick().then(() => {
      const el = document.getElementById(`v${v}`);
      el?.scrollIntoView({ block: 'start' });
      el?.focus({ preventScroll: true });
    });
  });
</script>

<section class="screen sub" aria-labelledby="versions-title">
  <BackLink to={href('settings')} label="Settings" title="Version history" id="versions-title" />
  <p class="intro">You are using version {__APP_VERSION__} ({__APP_BUILD__}).</p>

  {#if releases.length === 0}
    <div class="empty">
      <h2>No version history in this build</h2>
      <p>Each version lists its changes here when the build includes CHANGELOG.md.</p>
    </div>
  {/if}

  {#each releases as r (r.version)}
    <div class="section">
      <h2 class="section-head release" id="v{r.version}" tabindex="-1">
        <span class="ver">{r.version}</span>{#if r.date}{' '}<span class="date">· {longDate(r.date)}</span>{/if}
        {#if r.version === __APP_VERSION__}<span class="current">This version</span>{/if}
      </h2>
      <ul class="group entries">
        {#each r.entries as e, i (i)}<li class="row entry">{e}</li>{/each}
        {#if r.entries.length === 0}<li class="row entry none">No changes listed.</li>{/if}
      </ul>
    </div>
  {/each}
</section>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

  .intro {
    margin-top: var(--rr-space-2);
    padding: 0 var(--rr-space-4);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }

  .release {
    display: flex;
    flex-wrap: wrap;
    gap: var(--rr-space-1) var(--rr-space-2);
    align-items: baseline;
    scroll-margin-top: var(--rr-space-4);
  }

  .ver {
    font-family: var(--rr-mono);
    font-size: var(--rr-text-sub);
    font-weight: var(--rr-weight-bold);
    letter-spacing: 0;
    color: var(--rr-label);
  }

  .current {
    padding: 0 var(--rr-space-2);
    border-radius: var(--rr-radius-s);
    background: var(--rr-accent-soft);
    color: var(--rr-accent);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
  }

  .entry {
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  .none {
    color: var(--rr-label2);
  }
</style>
