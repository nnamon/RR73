<script lang="ts">
  /**
   * Settings › Rig control (docs/design/cat.md): the radio, Connect radio and its state, keying by
   * CAT, Keep Tx audio centred (the IC-705 only) and Test keying, and the radio's settings with
   * what to change. The KX2 adds its baud rate. Shown only where the browser has Web Serial (desktop
   * Chrome and Edge). Keying by CAT is off until the operator turns it on; until then the radio
   * keys by VOX and RR73 only reads and sets its dial and mode. Keep Tx audio centred needs keying
   * by CAT and is off by default.
   */
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { mhz } from '../lib/clock/format';
  import { KX2_BAUDS, type Kx2Baud } from '../lib/cat/serial';
  import { KX2_PRODUCT } from '../lib/cat/radios';
  import { chooseRadio, connectRadio, disconnectRadio, setKx2Baud, testKeying, unkeyFailedText } from '../lib/state/cat.svelte';
  import { rig, rigConnected, rigModeText, usbSendOn } from '../lib/state/radio.svelte';
  import { settings, updateSettings } from '../lib/state/settings.svelte';

  const connected = $derived(rigConnected());
  /** A link is open or opening: the button disconnects. */
  const linked = $derived(connected || rig.status === 'connecting');
  const kx2 = $derived(settings.cat.radio === 'kx2');

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

  /** The port to choose in the browser's chooser: the IC-705's CI-V port, or the Digirig's serial port. */
  const port = $derived(kx2 ? 'the Digirig’s CP210x serial port' : 'IC-705 Serial Port A (CI-V)');

  /** What is wrong with the connection and what to do, or how to start. */
  const connectionText = $derived.by((): { text: string; bad: boolean } | null => {
    if (rig.unkeyFailed) return { text: unkeyFailedText(), bad: true };
    switch (rig.status) {
      case 'off':
        return { text: kx2 ? `Plug in the Digirig by USB, tap Connect radio, then choose ${port}.` : `Plug in the IC-705 by USB, tap Connect radio, then choose ${port}.`, bad: false };
      case 'choosing':
        return { text: `Choose ${port}.`, bad: false };
      case 'silent':
        if (kx2)
          return rig.noiseOnly
            ? { text: 'Data arrives, but no answer from the KX2. Set Baud rate to the KX2’s MENU › RS232, and check that the Digirig is set for RS-232.', bad: true }
            : { text: 'No reply from the KX2. Check that it is on, that the Digirig’s serial cable is in its ACC jack, and that Baud rate matches MENU › RS232.', bad: true };
        return rig.noiseOnly
          ? { text: `This port sends data that is not CI-V. Tap Connect radio and choose ${port}.`, bad: true }
          : { text: `No reply from the IC-705. Check that it is on, that you chose ${port}, and that SET › Connectors › CI-V › CI-V Address is A4.`, bad: true };
      case 'lost':
        return kx2
          ? { text: 'The Digirig’s port closed, and Tx went off. Check its USB cable, then tap Connect radio.', bad: true }
          : { text: 'The IC-705’s port closed, and Tx went off. Check the cable and the radio, then tap Connect radio.', bad: true };
      case 'failed':
        switch (rig.error) {
          case 'busy':
            return { text: 'Another program has the port open. Close it, then tap Connect radio.', bad: true };
          case 'signals':
            return kx2
              ? { text: 'The port’s DTR and RTS lines could not be set low, so the port was closed. RTS keys the Digirig’s PTT. Set MENU › MIC BTN on the KX2 to OFF, then tap Connect radio.', bad: true }
              : { text: 'The port’s DTR and RTS lines could not be set low, so the port was closed. Set SET › Connectors › USB SEND/Keying › USB SEND to OFF, then tap Connect radio.', bad: true };
          case 'no-wasm':
            return { text: 'Rig control did not load. Reload the app.', bad: true };
          case 'gone':
            return kx2
              ? { text: 'The Digirig is not plugged in, or the browser no longer allows its port. Plug it in, then tap Connect radio.', bad: true }
              : { text: 'The IC-705 is not plugged in, or the browser no longer allows its port. Plug it in, then tap Connect radio.', bad: true };
          case 'choose':
            return { text: `The browser allows more than one port of this kind. Tap Connect radio and choose ${port}.`, bad: true };
          default:
            return { text: 'The port did not open. Unplug the USB cable, plug it in again, then tap Connect radio.', bad: true };
        }
      case 'connected':
        return usbSendOn() ? { text: 'Tx stays off until USB SEND is OFF. Radio settings, below, gives the menu path.', bad: true } : null;
      default:
        return rig.error === 'refused' ? { text: 'The browser did not allow the port. Tap Connect radio again.', bad: true } : null;
    }
  });

  const dialText = $derived(rig.hz === null ? 'Reading' : `${mhz(rig.hz)} ${rigModeText()}`);

  const usbSendValues = ['OFF', 'USB (A) DTR', 'USB (A) RTS', 'USB (B) DTR', 'USB (B) RTS'];
  const dataModValues = ['MIC', 'USB', 'MIC,USB', 'WLAN'];
  const totValues = ['OFF', '3 min', '5 min', '10 min', '20 min', '30 min'];

  type Row = { title: string; value: string; ok: boolean | null };

  /** MIC BTN as MP gives it: bit 0 PTT, bit 2 the UP and DN buttons (Programmer's Reference p. 20). */
  const micBtnText = (v: number) => (v & 1 ? (v & 4 ? 'PTT UP.DN' : 'PTT') : v & 4 ? 'UP.DN' : 'OFF');

  /** The settings read on connecting, each with whether it suits RR73. */
  const menu = $derived.by((): Row[] => {
    const m = rig.menu;
    const row = (title: string, values: string[], v: number | undefined, ok: (v: number) => boolean): Row => ({ title, value: v === undefined ? 'Reading' : (values[v] ?? String(v)), ok: v === undefined ? null : ok(v) });
    if (kx2) {
      const product = m.product;
      const isKx2 = product === KX2_PRODUCT;
      const dataMode = rig.mode === 'data' || rig.mode === 'data-rev';
      return [
        { title: 'Model', value: product === undefined ? 'Reading' : isKx2 ? 'KX2' : product === 2 ? 'KX3' : 'Not a KX2', ok: product === undefined ? null : isKx2 },
        {
          title: 'MIC BTN',
          value: m.mic_btn !== undefined ? micBtnText(m.mic_btn) : product !== undefined && !isKx2 ? 'Not read' : 'Reading',
          ok: m.mic_btn === undefined ? null : (m.mic_btn & 1) === 0,
        },
        // VX reads VOX in the present mode (p. 28): judged only in DATA.
        { title: 'VOX', value: m.vox === undefined ? 'Reading' : m.vox ? 'On' : 'Off', ok: m.vox === undefined || !dataMode ? null : settings.cat.keyPtt || m.vox === 1 },
      ];
    }
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
    if (kx2) {
      if (m.product !== undefined && m.product !== KX2_PRODUCT) out.push({ text: 'The radio does not report itself as a KX2, so RR73 does not read its menu. Check MIC BTN at the radio.', bad: false });
      if (m.mic_btn !== undefined && m.mic_btn & 1)
        out.push({ text: 'MIC BTN reads the mic jack’s ring as PTT, and the Digirig’s KX cable puts its PTT line there: the radio may transmit while the browser opens the port. Set MENU › MIC BTN to OFF.', bad: false });
      if (m.vox === 0 && !settings.cat.keyPtt && (rig.mode === 'data' || rig.mode === 'data-rev'))
        out.push({ text: 'With VOX off, nothing keys the radio for a transmission. Turn on Key the radio with CAT, or set MENU › VOX MD to ON in DATA A.', bad: true });
      return out;
    }
    if (usbSendOn()) out.push({ text: 'USB SEND keys the radio on a line of the port, so Tx stays off. Set SET › Connectors › USB SEND/Keying › USB SEND to OFF.', bad: true });
    if (m.data_mod === 0 || m.data_mod === 3) out.push({ text: 'Transmit audio from this computer does not reach the transmitter. Set SET › Connectors › MOD Input › DATA MOD to USB.', bad: true });
    if (m.time_out_timer === 0) out.push({ text: 'With the Time-Out Timer off, the radio puts no limit on a transmission. Set SET › Function › Time-Out Timer to 5 min.', bad: false });
    return out;
  });

  const shiftText = $derived(!settings.cat.keyPtt ? 'Needs Key the radio with CAT' : settings.cat.shiftDial ? 'Signal stays on your Tx frequency' : 'Off: the dial stays put');

  const testing = $derived(rig.test?.state === 'running');
  const testResult = $derived(rig.test?.state === 'done' ? rig.test : null);

  const radios = [
    { id: 'ic705', title: 'Icom IC-705', sub: 'USB cable' },
    { id: 'kx2', title: 'Elecraft KX2', sub: 'Digirig' },
  ] as const;
</script>

<section class="screen sub" aria-labelledby="rig-title">
  <BackLink to={href('settings')} label="Settings" title="Rig control" id="rig-title" />

  <div class="section">
    <h2 class="section-head" id="rig-radio">Radio</h2>
    <div class="group" role="radiogroup" aria-labelledby="rig-radio">
      {#each radios as r (r.id)}
        <button class="row pick" role="radio" aria-checked={settings.cat.radio === r.id} onclick={() => void chooseRadio(r.id)}>
          <span class="row-main"><span class="row-title">{r.title}</span><span class="row-sub">{r.sub}</span></span>
          {#if settings.cat.radio === r.id}<Icon name="check" size={17} class="chk" />{/if}
        </button>
      {/each}
      {#if kx2}
        <label class="row">
          <span class="row-title">Baud rate</span>
          <select class="select" value={settings.cat.kx2Baud} onchange={(e) => void setKx2Baud(Number(e.currentTarget.value) as Kx2Baud)}>
            {#each KX2_BAUDS as b (b)}
              <option value={b}>{b}</option>
            {/each}
          </select>
          <Icon name="updown" size={13} class="row-chevron" />
        </label>
      {/if}
    </div>
    {#if kx2}<p class="section-foot">Baud rate must match the KX2’s MENU › RS232, which is 4800 by default.</p>{/if}
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
          <span class="row-sub">{settings.cat.keyPtt ? (kx2 ? 'PTT by TX and RX commands' : 'PTT over CI-V') : 'Off: VOX keys the radio'}</span>
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

  {#if !kx2}
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
    </div>
  {/if}

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

  .select {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    border: 0;
    background: transparent;
    color: var(--rr-label2);
    font-size: var(--rr-text-body);
    font-variant-numeric: tabular-nums;
    text-align: right;
    text-align-last: right;
    appearance: none;
  }

  .row :global(.row-chevron) {
    margin-left: var(--rr-space-1);
    color: var(--rr-chev);
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
