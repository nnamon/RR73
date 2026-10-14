<script lang="ts">
  /**
   * Settings › Web SDR: receive audio from a web SDR through the relay. Tx still goes to the radio.
   * The relay lists its receivers, and the chosen one tunes to the band's dial. Where the relay
   * allows it (/about userReceivers), the operator adds KiwiSDRs by address, kept per relay. While
   * the practice band is on, it keeps the input.
   */
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { addUserReceiver, chooseReceiver, relay, relayKey, removeUserReceiver, setWebSdrOn, userReceivers, webSdr } from '../lib/state/relay.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { parseReceiverAddress, qspAbout, qspErrorText, qspReceivers, receiverAddress, userReceiverId, userReceiverOf, type QspReceiver } from '../lib/relay/qsp';

  let receivers = $state<QspReceiver[] | null>(null);
  let error = $state<string | null>(null);
  let userAllowed = $state(false);
  let adding = $state(false);
  let address = $state('');
  let addressError = $state<string | null>(null);
  let addressEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    const base = relay.base;
    const key = relayKey(base);
    receivers = null;
    error = null;
    userAllowed = false;
    adding = false;
    addressError = null;
    if (!base) return;
    let current = true;
    qspReceivers(base, key).then(
      (list) => {
        if (current) receivers = list;
      },
      (e) => {
        if (current) error = qspErrorText(e);
      },
    );
    qspAbout(base).then(
      (about) => {
        if (current) userAllowed = about.userReceivers === true;
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  });

  $effect(() => {
    if (adding) addressEl?.focus();
  });

  const own = $derived(userReceivers(relay.base));
  const chosenOwn = $derived(relay.receiver !== null && userReceiverOf(relay.receiver) !== null);

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
    const r = parseReceiverAddress(address);
    if (!r) {
      addressError = 'That is not a receiver address. Enter its host and port, such as kiwi.example.org:8073.';
      return;
    }
    addUserReceiver(r);
    adding = false;
    addressError = null;
  }

  const ready = $derived(!!relay.base && !!relay.receiver);
  const stateText = $derived.by(() => {
    if (!relay.sdrOn) return '';
    if (practice.on) return 'Paused while the practice band is on';
    const s = webSdr.status;
    if (!s) return 'Waiting for Start audio in Operate';
    if (s.state === 'connecting') return `Connecting to ${relay.receiverName}`;
    if (s.state === 'streaming') return `Receiving from ${relay.receiverName}`;
    return s.message ?? 'Stopped';
  });
</script>

<section class="screen sub" aria-labelledby="websdr-title">
  <BackLink to={href('settings')} label="Settings" title="Web SDR" id="websdr-title" />

  <div class="section">
    <div class="group">
      <label class="row" class:off={!ready}>
        <span class="row-main">
          <span class="row-title">Receive from a web SDR</span>
          <span class="row-sub">Tx stays on the radio</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={relay.sdrOn} disabled={!ready && !relay.sdrOn} onchange={(e) => setWebSdrOn(e.currentTarget.checked)} />
      </label>
    </div>
    {#if stateText}<p class="section-foot" role="status">{stateText}</p>{/if}
  </div>

  {#if !relay.base}
    <div class="section">
      <div class="group">
        <a class="row link" href={href('settings', 'relay')}>
          <span class="row-main"><span class="row-title">Relay</span></span>
          <span class="row-value">None</span>
          <Icon name="chevright" size={13} class="row-chevron" />
        </a>
      </div>
      <p class="section-foot">Web SDR receive needs a relay.</p>
    </div>
  {:else}
    <div class="section">
      <h2 class="section-head">Receivers</h2>
      <div class="group" role="radiogroup" aria-label="Receivers">
        {#if receivers}
          {#each receivers as r (r.id)}
            <button class="row pick" role="radio" aria-checked={relay.receiver === r.id} onclick={() => chooseReceiver(r)}>
              <span class="row-main">
                <span class="row-title">{r.name}</span>
                <span class="row-sub">{[r.location, r.grid].filter(Boolean).join(' · ')}</span>
              </span>
              {#if relay.receiver === r.id}<Icon name="check" size={17} class="chk" />{/if}
            </button>
          {:else}
            {#if own.length === 0}<p class="none">This relay offers no receivers.</p>{/if}
          {/each}
        {:else if error}
          <p class="none err" role="alert">{error}</p>
        {:else}
          <p class="none">Loading receivers from the relay</p>
        {/if}
        {#each own as r (userReceiverId(r))}
          {@const id = userReceiverId(r)}
          <button class="row pick" role="radio" aria-checked={relay.receiver === id} onclick={() => chooseReceiver({ id, name: receiverAddress(r) })}>
            <span class="row-main">
              <span class="row-title">{receiverAddress(r)}</span>
              <span class="row-sub">Added by you</span>
            </span>
            {#if relay.receiver === id}<Icon name="check" size={17} class="chk" />{/if}
          </button>
        {/each}
      </div>
      <p class="section-foot">Other listeners on the receiver see your callsign.</p>
    </div>

    {#if userAllowed}
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
                placeholder="host:port"
                bind:this={addressEl}
                bind:value={address}
                onblur={saveAddress}
                onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                aria-invalid={addressError !== null}
              />
            </label>
          {:else}
            <button class="row act" onclick={startAdding}><span class="row-title">Add KiwiSDR</span></button>
          {/if}
        </div>
        {#if addressError}
          <p class="section-foot err" role="alert">{addressError}</p>
        {/if}
      </div>
    {/if}

    {#if chosenOwn && relay.receiver}
      {@const id = relay.receiver}
      <div class="section center">
        <button class="text-button danger" onclick={() => removeUserReceiver(id)}>Remove receiver</button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .pick,
  .act {
    width: 100%;
    text-align: left;
  }

  .act .row-title {
    color: var(--rr-accent);
  }

  .center {
    display: flex;
    justify-content: center;
  }

  .pick :global(.chk) {
    flex: none;
    color: var(--rr-accent);
  }

  .off .row-title {
    opacity: 0.4;
  }

  .link {
    color: var(--rr-label);
  }

  .link :global(.row-chevron) {
    color: var(--rr-chev);
  }

  .none {
    padding: var(--rr-space-3) var(--rr-space-4);
    font-size: var(--rr-text-sub);
    line-height: var(--rr-leading-sub);
    color: var(--rr-label2);
  }

  .err {
    color: var(--rr-tx-text);
  }
</style>
