<script lang="ts">
  import { onMount, tick } from 'svelte';
  import LogNotice from './ui/LogNotice.svelte';
  import QsoSheet from './ui/QsoSheet.svelte';
  import StatusNotice from './ui/StatusNotice.svelte';
  import UpdateNotice from './ui/UpdateNotice.svelte';
  import Log from './views/Log.svelte';
  import DecodeColours from './views/DecodeColours.svelte';
  import Logging from './views/Logging.svelte';
  import Operate from './views/Operate.svelte';
  import PracticeSettings from './views/PracticeSettings.svelte';
  import FtSettings from './views/FtSettings.svelte';
  import WsprSettings from './views/WsprSettings.svelte';
  import RttySettings from './views/RttySettings.svelte';
  import MacroSettings from './views/MacroSettings.svelte';
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
  import { startWspr } from './lib/state/wspr.svelte';

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

  // A screen opened from another starts at the top, as on iOS. Going back returns to where the
  // earlier screen was. Settings › Optional features and a version opened from the update notice
  // scroll to their own place.
  const scrolls = new Map<string, number>();
  let scrollNow = 0;
  let shownPath = route.path.join('/');
  $effect(() => {
    const path = route.path.join('/');
    const prev = shownPath;
    if (path === prev) return;
    shownPath = path;
    scrolls.set(prev, scrollNow);
    const back = prev.startsWith(`${path}/`);
    const own = path === 'settings/features' || (path.startsWith('settings/versions/') && path !== 'settings/versions');
    // Effects run after the DOM update and before paint, so the new screen never shows at the old
    // offset and anything measuring it afterwards sees the final position.
    const pane = document.querySelector<HTMLElement>('main .pane.scroll');
    if (!pane || own) return;
    pane.scrollTop = back ? (scrolls.get(path) ?? 0) : 0;
    scrollNow = pane.scrollTop;
  });
  const track = (e: Event) => (scrollNow = (e.currentTarget as HTMLElement).scrollTop);

  onMount(() => {
    startClock();
    startQso();
    startWspr();
  });
</script>

<!-- Operate is the main screen. Log, Spots and Settings open over it with a back link to it. -->
<div class="app" class:on-operate={tab === 'operate'}>
  <main class="main" id="main">
    <!-- Operate stays mounted so the waterfall keeps its history while another screen is open. -->
    <div class="pane" hidden={tab !== 'operate'}><Operate active={tab === 'operate'} /></div>
    {#if tab === 'log'}
      <div class="pane scroll" onscroll={track}><Log /></div>
    {:else if tab === 'spots'}
      <div class="pane scroll" onscroll={track}><Spots /></div>
    {:else if tab === 'settings'}
      <div class="pane scroll" onscroll={track}>
        {#if sub === 'radio'}
          <RadioAudio />
        {:else if sub === 'logging' && route.path[2] === 'wavelog'}
          <WavelogSettings />
        {:else if sub === 'logging'}
          <Logging />
        {:else if sub === 'practice'}
          <PracticeSettings />
        {:else if sub === 'ft8'}
          <FtSettings />
        {:else if sub === 'wspr'}
          <WsprSettings />
        {:else if sub === 'rtty'}
          <RttySettings />
        {:else if sub === 'macros'}
          <MacroSettings macroId={route.path[2] ?? null} />
        {:else if sub === 'colours'}
          <DecodeColours />
        {:else if sub === 'versions'}
          <VersionHistory focus={route.path[2] ?? null} />
        {:else}
          <Settings section={sub} />
        {/if}
      </div>
    {/if}
  </main>
  {#if update.notice}<UpdateNotice version={update.notice} />{/if}
  <div class="floats">
    <StatusNotice />
    <LogNotice />
  </div>
</div>

<QsoSheet />

<style>
  /* Border-box (base.css): the safe-area padding is inside the 100dvh, so the app is never taller than the screen. */
  .app {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;

    /* A keyboard mode sets --rr-app-h to the visual viewport while the keyboard is up, so Operate's
       bottom bar sits on the keyboard (lib/state/keyboard.svelte.ts). */
    height: var(--rr-app-h, 100dvh);
    padding-bottom: var(--rr-safe-bottom);
    background: var(--rr-bg);
  }

  /* Under the home indicator, Operate's bottom bar carries on. */
  .app.on-operate {
    background: var(--rr-dock);
  }

  /* Notices float over the screen above Operate's buttons, or above the screen's bottom edge, so nothing under them moves. */
  .floats {
    position: fixed;
    right: 0;
    bottom: calc(var(--rr-safe-bottom) + var(--rr-space-2));
    left: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 var(--rr-space-4);
    pointer-events: none;
  }

  .app.on-operate .floats {
    bottom: calc(var(--rr-safe-bottom) + var(--rr-bar-h, 0px) + var(--rr-space-2));
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
