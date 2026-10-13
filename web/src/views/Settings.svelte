<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import BackLink from '../ui/BackLink.svelte';
  import LocateButton from '../ui/LocateButton.svelte';
  import type { LocateResult } from '../lib/location/locate';
  import { href } from '../lib/app/router.svelte';
  import { normaliseCallsign, normaliseGrid, normaliseMinutes, settings, updateSettings, type Theme } from '../lib/state/settings.svelte';
  import { isGrid } from '../lib/qso/messages';
  import { audio, busy } from '../lib/state/station.svelte';
  import { clearCacheAndReload, reloadApp } from '../lib/app/update.svelte';
  import { log } from '../lib/log/log.svelte';
  import { features, setFeature, type FeatureId } from '../lib/state/features.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { presetLabel, presetOf } from '../lib/decode/highlight';

  /** "features" scrolls to Optional features, as when Spots is hidden and its path opens Settings. */
  let { section = null }: { section?: string | null } = $props();

  let featuresHead = $state<HTMLElement | null>(null);
  $effect(() => {
    if (section === 'features') featuresHead?.scrollIntoView({ block: 'start' });
  });

  const optional: { id: FeatureId; title: string; sub?: string }[] = [
    { id: 'activations', title: 'Activations', sub: 'POTA, SOTA, WWFF and IOTA' },
    { id: 'potaSpots', title: 'POTA spots' },
    { id: 'clusterSpots', title: 'Cluster spots' },
    { id: 'lotw', title: 'LoTW users', sub: 'Marks stations that use LoTW' },
  ];

  let callsign = $state(settings.callsign);
  $effect(() => {
    callsign = settings.callsign;
  });

  let grid = $state(settings.grid);
  let gridError = $state('');
  let gridNote = $state('');
  $effect(() => {
    grid = settings.grid;
  });

  function saveGrid() {
    const g = grid.trim();
    if (g && !isGrid(g)) {
      gridError = 'A grid square is 4 or 6 characters, such as OJ11 or OJ11ab.';
      return;
    }
    gridError = '';
    grid = g ? normaliseGrid(g) : '';
    if (grid !== settings.grid) void updateSettings({ grid });
  }

  function useGps(r: LocateResult) {
    if (!r.ok) {
      gridError = r.message;
      gridNote = '';
      return;
    }
    grid = r.grid;
    saveGrid();
    gridNote = r.note;
  }

  let watchdogMin = $state(String(settings.watchdogMin));
  $effect(() => {
    watchdogMin = String(settings.watchdogMin);
  });

  /** Any positive number of minutes; anything else puts back the stored value. */
  function saveWatchdog() {
    const m = normaliseMinutes(Number(watchdogMin.replace(',', '.')));
    if (m === null) watchdogMin = String(settings.watchdogMin);
    else void updateSettings({ watchdogMin: m });
  }

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

  const loggingSummary = $derived.by(() => {
    // Activation files count only while Activations is on.
    const on = log.facts.filter((f) => f.active && (features.activations || f.transport !== 'file')).map((f) => f.name);
    if (!on.length) return 'Only on this phone';
    return on.length > 2 ? `${on.length} destinations` : on.join(' and ');
  });

  type ReloadKind = 'reload' | 'clear';
  /** A reload stops audio; it starts on the first tap. */
  let reloading = $state<ReloadKind | null>(null);
  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);

  $effect(() => {
    const set = () => (online = navigator.onLine);
    window.addEventListener('online', set);
    window.addEventListener('offline', set);
    return () => {
      window.removeEventListener('online', set);
      window.removeEventListener('offline', set);
    };
  });

  function tapReload(kind: ReloadKind) {
    if (reloading) return;
    reloading = kind;
    void (kind === 'reload' ? reloadApp() : clearCacheAndReload());
  }

  const reloadSub = $derived(reloading === 'reload' ? 'Checking for updates' : 'Installs any update. Audio stops.');

  const clearSub = $derived(
    !online
      ? 'Needs a connection'
      : reloading === 'clear'
        ? 'Removing the cached copy'
        : 'Keeps settings and QSOs. Audio stops.',
  );

  const themes: { id: Theme; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
</script>

<section class="screen" aria-labelledby="settings-title">
  <BackLink to={href('operate')} label="Operate" title="Settings" id="settings-title" />

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
          placeholder="Required"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="13"
        />
      </label>
      <div class="row">
        <label class="row-title" for="settings-grid">Grid</label>
        <input
          id="settings-grid"
          class="field mono"
          type="text"
          bind:value={grid}
          oninput={() => (gridNote = '')}
          onblur={saveGrid}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          placeholder="Required"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="6"
        />
        <LocateButton chars={6} onresult={useGps} />
      </div>
    </div>
    {#if gridError}<p class="section-foot err" role="alert">{gridError}</p>{:else if gridNote}<p class="section-foot" role="status">{gridNote}</p>{/if}
    <p class="section-foot">Needed to transmit.</p>
  </div>

  <div class="section">
    <h2 class="section-head">FT8 and FT4</h2>
    <div class="group">
      <div class="row">
        <span class="row-main"><span class="row-title" id="ack">Confirm with</span></span>
        <span class="seg ack" role="radiogroup" aria-labelledby="ack">
          {#each ['RR73', 'RRR'] as const as a (a)}
            <label class="seg-i" class:on={settings.ack === a}>
              <input class="visually-hidden" type="radio" name="ack" value={a} checked={settings.ack === a} onchange={() => void updateSettings({ ack: a })} />
              {a}
            </label>
          {/each}
        </span>
      </div>
      <label class="row">
        <span class="row-main"><span class="row-title">Work dupes</span><span class="row-sub">Same day, band and mode</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.workDupes} onchange={(e) => void updateSettings({ workDupes: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
      <label class="row">
        <span class="row-main"><span class="row-title">Tail-end</span><span class="row-sub">Call once more after their QSO</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.tailEnd} onchange={(e) => void updateSettings({ tailEnd: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
      <label class="row">
        <span class="row-main"><span class="row-title">Watchdog</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.watchdog} onchange={(e) => void updateSettings({ watchdog: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
      {#if settings.watchdog}
        <label class="row">
          <span class="row-title">Stop Tx after</span>
          <input
            class="field num"
            type="text"
            inputmode="decimal"
            bind:value={watchdogMin}
            onblur={saveWatchdog}
            onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            autocomplete="off"
            aria-label="Stop Tx after, min"
          />
          <span class="unit">min</span>
        </label>
      {/if}
      <label class="row">
        <span class="row-main"><span class="row-title">Hold Tx frequency</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.holdTx} onchange={(e) => void updateSettings({ holdTx: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
    </div>
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
  </div>

  <div class="section">
    <h2 class="section-head">Practice</h2>
    <div class="group">
      <a class="row link" href={href('settings', 'practice')}>
        <span class="row-main"><span class="row-title">Practice band</span></span>
        <span class="row-value">{practice.on ? 'On' : 'Off'}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
    </div>
  </div>

  <div class="section">
    <h2 class="section-head" id="features" bind:this={featuresHead}>Optional features</h2>
    <div class="group">
      {#each optional as f (f.id)}
        <label class="row">
          <span class="row-main">
            <span class="row-title">{f.title}</span>
            {#if f.sub}<span class="row-sub">{f.sub}</span>{/if}
          </span>
          <input type="checkbox" role="switch" class="switch" checked={features[f.id]} onchange={(e) => void setFeature(f.id, e.currentTarget.checked)} />
        </label>
      {/each}
    </div>
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
    <div class="group colours">
      <a class="row link" href={href('settings', 'colours')}>
        <span class="row-main"><span class="row-title">Decode colours</span></span>
        <span class="row-value">{presetLabel(presetOf(settings.highlights))}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
    </div>
  </div>

  <div class="section">
    <h2 class="section-head">About</h2>
    <div class="group">
      <a class="row link" href={href('settings', 'versions')}>
        <span class="row-main"><span class="row-title">Version history</span></span>
        <span class="row-value">{__APP_VERSION__}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
      <button class="row reload" disabled={reloading !== null} onclick={() => tapReload('reload')}>
        <span class="row-main"><span class="row-title acc">Reload app</span><span class="row-sub" aria-live="polite">{reloadSub}</span></span>
      </button>
      <button class="row reload" disabled={reloading !== null || !online} onclick={() => tapReload('clear')}>
        <span class="row-main"><span class="row-title acc">Clear cached copy and reload</span><span class="row-sub" aria-live="polite">{clearSub}</span></span>
      </button>
    </div>
  </div>
</section>

<style>
  .link {
    color: var(--rr-label);
  }

  .err {
    color: var(--rr-tx-text);
  }

  .ack {
    width: 160px;
  }

  .colours {
    margin-top: var(--rr-space-4);
  }

  .switch {
    flex: none;
    width: 44px;
    height: 26px;
    margin: 0;
    accent-color: var(--rr-accent-fill);
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

  .field.num {
    font-variant-numeric: tabular-nums;
  }

  .unit {
    flex: none;
    color: var(--rr-label2);
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
