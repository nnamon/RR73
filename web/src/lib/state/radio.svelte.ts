/**
 * The radio as rig control reports it, for the rest of the app (docs/design/cat.md): its state,
 * the dial in use, the keyer for transmissions and why a transmission cannot go. The link itself
 * lives in lib/state/cat.svelte.ts, which writes this state; the transmit paths, the band sheet and
 * the log read it, so none of them imports the link.
 */

import type { CatFilter, CatMode, DataSub, SettingId } from '../cat/protocol';
import { RADIOS, type RadioTraits } from '../cat/radios';
import { bandOfHz } from '../log/bandplan';
import { STATUS } from '../qso/status';
import { dialHz, isBand, type BandId } from '../radio/bands';
import { operatingDialHz } from '../radio/hound-dial';
import { rttyDialHz } from '../rtty/dial';
import { txDialShiftHz } from '../cat/passband';
import type { Mode } from '../clock/slots';
import type { Keyer } from '../tx/keyer';
import { practice } from './practice.svelte';
import { settings } from './settings.svelte';

/**
 * `off` with no radio; `choosing` while the browser's port chooser is open; `connecting` until the
 * radio first answers; `connected`; `silent` after 3 requests in a row went unanswered; `failed`
 * when the port did not open; `lost` when it went away.
 */
export type RigStatus = 'off' | 'choosing' | 'connecting' | 'connected' | 'silent' | 'failed' | 'lost';

/** Why rig control is not connected, for the Rig control screen. */
export type RigError = 'refused' | 'busy' | 'signals' | 'failed' | 'no-wasm' | 'gone' | 'choose' | 'lost' | 'no-reply';

/** The last dial RR73 set on the radio, and how it went. */
export interface RigTuning {
  hz: number;
  /** `waiting` while the radio transmits: the dial is set once it receives. */
  state: 'setting' | 'waiting' | 'set' | 'refused' | 'no-reply' | 'busy';
}

/** The last Test keying. */
export type RigTest = { state: 'running' } | { state: 'done'; ok: boolean; text: string; atMs: number };

export const rig = $state({
  status: 'off' as RigStatus,
  error: null as RigError | null,
  /** The port sends bytes, but no frame from the radio: another port, such as Serial Port B. */
  noiseOnly: false,
  /** The operating frequency, Hz, once read. */
  hz: null as number | null,
  mode: null as CatMode | null,
  filter: null as CatFilter | null,
  /** Data mode (USB-D) on, once read. The IC-705's. */
  data: null as boolean | null,
  /** The data sub-mode, once read; valid only in DATA and DATA-REV. The KX2's. */
  sub: null as DataSub | null,
  /** The settings read on connecting: the IC-705's menu codes; the KX2's product number, MIC BTN and VOX. */
  menu: {} as Partial<Record<SettingId, number>>,
  /** RR73 holds PTT on. */
  keyed: false,
  /** Transmit or receive, as the radio last reported it; null before the first report. */
  transmitting: null as boolean | null,
  /** From PTT on until a read confirmed PTT off: RR73 may hold the radio keyed. */
  mayBeKeyed: false,
  /** PTT off went out and no read confirmed receive after it: the radio may still transmit. */
  unkeyFailed: false,
  /** The driver refused to lower DTR and RTS on the IC-705's port, and USB SEND read OFF: the port stayed open. */
  linesHigh: false,
  /** Where the last attempt on this radio stopped without connecting, as found when the app started; null otherwise. */
  lastStop: null as string | null,
  tuning: null as RigTuning | null,
  test: null as RigTest | null,
});

/** The radio chosen in Settings › Rig control. */
export function radioTraits(): RadioTraits {
  return RADIOS[settings.cat.radio] ?? RADIOS.ic705;
}

/** The chosen radio's name on screen: "IC-705", "KX2". */
export function radioName(): string {
  return radioTraits().name;
}

const SUB_TEXT: Record<DataSub, string> = { data_a: 'DATA A', afsk_a: 'AFSK A', fsk_d: 'FSK D', psk_d: 'PSK D' };

/**
 * The radio's mode as its screen shows it: "USB-D", "LSB", "CW-R" on the IC-705; "DATA A",
 * "AFSK A REV", "USB" on the KX2. Empty before the first read.
 */
export function modeText(mode: CatMode | null, data: boolean | null, sub: DataSub | null = null): string {
  if (mode === null) return '';
  if (mode === 'data' || mode === 'data-rev') return (sub ? SUB_TEXT[sub] : 'DATA') + (mode === 'data-rev' ? ' REV' : '');
  return mode.toUpperCase().replace('-REV', ' REV') + (data ? '-D' : '');
}

/** The connected radio's mode, as modeText gives it. */
export function rigModeText(): string {
  return modeText(rig.mode, rig.data, rig.sub);
}

/**
 * True when the radio reads the data mode RR73 sets (USB-D on the IC-705, DATA A on the KX2),
 * false when it reads another mode, null before it has read enough to say.
 */
export function rigInDataMode(): boolean | null {
  if (rig.mode === null) return null;
  if (settings.cat.radio === 'kx2') {
    if (rig.mode !== 'data') return false;
    return rig.sub === null ? null : rig.sub === 'data_a';
  }
  return rig.data === null ? null : rig.mode === 'usb' && rig.data;
}

/** The Rig control row's value in Settings: "Connected", "No reply", or Off with no radio chosen. */
export function rigSummary(): string {
  if (rig.unkeyFailed) return 'PTT off not confirmed';
  switch (rig.status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
    case 'choosing':
      return 'Connecting';
    case 'silent':
      return 'No reply';
    case 'lost':
    case 'failed':
      return 'Not connected';
    default:
      return 'Off';
  }
}

/** True while a radio is connected: it answers, or answered before going silent. */
export function rigConnected(): boolean {
  return rig.status === 'connected' || rig.status === 'silent';
}

/**
 * True when the radio's USB SEND keys it on a DTR or RTS line (CI-V guide p. 8: 1 and 2 port A, 3
 * and 4 port B). Chromium raises both lines while it opens a port, so RR73 keeps them low and
 * refuses to transmit until USB SEND is OFF (docs/design/cat.md).
 */
export function usbSendOn(): boolean {
  const v = rig.menu.usb_send;
  return v !== undefined && v >= 1 && v <= 4;
}

/** The RR73 band the radio's dial is on; null without a dial or outside RR73's bands. */
export function rigBand(): BandId | null {
  if (rig.hz === null) return null;
  const b = bandOfHz(rig.hz);
  return isBand(b) ? b : null;
}

/** The dial a band and mode use, Hz, as the band sheet sets it: the operator's own, Hound's, or the band's usual one. */
export function plannedDialHz(band: BandId, mode: Mode): number | null {
  if (mode === 'RTTY') return rttyDialHz(band, settings.rtty.dialHz);
  if (mode === 'WSPR') return dialHz(band, 'WSPR');
  const hound = mode === 'FT8' && settings.houndBands.includes(band);
  return operatingDialHz(band, mode, hound, settings.houndDialHz, settings.ftDialHz);
}

/** True while the dial in use is the radio's: one is connected and its dial is on RR73's band. */
export function rigDialInUse(): boolean {
  return rigConnected() && rig.hz !== null && rigBand() === settings.band;
}

/**
 * The dial in use, Hz: the radio's while rigDialInUse, else `fallback` (the dial the band sheet
 * shows without rig control).
 */
export function dialNow(fallback: number | null): number | null {
  return rigDialInUse() ? rig.hz : fallback;
}

/** Operate's radio badge: the connection in a word or two, its tint, and the whole for screen readers. */
export interface RigBadge {
  text: string;
  tone: 'ok' | 'warn' | 'bad';
  label: string;
}

/**
 * Operate's radio badge while rig control is on: a radio connected or connecting, or the one the
 * operator connected gone; null with rig control off. Green "Connected" while all is well. Amber
 * names what is wrong, the most serious first: "Transmitting" while the radio transmits with no
 * PTT from RR73, the mode it is in ("USB", "AFSK A") outside the data mode RR73 sets (USB-D, DATA
 * A), "Off band" while its dial is on another band than RR73's, and "Connecting" until its mode is
 * read. Red while the link is down or PTT off went unconfirmed. The label for screen readers says
 * the whole.
 */
export function rigBadge(): RigBadge | null {
  if (!settings.cat.connect && rig.status === 'off') return null;
  const name = radioName();
  const open = 'Open Rig control';
  if (rig.unkeyFailed) return { text: 'Transmitting', tone: 'bad', label: `${name} may still transmit: PTT off not confirmed. ${open}` };
  switch (rig.status) {
    case 'connected': {
      // The most serious condition first; its label names it. RR73's own keying counts until a
      // read confirms receive, so its end shows nothing.
      const band = rigBand();
      const data = rigInDataMode();
      if (rig.transmitting === true && !rig.keyed && !rig.mayBeKeyed) return { text: 'Transmitting', tone: 'warn', label: `${name} connected, transmitting with no PTT from RR73. ${open}` };
      if (data === false) return { text: rigModeText(), tone: 'warn', label: `${name} connected, in ${rigModeText()}. ${open}` };
      if (rig.hz !== null && band !== settings.band) return { text: 'Off band', tone: 'warn', label: `${name} connected, ${band === null ? 'outside the bands' : `on ${band}`}. ${open}` };
      // Green only once the mode is read: after a spell without answers it is read again within 5 s.
      if (data === null) return { text: 'Connecting', tone: 'warn', label: `${name} connected, reading its mode. ${open}` };
      return { text: 'Connected', tone: 'ok', label: `${name} connected. ${open}` };
    }
    case 'connecting':
    case 'choosing':
      return { text: 'Connecting', tone: 'warn', label: `${name} connecting. ${open}` };
    case 'silent':
      return { text: 'No reply', tone: 'bad', label: `No reply from the ${name}. ${open}` };
    case 'lost':
      return { text: 'Port closed', tone: 'bad', label: `The ${name}’s port closed. ${open}` };
    default:
      return { text: 'Not connected', tone: 'bad', label: `${name} not connected. ${open}` };
  }
}

let keyer: Keyer | null = null;

/**
 * Where transmit audio goes, as the audio engine reports it: `ok` on the output chosen in Settings ›
 * Radio and audio, `default` with none chosen (System default), `missing` when the chosen device is
 * not connected, `refused` when the browser refused it, `switching` while the output moves to it.
 * Always `ok` where the browser cannot choose an output.
 */
export type TxOutput = 'ok' | 'default' | 'missing' | 'refused' | 'switching';

let txOutputOf: () => TxOutput = () => 'ok';

/** The audio engine (lib/state/station.svelte.ts) tells where transmit audio goes. */
export function provideTxOutput(fn: () => TxOutput) {
  txOutputOf = fn;
}

/** Where transmit audio goes now. */
export function txOutput(): TxOutput {
  return txOutputOf();
}

const OUTPUT_NOTICE: Record<Exclude<TxOutput, 'ok'>, string> = {
  default: STATUS.txOutputDefault,
  missing: STATUS.txOutputMissing,
  refused: STATUS.txOutputRefused,
  switching: STATUS.txOutputSwitching,
};

/**
 * Keying by CAT, a transmission whose audio would not reach the output chosen in Settings › Radio
 * and audio is refused: the radio would transmit with its Tx audio on another device, or none.
 * Null without CAT keying, where VOX keys only on audio that reaches the radio.
 */
function outputGate(): string | null {
  if (!txKeyer()) return null;
  const o = txOutput();
  return o === 'ok' ? null : OUTPUT_NOTICE[o];
}

/** Rig control hands over the radio's PTT while a link is open, and null when it closes. */
export function provideKeyer(k: Keyer | null) {
  keyer = k;
}

/**
 * True when transmissions key the radio by CAT once it is connected: Key the radio with CAT is on,
 * and with the practice band on, its Play Tx audio too, the switch that lets practice key a
 * connected radio. Then practice transmissions key the radio as real ones do. With Play Tx audio
 * off, practice plays no Tx audio and keys nothing.
 */
export function catKeys(): boolean {
  return settings.cat.keyPtt && (!practice.on || practice.playTx);
}

/**
 * The keyer for transmissions: the radio's PTT while one is connected and catKeys holds; null
 * otherwise, and the radio keys by VOX on the audio alone.
 */
export function txKeyer(): Keyer | null {
  return catKeys() && rigConnected() ? keyer : null;
}

/**
 * The radio's dial shift for a transmission at audio `hz` in `mode`, Hz (lib/cat/passband.ts): with
 * Keep Tx audio centred on, the IC-705 keyed by CAT and in USB, for FT8 and FT4; 0 otherwise. The
 * dial moves up by it and the audio down, so the RF frequency stays the receive dial plus `hz`. In
 * another mode than USB the dial and the audio would not add up to the same RF. WSPR (1410 to
 * 1590 Hz) and RTTY are left out (docs/design/cat.md, Passband shift).
 */
export function txShiftHz(mode: Mode, hz: number): number {
  // Elecraft's documents give no transmit passband for the KX2's DATA A to centre the audio in.
  if (settings.cat.radio !== 'ic705') return 0;
  if (!settings.cat.shiftDial || (mode !== 'FT8' && mode !== 'FT4') || !txKeyer() || rig.mode !== 'usb' || rig.hz === null) return 0;
  return txDialShiftHz(hz);
}

/**
 * Why a transmission cannot go because of the radio, or null: keying by CAT is on and the radio
 * the operator connected is not connected now; PTT off was not confirmed; the radio's USB SEND
 * keys it on a port line; keying by CAT, the Tx audio would not reach the chosen output; or the
 * radio's dial is on another band than RR73's, where QSOs would log the wrong band. The practice
 * band with Play Tx audio off keys nothing, so it needs no radio connected.
 */
export function rigGate(): string | null {
  if (catKeys() && settings.cat.connect && !rigConnected()) return STATUS.radioDown;
  if (!rigConnected()) return null;
  if (rig.unkeyFailed) return STATUS.pttUnconfirmed;
  if (usbSendOn()) return STATUS.usbSend;
  const output = outputGate();
  if (output) return output;
  if (rig.hz === null) return null;
  const b = rigBand();
  if (b === null) return STATUS.radioOutside;
  return b === settings.band ? null : STATUS.radioBand(b);
}

/** Why Tune cannot go because of the radio, or null: as rigGate, but on any band. */
export function tuneGate(): string | null {
  if (catKeys() && settings.cat.connect && !rigConnected()) return STATUS.radioDown;
  if (!rigConnected()) return null;
  if (rig.unkeyFailed) return STATUS.pttUnconfirmed;
  return usbSendOn() ? STATUS.usbSend : outputGate();
}

type NoticeListener = (text: string, txOff: boolean, always: boolean) => void;

const noticeListeners = new Set<NoticeListener>();

/**
 * Listens for what the radio does to transmissions: the port lost or a fault (`txOff`: Tx goes
 * off, as when audio stops), PTT off unconfirmed, or Tune refused. Each runtime shows it in its own
 * status line: a `txOff` notice only while Tx was on, unless `always`.
 */
export function onRadioNotice(fn: NoticeListener): () => void {
  noticeListeners.add(fn);
  return () => noticeListeners.delete(fn);
}

/** Tells the runtimes; rig control calls it with `txOff` when the port goes or the radio faults. */
export function radioNotice(text: string, txOff = false, always = false) {
  for (const l of noticeListeners) l(text, txOff, always);
}

/** Forgets the radio's state, as after Disconnect radio; tests use it to start again. */
export function resetRig() {
  Object.assign(rig, { status: 'off', error: null, noiseOnly: false, hz: null, mode: null, filter: null, data: null, sub: null, menu: {}, keyed: false, transmitting: null, mayBeKeyed: false, unkeyFailed: false, linesHigh: false, lastStop: null, tuning: null, test: null });
  keyer = null;
}
