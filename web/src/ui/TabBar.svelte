<script lang="ts">
  import Icon from './Icon.svelte';
  import { href, type Tab } from '../lib/app/router.svelte';

  let { active }: { active: Tab } = $props();

  const tabs: { id: Tab; label: string }[] = [
    { id: 'operate', label: 'Operate' },
    { id: 'log', label: 'Log' },
    { id: 'spots', label: 'Spots' },
    { id: 'settings', label: 'Settings' },
  ];
</script>

<nav class="tabbar" aria-label="Main">
  {#each tabs as t (t.id)}
    <a class="tab" class:on={active === t.id} href={href(t.id)} aria-current={active === t.id ? 'page' : undefined}>
      <Icon name={t.id} size={25} />
      <span>{t.label}</span>
    </a>
  {/each}
</nav>

<style>
  .tabbar {
    position: relative;
    z-index: 20;
    display: flex;
    flex: none;
    padding: 0 calc(var(--rr-space-1) + var(--rr-safe-right)) var(--rr-safe-bottom) calc(var(--rr-space-1) + var(--rr-safe-left));
    background: var(--rr-bar);
    box-shadow: 0 calc(-1 * var(--rr-hairline)) 0 var(--rr-sep);
    backdrop-filter: saturate(1.6) blur(18px);
  }

  .tab {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: var(--rr-tabbar);
    padding-top: var(--rr-space-1);
    color: var(--rr-label3);
  }

  .tab.on {
    color: var(--rr-accent);
  }

  .tab span {
    margin-top: var(--rr-space-half);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-medium);
    line-height: var(--rr-leading-caption);
    letter-spacing: 0;
  }
</style>
