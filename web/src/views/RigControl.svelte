<script lang="ts">
  /**
   * Settings › Rig control (docs/design/cat.md): the radio, Connect radio and its state, keying by
   * CAT, Keep Tx audio centred (the IC-705 only) and Test keying, and the radio's settings with
   * what to change, and the baud rate. Shown only where the browser has Web Serial (desktop
   * Chrome and Edge). Keying by CAT is off until the operator turns it on; until then the radio
   * keys by VOX and RR73 only reads and sets its dial and mode. Keep Tx audio centred needs keying
   * by CAT and is off by default.
   */
  import { onMount } from 'svelte';
  import BackLink from '../ui/BackLink.svelte';
  import Icon from '../ui/Icon.svelte';
  import { href } from '../lib/app/router.svelte';
  import { mhz } from '../lib/clock/format';
  import { IC705_BAUDS, KX2_BAUDS, type Ic705Baud, type Kx2Baud } from '../lib/cat/serial';
  import { KX2_PRODUCT, KX3_PRODUCT } from '../lib/cat/radios';
  import { connectLogText, lastAttempt } from '../lib/cat/connect-log';
  import { chooseRadio, connectRadio, disconnectRadio, reconnectRadio, rereadMicBtn, setIc705Baud, setKx2Baud, setRigEnabled, testKeying, unkeyFailedText } from '../lib/state/cat.svelte';
  import { catKeys, radioName, radioTraits, rig, rigBand, rigConnected, rigInDataMode, rigModeText, txOutput, usbSendOn } from '../lib/state/radio.svelte';
  import { settings, updateSettings } from '../lib/state/settings.svelte';
  import { audio } from '../lib/state/station.svelte';

  const connected = $derived(rigConnected());
  /** A link is open or opening: the button disconnects. */
  const linked = $derived(connected || rig.status === 'connecting');
  /**
   * The radio the operator connected is not open now: the port closed, or did not open. Reconnect
   * radio opens the port the browser allows without the chooser, as when no `connect` event came.
   */
  const reconnectable = $derived(settings.cat.connect && !linked && rig.status !== 'choosing' && rig.error !== 'no-wasm');
  const kx2 = $derived(settings.cat.radio === 'kx2');

  // Once on opening: the operator may have changed MIC BTN at the radio since the last read.
  onMount(() => rereadMicBtn());

  /**
   * The radio transmits and RR73 holds no PTT: VOX, its own PTT or another program keys it. RR73's
   * own keying counts until a read confirms receive.
   */
  const transmittingAlone = $derived(rigConnected() && rig.transmitting === true && !rig.keyed && !rig.mayBeKeyed);

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
  const digirig = $derived(kx2 && settings.cat.kx2Link === 'digirig');
  const port = $derived(kx2 ? (digirig ? 'the Digirig’s CP210x serial port' : 'the KX2 cable’s serial port') : 'IC-705 Serial Port A (CI-V)');

  /** What is wrong with the connection and what to do, or how to start. */
  const connectionText = $derived.by((): { text: string; bad: boolean } | null => {
    if (rig.unkeyFailed) return { text: unkeyFailedText(), bad: true };
    switch (rig.status) {
      case 'off':
        return { text: kx2 ? `Plug in the ${digirig ? 'Digirig' : 'KX2 cable'} by USB, tap Connect radio, then choose ${port}.` : `Plug in the IC-705 by USB, tap Connect radio, then choose ${port}.`, bad: false };
      case 'choosing':
        return { text: `Choose ${port}.`, bad: false };
      case 'silent':
        if (kx2)
          return rig.noiseOnly
            ? { text: digirig ? 'Data arrives, but no answer from the KX2. Set Baud rate to the KX2’s MENU › RS232, and check that the Digirig is set for RS-232.' : 'Data arrives, but no answer from the KX2. Set Baud rate to the KX2’s MENU › RS232.', bad: true }
            : { text: 'No reply from the KX2. Check that it is on, that the serial cable is in its ACC jack, and that Baud rate matches MENU › RS232.', bad: true };
        return rig.noiseOnly
          ? { text: `This port sends data that is not CI-V. Tap Connect radio and choose ${port}.`, bad: true }
          : { text: `No reply from the IC-705. Check that it is on, that you chose ${port}, and that SET › Connectors › CI-V › CI-V Address is A4.`, bad: true };
      case 'lost':
        return kx2
          ? { text: 'The KX2’s port closed, and Tx went off. Check the USB cable, then tap Reconnect radio.', bad: true }
          : { text: 'The IC-705’s port closed, and Tx went off. Check the cable and the radio, then tap Reconnect radio.', bad: true };
      case 'failed':
        switch (rig.error) {
          case 'busy':
            return { text: 'Another program has the port open. Close it, then tap Reconnect radio.', bad: true };
          case 'signals':
            return kx2
              ? { text: 'The port’s DTR and RTS lines could not be set low, so the port was closed. RTS keys the Digirig’s PTT. Set MENU › MIC BTN on the KX2 to OFF, then tap Reconnect radio.', bad: true }
              : { text: 'The port’s DTR and RTS lines could not be set low, and USB SEND did not read OFF, so the port was closed. Set SET › Connectors › USB SEND/Keying › USB SEND to OFF, then tap Reconnect radio.', bad: true };
          case 'no-wasm':
            return { text: 'Rig control did not load. Reload the app.', bad: true };
          case 'gone':
            return kx2
              ? { text: 'The KX2’s cable is not plugged in, or the browser no longer allows its port. Plug it in, then tap Connect radio.', bad: true }
              : { text: 'The IC-705 is not plugged in, or the browser no longer allows its port. Plug it in, then tap Connect radio.', bad: true };
          case 'choose':
            return { text: `The browser allows more than one port of this kind. Tap Connect radio and choose ${port}.`, bad: true };
          default:
            return { text: 'The port did not open. Unplug the USB cable, plug it in again, then tap Reconnect radio.', bad: true };
        }
      case 'connected':
        if (usbSendOn()) return { text: 'Tx stays off until USB SEND is OFF. Radio settings, below, gives the menu path.', bad: true };
        return transmittingAlone ? { text: `The ${radioName()} reports transmitting, and RR73 holds no PTT: VOX, its own PTT or another program keys it.`, bad: false } : null;
      default:
        return rig.error === 'refused' ? { text: 'The browser did not allow the port. Tap Connect radio again.', bad: true } : null;
    }
  });

  /** Copy connection log: the last attempt's steps, for a report when the browser closed while connecting. */
  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let logText = $state('');
  async function copyLog() {
    const text = connectLogText(lastAttempt(), __APP_VERSION__, navigator.userAgent);
    try {
      await navigator.clipboard.writeText(text);
      copyState = 'copied';
      logText = '';
    } catch {
      copyState = 'failed';
      logText = text;
    }
  }

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
    if (!digirig || connected || settings.cat.kx2MicBtn === 0) return null;
    return {
      text: 'Set MENU › MIC BTN to OFF on the KX2 before you connect: with PTT there, the Digirig keys the KX2 while the browser opens the port. Until RR73 reads MIC BTN OFF, it opens the port only when you tap Connect radio.',
      bad: settings.cat.kx2MicBtn !== null && (settings.cat.kx2MicBtn & 1) === 1,
    };
  });

  /**
   * The radio outside the data mode RR73 sets, USB-D or DATA A: a transmission goes out in the mode
   * it is in, and Operate's radio badge is amber.
   */
  const notDataMode = $derived.by(() => {
    if (!connected || rigInDataMode() !== false) return null;
    return kx2
      ? `The KX2 is in ${rigModeText()}. A transmission keyed by TX goes out in that mode: choose a band to set DATA A.`
      : `The IC-705 is in ${rigModeText()}. A transmission goes out in that mode: choose a band to set USB-D.`;
  });

  /** The radio's dial on another band than RR73's, or outside them all: transmissions are refused, and the badge is amber. */
  const offBand = $derived.by(() => {
    if (!connected || rig.hz === null) return null;
    const b = rigBand();
    if (b === settings.band) return null;
    return `The ${radioName()} is on ${mhz(rig.hz)}, ${b === null ? 'outside every band' : `outside ${settings.band}`}, so transmissions are refused. Choose a band to set it.`;
  });

  /**
   * The residual risk of CAT keying on the KX2: no transmit time-out in Elecraft's documents, and an
   * interface Digirig says RF can stop from returning to receive (Troubleshooting Digital Modes).
   */
  const KX2_RISK =
    'The KX2 has no transmit time-out. Digirig reports that RF can stop its interface returning to receive. Keyed by CAT, a stuck interface leaves the KX2 transmitting until you unkey it. Keyed by VOX, it stops when the audio stops.';

  const KX2_RISK_CABLE = 'The KX2 has no transmit time-out. Keyed by CAT, it transmits until RR73 or you unkey it. Keyed by VOX, it stops when the audio stops.';

  /** RR73's FT8 and FT4 audio runs from 200 to 2800 Hz; Elecraft's SSB filters are 2.7 or 2.8 kHz wide (docs/design/cat.md). */
  const FILTER_MIN_HZ = 2700;
  const khz = (hz: number) => `${(hz / 1000).toFixed(2)} kHz`;

  /** An offset with its sign: "+120 Hz", "−50 Hz", "0 Hz". */
  const signedHz = (hz: number) => `${hz > 0 ? '+' : hz < 0 ? '−' : ''}${Math.abs(hz)} Hz`;
  /** RIT or XIT as read, with the offset they share. */
  const offsetValue = (on: number | undefined) => (on === undefined ? 'Reading' : on ? `On, ${signedHz(rig.menu.offset_hz ?? 0)}` : 'Off');
  /** Where an offset puts the frequency against the dial: "120 Hz above". */
  const offsetText = (hz: number) => `${Math.abs(hz)} Hz ${hz > 0 ? 'above' : 'below'}`;
  /** The IC-705's split and duplex, as the setting holds them (lib/cat/radio.ts). */
  const splitValues = ['Off', 'On', 'DUP−', 'DUP+'];

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
        { title: 'RIT', value: offsetValue(m.rit), ok: m.rit === undefined ? null : m.rit === 0 },
        { title: 'XIT', value: offsetValue(m.xit), ok: m.xit === undefined ? null : m.xit === 0 },
      ];
    }
    return [
      row('USB SEND', usbSendValues, m.usb_send, (v) => v === 0),
      row('DATA MOD', dataModValues, m.data_mod, (v) => v === 1 || v === 2),
      row('Time-Out Timer', totValues, m.time_out_timer, (v) => v !== 0),
      // Split, duplex, RIT and ΔTX (Icom's XIT) move the RF away from the frequency RR73 logs, or
      // the receive frequency away from the dial it transmits on (CI-V guide pp. 3, 15).
      row('Split', splitValues, m.split, (v) => v === 0),
      { title: 'RIT', value: offsetValue(m.rit), ok: m.rit === undefined ? null : m.rit === 0 },
      { title: 'ΔTX', value: offsetValue(m.xit), ok: m.xit === undefined ? null : m.xit === 0 },
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
      if (digirig && mic !== undefined && mic >= 0 && mic & 1)
        out.push({ text: 'MIC BTN reads the mic jack’s ring as PTT, and the Digirig’s KX cable puts its PTT line there: the KX2 transmits while the browser opens the port. Set MENU › MIC BTN to OFF.', bad: true });
      else if (digirig && mic === 4) out.push({ text: 'MIC BTN reads the mic jack’s ring for UP and DN, where the Digirig’s KX cable puts its PTT line: VFO A may move by itself. Set MENU › MIC BTN to OFF.', bad: false });
      if (m.auto_info !== undefined && m.auto_info !== null && m.auto_info > 0)
        out.push({ text: `The KX2 sends its dial and mode by itself (AI${m.auto_info}), set by another program or MENU › AUTO INF, and a change during a band change can read as refused. Turn the KX2 off and on, or set MENU › AUTO INF back to its default.`, bad: false });
      if (m.k2 === 1 || m.k2 === 3)
        out.push({ text: `The KX2 is in K2 command mode ${m.k2}, left by another program: it reports DATA as LSB or USB, so every band change reads as refused. Close that program, turn the KX2 off and on, then connect again.`, bad: true });
      if (m.vox === 0 && !settings.cat.keyPtt && (rig.mode === 'data' || rig.mode === 'data-rev'))
        out.push({ text: 'With VOX off, nothing keys the radio for a transmission. Turn on Key the radio with CAT, or set MENU › VOX MD to ON in DATA A.', bad: true });
      if (digirig && !settings.cat.keyPtt)
        out.push({ text: 'ERR PTT at power-on turns VOX off in every mode until MENU › VOX MD is set again. The Digirig’s PTT line, held while RTS is asserted, causes it.', bad: false });
      if (m.bandwidth !== undefined && m.bandwidth < FILTER_MIN_HZ)
        out.push({ text: `The receive filter is ${khz(m.bandwidth)} wide, and FT8 and FT4 use 200 to 2800 Hz. Tap FIL on the KX2 and turn AF/MON to widen it to ${khz(FILTER_MIN_HZ)} or more.`, bad: false });
      if (m.split === 1) out.push({ text: 'Split is on: the KX2 transmits on VFO B, away from the frequency RR73 logs. Turn split off on the KX2.', bad: true });
      if (m.xit === 1) out.push({ text: `XIT is on: the KX2 transmits ${Math.abs(m.offset_hz ?? 0)} Hz from VFO A, away from the frequency RR73 logs. Set MENU › XIT to OFF.`, bad: true });
      if (m.rit === 1 && m.offset_hz)
        out.push({ text: `RIT is on: the KX2 receives ${offsetText(m.offset_hz)} VFO A, so replies land ${Math.abs(m.offset_hz)} Hz from the station they answer. Tap RIT on the KX2 to turn it off.`, bad: true });
      else if (m.rit === 1) out.push({ text: 'RIT is on with a 0 Hz offset. Tap RIT on the KX2 to turn it off before the offset moves the receive frequency.', bad: false });
      out.push({ text: 'MENU › AUTO OFF, when set, turns the KX2 off after that many minutes without use of its controls. Keep it at INFINITE while RR73 runs the radio.', bad: false });
      return out;
    }
    if (usbSendOn()) out.push({ text: 'USB SEND keys the radio on a line of the port, so Tx stays off. Set SET › Connectors › USB SEND/Keying › USB SEND to OFF.', bad: true });
    if (m.data_mod === 0 || m.data_mod === 3) out.push({ text: 'Transmit audio from this computer does not reach the transmitter. Set SET › Connectors › MOD Input › DATA MOD to USB.', bad: true });
    if (m.time_out_timer === 0) out.push({ text: 'With the Time-Out Timer off, the radio puts no limit on a transmission. Set SET › Function › Time-Out Timer to 5 min.', bad: false });
    if (m.split === 1) out.push({ text: 'Split is on: the IC-705 transmits on the other VFO, away from the frequency RR73 logs. Touch SPLIT on the FUNCTION screen to turn it off.', bad: true });
    if (m.split === 2 || m.split === 3)
      out.push({ text: 'Duplex is on: the IC-705 transmits at its duplex offset from the dial, away from the frequency RR73 logs. On FUNCTION screen 2, touch DUP until it shows OFF.', bad: true });
    const off = m.offset_hz ?? 0;
    if (m.xit === 1 && off)
      out.push({ text: `ΔTX (XIT) is on: the IC-705 transmits ${offsetText(off)} the dial, away from the frequency RR73 logs. Push the RIT/ΔTX key to turn it off.`, bad: true });
    else if (m.xit === 1) out.push({ text: 'ΔTX (XIT) is on with a 0 Hz offset. Push the RIT/ΔTX key to turn it off before the offset moves the transmit frequency.', bad: false });
    if (m.rit === 1 && off)
      out.push({ text: `RIT is on: the IC-705 receives ${offsetText(off)} the dial it transmits on, so replies land ${Math.abs(off)} Hz from the station they answer. Push the RIT/ΔTX key to turn it off.`, bad: true });
    else if (m.rit === 1) out.push({ text: 'RIT is on with a 0 Hz offset. Push the RIT/ΔTX key to turn it off before the offset moves the receive frequency.', bad: false });
    return out;
  });

  /** The radio's audio device, for Settings › Radio and audio › Output. */
  const radioAudio = $derived(kx2 && !digirig ? 'the KX2’s audio interface' : radioTraits().audioDevice);

  /**
   * Keying by CAT, a transmission goes only to the output chosen in Radio and audio, so the radio
   * never transmits with its Tx audio on another device. Why each is refused, and what to do.
   */
  const outputText = $derived.by((): string | null => {
    if (!catKeys()) return null;
    switch (txOutput()) {
      case 'default':
        return `Key the radio with CAT needs the Tx audio on the radio. Choose ${radioAudio} in Settings › Radio and audio › Output. Until then each transmission is refused.`;
      case 'missing':
        return `The Tx output chosen in Settings › Radio and audio is not connected, so each transmission is refused. Connect it, or choose ${radioAudio} there.`;
      case 'refused':
        return audio.status === 'running'
          ? 'The browser refused the Tx output chosen in Settings › Radio and audio, so each transmission is refused. Choose it there again.'
          : 'The browser refused the Tx output chosen in Settings › Radio and audio, so each transmission is refused. Tap Start audio to allow it.';
      default:
        return null;
    }
  });

  const shiftText = $derived(!settings.cat.keyPtt ? 'Needs Key the radio with CAT' : settings.cat.shiftDial ? 'Signal stays on your Tx frequency' : 'Off: the dial stays put');

  const testing = $derived(rig.test?.state === 'running');
  const testResult = $derived(rig.test?.state === 'done' ? rig.test : null);

  const radios = [
    { id: 'ic705', title: 'Icom IC-705', sub: 'USB cable' },
    { id: 'kx2', title: 'Elecraft KX2', sub: 'Digirig or KX2 cable' },
  ] as const;
</script>

<section class="screen sub" aria-labelledby="rig-title">
  <BackLink to={href('settings')} label="Settings" title="Rig control" id="rig-title" />

  <div class="section">
    <div class="group">
      <label class="row">
        <span class="row-main"><span class="row-title">Rig control</span></span>
        <input type="checkbox" role="switch" class="switch" checked={settings.cat.enabled} onchange={(e) => void setRigEnabled(e.currentTarget.checked)} />
      </label>
    </div>
    <p class="section-foot">{settings.cat.enabled ? 'Reads and sets the radio’s dial and mode over USB.' : 'Off: the radio’s port stays closed, and transmissions key the radio by VOX.'}</p>
    {#if !settings.cat.enabled && rig.unkeyFailed}<p class="section-foot err" role="alert">{unkeyFailedText()}</p>{/if}
  </div>

  {#if settings.cat.enabled}

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
          <span class="row-main"><span class="row-title">Connection</span><span class="row-sub">Digirig keys the mic jack</span></span>
          <select class="select" value={settings.cat.kx2Link} onchange={(e) => void updateSettings({ cat: { ...settings.cat, kx2Link: e.currentTarget.value === 'cable' ? 'cable' : 'digirig' } })}>
            <option value="digirig">Digirig</option>
            <option value="cable">KX2 cable</option>
          </select>
          <Icon name="updown" size={13} class="row-chevron" />
        </label>
      {/if}
      <label class="row">
        <span class="row-title">Baud rate</span>
        {#if kx2}
          <select class="select" value={settings.cat.kx2Baud} onchange={(e) => void setKx2Baud(Number(e.currentTarget.value) as Kx2Baud)}>
            {#each KX2_BAUDS as b (b)}
              <option value={b}>{b}</option>
            {/each}
          </select>
        {:else}
          <select class="select" value={settings.cat.ic705Baud} onchange={(e) => void setIc705Baud(Number(e.currentTarget.value) as Ic705Baud)}>
            {#each IC705_BAUDS as b (b)}
              <option value={b}>{b}</option>
            {/each}
          </select>
        {/if}
        <Icon name="updown" size={13} class="row-chevron" />
      </label>
    </div>
    {#if kx2}
      <p class="section-foot">Baud rate must match the KX2’s MENU › RS232, which is 4800 by default.</p>
    {:else}
      <p class="section-foot" data-testid="rig-baud">Over USB the IC-705 answers at any rate. It has no baud rate setting.</p>
    {/if}
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
        {#if reconnectable}<button class="row act" onclick={() => void reconnectRadio()}><span class="row-title">Reconnect radio</span></button>{/if}
        <button class="row act" disabled={rig.status === 'choosing'} onclick={() => void connectRadio()}>
          <span class="row-main">
            <span class="row-title">Connect radio</span>
            {#if reconnectable}<span class="row-sub">Choose another port</span>{/if}
          </span>
        </button>
      {/if}
      <button class="row act" onclick={() => void copyLog()}>
        <span class="row-main">
          <span class="row-title">Copy connection log</span>
          {#if copyState === 'copied'}<span class="row-sub" role="status">Copied</span>{/if}
        </span>
      </button>
    </div>
    {#if rig.lastStop && !connected}<p class="section-foot err" data-testid="rig-last">{rig.lastStop}</p>{/if}
    {#if copyState === 'failed'}
      <p class="section-foot">The browser refused to copy. Select the log below and copy it.</p>
      <textarea class="report" readonly aria-label="Connection log" value={logText}></textarea>
    {/if}
    {#if connectionText}<p class="section-foot" class:err={connectionText.bad} role={connectionText.bad ? 'alert' : undefined} data-testid="rig-help">{connectionText.text}</p>{/if}
    {#if connected && rig.linesHigh}<p class="section-foot" data-testid="rig-lines">DTR and RTS could not be lowered. With USB SEND OFF, the radio ignores them.</p>{/if}
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
      <button class="row act" disabled={!connected || testing} onclick={() => void testKeying()}>
        <span class="row-main">
          <span class="row-title">{testing ? 'Testing keying' : 'Test keying'}</span>
          {#if testResult}<span class="row-sub" class:ok={testResult.ok} class:err={!testResult.ok} role="status" data-testid="rig-test">{testResult.text}</span>{/if}
        </span>
      </button>
    </div>
    {#if outputText}<p class="section-foot err" role="alert" data-testid="rig-output">{outputText}</p>{/if}
    {#if notDataMode}<p class="section-foot err" role="alert" data-testid="rig-mode">{notDataMode}</p>{/if}
    {#if offBand}<p class="section-foot err" role="alert" data-testid="rig-band">{offBand}</p>{/if}
    <p class="section-foot">Test keying transmits 1 s with no audio. Use low power into a dummy load.</p>
    {#if kx2}<p class="section-foot" data-testid="rig-risk">{digirig ? KX2_RISK : KX2_RISK_CABLE}</p>{/if}
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

  .report {
    width: 100%;
    min-height: 160px;
    margin-top: var(--rr-space-2);
    padding: var(--rr-space-2);
    border: 0;
    border-radius: var(--rr-radius-m);
    background: var(--rr-fill);
    color: var(--rr-label);
    font-family: var(--rr-mono);
    font-size: var(--rr-text-caption);
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
