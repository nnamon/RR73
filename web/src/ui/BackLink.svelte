<script lang="ts">
  /**
   * iOS navigation bar for a pushed screen: a back link, the screen's title, centred, and bar
   * buttons in `trailing`, as `.bar-button`s (base.css). The bar stays at the top while the screen
   * scrolls. At the top of the content it is clear, on the screen's background; once content
   * scrolls under it, it takes the bar material and a hairline, as UIKit's scroll-edge
   * appearance does.
   */
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { to, label, title, id, trailing }: { to: string; label: string; title: string; id: string; trailing?: Snippet } = $props();

  let bar: HTMLDivElement;
  let scrolled = $state(false);

  // The nearest ancestor that scrolls: the screen's pane.
  $effect(() => {
    let pane = bar.parentElement;
    while (pane && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
    if (!pane) return;
    const el = pane;
    const update = () => (scrolled = el.scrollTop > 0);
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  });
</script>

<div class="bar" class:scrolled bind:this={bar}>
  <a class="back" href={to}><Icon name="back" size={22} /><span>{label}</span></a>
  <h1 {id} class="title">{title}</h1>
  {#if trailing}<div class="bar-buttons trailing">{@render trailing()}</div>{/if}
</div>

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    height: var(--rr-tap);
    padding: 0 var(--rr-space-2);
    background: var(--rr-bg);
  }

  .bar.scrolled {
    background: var(--rr-dock);
    box-shadow: 0 var(--rr-hairline) 0 var(--rr-sep);
    -webkit-backdrop-filter: var(--rr-material-blur);
    backdrop-filter: var(--rr-material-blur);
  }

  .back {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    min-height: var(--rr-tap);
    padding-right: var(--rr-space-2);
    color: var(--rr-accent);
    font-size: var(--rr-text-body);
  }

  .trailing {
    position: relative;
    z-index: 1;
    margin-left: auto;
    margin-right: calc(-1 * var(--rr-space-2));
  }

  .title {
    position: absolute;
    inset: 0 112px;
    overflow: hidden;
    font-size: var(--rr-text-body);
    font-weight: var(--rr-weight-semibold);
    line-height: var(--rr-tap);
    text-align: center;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
