<script lang="ts">
  import { onMount, tick } from 'svelte';
  import LogNotice from './ui/LogNotice.svelte';
  import QsoSheet from './ui/QsoSheet.svelte';
  import SettingsSplit from './ui/SettingsSplit.svelte';
  import ShortcutsSheet from './ui/ShortcutsSheet.svelte';
  import PortChooser from './ui/PortChooser.svelte';
  import { isDesktop } from './lib/app/desktop';
  import StationBar from './ui/StationBar.svelte';
  import StatusNotice from './ui/StatusNotice.svelte';
  import UpdateNotice from './ui/UpdateNotice.svelte';
  import Log from './views/Log.svelte';
  import DecodeColours from './views/DecodeColours.svelte';
  import Logging from './views/Logging.svelte';
  import Operate from './views/Operate.svelte';
  import PracticeSettings from './views/PracticeSettings.svelte';
  import RelaySettings from './views/RelaySettings.svelte';
  import WebSdrSettings from './views/WebSdrSettings.svelte';
  import PskReporterSettings from './views/PskReporterSettings.svelte';
  import FtSettings from './views/FtSettings.svelte';
  import WsprSettings from './views/WsprSettings.svelte';
  import RttySettings from './views/RttySettings.svelte';
  import MacroSettings from './views/MacroSettings.svelte';
  import RadioAudio from './views/RadioAudio.svelte';
  import RigControl from './views/RigControl.svelte';
  import { catSupported } from './lib/state/cat.svelte';
  import Settings from './views/Settings.svelte';
  import Spots from './views/Spots.svelte';
  import VersionHistory from './views/VersionHistory.svelte';
  import Credits from './views/Credits.svelte';
  import Guide from './views/Guide.svelte';
  import GuidePage from './views/GuidePage.svelte';
  import WavelogSettings from './views/WavelogSettings.svelte';
  import { go, redirectOf, replace, route, tabOf } from './lib/app/router.svelte';
  import { layout, split } from './lib/app/layout.svelte';
  import { currentListKeys, focusKind, macroKeyOf, shortcutOf } from './lib/app/shortcuts';
  import { isFt, isKeyboard } from './lib/clock/slots';
  import { session, unmute } from './lib/state/keyboard.svelte';
  import { sheetOpen, sheets } from './lib/app/sheets.svelte';
  import { reloadIfIdle, update } from './lib/app/update.svelte';
  import { spotsShown } from './lib/state/features.svelte';
  import { startClock } from './lib/state/now.svelte';
  import { settings, settingsStatus } from './lib/state/settings.svelte';
  import { busy, halt } from './lib/state/station.svelte';
  import { callCq, qso, setHunt, setTxEnabled, startQso } from './lib/state/qso.svelte';
  import { startNightTimer } from './lib/state/night.svelte';
  import { setBeacon, startWspr, wspr } from './lib/state/wspr.svelte';
  import { plannedDialHz, rig } from './lib/state/radio.svelte';
  import { RADIO_STATUS_REPEAT_MS, sendRadioStatus } from './lib/log/log.svelte';

  const tab = $derived(tabOf(route.path));
  const sub = $derived(route.path[1] ?? null);

  // With Spots hidden, its paths (and Activate from earlier versions) open Settings › Optional features.
  // Settings › Logging › Wavelog › Send radio status: the dial and mode, on a change and every 2 min.
  $effect(() => {
    const on = settings.wavelogRadio;
    sendRadioStatus(on, rig.hz ?? plannedDialHz(settings.band, settings.mode), settings.mode);
    if (!on) return;
    const t = setInterval(() => sendRadioStatus(settings.wavelogRadio, rig.hz ?? plannedDialHz(settings.band, settings.mode), settings.mode), RADIO_STATUS_REPEAT_MS);
    return () => clearInterval(t);
  });

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

  // The font: Automatic uses the system font on Apple devices and Windows (Segoe UI), and Inter elsewhere.
  const systemFont = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod|Win/.test(navigator.platform || navigator.userAgent);
  $effect(() => {
    const root = document.documentElement;
    const inter = settings.font === 'inter' || (settings.font === 'auto' && !systemFont);
    if (inter) root.dataset.font = 'inter';
    else delete root.dataset.font;
  });

  // The monospace font: the system's, or a bundled one.
  $effect(() => {
    const root = document.documentElement;
    if (settings.monoFont === 'system') delete root.dataset.mono;
    else root.dataset.mono = settings.monoFont;
    if (settings.monoDecodes) root.dataset.monoDecodes = '';
    else delete root.dataset.monoDecodes;
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
      if (h1 instanceof HTMLElement && !path.startsWith('settings/versions/') && !/^settings\/guide\/[^/]+\/./.test(path)) {
        h1.setAttribute('tabindex', '-1');
        h1.focus({ preventScroll: true });
      }
    });
  });

  // A screen opened from another starts at the top, as on iOS. Going back returns to where the
  // earlier screen was. Settings › Optional features, a version opened from the update notice and a
  // section of a guide page scroll to their own place, as does Radio and audio opened at Timing by the Clock badge.
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
    const own =
      path === 'settings/features' || path === 'settings/radio/timing' || (path.startsWith('settings/versions/') && path !== 'settings/versions') || /^settings\/guide\/[^/]+\/./.test(path);
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
    return startNightTimer();
  });

  /**
   * Keyboard shortcuts (lib/app/shortcuts.ts). Esc halts on every screen; the open sheet or menu
   * closes on the same press, by its own handling of Esc. The rest wait while a sheet is open.
   * Each acts on the mode chosen: ⌥T is Tx in FT8 and FT4, the beacon in WSPR and the keyboard
   * modes' Tx; ⌥C and ⌥H are FT8 and FT4 only. In a keyboard mode F1 to F12 send the macros on
   * Operate, also while the text to send has focus.
   */
  function onkey(e: KeyboardEvent) {
    const macro = isKeyboard(settings.mode) && tab === 'operate' && !sheetOpen() ? macroKeyOf(e) : null;
    if (macro !== null) {
      const m = settings.keyboard.macros[settings.keyboard.set][macro];
      if (m) {
        unmute();
        session.tapMacro(m);
      }
      e.preventDefault();
      return;
    }
    const s = shortcutOf(e, focusKind(document.activeElement));
    if (!s) return;
    if (s === 'halt') {
      halt();
      return;
    }
    if (sheetOpen()) return;
    const ft = isFt(settings.mode);
    const list = tab === 'operate' ? currentListKeys() : null;
    switch (s) {
      case 'tx':
        if (ft) setTxEnabled(!qso.st.txEnabled);
        else if (settings.mode === 'WSPR') setBeacon(!wspr.beacon.on);
        else {
          unmute();
          session.txButton();
        }
        break;
      case 'cq':
        if (!ft) return;
        callCq();
        break;
      case 'hunt':
        if (!ft) return;
        setHunt(!qso.st.hunt);
        break;
      case 'band':
        sheets.band = true;
        break;
      case 'help':
        sheets.shortcuts = true;
        break;
      case 'operate':
      case 'log':
      case 'settings':
        go(s);
        break;
      case 'call':
        if (!list || !qso.selected) return;
        list.call();
        break;
      case 'next':
      case 'previous':
        if (!list) return;
        list.move(s === 'next' ? 1 : -1);
        break;
    }
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onkey} />

<!-- The detail of a Settings path: the whole list in compact width, one section or sub-screen beside the sections otherwise. -->
{#snippet settingsScreen()}
  {#if sub === 'radio'}
    <RadioAudio />
  {:else if sub === 'rig' && catSupported()}
    <RigControl />
  {:else if sub === 'logging' && route.path[2] === 'wavelog'}
    <WavelogSettings />
  {:else if sub === 'logging'}
    <Logging />
  {:else if sub === 'practice'}
    <PracticeSettings />
  {:else if sub === 'relay'}
    <RelaySettings />
  {:else if sub === 'sdr'}
    <WebSdrSettings />
  {:else if sub === 'pskreporter'}
    <PskReporterSettings />
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
  {:else if sub === 'credits'}
    <Credits />
  {:else if sub === 'guide' && route.path[2]}
    <GuidePage slug={route.path[2]} focus={route.path[3] ?? null} />
  {:else if sub === 'guide'}
    <Guide />
  {:else}
    <Settings section={sub} />
  {/if}
{/snippet}

<!-- Operate is the main screen. Log, Spots and Settings open over it with a back link to it. -->
<div class="app" class:on-operate={tab === 'operate'}>
  {#if layout.size === 'regular'}
    <!-- Regular width: one top bar above every screen, with the tabs. -->
    <div class="top"><StationBar regular {tab} /></div>
  {/if}
  <main class="main" id="main">
    <!-- Operate stays mounted so the waterfall keeps its history while another screen is open. -->
    <div class="pane" hidden={tab !== 'operate'}><Operate active={tab === 'operate'} /></div>
    <!-- List and detail side by side scroll on their own: the pane itself does not. -->
    {#if tab === 'log'}
      <div class="pane" class:scroll={!split()} onscroll={track}><Log /></div>
    {:else if tab === 'spots'}
      <div class="pane" class:scroll={!split()} onscroll={track}><Spots /></div>
    {:else if tab === 'settings'}
      <div class="pane" class:scroll={!split()} onscroll={track}>
        {#if split()}
          <SettingsSplit>{@render settingsScreen()}</SettingsSplit>
        {:else}
          {@render settingsScreen()}
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
<ShortcutsSheet bind:open={sheets.shortcuts} />
{#if isDesktop()}<PortChooser />{/if}

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

  /* Regular width: the top bar under the status bar, in the bar's material. */
  .top {
    position: relative;
    z-index: 5;
    flex: none;
    padding-top: var(--rr-safe-top);
    background: var(--rr-dock);
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
