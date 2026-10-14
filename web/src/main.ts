import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { checkUpdated, noteLoadFailure, registerServiceWorker } from './lib/app/update.svelte';
import { loadLog } from './lib/log/log.svelte';
import { loadSettings } from './lib/state/settings.svelte';
import { loadPractice, practice } from './lib/state/practice.svelte';
import { initPractice } from './lib/practice/runtime.svelte';
import { installNetworkGuard } from './lib/practice/guard';

// While practice is on, nothing but the app's own files goes over the network.
installNetworkGuard(() => practice.on);

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
const practiceLoaded = loadPractice();
void Promise.race([Promise.all([loadSettings(), practiceLoaded]), new Promise((resolve) => setTimeout(resolve, SETTINGS_WAIT_MS))]).finally(() => {
  mount(App, { target: document.getElementById('app')! });
  void practiceLoaded
    .then(() => initPractice())
    .catch(() => undefined)
    .finally(() => void loadLog());
});

// The Playwright screen review drives the app through these; other builds leave them out.
if (import.meta.env.VITE_E2E === '1') void import('./lib/testing/e2e-hooks').then((m) => m.installE2eHooks());
