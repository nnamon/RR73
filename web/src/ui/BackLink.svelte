<script lang="ts">
  /**
   * iOS navigation bar for a pushed screen: a back link, the screen's title, centred, and bar
   * buttons in `trailing`, as `.bar-button`s (base.css).
   */
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { to, label, title, id, trailing }: { to: string; label: string; title: string; id: string; trailing?: Snippet } = $props();
</script>

<div class="bar">
  <a class="back" href={to}><Icon name="back" size={22} /><span>{label}</span></a>
  <h1 {id} class="title">{title}</h1>
  {#if trailing}<div class="bar-buttons trailing">{@render trailing()}</div>{/if}
</div>

<style>
  .bar {
    position: relative;
    display: flex;
    align-items: center;
    height: var(--rr-tap);
    padding: 0 var(--rr-space-2);
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
