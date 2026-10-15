<script lang="ts">
  /**
   * Settings › Rig control (docs/design/cat.md): the radio, Connect radio and its state, keying by
   * CAT, Keep Tx audio centred and Test keying, and the radio's menu settings with what to change.
   * Shown only where the browser has Web Serial (desktop Chrome and Edge). Keying by CAT is off
   * until the operator turns it on; until then the radio keys by VOX and RR73 only reads and sets
   * its dial and mode. Keep Tx audio centred needs keying by CAT and is off by default.
   */
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { mhz } from '../lib/clock/format';
  import { UNKEY_FAILED, connectRadio, disconnectRadio, testKeying } from '../lib/state/cat.svelte';
  import { modeText, rig, rigConnected, usbSendOn } from '../lib/state/radio.svelte';
  import { settings, updateSettings } from '../lib/state/settings.svelte';

  const connected = $derived(rigConnected());
  /** A link is open or opening: the button disconnects. */
  const linked = $derived(connected || rig.status === 'connecting');

  const badge = $derived.by((): { text: string; tone: 'ok' | 'wait' | 'idle' | 'bad' } => {
    if (rig.unkeyFailed) return { text: 'PTT off not confirmed', tone: 'bad' };
    switch (rig.status) {
      case 'connected':
        return rig.keyed ? { text: 'Transmitting', tone: 'wait' } : { text: 'Connected', tone: 'ok' };
      case 'connecting':
        return { text: 'Connecting', tone: 'wait' };
      case 'choosing':
        return { text: 'Choosing a port', tone: 'wait' };
      case 'silent':
        return { text: 'No reply', tone: 'bad' };
      case 'lost':
        return { text: 'Port closed', tone: 'bad' };
      case 'failed':
        return { text: 'Not connected', tone: 'bad' };
      default:
        return { text: 'Off', tone: 'idle' };
    }
  });

  const PORT_A = 'IC-705 Serial Port A (CI-V)';

  /** What is wrong with the connection and what to do, or how to start. */
  const connectionText = $derived.by((): { text: string; bad: boolean } | null => {
    if (rig.unkeyFailed) return { text: UNKEY_FAILED, bad: true };
    switch (rig.status) {
      case 'off':
        return { text: `Plug in the IC-705 by USB, tap Connect radio, then choose ${PORT_A}.`, bad: false };
      case 'choosing':
        return { text: `Choose ${PORT_A}.`, bad: false };
      case 'silent':
        return rig.noiseOnly
          ? { text: `This port sends data that is not CI-V. Tap Connect radio and choose ${PORT_A}.`, bad: true }
          : { text: `No reply from the IC-705. Check that it is on, that you chose ${PORT_A}, and that SET › Connectors › CI-V › CI-V Address is A4.`, bad: true };
      case 'lost':
        return { text: 'The IC-705’s port closed, and Tx went off. Check the cable and the radio, then tap Connect radio.', bad: true };
      case 'failed':
        switch (rig.error) {
          case 'busy':
            return { text: 'Another program has the port open. Close it, then tap Connect radio.', bad: true };
          case 'signals':
            return { text: 'The port’s DTR and RTS lines could not be set low, so the port was closed. Set SET › Connectors › USB SEND/Keying › USB SEND to OFF, then tap Connect radio.', bad: true };
          case 'no-wasm':
            return { text: 'Rig control did not load. Reload the app.', bad: true };
          case 'gone':
            return { text: 'The IC-705 is not plugged in, or the browser no longer allows its port. Plug it in, then tap Connect radio.', bad: true };
          case 'choose':
            return { text: `The browser allows more than one port of this kind. Tap Connect radio and choose ${PORT_A}.`, bad: true };
          default:
            return { text: 'The port did not open. Unplug the USB cable, plug it in again, then tap Connect radio.', bad: true };
        }
      case 'connected':
        return usbSendOn() ? { text: 'Tx stays off until USB SEND is OFF. Radio settings, below, gives the menu path.', bad: true } : null;
      default:
        return rig.error === 'refused' ? { text: 'The browser did not allow the port. Tap Connect radio again.', bad: true } : null;
    }
  });

  const dialText = $derived(rig.hz === null ? 'Reading' : `${mhz(rig.hz)} ${modeText(rig.mode, rig.data)}`);

  const usbSendValues = ['OFF', 'USB (A) DTR', 'USB (A) RTS', 'USB (B) DTR', 'USB (B) RTS'];
  const dataModValues = ['MIC', 'USB', 'MIC,USB', 'WLAN'];
  const totValues = ['OFF', '3 min', '5 min', '10 min', '20 min', '30 min'];

  /** The menu settings read on connecting, each with whether it suits RR73. */
  const menu = $derived.by(() => {
    const m = rig.menu;
    const row = (title: string, values: string[], v: number | undefined, ok: (v: number) => boolean) => ({ title, value: v === undefined ? 'Reading' : (values[v] ?? String(v)), ok: v === undefined ? null : ok(v) });
    return [
      row('USB SEND', usbSendValues, m.usb_send, (v) => v === 0),
      row('DATA MOD', dataModValues, m.data_mod, (v) => v === 1 || v === 2),
      row('Time-Out Timer', totValues, m.time_out_timer, (v) => v !== 0),
    ];
  });

  /** What to change on the radio, with its menu path; `bad` where Tx cannot work until it changes. */
  const advice = $derived.by(() => {
    const m = rig.menu;
    const out: { text: string; bad: boolean }[] = [];
    if (usbSendOn()) out.push({ text: 'USB SEND keys the radio on a line of the port, so Tx stays off. Set SET › Connectors › USB SEND/Keying › USB SEND to OFF.', bad: true });
    if (m.data_mod === 0 || m.data_mod === 3) out.push({ text: 'Transmit audio from this computer does not reach the transmitter. Set SET › Connectors › MOD Input › DATA MOD to USB.', bad: true });
    if (m.time_out_timer === 0) out.push({ text: 'With the Time-Out Timer off, the radio puts no limit on a transmission. Set SET › Function › Time-Out Timer to 5 min.', bad: false });
    return out;
  });

  const shiftText = $derived(!settings.cat.keyPtt ? 'Needs Key the radio with CAT' : settings.cat.shiftDial ? 'Signal stays on your Tx frequency' : 'Off: the dial stays put');

  const testing = $derived(rig.test?.state === 'running');
  const testResult = $derived(rig.test?.state === 'done' ? rig.test : null);
</script>

<section class="screen sub" aria-labelledby="rig-title">
  <BackLink to={href('settings')} label="Settings" title="Rig control" id="rig-title" />

  <div class="section">
    <h2 class="section-head" id="rig-radio">Radio</h2>
    <div class="group" role="radiogroup" aria-labelledby="rig-radio">
      <button class="row pick" role="radio" aria-checked={settings.cat.radio === 'ic705'} onclick={() => void updateSettings({ cat: { ...settings.cat, radio: 'ic705' } })}>
        <span class="row-main"><span class="row-title">Icom IC-705</span><span class="row-sub">USB cable</span></span>
        {#if settings.cat.radio === 'ic705'}<Icon name="check" size={17} class="chk" />{/if}
      </button>
    </div>
  </div>

  <div class="section">
    <h2 class="section-head">Connection</h2>
    <div class="group">
      <div class="row">
        <span class="row-main"><span class="row-title">Status</span></span>
        <span class="tag {badge.tone}" role="status" data-testid="rig-status">{badge.text}</span>
      </div>
      {#if connected}
        <div class="row">
          <span class="row-main"><span class="row-title">Dial</span></span>
          <span class="row-value dial" data-testid="rig-dial">{dialText}</span>
        </div>
      {/if}
      {#if linked}
        <button class="row act" onclick={() => void disconnectRadio()}><span class="row-title">Disconnect radio</span></button>
      {:else}
        <button class="row act" disabled={rig.status === 'choosing'} onclick={() => void connectRadio()}><span class="row-title">Connect radio</span></button>
      {/if}
    </div>
    {#if connectionText}<p class="section-foot" class:err={connectionText.bad} role={connectionText.bad ? 'alert' : undefined} data-testid="rig-help">{connectionText.text}</p>{/if}
  </div>

  <div class="section">
    <h2 class="section-head">Transmit</h2>
    <div class="group">
      <label class="row">
        <span class="row-main">
          <span class="row-title">Key the radio with CAT</span>
          <span class="row-sub">{settings.cat.keyPtt ? 'PTT over CI-V' : 'Off: VOX keys the radio'}</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={settings.cat.keyPtt} onchange={(e) => void updateSettings({ cat: { ...settings.cat, keyPtt: e.currentTarget.checked } })} />
      </label>
      <button class="row act" disabled={!connected || testing} onclick={() => void testKeying()}>
        <span class="row-main">
          <span class="row-title">{testing ? 'Testing keying' : 'Test keying'}</span>
          {#if testResult}<span class="row-sub" class:ok={testResult.ok} class:err={!testResult.ok} role="status" data-testid="rig-test">{testResult.text}</span>{/if}
        </span>
      </button>
    </div>
    <p class="section-foot">Test keying transmits 1 s with no audio. Use low power into a dummy load.</p>
  </div>

  <div class="section">
    <div class="group">
      <label class="row" class:off={!settings.cat.keyPtt}>
        <span class="row-main">
          <span class="row-title">Keep Tx audio centred</span>
          <span class="row-sub" data-testid="rig-shift">{shiftText}</span>
        </span>
        <input type="checkbox" role="switch" class="switch" checked={settings.cat.shiftDial} disabled={!settings.cat.keyPtt} onchange={(e) => void updateSettings({ cat: { ...settings.cat, shiftDial: e.currentTarget.checked } })} />
      </label>
    </div>
    <p class="section-foot">The radio’s dial moves during each FT8 and FT4 Tx, then goes back.</p>
  </div>

  {#if connected}
    <div class="section">
      <h2 class="section-head">Radio settings</h2>
      <ul class="group">
        {#each menu as m (m.title)}
          <li class="row">
            <span class="row-main"><span class="row-title">{m.title}</span></span>
            <span class="row-value">{m.value}</span>
            {#if m.ok !== null}
              <span class="mark" class:okm={m.ok} class:warn={!m.ok}><Icon name={m.ok ? 'check' : 'alert'} size={20} /><span class="visually-hidden">{m.ok ? 'Suits RR73' : 'Change it'}</span></span>
            {/if}
          </li>
        {/each}
      </ul>
      {#each advice as a (a.text)}<p class="section-foot" class:err={a.bad} data-testid="rig-advice">{a.text}</p>{/each}
    </div>
  {/if}
</section>

<style>
  .sub {
    padding-top: var(--rr-safe-top);
  }

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

  .off .row-title {
    opacity: 0.4;
  }

  .err {
    color: var(--rr-tx-text);
  }

  .ok {
    color: var(--rr-ok);
  }

  .dial {
    font-variant-numeric: tabular-nums;
  }

  /* Status badges share one shape across the app: a filled tint capsule, 21 pt high. */
  .tag {
    display: inline-flex;
    flex: none;
    align-items: center;
    height: 21px;
    padding: 0 var(--rr-space-2);
    border-radius: var(--rr-radius-pill);
    font-size: var(--rr-text-caption);
    font-weight: var(--rr-weight-bold);
    line-height: 21px;
    white-space: nowrap;
  }

  .tag.ok {
    background: var(--rr-ok-soft);
    color: var(--rr-ok);
  }

  .tag.wait {
    background: var(--rr-warn-soft);
    color: var(--rr-warn);
  }

  .tag.idle {
    background: var(--rr-fill2);
    color: var(--rr-label2);
  }

  .tag.bad {
    background: var(--rr-tx-soft);
    color: var(--rr-tx-text);
  }

  .mark {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
  }

  .mark.okm {
    color: var(--rr-ok);
  }

  .mark.warn {
    color: var(--rr-warn);
  }
</style>
