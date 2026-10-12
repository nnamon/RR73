<script lang="ts">
  /** iOS navigation bar for a sub-screen: a back link and the screen's title, centred. */
  import Icon from './Icon.svelte';

  let { to, label, title, id }: { to: string; label: string; title: string; id: string } = $props();
</script>

<div class="bar">
  <a class="back" href={to}><Icon name="back" size={22} /><span>{label}</span></a>
  <h1 {id} class="title">{title}</h1>
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
