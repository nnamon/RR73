<script lang="ts">
  /**
   * Settings › PSK Reporter: reports the stations the radio decodes, through the relay
   * (docs/design/qsp.md, PSK Reporter). Off by default. The status line says what holds reports
   * back, or what went last. The relay's /about says whether it reports to PSK Reporter.
   */
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { utcHm } from '../lib/clock/format';
  import { relay, relayName } from '../lib/state/relay.svelte';
  import { pskHold, pskReporter, pskStatus, updatePskReporter } from '../lib/state/pskreporter.svelte';
  import { qspAbout } from '../lib/relay/qsp';

  let offered = $state<boolean | null>(null);
  $effect(() => {
    const base = relay.base;
    offered = null;
    if (!base) return;
    let current = true;
    qspAbout(base).then(
      (a) => {
        if (current) offered = a.services.includes('pskreporter');
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  });

  let antenna = $state(pskReporter.antenna);

  function saveAntenna() {
    antenna = antenna.trim().slice(0, 100);
    if (antenna !== pskReporter.antenna) void updatePskReporter({ antenna });
  }

  const stateText = $derived.by(() => {
    const hold = pskHold();
    if (hold === 'off') return '';
    if (hold === 'relay') return 'Needs a relay. Add one in Settings › Relay.';
    if (offered === false) return 'This relay does not report to PSK Reporter';
    if (hold === 'station') return 'Needs your callsign and grid';
    if (hold === 'practice') return 'Paused while the practice band is on';
    if (hold === 'web-sdr') return 'Paused while receiving from a web SDR';
    if (hold === 'mode') return 'Paused in WSPR and RTTY';
    if (pskStatus.error) return pskStatus.error;
    if (pskStatus.atMs !== null) return `Sent ${pskStatus.spots} ${pskStatus.spots === 1 ? 'spot' : 'spots'}, last at ${utcHm(pskStatus.atMs)} UTC`;
    return 'Waiting for decodes';
  });
</script>

<section class="screen sub" aria-labelledby="psk-title">
  <BackLink to={href('settings')} label="Settings" title="PSK Reporter" id="psk-title" />

  <div class="section">
    <div class="group">
      <label class="row">
        <span class="row-main">
          <span class="row-title">Report to PSK Reporter</span>
          <span class="row-sub">Stations your radio decodes</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={pskReporter.on} onchange={(e) => void updatePskReporter({ on: e.currentTarget.checked })} />
      </label>
    </div>
    {#if stateText}<p class="section-foot" role="status">{stateText}</p>{/if}
  </div>

  <div class="section">
    <div class="group">
      <label class="row">
        <span class="row-title">Antenna</span>
        <input
          class="row-field"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="Optional"
          maxlength="100"
          bind:value={antenna}
          onblur={saveAntenna}
          onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      <a class="row link" href={href('settings', 'relay')}>
        <span class="row-main"><span class="row-title">Relay</span></span>
        <span class="row-value">{relayName(relay.base)}</span>
        <Icon name="chevright" size={13} class="row-chevron" />
      </a>
    </div>
    <p class="section-foot">PSK Reporter shows your antenna on its map. The relay reports every 5 min.</p>
  </div>
</section>

<style>
  .link {
    color: var(--rr-label);
  }

  .link :global(.row-chevron) {
    color: var(--rr-chev);
  }
</style>
