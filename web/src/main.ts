import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { checkUpdated, watchServiceWorker } from './lib/app/update.svelte';
import { loadSettings } from './lib/state/settings.svelte';

checkUpdated(__APP_VERSION__);
watchServiceWorker();

// Settings load before the first render, so the theme and callsign never flash their defaults.
void loadSettings().finally(() => {
  mount(App, { target: document.getElementById('app')! });
});
