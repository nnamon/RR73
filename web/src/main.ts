import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { checkUpdated, watchServiceWorker } from './lib/app/update.svelte';
import { loadLog } from './lib/log/log.svelte';
import { loadSettings } from './lib/state/settings.svelte';

checkUpdated(__APP_VERSION__);
watchServiceWorker();

// Settings load before the first render, so the theme and callsign never flash their defaults.
// The log loads after the first render: Operate does not wait for it.
void loadSettings().finally(() => {
  mount(App, { target: document.getElementById('app')! });
  void loadLog();
});

// The Playwright screen review drives the app through these; other builds leave them out.
if (import.meta.env.VITE_E2E === '1') void import('./lib/testing/e2e-hooks').then((m) => m.installE2eHooks());
