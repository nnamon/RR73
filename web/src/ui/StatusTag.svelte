<script lang="ts">
  /** Where a QSO stands at one destination: "Wavelog · waiting", or "Wavelog" with a tick once delivered. */
  import Icon from './Icon.svelte';
  import type { Tag } from '../lib/log/view';

  let { tag }: { tag: Tag } = $props();
</script>

<span class="tg {tag.tone}">
  <span aria-hidden="true">{tag.text}</span>
  {#if tag.tone === 'ok'}<Icon name="check" size={11} class="tg-ck" />{/if}
  <span class="visually-hidden">{tag.label}</span>
</span>

<style>
  .tg {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--rr-space-half);
    height: 21px;
    padding: 0 var(--rr-space-1-5);
    border-radius: var(--rr-radius-s);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: 21px;
    letter-spacing: 0;
    white-space: nowrap;
  }

  .ok {
    background: var(--rr-ok-soft);
    color: var(--rr-ok);
  }

  .wait {
    box-shadow: inset 0 0 0 1.5px var(--rr-warn);
    color: var(--rr-warn);
  }

  .bad {
    background: var(--rr-tx-soft);
    color: var(--rr-tx-text);
  }
</style>
