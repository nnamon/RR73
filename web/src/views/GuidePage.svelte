<script lang="ts">
  /**
   * One page of the Guide, as Version history shows the changelog: each section a header over a
   * group, each paragraph and list item a row. Links to other pages open them here; `focus` names
   * a section to scroll to.
   */
  import { tick } from 'svelte';
  import files from 'virtual:guide';
  import BackLink from '../ui/BackLink.svelte';
  import { href } from '../lib/app/router.svelte';
  import { parseGuidePage, type Span } from '../lib/app/guide';

  let { slug, focus = null }: { slug: string; focus?: string | null } = $props();

  const page = $derived(slug !== 'index' && files[slug] ? parseGuidePage(slug, files[slug]) : null);

  $effect(() => {
    const id = focus;
    void page;
    void tick().then(() => {
      const el = id ? document.getElementById(`guide-${id}`) : null;
      el?.scrollIntoView({ block: 'start' });
      el?.focus({ preventScroll: true });
    });
  });
</script>

{#snippet spans(list: Span[])}
  {#each list as s, i (i)}
    {#if s.kind === 'code'}<code class="msg">{s.text}</code>
    {:else if s.kind === 'page'}<a class="in" href={s.anchor ? href('settings', 'guide', s.slug, s.anchor) : href('settings', 'guide', s.slug)}>{s.text}</a>
    {:else if s.kind === 'web'}<a class="in" href={s.url} target="_blank" rel="noopener noreferrer">{s.text}</a>
    {:else}{s.text}{/if}
  {/each}
{/snippet}

<section class="screen sub" aria-labelledby="guide-page-title">
  <BackLink to={href('settings', 'guide')} label="Guide" title={page?.title ?? 'Guide'} id="guide-page-title" />

  {#if !page}
    <div class="empty">
      <h2>No such page in this version</h2>
      <p>Pages of the guide are listed under Settings › Guide.</p>
    </div>
  {:else}
    {#each page.sections as s, si (si)}
      <div class="section">
        {#if s.heading}<h2 class="section-head" id="guide-{s.id}" tabindex="-1">{s.heading}</h2>{/if}
        <div class="group">
          {#each s.blocks as b, bi (bi)}
            {#if b.kind === 'p'}
              <p class="row text">{@render spans(b.spans)}</p>
            {:else}
              <svelte:element this={b.kind} class="items">
                {#each b.items as item, ii (ii)}
                  <li class="row text item">
                    <span class="mark" aria-hidden="true">{b.kind === 'ol' ? `${ii + 1}.` : '•'}</span>
                    <span class="row-main">{@render spans(item)}</span>
                  </li>
                {/each}
              </svelte:element>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</section>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

  .section-head {
    scroll-margin-top: var(--rr-space-4);
  }

  .text {
    display: block;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
  }

  /* Rows of a list follow the rows before them in one group, each with its own separator. */
  .items {
    display: contents;
  }

  /* Rows on either side of a list: the separator base.css draws between sibling rows. */
  .text + .items > .item:first-child::before,
  .items + .text::before,
  .items + .items > .item:first-child::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: var(--rr-space-4);
    height: var(--rr-hairline);
    background: var(--rr-sep);
    transform: scaleY(0.5);
    transform-origin: 0 0;
  }

  .item {
    display: flex;
    gap: var(--rr-space-2);
    align-items: baseline;
  }

  .mark {
    flex: none;
    min-width: var(--rr-space-4);
    color: var(--rr-label2);
    font-variant-numeric: tabular-nums;
  }

  .msg {
    font-family: var(--rr-mono);
    font-size: var(--rr-text-sub);
  }

  .in {
    color: var(--rr-accent);
  }
</style>
