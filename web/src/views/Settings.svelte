<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { normaliseCallsign, settings, updateSettings, type Theme } from '../lib/state/settings.svelte';
  import { audio, band, busy } from '../lib/state/station.svelte';
  import { clearCacheAndReload, reloadApp } from '../lib/app/update.svelte';
  import { log } from '../lib/log/log.svelte';

  let callsign = $state(settings.callsign);
  $effect(() => {
    callsign = settings.callsign;
  });

  function saveCallsign() {
    const v = normaliseCallsign(callsign);
    callsign = v;
    if (v !== settings.callsign) void updateSettings({ callsign: v });
  }

  const radioSummary = $derived.by(() => {
    const r = audio.report;
    if (audio.status !== 'running' || !r) return 'Audio off';
    const ch = r.channelUsed === 'mono' || !r.channelUsed ? 'mono' : `${r.channelUsed} channel`;
    return `${(r.contextRate / 1000).toFixed(r.contextRate % 1000 ? 1 : 0)} kHz, ${ch}`;
  });

  const decoderText = $derived.by(() => {
    const d = band.decoder;
    if (d.state === 'ready') return `${d.version}, loaded in ${Math.round(d.loadMs)} ms`;
    if (d.state === 'loading') return 'Loading';
    if (d.state === 'failed') return d.reason === 'crashed' ? 'Stopped' : 'Did not load';
    return 'Loads when audio starts';
  });

  const loggingSummary = $derived.by(() => {
    const on = log.facts.filter((f) => f.active).map((f) => f.name);
    if (!on.length) return 'Only on this phone';
    return on.length > 2 ? `${on.length} destinations` : on.join(' and ');
  });

  type ReloadKind = 'reload' | 'clear';
  /** A reload stops audio, so with audio running the first tap asks and a second tap within 5 s reloads. */
  let confirming = $state<ReloadKind | null>(null);
  let reloading = $state<ReloadKind | null>(null);
  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const set = () => (online = navigator.onLine);
    window.addEventListener('online', set);
    window.addEventListener('offline', set);
    return () => {
      window.removeEventListener('online', set);
      window.removeEventListener('offline', set);
      clearTimeout(confirmTimer);
    };
  });

  function tapReload(kind: ReloadKind) {
    if (reloading) return;
    if (busy() && confirming !== kind) {
      confirming = kind;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirming = null), 5000);
      return;
    }
    confirming = null;
    reloading = kind;
    void (kind === 'reload' ? reloadApp() : clearCacheAndReload());
  }

  const reloadSub = $derived(
    reloading === 'reload'
      ? 'Checking for a newer version.'
      : confirming === 'reload'
        ? 'Audio is running. Tap again to stop it and reload.'
        : 'Checks for a newer version, installs it and reloads.',
  );

  const clearSub = $derived(
    !online
      ? 'Needs a connection: the app loads fresh from the network.'
      : reloading === 'clear'
        ? 'Removing the stored copy.'
        : confirming === 'clear'
          ? 'Audio is running. Tap again to stop it and reload.'
          : 'Removes the stored copy and loads the app fresh. Settings and saved data stay on this phone.',
  );

  const themes: { id: Theme; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
</script>

<section class="screen" aria-labelledby="settings-title">
  <h1 id="settings-title" class="large-title">Settings</h1>

  <div class="section">
    <h2 class="section-head">Station</h2>
    <div class="group">
      <label class="row">
        <span class="row-title">Callsign</span>
        <input
          class="field mono"
          type="text"
          bind:value={callsign}
          onblur={saveCallsign}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          placeholder="Not set"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="13"
        />
      </label>
    </div>
    <p class="section-foot">Decodes to this callsign are marked in red. Stored on this phone.</p>
  </div>

  <div class="section">
    <h2 class="section-head">Radio</h2>
    <div class="group">
      <a class="row link" href={href('settings', 'radio')}>
        <span class="row-main"><span class="row-title">Radio and audio</span></span>
        <span class="row-value">{radioSummary}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
    </div>
  </div>

  <div class="section">
    <h2 class="section-head">Log</h2>
    <div class="group">
      <a class="row link" href={href('settings', 'logging')}>
        <span class="row-main"><span class="row-title">Logging</span></span>
        <span class="row-value">{loggingSummary}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
    </div>
    <p class="section-foot">Wavelog and the POTA, SOTA and WWFF files.</p>
  </div>

  <div class="section">
    <h2 class="section-head" id="appearance">Appearance</h2>
    <div class="seg" role="radiogroup" aria-labelledby="appearance">
      {#each themes as t (t.id)}
        <label class="seg-i" class:on={settings.theme === t.id}>
          <input class="visually-hidden" type="radio" name="theme" value={t.id} checked={settings.theme === t.id} onchange={() => void updateSettings({ theme: t.id })} />
          {t.label}
        </label>
      {/each}
    </div>
  </div>

  <div class="section">
    <h2 class="section-head">About</h2>
    <div class="group">
      <a class="row link" href={href('settings', 'versions')}>
        <span class="row-main"><span class="row-title">Version {__APP_VERSION__} ({__APP_BUILD__})</span></span>
        <span class="row-value">Version history</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
      <div class="row">
        <span class="row-main"><span class="row-title">Decoder</span></span>
        <span class="row-value" data-testid="decoder-status">{decoderText}</span>
      </div>
      <button class="row reload" disabled={reloading !== null} onclick={() => tapReload('reload')}>
        <span class="row-main"><span class="row-title acc">Reload app</span><span class="row-sub" aria-live="polite">{reloadSub}</span></span>
      </button>
      <button class="row reload" disabled={reloading !== null || !online} onclick={() => tapReload('clear')}>
        <span class="row-main"><span class="row-title acc">Clear cached copy and reload</span><span class="row-sub" aria-live="polite">{clearSub}</span></span>
      </button>
    </div>
    <p class="section-foot">RR73 is free software under the MIT or Apache 2.0 licence.</p>
  </div>
</section>

<style>
  .link {
    color: var(--rr-label);
  }

  .reload {
    color: var(--rr-label);
  }

  .acc {
    color: var(--rr-accent);
  }

  .reload:disabled .acc {
    color: var(--rr-label3);
  }

  .link :global(.row-chevron) {
    color: var(--rr-chev);
  }

  .field {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    border: 0;
    background: transparent;
    font-size: var(--rr-text-body);
    text-align: right;
    text-transform: uppercase;
  }

  .field::placeholder {
    color: var(--rr-label3);
    font-family: var(--rr-sans);
    text-transform: none;
  }

  .field:focus {
    outline: none;
  }

  .row:has(.field:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }
</style>
