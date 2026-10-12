<script lang="ts">
  import { onMount, tick } from 'svelte';
  import TabBar from './ui/TabBar.svelte';
  import UpdateNotice from './ui/UpdateNotice.svelte';
  import Operate from './views/Operate.svelte';
  import Placeholder from './views/Placeholder.svelte';
  import RadioAudio from './views/RadioAudio.svelte';
  import Settings from './views/Settings.svelte';
  import VersionHistory from './views/VersionHistory.svelte';
  import { route, tabOf } from './lib/app/router.svelte';
  import { reloadIfIdle, update } from './lib/app/update.svelte';
  import { startClock } from './lib/state/now.svelte';
  import { settings } from './lib/state/settings.svelte';
  import { busy } from './lib/state/station.svelte';

  const tab = $derived(tabOf(route.path));
  const sub = $derived(route.path[1] ?? null);

  const TITLES: Record<string, string> = { operate: 'Operate', log: 'Log', activate: 'Activate', spots: 'Spots', settings: 'Settings' };

  // The theme follows the system unless Settings pins it.
  $effect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
  });

  // Each screen has its own title; after a change of screen, focus moves to its heading so a
  // screen reader starts there. An update waiting to load is applied at this moment if nothing runs.
  let first = true;
  $effect(() => {
    const path = route.path.join('/');
    const initial = first;
    first = false;
    void tick().then(() => {
      const h1 = document.querySelector('main .pane:not([hidden]) h1');
      document.title = `${h1?.textContent?.trim() || TITLES[tab]} · RR73`;
      if (initial) return;
      if (reloadIfIdle(busy())) return;
      if (h1 instanceof HTMLElement && !path.startsWith('settings/versions/')) {
        h1.setAttribute('tabindex', '-1');
        h1.focus({ preventScroll: true });
      }
    });
  });

  onMount(() => {
    startClock();
  });
</script>

<div class="app">
  <main class="main" id="main">
    <!-- Operate stays mounted so the waterfall keeps its history while another tab is open. -->
    <div class="pane" hidden={tab !== 'operate'}><Operate /></div>
    {#if tab === 'log'}
      <div class="pane scroll">
        <Placeholder title="Log" heading="No QSOs yet" text="QSOs you log on Operate will appear here, newest first. Logging arrives in a later version." />
      </div>
    {:else if tab === 'activate'}
      <div class="pane scroll">
        <Placeholder
          title="Activate"
          heading="No activation running"
          text="Activations for POTA, SOTA, WWFF and IOTA references will appear here with their progress. Activations arrive in a later version."
        />
      </div>
    {:else if tab === 'spots'}
      <div class="pane scroll">
        <Placeholder
          title="Spots"
          heading="No spots yet"
          text="POTA, SOTA and WWFF spots on your bands will appear here and refresh every minute while online. Spots arrive in a later version."
        />
      </div>
    {:else if tab === 'settings'}
      <div class="pane scroll">
        {#if sub === 'radio'}
          <RadioAudio />
        {:else if sub === 'versions'}
          <VersionHistory focus={route.path[2] ?? null} />
        {:else}
          <Settings />
        {/if}
      </div>
    {/if}
  </main>
  {#if update.notice}<UpdateNotice version={update.notice} />{/if}
  <TabBar active={tab} />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--rr-bg);
  }

  .main {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .pane {
    position: absolute;
    inset: 0;
  }

  .pane[hidden] {
    display: none;
  }

  .scroll {
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
