<script lang="ts">
  import { onMount, tick } from 'svelte';
  import LogNotice from './ui/LogNotice.svelte';
  import QsoSheet from './ui/QsoSheet.svelte';
  import StatusNotice from './ui/StatusNotice.svelte';
  import TabBar from './ui/TabBar.svelte';
  import UpdateNotice from './ui/UpdateNotice.svelte';
  import Log from './views/Log.svelte';
  import Logging from './views/Logging.svelte';
  import Operate from './views/Operate.svelte';
  import RadioAudio from './views/RadioAudio.svelte';
  import Settings from './views/Settings.svelte';
  import Spots from './views/Spots.svelte';
  import VersionHistory from './views/VersionHistory.svelte';
  import WavelogSettings from './views/WavelogSettings.svelte';
  import { redirectOf, replace, route, tabOf } from './lib/app/router.svelte';
  import { reloadIfIdle, update } from './lib/app/update.svelte';
  import { spotsShown } from './lib/state/features.svelte';
  import { startClock } from './lib/state/now.svelte';
  import { settings, settingsStatus } from './lib/state/settings.svelte';
  import { busy } from './lib/state/station.svelte';
  import { startQso } from './lib/state/qso.svelte';

  const tab = $derived(tabOf(route.path));
  const sub = $derived(route.path[1] ?? null);

  // With Spots hidden, its paths (and Activate from earlier versions) open Settings › Optional features.
  $effect(() => {
    const to = settingsStatus.loaded ? redirectOf(route.path, spotsShown()) : null;
    if (to) replace(...to);
  });

  const TITLES: Record<string, string> = { operate: 'Operate', log: 'Log', spots: 'Spots', settings: 'Settings' };

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
    startQso();
  });
</script>

<div class="app">
  <main class="main" id="main">
    <!-- Operate stays mounted so the waterfall keeps its history while another tab is open. -->
    <div class="pane" hidden={tab !== 'operate'}><Operate /></div>
    {#if tab === 'log'}
      <div class="pane scroll"><Log /></div>
    {:else if tab === 'spots'}
      <div class="pane scroll"><Spots /></div>
    {:else if tab === 'settings'}
      <div class="pane scroll">
        {#if sub === 'radio'}
          <RadioAudio />
        {:else if sub === 'logging' && route.path[2] === 'wavelog'}
          <WavelogSettings />
        {:else if sub === 'logging'}
          <Logging />
        {:else if sub === 'versions'}
          <VersionHistory focus={route.path[2] ?? null} />
        {:else}
          <Settings section={sub} />
        {/if}
      </div>
    {/if}
  </main>
  {#if update.notice}<UpdateNotice version={update.notice} />{/if}
  <StatusNotice />
  <LogNotice />
  <TabBar active={tab} />
</div>

<QsoSheet />

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
