import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { checkUpdated, noteLoadFailure, registerServiceWorker } from './lib/app/update.svelte';
import { loadLog } from './lib/log/log.svelte';
import { loadSettings, updateSettings } from './lib/state/settings.svelte';
import { loadPractice, practice } from './lib/state/practice.svelte';
import { initPractice } from './lib/practice/runtime.svelte';
import { installNetworkGuard } from './lib/practice/guard';
import { linkSpotFeed } from './lib/state/spots.svelte';
import { initRelay, loadRelay } from './lib/state/relay.svelte';
import { initPskReporter, loadPskReporter } from './lib/state/pskreporter.svelte';
import { initHeardYou, loadHeardYou } from './lib/state/heard.svelte';
import { initWsprnet, loadWsprnet } from './lib/state/wsprnet.svelte';
import { initCat } from './lib/state/cat.svelte';
import { initWavelogWorked } from './lib/log/wavelog-worked.svelte';

// While practice is on, nothing but the app's own files goes over the network.
installNetworkGuard(() => practice.on);
// The Optional features switches turn the spot sources on and off.
linkSpotFeed();

/** Longest wait for stored settings before the first render, ms. They take a few ms when storage answers. */
const SETTINGS_WAIT_MS = 500;

checkUpdated(__APP_VERSION__);
void registerServiceWorker();

// A lazy chunk, script or stylesheet of this build failed: a newer build may have replaced it.
window.addEventListener('vite:preloadError', () => void noteLoadFailure());
window.addEventListener(
  'error',
  (e) => {
    if (e.target instanceof HTMLScriptElement || e.target instanceof HTMLLinkElement) void noteLoadFailure();
  },
  true,
);

// Settings load before the first render, so the theme and callsign never flash their defaults,
// but the first render never waits on storage longer than SETTINGS_WAIT_MS: while an older copy
// of RR73 holds the database, the app opens and says so. The log loads after the first render.
// With practice on, the practice log loads in place of the log.
// The Playwright tests pin the theme before the app starts (e2e/theme.ts); other builds leave it out.
if (import.meta.env.VITE_E2E === '1') {
  const theme = (window as { __rr73Theme?: unknown }).__rr73Theme;
  if (theme === 'light' || theme === 'dark' || theme === 'sun' || theme === 'system') void updateSettings({ theme });
}
const practiceLoaded = loadPractice();
const relayLoaded = loadRelay();
const pskLoaded = loadPskReporter();
const heardLoaded = loadHeardYou();
const wsprnetLoaded = loadWsprnet();
const settingsLoaded = loadSettings();
void Promise.race([Promise.all([settingsLoaded, practiceLoaded, relayLoaded, pskLoaded, heardLoaded, wsprnetLoaded]), new Promise((resolve) => setTimeout(resolve, SETTINGS_WAIT_MS))]).finally(() => {
  mount(App, { target: document.getElementById('app')! });
  // Rig control, in desktop Chromium: opens the radio's port again once the settings say to.
  void settingsLoaded.then(() => initCat());
  void Promise.all([practiceLoaded, relayLoaded])
    .then(() => initPractice())
    .then(() => initRelay())
    .then(() => initPskReporter())
    .then(() => initHeardYou())
    .then(() => initWsprnet())
    .catch(() => undefined)
    .finally(() => {
      void loadLog();
      // Read Wavelog's log (Settings › Logging › Wavelog) starts once the operator's log has loaded.
      initWavelogWorked();
    });
});

// The Playwright screen review drives the app through these; other builds leave them out.
if (import.meta.env.VITE_E2E === '1') void import('./lib/testing/e2e-hooks').then((m) => m.installE2eHooks());
