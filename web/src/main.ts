import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { checkUpdated, watchServiceWorker } from './lib/app/update.svelte';
import { loadLog } from './lib/log/log.svelte';
import { loadSettings } from './lib/state/settings.svelte';

/** Longest wait for stored settings before the first render, ms. They take a few ms when storage answers. */
const SETTINGS_WAIT_MS = 500;

checkUpdated(__APP_VERSION__);
watchServiceWorker();

// Settings load before the first render, so the theme and callsign never flash their defaults,
// but the first render never waits on storage longer than SETTINGS_WAIT_MS: while an older copy
// of RR73 holds the database, the app opens and says so. The log loads after the first render.
void Promise.race([loadSettings(), new Promise((resolve) => setTimeout(resolve, SETTINGS_WAIT_MS))]).finally(() => {
  mount(App, { target: document.getElementById('app')! });
  void loadLog();
});
