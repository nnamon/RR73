<script lang="ts">
  /**
   * Settings › Relay: the QSP relay in use (docs/design/qsp.md). The list holds None, the default,
   * and each relay the operator added by its API base. The chosen relay shows its access key, Test
   * relay and Remove relay. Test reads /about and, when the relay offers web SDR, its receivers.
   */
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { addRelay, chooseRelay, relay, relayKey, relayName, removeRelay, setRelayKey } from '../lib/state/relay.svelte';
  import { blockedFromPage, normaliseBase, qspAbout, qspErrorText, qspReceivers } from '../lib/relay/qsp';

  let adding = $state(false);
  let address = $state('');
  let addressError = $state<string | null>(null);
  let addressEl: HTMLInputElement | undefined = $state();
  let key = $state(relayKey());
  let result = $state<{ ok: boolean; text: string } | null>(null);
  let testing = $state(false);

  // Show the chosen relay's key and clear the last test result.
  $effect(() => {
    key = relayKey(relay.base);
    result = null;
  });

  $effect(() => {
    if (adding) addressEl?.focus();
  });

  function choose(base: string) {
    adding = false;
    addressError = null;
    chooseRelay(base);
  }

  function startAdding() {
    adding = true;
    address = '';
    addressError = null;
  }

  function saveAddress() {
    if (!address.trim()) {
      adding = false;
      addressError = null;
      return;
    }
    const base = normaliseBase(address);
    if (!base) {
      addressError = 'That is not an http or https address. Enter the relay’s API base, such as https://relay.example.org/qsp.';
      return;
    }
    if (blockedFromPage(base, location.protocol)) {
      addressError = 'Browsers block http requests from an https app. Enter the relay’s https address.';
      return;
    }
    addRelay(base);
    adding = false;
    addressError = null;
  }

  function saveKey() {
    key = key.trim();
    setRelayKey(relay.base, key);
  }

  async function test() {
    const base = relay.base;
    if (!base || testing) return;
    testing = true;
    result = null;
    try {
      const about = await qspAbout(base);
      if (about.name !== 'QSP') throw new Error('not QSP');
      let text = `${about.name} ${about.version}`;
      if (about.services.includes('sdr')) {
        const list = await qspReceivers(base, relayKey(base));
        text += ` · Web SDR, ${list.length} ${list.length === 1 ? 'receiver' : 'receivers'}`;
      }
      if (base === relay.base) result = { ok: true, text };
    } catch (e) {
      if (base === relay.base) result = { ok: false, text: qspErrorText(e) };
    } finally {
      testing = false;
    }
  }
</script>

<section class="screen sub" aria-labelledby="relay-title">
  <BackLink to={href('settings')} label="Settings" title="Relay" id="relay-title" />

  <div class="section">
    <div class="group" role="radiogroup" aria-label="Relay">
      <button class="row pick" role="radio" aria-checked={!relay.base} onclick={() => choose('')}>
        <span class="row-main"><span class="row-title">None</span></span>
        {#if !relay.base}<Icon name="check" size={17} class="chk" />{/if}
      </button>
      {#each relay.relays as r (r.base)}
        <button class="row pick" role="radio" aria-checked={relay.base === r.base} onclick={() => choose(r.base)}>
          <span class="row-main">
            <span class="row-title">{relayName(r.base)}</span>
            <span class="row-sub">{r.base.replace(/^https?:\/\//, '')}</span>
          </span>
          {#if relay.base === r.base}<Icon name="check" size={17} class="chk" />{/if}
        </button>
      {/each}
    </div>
    <p class="section-foot">QSP relays connect RR73 to services a web page cannot reach, such as web SDRs.</p>
  </div>

  <div class="section">
    <div class="group">
      {#if adding}
        <label class="row">
          <span class="row-title">Address</span>
          <input
            class="row-field"
            type="url"
            inputmode="url"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="https://host/path"
            bind:this={addressEl}
            bind:value={address}
            onblur={saveAddress}
            onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-invalid={addressError !== null}
          />
        </label>
      {:else}
        <button class="row act" onclick={startAdding}><span class="row-title">Add relay</span></button>
      {/if}
    </div>
    {#if addressError}
      <p class="section-foot err" role="alert">{addressError}</p>
    {:else if adding}
      <p class="section-foot">The relay’s operator gives you its API base.</p>
    {/if}
  </div>

  {#if relay.base}
    <div class="section">
      <h2 class="section-head">{relayName(relay.base)}</h2>
      <div class="group">
        <label class="row">
          <span class="row-title">Access key</span>
          <input
            class="row-field"
            type="password"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Optional"
            bind:value={key}
            onblur={saveKey}
            onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <button class="row act" disabled={testing} onclick={() => void test()}>
          <span class="row-main">
            <span class="row-title">{testing ? 'Testing' : 'Test relay'}</span>
            {#if result}<span class="row-sub" class:err={!result.ok} role="status">{result.text}</span>{/if}
          </span>
        </button>
      </div>
      <p class="section-foot">The relay’s operator issues access keys. The relay never receives passwords for other services.</p>
    </div>

    <div class="section center">
      <button class="text-button danger" onclick={() => removeRelay(relay.base)}>Remove relay</button>
    </div>
  {/if}
</section>

<style>
  .pick,
  .act {
    width: 100%;
    text-align: left;
  }

  .pick :global(.chk) {
    flex: none;
    color: var(--rr-accent);
  }

  .act .row-title {
    color: var(--rr-accent);
  }

  .act:disabled .row-title {
    opacity: 0.4;
  }

  .err {
    color: var(--rr-tx-text);
  }

  .center {
    display: flex;
    justify-content: center;
  }
</style>
