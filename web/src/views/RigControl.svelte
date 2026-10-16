<script lang="ts">
  /**
   * Settings › Rig control (docs/design/cat.md): the radio, Connect radio and its state, keying by
   * CAT, Keep Tx audio centred (the IC-705 only) and Test keying, and the radio's settings with
   * what to change. The KX2 adds its baud rate. Shown only where the browser has Web Serial (desktop
   * Chrome and Edge). Keying by CAT is off until the operator turns it on; until then the radio
   * keys by VOX and RR73 only reads and sets its dial and mode. Keep Tx audio centred needs keying
   * by CAT and is off by default.
   */
  import { onMount } from 'svelte';
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { mhz } from '../lib/clock/format';
  import { KX2_BAUDS, type Kx2Baud } from '../lib/cat/serial';
  import { KX2_PRODUCT, KX3_PRODUCT } from '../lib/cat/radios';
  import { chooseRadio, connectRadio, disconnectRadio, rereadMicBtn, setKx2Baud, testKeying, unkeyFailedText } from '../lib/state/cat.svelte';
  import { radioName, rig, rigConnected, rigInDataMode, rigModeText, usbSendOn } from '../lib/state/radio.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { settings, updateSettings } from '../lib/state/settings.svelte';

  const connected = $derived(rigConnected());
  /** A link is open or opening: the button disconnects. */
  const linked = $derived(connected || rig.status === 'connecting');
  const kx2 = $derived(settings.cat.radio === 'kx2');

  // Once on opening: the operator may have changed MIC BTN at the radio since the last read.
  onMount(() => rereadMicBtn());

  /** The radio transmits and RR73 holds no PTT: VOX, its own PTT or another program keys it. */
  const transmittingAlone = $derived(rigConnected() && rig.transmitting === true && !rig.keyed);

  const badge = $derived.by((): { text: string; tone: 'ok' | 'wait' | 'idle' | 'bad' } => {
    if (rig.unkeyFailed) return { text: 'PTT off not confirmed', tone: 'bad' };
    switch (rig.status) {
      case 'connected':
        return rig.keyed || transmittingAlone ? { text: 'Transmitting', tone: 'wait' } : { text: 'Connected', tone: 'ok' };
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
        if (usbSendOn()) return { text: 'Tx stays off until USB SEND is OFF. Radio settings, below, gives the menu path.', bad: true };
        return transmittingAlone ? { text: `The ${radioName()} reports transmitting, and RR73 holds no PTT: VOX, its own PTT or another program keys it.`, bad: false } : null;
      default:
        return rig.error === 'refused' ? { text: 'The browser did not allow the port. Tap Connect radio again.', bad: true } : null;
    }
  });

  const dialText = $derived(rig.hz === null ? 'Reading' : `${mhz(rig.hz)} ${rigModeText()}`);

  const usbSendValues = ['OFF', 'USB (A) DTR', 'USB (A) RTS', 'USB (B) DTR', 'USB (B) RTS'];
  const dataModValues = ['MIC', 'USB', 'MIC,USB', 'WLAN'];
  const totValues = ['OFF', '3 min', '5 min', '10 min', '20 min', '30 min'];

  /** `bad`: a setting that can make the radio transmit unasked, shown as an error. */
  type Row = { title: string; value: string; ok: boolean | null; bad?: boolean };

  /**
   * Before the KX2's port opens: MIC BTN with PTT lets the Digirig key the radio while the browser
   * opens the port (Owner's Manual pp. 8, 48). An error once a read found PTT there.
   */
  const micBtnFirst = $derived.by((): { text: string; bad: boolean } | null => {
    if (!kx2 || connected || settings.cat.kx2MicBtn === 0) return null;
    return {
      text: 'Set MENU › MIC BTN to OFF on the KX2 before you connect: with PTT there, the Digirig keys the KX2 while the browser opens the port. Until RR73 reads MIC BTN OFF, it opens the port only when you tap Connect radio.',
      bad: settings.cat.kx2MicBtn !== null && (settings.cat.kx2MicBtn & 1) === 1,
    };
  });

  /** The KX2 outside DATA A: TX transmits in the mode it is in. */
  const notDataA = $derived(kx2 && connected && rigInDataMode() === false ? `The KX2 is in ${rigModeText()}. A transmission keyed by TX goes out in that mode: choose a band to set DATA A.` : null);

  /**
   * The residual risk of CAT keying on the KX2: no transmit time-out in Elecraft's documents, and an
   * interface Digirig says RF can stop from returning to receive (Troubleshooting Digital Modes).
   */
  const KX2_RISK =
    'The KX2 has no transmit time-out. Digirig reports that RF can stop its interface returning to receive. Keyed by CAT, a stuck interface leaves the KX2 transmitting until you unkey it. Keyed by VOX, it stops when the audio stops.';

  /** RR73's FT8 and FT4 audio runs from 200 to 2800 Hz; Elecraft's SSB filters are 2.7 or 2.8 kHz wide (docs/design/cat.md). */
  const FILTER_MIN_HZ = 2700;
  const khz = (hz: number) => `${(hz / 1000).toFixed(2)} kHz`;

  /** MIC BTN as MP gives it: bit 0 PTT, bit 2 the UP and DN buttons (Programmer's Reference p. 20). */
  const micBtnText = (v: number) => (v & 1 ? (v & 4 ? 'PTT UP.DN' : 'PTT') : v & 4 ? 'UP.DN' : 'OFF');

  /** The settings read on connecting, each with whether it suits RR73. */
  const menu = $derived.by((): Row[] => {
    const m = rig.menu;
    const row = (title: string, values: string[], v: number | undefined, ok: (v: number) => boolean): Row => ({ title, value: v === undefined ? 'Reading' : (values[v] ?? String(v)), ok: v === undefined ? null : ok(v) });
    if (kx2) {
      const product = m.product;
      const isKx2 = product === KX2_PRODUCT;
      const readable = isKx2 || product === KX3_PRODUCT;
      const dataMode = rig.mode === 'data' || rig.mode === 'data-rev';
      const mic = m.mic_btn;
      return [
        { title: 'Model', value: product === undefined ? 'Reading' : isKx2 ? 'KX2' : product === KX3_PRODUCT ? 'KX3' : 'Not a KX2', ok: product === undefined ? null : isKx2 },
        // Only OFF suits: PTT keys the radio on the Digirig's line, UP and DN move VFO A (Owner's Manual pp. 48, 56).
        {
          title: 'MIC BTN',
          value: mic !== undefined && mic >= 0 ? micBtnText(mic) : mic === -1 || (product !== undefined && !readable) ? 'Not read' : 'Reading',
          ok: mic === undefined || mic < 0 ? null : mic === 0,
          bad: mic !== undefined && mic >= 0 && (mic & 1) === 1,
        },
        // VX reads VOX in the present mode (p. 28): judged only in DATA.
        { title: 'VOX', value: m.vox === undefined ? 'Reading' : m.vox ? 'On' : 'Off', ok: m.vox === undefined || !dataMode ? null : settings.cat.keyPtt || m.vox === 1 },
        { title: 'Filter', value: m.bandwidth === undefined ? 'Reading' : khz(m.bandwidth), ok: m.bandwidth === undefined ? null : m.bandwidth >= FILTER_MIN_HZ },
        { title: 'Split', value: m.split === undefined ? 'Reading' : m.split ? 'On' : 'Off', ok: m.split === undefined ? null : m.split === 0 },
        { title: 'XIT', value: m.xit === undefined ? 'Reading' : m.xit ? `On, ${m.xit_hz !== undefined && m.xit_hz > 0 ? '+' : ''}${m.xit_hz ?? 0} Hz` : 'Off', ok: m.xit === undefined ? null : m.xit === 0 },
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
      const mic = m.mic_btn;
      if (m.product !== undefined && m.product !== KX2_PRODUCT && m.product !== KX3_PRODUCT)
        out.push({ text: 'The radio does not report itself as a KX2 or KX3, so RR73 does not read MIC BTN. Check MENU › MIC BTN at the radio: OFF.', bad: false });
      if (mic === undefined && m.menu_entry === 82) out.push({ text: 'The KX2 shows its MIC BTN menu entry, as a read cut off by a lost port leaves it. Tap DISP on the KX2 to leave the menu, and RR73 reads MIC BTN.', bad: false });
      if (mic === -1) out.push({ text: 'MIC BTN could not be read. Check MENU › MIC BTN at the radio: OFF.', bad: false });
      if (mic !== undefined && mic >= 0 && mic & 1)
        out.push({ text: 'MIC BTN reads the mic jack’s ring as PTT, and the Digirig’s KX cable puts its PTT line there: the KX2 transmits while the browser opens the port. Set MENU › MIC BTN to OFF.', bad: true });
      else if (mic === 4) out.push({ text: 'MIC BTN reads the mic jack’s ring for UP and DN, where the Digirig’s KX cable puts its PTT line: VFO A may move by itself. Set MENU › MIC BTN to OFF.', bad: false });
      if (m.k2 === 1 || m.k2 === 3)
        out.push({ text: `The KX2 is in K2 command mode ${m.k2}, left by another program: it reports DATA as LSB or USB, so every band change reads as refused. Close that program, turn the KX2 off and on, then connect again.`, bad: true });
      if (m.vox === 0 && !settings.cat.keyPtt && (rig.mode === 'data' || rig.mode === 'data-rev'))
        out.push({ text: 'With VOX off, nothing keys the radio for a transmission. Turn on Key the radio with CAT, or set MENU › VOX MD to ON in DATA A.', bad: true });
      if (!settings.cat.keyPtt)
        out.push({ text: 'ERR PTT at power-on turns VOX off in every mode until MENU › VOX MD is set again. The Digirig’s PTT line, held while RTS is asserted, causes it.', bad: false });
      if (m.bandwidth !== undefined && m.bandwidth < FILTER_MIN_HZ)
        out.push({ text: `The receive filter is ${khz(m.bandwidth)} wide, and FT8 and FT4 use 200 to 2800 Hz. Tap FIL on the KX2 and turn AF/MON to widen it to ${khz(FILTER_MIN_HZ)} or more.`, bad: false });
      if (m.split === 1) out.push({ text: 'Split is on: the KX2 transmits on VFO B, away from the frequency RR73 logs. Turn split off on the KX2.', bad: true });
      if (m.xit === 1) out.push({ text: `XIT is on: the KX2 transmits ${Math.abs(m.xit_hz ?? 0)} Hz from VFO A, away from the frequency RR73 logs. Set MENU › XIT to OFF.`, bad: true });
      out.push({ text: 'MENU › AUTO OFF, when set, turns the KX2 off after that many minutes without use of its controls. Keep it at INFINITE while RR73 runs the radio.', bad: false });
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
    {#if micBtnFirst}<p class="section-foot" class:err={micBtnFirst.bad} role={micBtnFirst.bad ? 'alert' : undefined} data-testid="rig-micbtn">{micBtnFirst.text}</p>{/if}
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
      <!-- The practice band never keys the radio by CAT, Test keying included. -->
      <button class="row act" disabled={!connected || testing || practice.on} onclick={() => void testKeying()}>
        <span class="row-main">
          <span class="row-title">{testing ? 'Testing keying' : 'Test keying'}</span>
          {#if practice.on}<span class="row-sub" data-testid="rig-test-practice">Off with the practice band on</span>
          {:else if testResult}<span class="row-sub" class:ok={testResult.ok} class:err={!testResult.ok} role="status" data-testid="rig-test">{testResult.text}</span>{/if}
        </span>
      </button>
    </div>
    {#if notDataA}<p class="section-foot err" role="alert" data-testid="rig-mode">{notDataA}</p>{/if}
    <p class="section-foot">Test keying transmits 1 s with no audio. Use low power into a dummy load.</p>
    <p class="section-foot" data-testid="rig-practice">The practice band never keys the radio by CAT.</p>
    {#if kx2}<p class="section-foot" data-testid="rig-risk">{KX2_RISK}</p>{/if}
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
              <span class="mark" class:okm={m.ok} class:warn={!m.ok && !m.bad} class:badm={m.bad}><Icon name={m.ok ? 'check' : 'alert'} size={20} /><span class="visually-hidden">{m.ok ? 'Suits RR73' : 'Change it'}</span></span>
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

  .mark.badm {
    color: var(--rr-tx-text);
  }
</style>
