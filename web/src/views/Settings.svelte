<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { normaliseCallsign, normaliseGrid, settings, updateSettings, type Theme } from '../lib/state/settings.svelte';
  import { isGrid } from '../lib/qso/messages';
  import { audio, band } from '../lib/state/station.svelte';

  let callsign = $state(settings.callsign);
  $effect(() => {
    callsign = settings.callsign;
  });

  let grid = $state(settings.grid);
  let gridError = $state('');
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
      <label class="row">
        <span class="row-title">Grid</span>
        <input
          class="field mono"
          type="text"
          bind:value={grid}
          onblur={saveGrid}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          placeholder="Not set"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="6"
        />
      </label>
    </div>
    {#if gridError}<p class="section-foot err" role="alert">{gridError}</p>{/if}
    <p class="section-foot">Decodes to this callsign are marked in red. Transmitting needs both the callsign and the grid. Stored on this phone.</p>
  </div>

  <div class="section">
    <h2 class="section-head" id="ack">Operating</h2>
    <div class="group">
      <div class="row">
        <span class="row-main"><span class="row-title">Confirm with</span></span>
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
        <span class="row-main"><span class="row-title">Work dupes in Run</span><span class="row-sub">Stations already worked today on this band and mode</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.workDupes} onchange={(e) => void updateSettings({ workDupes: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
    </div>
    <p class="section-foot">Tx4 sends RR73 or RRR. The watchdog stops Tx after 6 min without a touch or a new message.</p>
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
    </div>
    <p class="section-foot">RR73 is free software under the MIT or Apache 2.0 licence.</p>
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

  .switch {
    flex: none;
    width: 44px;
    height: 26px;
    margin: 0;
    accent-color: var(--rr-accent-fill);
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
