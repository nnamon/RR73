<script lang="ts">
  /**
   * Settings › Logging › Wavelog: the address and API key, Test connection, the default station
   * location, sending on or off, and removing Wavelog from this phone.
   */
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import Sheet from '../ui/Sheet.svelte';
  import { href } from '../lib/app/router.svelte';
  import { utcHm } from '../lib/clock/format';
  import { forgetWavelog, log, setWavelog, testWavelog } from '../lib/log/log.svelte';
  import { checkAddress } from '../lib/log/wavelog';

  let url = $state('');
  let apiKey = $state('');
  let filled = false;
  // The log loads after the first render: fill the fields once it has.
  $effect(() => {
    if (log.ready && !filled) {
      filled = true;
      url = log.wavelog.url;
      apiKey = log.wavelog.apiKey;
    }
  });
  let addressError = $state('');
  let testing = $state(false);
  let removing = $state(false);

  const w = $derived(log.wavelog);
  const test = $derived(w.lastTest);

  /** Stores the address in its normal form, or says what is wrong with it. Returns the stored address. */
  async function saveAddress(quiet: boolean): Promise<string | null> {
    const a = checkAddress(url);
    if (!a.ok) {
      addressError = quiet && !url.trim() ? '' : a.message;
      return null;
    }
    addressError = '';
    url = a.url;
    if (a.url !== w.url) await setWavelog({ url: a.url, lastTest: null });
    return a.url;
  }

  async function saveKey() {
    apiKey = apiKey.trim();
    if (apiKey !== w.apiKey) await setWavelog({ apiKey, lastTest: null });
  }

  async function runTest() {
    testing = true;
    try {
      await saveKey();
      const address = await saveAddress(false);
      if (address) await testWavelog({ url: address, apiKey, stationId: log.wavelog.stationId });
    } finally {
      testing = false;
    }
  }

  async function remove() {
    removing = false;
    await forgetWavelog();
    url = '';
    apiKey = '';
  }
</script>

<section class="screen sub" aria-labelledby="wavelog-title">
  <BackLink to={href('settings', 'logging')} label="Logging" title="Wavelog" id="wavelog-title" />

  <div class="section">
    <h2 class="section-head">Connection</h2>
    <div class="group">
      <label class="row">
        <span class="row-title">Address</span>
        <input
          class="row-field"
          type="url"
          bind:value={url}
          onblur={() => void saveAddress(true)}
          placeholder="https://log.example.com"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          inputmode="url"
        />
      </label>
      <label class="row">
        <span class="row-title">API key</span>
        <input class="row-field mono" type="password" bind:value={apiKey} onblur={() => void saveKey()} placeholder="Read-write key" autocapitalize="off" autocomplete="off" spellcheck="false" />
      </label>
    </div>
    {#if addressError}
      <p class="section-foot bad" role="alert">{addressError}</p>
    {:else}
      <p class="section-foot">Create a read-write API key on the API page in Wavelog. The key stays on this phone.</p>
    {/if}
  </div>

  <div class="section">
    <button class="btn primary wide" disabled={testing} onclick={() => void runTest()}>{testing ? 'Testing connection' : 'Test connection'}</button>
    <p class="result" class:ok={test?.ok} class:bad={test && !test.ok} role="status">
      {#if testing}
        Checking the key, the station locations and a test QSO that Wavelog does not store.
      {:else if test}
        {test.ok ? `Connected${test.version ? ` to Wavelog ${test.version}` : ''} at ${utcHm(test.at)} UTC. The key can read and write.` : test.message}
      {/if}
    </p>
  </div>

  {#if w.stations.length}
    <div class="section">
      <h2 class="section-head" id="station-head">Station location</h2>
      <div class="group" role="radiogroup" aria-labelledby="station-head">
        {#each w.stations as s (s.id)}
          <label class="row pick">
            <input class="visually-hidden" type="radio" name="station" value={s.id} checked={w.stationId === s.id} onchange={() => void setWavelog({ stationId: s.id })} />
            <span class="row-main">
              <span class="row-title">{s.name}</span>
              <span class="row-sub">{s.callsign}{s.grid ? ` · ${s.grid}` : ''}{s.active ? ' · active in Wavelog' : ''}</span>
            </span>
            {#if w.stationId === s.id}<span class="tick" aria-hidden="true"><Icon name="check" size={20} /></span>{/if}
          </label>
        {/each}
      </div>
      <p class="section-foot">For QSOs outside an activation, and the default for new activations. Wavelog refuses a QSO whose callsign on air differs from its station location’s callsign, so each activation can choose its own.</p>
    </div>
  {/if}

  <div class="section">
    <div class="group">
      <label class="row">
        <span class="row-main">
          <span class="row-title">Send QSOs to Wavelog</span>
          <span class="row-sub">Off keeps them on this phone only</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={w.enabled} onchange={(e) => void setWavelog({ enabled: e.currentTarget.checked })} />
      </label>
    </div>
  </div>

  {#if w.url || w.apiKey}
    <div class="section center">
      <button class="text-button danger" onclick={() => (removing = true)}>Remove Wavelog…</button>
    </div>
  {/if}
</section>

<Sheet bind:open={removing} title="Remove Wavelog?">
  <p class="confirm-text">The address and API key are deleted from this phone. QSOs stay in the log with their delivery history.</p>
  <button class="btn tx full" onclick={() => void remove()}>Remove Wavelog</button>
  <button class="btn full keep" onclick={() => (removing = false)}>Keep Wavelog</button>
</Sheet>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

  .row-title {
    flex: none;
  }

  .wide {
    display: flex;
    width: 100%;
  }

  .result {
    min-height: var(--rr-leading-sub);
    padding: var(--rr-space-2) var(--rr-space-4) 0;
    font-size: var(--rr-text-foot);
    line-height: var(--rr-leading-foot);
    color: var(--rr-label2);
  }

  .ok {
    color: var(--rr-ok);
  }

  .bad {
    color: var(--rr-tx-text);
  }

  .pick {
    cursor: pointer;
  }

  .pick:has(:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }

  .tick {
    flex: none;
    color: var(--rr-accent);
  }

  .center {
    display: flex;
    justify-content: center;
  }

  .confirm-text {
    margin: var(--rr-space-3) var(--rr-space-1) 0;
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
    text-align: center;
  }

  .full {
    width: 100%;
    margin-top: var(--rr-space-3);
  }

  .keep {
    margin-top: var(--rr-space-2);
    background: transparent;
    color: var(--rr-accent);
  }
</style>
