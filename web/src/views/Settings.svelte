<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import BackLink from '../ui/BackLink.svelte';
  import LocateButton from '../ui/LocateButton.svelte';
  import type { LocateResult } from '../lib/location/locate';
  import { href } from '../lib/app/router.svelte';
  import { split } from '../lib/app/layout.svelte';
  import { NIGHT_AFTER, normaliseCallsign, normaliseGrid, normaliseText, settings, updateSettings, type FontChoice, type Theme } from '../lib/state/settings.svelte';
  import { isGrid } from '../lib/qso/messages';
  import { busy } from '../lib/state/station.svelte';
  import { clearCacheAndReload, reloadApp } from '../lib/app/update.svelte';
  import { features, setFeature, type FeatureId } from '../lib/state/features.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { relay, relayName } from '../lib/state/relay.svelte';
  import { pskReporter } from '../lib/state/pskreporter.svelte';
  import { presetLabel, presetOf } from '../lib/decode/highlight';
  import { loggingSummary as logging, radioSummary as radio } from '../lib/state/summaries';
  import { catSupported } from '../lib/state/cat.svelte';
  import { rigSummary } from '../lib/state/radio.svelte';

  // Rig control needs Web Serial: desktop Chrome and Edge. Safari has none, so the row never shows there.
  const rigShown = catSupported();

  /**
   * "features" scrolls to Optional features, as when Spots is hidden and its path opens Settings.
   * Beside the sections (compact height and regular width) the path names the one section shown:
   * station (the default), features, appearance or about.
   */
  let { section = null }: { section?: string | null } = $props();

  type One = 'station' | 'features' | 'appearance' | 'about';
  const ONE_TITLES: Record<One, string> = { station: 'Station', features: 'Optional features', appearance: 'Appearance', about: 'About' };
  const one = $derived<One | null>(split() ? (section && section in ONE_TITLES ? (section as One) : 'station') : null);

  let featuresHead = $state<HTMLElement | null>(null);
  $effect(() => {
    if (section === 'features' && !one) featuresHead?.scrollIntoView({ block: 'start' });
  });

  const optional: { id: FeatureId; title: string; sub?: string }[] = [
    { id: 'activations', title: 'Activations', sub: 'POTA, SOTA, WWFF and IOTA' },
    { id: 'potaSpots', title: 'POTA spots', sub: 'Activators from pota.app' },
    { id: 'clusterSpots', title: 'Cluster spots', sub: 'DX cluster from HamQTH' },
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

  let myName = $state(settings.myName);
  let myQth = $state(settings.myQth);
  $effect(() => {
    myName = settings.myName;
    myQth = settings.myQth;
  });

  function saveText(key: 'myName' | 'myQth', value: string) {
    const v = normaliseText(value);
    if (key === 'myName') myName = v;
    else myQth = v;
    if (v !== settings[key]) void updateSettings({ [key]: v });
  }

  function saveCallsign() {
    const v = normaliseCallsign(callsign);
    callsign = v;
    if (v !== settings.callsign) void updateSettings({ callsign: v });
  }

  const radioSummary = $derived(radio());
  const loggingSummary = $derived(logging());

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
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'sun', label: 'Sun' },
    { id: 'system', label: 'System' },
  ];

  const fonts: { id: FontChoice; label: string }[] = [
    { id: 'auto', label: 'Automatic' },
    { id: 'system', label: 'System' },
    { id: 'inter', label: 'Inter' },
  ];
</script>

{#snippet stationSection()}
  <div class="section">
    {#if !one}<h2 class="section-head">Station</h2>{/if}
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
      <label class="row">
        <span class="row-title">Name</span>
        <input
          class="field mono"
          type="text"
          bind:value={myName}
          onblur={() => saveText('myName', myName)}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          placeholder="Optional"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="40"
        />
      </label>
      <label class="row">
        <span class="row-title">QTH</span>
        <input
          class="field mono"
          type="text"
          bind:value={myQth}
          onblur={() => saveText('myQth', myQth)}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          placeholder="Optional"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="40"
        />
      </label>
    </div>
    {#if gridError}<p class="section-foot err" role="alert">{gridError}</p>{:else if gridNote}<p class="section-foot" role="status">{gridNote}</p>{/if}
    <p class="section-foot">Callsign and grid are needed to transmit.</p>
  </div>

{/snippet}
{#snippet modesSection()}
  <div class="section">
    <h2 class="section-head">Modes</h2>
    <div class="group">
      <a class="row link" href={href('settings', 'ft8')}>
        <span class="row-main"><span class="row-title">FT8 and FT4</span></span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
      <a class="row link" href={href('settings', 'wspr')}>
        <span class="row-main"><span class="row-title">WSPR</span></span>
        <span class="row-value">{settings.wspr.txPct}% · {settings.wspr.powerDbm} dBm</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
      <a class="row link" href={href('settings', 'rtty')}>
        <span class="row-main"><span class="row-title">RTTY</span></span>
        <span class="row-value">{settings.rtty.baud} · {settings.rtty.shiftHz} Hz</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
      <a class="row link" href={href('settings', 'macros')}>
        <span class="row-main"><span class="row-title">Macros</span></span>
        <span class="row-value">{settings.keyboard.set === 'qso' ? 'QSO' : 'Contest'} · {settings.keyboard.macros[settings.keyboard.set].length}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
    </div>
  </div>

{/snippet}
{#snippet radioSection()}
  <div class="section">
    <h2 class="section-head">Radio</h2>
    <div class="group">
      <a class="row link" href={href('settings', 'radio')}>
        <span class="row-main"><span class="row-title">Radio and audio</span></span>
        <span class="row-value">{radioSummary}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
      {#if rigShown}
        <a class="row link" href={href('settings', 'rig')}>
          <span class="row-main"><span class="row-title">Rig control</span></span>
          <span class="row-value">{rigSummary()}</span>
          <Icon name="chevright" size={13} class="row-chevron" />
        </a>
      {/if}
      <a class="row link" href={href('settings', 'sdr')}>
        <span class="row-main"><span class="row-title">Web SDR</span></span>
        <span class="row-value">{relay.sdrOn ? relay.receiverName || 'On' : 'Off'}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
      <a class="row link" href={href('settings', 'pskreporter')}>
        <span class="row-main"><span class="row-title">PSK Reporter</span></span>
        <span class="row-value">{pskReporter.on ? 'On' : 'Off'}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
      <a class="row link" href={href('settings', 'relay')}>
        <span class="row-main"><span class="row-title">Relay</span></span>
        <span class="row-value">{relayName(relay.base)}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
    </div>
  </div>

{/snippet}
{#snippet logSection()}
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

{/snippet}
{#snippet practiceSection()}
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

{/snippet}
{#snippet featuresSection()}
  <div class="section">
    <h2 class="section-head" class:visually-hidden={one} id="features" bind:this={featuresHead}>Optional features</h2>
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

{/snippet}
{#snippet appearanceSection()}
  <div class="section">
    <h2 class="section-head" class:visually-hidden={one} id="appearance">Appearance</h2>
    <div class="seg" role="radiogroup" aria-labelledby="appearance">
      {#each themes as t (t.id)}
        <label class="seg-i" class:on={settings.theme === t.id}>
          <input class="visually-hidden" type="radio" name="theme" value={t.id} checked={settings.theme === t.id} onchange={() => void updateSettings({ theme: t.id })} />
          {t.label}
        </label>
      {/each}
    </div>
    <div class="group night">
      <div class="row stack">
        <span class="row-main"><span class="row-title" id="font-choice">Font</span><span class="row-sub">Automatic: Apple's font, else Inter</span></span>
        <span class="seg" role="radiogroup" aria-labelledby="font-choice">
          {#each fonts as f (f.id)}
            <label class="seg-i" class:on={settings.font === f.id}>
              <input class="visually-hidden" type="radio" name="font" value={f.id} checked={settings.font === f.id} onchange={() => void updateSettings({ font: f.id })} />
              {f.label}
            </label>
          {/each}
        </span>
      </div>
      <div class="row stack">
        <span class="row-main"><span class="row-title" id="night-after">Night display</span><span class="row-sub">After Operate sits untouched</span></span>
        <span class="seg" role="radiogroup" aria-labelledby="night-after">
          {#each NIGHT_AFTER as m (m)}
            <label class="seg-i" class:on={settings.nightAfterMin === m}>
              <input class="visually-hidden" type="radio" name="night-after" value={m} checked={settings.nightAfterMin === m} onchange={() => void updateSettings({ nightAfterMin: m })} />
              {m === 0 ? 'Off' : `${m} min`}
            </label>
          {/each}
        </span>
      </div>
    </div>
    {#if !one}<div class="group colours">
      <a class="row link" href={href('settings', 'colours')}>
        <span class="row-main"><span class="row-title">Decode colours</span></span>
        <span class="row-value">{presetLabel(presetOf(settings.highlights))}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
    </div>{/if}
  </div>

{/snippet}
{#snippet aboutSection()}
  <div class="section">
    {#if !one}<h2 class="section-head">About</h2>{/if}
    <div class="group">
      <a class="row link" href={href('settings', 'versions')}>
        <span class="row-main"><span class="row-title">Version history</span></span>
        <span class="row-value">{__APP_VERSION__}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
      <a class="row link" href={href('settings', 'credits')}>
        <span class="row-main"><span class="row-title">Credits</span></span>
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
{/snippet}

{#if one}
  <!-- Beside the sections (SettingsSplit): one section, titled in its bar. -->
  <section class="screen" aria-labelledby="settings-title">
    <BackLink to={href('settings')} label="Settings" title={ONE_TITLES[one]} id="settings-title" />
    {#if one === 'features'}
      {@render featuresSection()}
    {:else if one === 'appearance'}
      {@render appearanceSection()}
    {:else if one === 'about'}
      {@render aboutSection()}
    {:else}
      {@render stationSection()}
    {/if}
  </section>
{:else}
  <section class="screen" aria-labelledby="settings-title">
    <BackLink to={href('operate')} label="Operate" title="Settings" id="settings-title" />

    {@render stationSection()}

    {@render modesSection()}

    {@render radioSection()}

    {@render logSection()}

    {@render practiceSection()}

    {@render featuresSection()}

    {@render appearanceSection()}

    {@render aboutSection()}
  </section>
{/if}

<style>
  .link {
    color: var(--rr-label);
  }

  .err {
    color: var(--rr-tx-text);
  }

  .colours,
  .night {
    margin-top: var(--rr-space-4);
  }

  /* The title, then the segments across the row. */
  .stack {
    flex-direction: column;
    gap: var(--rr-space-2);
    align-items: stretch;
  }

  .reload {
    color: var(--rr-label);
  }

  .acc {
    color: var(--rr-accent);
  }

  .reload:disabled .acc {
    opacity: 0.4;
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
