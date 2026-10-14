<script lang="ts">
  /**
   * Settings › Web SDR: receive from a web SDR through the relay in place of the radio. Tx stays
   * on the radio's headset cable. The receivers come from the relay; the one chosen tunes to the
   * band's dial. The practice band, while on, comes first.
   */
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { chooseReceiver, relay, relayKey, setWebSdrOn, webSdr } from '../lib/state/relay.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { qspErrorText, qspReceivers, type QspReceiver } from '../lib/relay/qsp';

  let receivers = $state<QspReceiver[] | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const base = relay.base;
    const key = relayKey(base);
    receivers = null;
    error = null;
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
    return () => {
      current = false;
    };
  });

  const ready = $derived(!!relay.base && !!relay.receiver);
  const stateText = $derived.by(() => {
    if (!relay.sdrOn) return '';
    if (practice.on) return 'Waits while the practice band is on.';
    const s = webSdr.status;
    if (!s) return 'Starts with audio.';
    if (s.state === 'connecting') return 'Connecting';
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
      <p class="section-foot">A web SDR reaches RR73 through a relay. Choose one first.</p>
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
            <p class="none">This relay offers no receivers.</p>
          {/each}
        {:else if error}
          <p class="none err" role="alert">{error}</p>
        {:else}
          <p class="none">Asking the relay for its receivers.</p>
        {/if}
      </div>
      <p class="section-foot">Tunes to the band’s dial. Other listeners see your callsign.</p>
    </div>
  {/if}
</section>

<style>
  .pick {
    width: 100%;
    text-align: left;
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
