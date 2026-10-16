// Settings, kept in IndexedDB. Loaded once at start; every change is written at once.

import { getKv, mergeKv, peekKv } from './db';
import { dialHz, isBand, type BandId } from '../radio/bands';
import { inBand, type FtDials, type HoundDials } from '../radio/hound-dial';
import type { Mode } from '../clock/slots';
import { defaultHighlights, normaliseHighlights, type HighlightEntry } from '../decode/highlight';
import type { Contrast } from '../waterfall/levels';
import { isPaletteId, type PaletteId } from '../waterfall/colormap';
import { clampHz } from '../waterfall/pick';
import { HUNT_ORDERS, QUEUE_ORDERS, type HuntOrder, type QueueOrder } from '../qso/sequencer';
import { DEFAULT_POWER_DBM, isPowerDbm } from '../wspr/power';
import { DEFAULT_STOP_AFTER_MIN, DEFAULT_TX_PCT, normalisePct, normaliseStopAfter } from '../wspr/schedule';
import { SPOT_SORTS, type SpotSort } from '../wspr/spots';
import { RTTY_DEFAULTS, validateRtty, type RttySettings } from '../rtty/settings';
import { keyboardDefaults, validateKeyboard, type KeyboardSettings } from '../keyboard/settings';
import { fixShippedReport, normaliseMacros } from '../keyboard/macros';
import type { CatRadioId } from '../cat/radios';
import { IC705_BAUDS, IC705_DEFAULT_BAUD, KX2_BAUDS, KX2_DEFAULT_BAUD, type Ic705Baud, type Kx2Baud } from '../cat/serial';

/** Sun: light with the most contrast, for direct sunlight (tokens.css). */
export type Theme = 'system' | 'light' | 'dark' | 'sun';

/**
 * The checklist items the operator ticks before transmitting; RR73 cannot read these system
 * settings. iOS shows focus, clicks and volume, other systems sounds, output and power
 * (lib/app/advice.ts).
 */
export interface Checklist {
  focus: boolean;
  clicks: boolean;
  volume: boolean;
  /** System sounds off. */
  sounds: boolean;
  /** The radio is not the system's default output. */
  output: boolean;
  /** Sleep set to Never. */
  power: boolean;
}

/**
 * Optional parts of the app, each off until the operator turns it on in Settings › Optional
 * features. Nothing large downloads or polls for a feature that is off.
 */
export interface Features {
  /** POTA, SOTA, WWFF and IOTA activations: start, progress and files. */
  activations: boolean;
  /** Spots from the POTA spot list. */
  potaSpots: boolean;
  /** DX cluster spots through HamQTH. */
  clusterSpots: boolean;
}

export type FeatureId = keyof Features;

export const FEATURE_IDS: readonly FeatureId[] = ['activations', 'potaSpots', 'clusterSpots'];

export const FEATURES_OFF: Readonly<Features> = { activations: false, potaSpots: false, clusterSpots: false };

/** WSPR's own settings (Settings › WSPR, ADR 0006). */
export interface WsprSettings {
  /** Share of slots the beacon transmits in, %: 5 to 100 in steps of 5. */
  txPct: number;
  /** Power the messages report, dBm: one of WSPR's values (lib/wspr/power.ts). The radio sets the real output. */
  powerDbm: number;
  /** Tx audio frequency, the signal centre, Hz: 1410 to 1590 (FREQ_LIMITS in waterfall/pick.ts). */
  txHz: number;
  /** The beacon turns off this long after Beacon on, min; 0 is Off. */
  stopAfterMin: number;
  /** Order of the spots in each slot. */
  sort: SpotSort;
}

export const WSPR_DEFAULTS: Readonly<WsprSettings> = { txPct: DEFAULT_TX_PCT, powerDbm: DEFAULT_POWER_DBM, txHz: 1500, stopAfterMin: DEFAULT_STOP_AFTER_MIN, sort: 'distance' };

export type { CatRadioId };

/** Rig control (Settings › Rig control, docs/design/cat.md). Desktop Chromium only. */
export interface CatSettings {
  radio: CatRadioId;
  /** Transmissions key the radio by PTT over CI-V. Off: the radio keys by VOX, and RR73 only reads and sets its dial and mode. */
  keyPtt: boolean;
  /**
   * FT8 and FT4 transmissions move the radio's dial so their audio sits at 1500 to 2000 Hz, in the
   * middle of the transmit passband, at the same RF frequency (lib/cat/passband.ts). Works only
   * with keyPtt, as the dial moves before PTT on and back after PTT off.
   */
  shiftDial: boolean;
  /** The operator connected a radio and has not disconnected it: RR73 opens its port again when the app opens. */
  connect: boolean;
  /** USB IDs of the port chosen, to find it among the ports the browser allows; null when the browser gave none. */
  usbVendorId: number | null;
  usbProductId: number | null;
  /** The KX2's serial rate: its MENU › RS232 must match (Owner's Manual p. 49). */
  kx2Baud: Kx2Baud;
  /** The IC-705's serial rate: any works over USB (Basic Manual p. 13-2). */
  ic705Baud: Ic705Baud;
  /**
   * The KX2's MIC BTN as last read, as MP gives it; null before any read. RR73 opens a KX2's port
   * by itself (on starting, on the port coming back, on a new baud rate) only after it read 0, OFF.
   */
  kx2MicBtn: number | null;
  /** RR73 may have left the radio keyed: set from PTT on until a read confirms PTT off, kept across reloads. */
  leftKeyed: boolean;
}

export const CAT_DEFAULTS: Readonly<CatSettings> = { radio: 'ic705', keyPtt: false, shiftDial: false, connect: false, usbVendorId: null, usbProductId: null, kx2Baud: KX2_DEFAULT_BAUD, ic705Baud: IC705_DEFAULT_BAUD, kx2MicBtn: null, leftKeyed: false };

export interface Settings {
  /** Operator callsign, upper case; empty until set. */
  callsign: string;
  theme: Theme;
  band: BandId;
  mode: Mode;
  /** Input device, or null for the system default. */
  inputDeviceId: string | null;
  /** The input device's name, to find it again when the browser gives it a new ID; empty when unknown. */
  inputDeviceLabel: string;
  /** Output device for transmit audio, or null for the system default. Chromium only (lib/audio/sink.ts). */
  outputDeviceId: string | null;
  /** The output device's name, to find it again when the browser gives it a new ID; empty when unknown. */
  outputDeviceLabel: string;
  /** Tune output level, 0 to 1. */
  outputLevel: number;
  /** Play the start tone (1500 Hz, 0.4 s) through the radio when audio starts. */
  startTone: boolean;
  checklist: Checklist;
  /** Receive and transmit audio frequencies (lowest tone), Hz. */
  rxHz: number;
  txHz: number;
  /** Tx stays put when calling a station; when false, Tx moves to the station called. */
  holdTx: boolean;
  /** The operator has set a frequency from the waterfall, so the hint under it is gone. */
  freqPicked: boolean;
  /** Operator grid square, 4 or 6 characters; empty until set. */
  grid: string;
  /** Tx4 acknowledges with RR73 or RRR. */
  ack: 'RR73' | 'RRR';
  /** Run mode works stations already worked today on this band and mode. */
  workDupes: boolean;
  /** Parity for calling CQ: even is 1st. */
  cqParity: 'even' | 'odd';
  /** Order Run mode answers callers in. */
  queueOrder: QueueOrder;
  /** Run: after a QSO from CQ, answer the next caller or call CQ again. Off: Tx goes off after the QSO. */
  run: boolean;
  /** Call a station that answered someone else once more when that QSO ends. */
  tailEnd: boolean;
  /** Order Hunt picks CQs in. */
  huntOrder: HuntOrder;
  /** The watchdog stops Tx after `watchdogMin` without a touch or a new message. */
  watchdog: boolean;
  /** Watchdog limit, min: any positive number. */
  watchdogMin: number;
  /** Each new message in a QSO restarts the watchdog, as well as the operator's actions. */
  watchdogRefresh: boolean;
  /** Hunt moves on after this many calls without an answer: 1 to 99. */
  huntCalls: number;
  /** Bands where FT8 runs in Hound mode (FT8 DXpedition mode). */
  houndBands: BandId[];
  /** The DXpedition's dial frequency entered for Hound mode, Hz, by band. */
  houndDialHz: HoundDials;
  /** The operator's own FT8 and FT4 dials, Hz, by mode and band; the usual one where none. */
  ftDialHz: FtDials;
  features: Features;
  /** Decode colours in priority order: the first enabled match colours a decode. */
  highlights: HighlightEntry[];
  /** How many dB over the noise reach the top of the waterfall's colours (waterfall/levels.ts). */
  waterfallContrast: Contrast;
  /** The waterfall's colormap (waterfall/colormap.ts). */
  waterfallPalette: PaletteId;
  /** FT8 and FT4 write the callsigns of their decodes over the signals on the waterfall; off by default. */
  waterfallCalls: boolean;
  /** Minutes without a touch before Operate turns to the night display; 0 never. */
  nightAfterMin: NightAfter;
  wspr: WsprSettings;
  /** The operator's name and QTH, for {MYNAME} and {MYQTH} in keyboard macros. */
  myName: string;
  myQth: string;
  /** RTTY's own settings (Settings › RTTY). */
  rtty: RttySettings;
  /** Macros, contest and serial numbers, shared by every keyboard mode. */
  keyboard: KeyboardSettings;
  cat: CatSettings;
}

export const DEFAULTS: Settings = {
  callsign: '',
  theme: 'light',
  band: '20m',
  mode: 'FT8',
  inputDeviceId: null,
  inputDeviceLabel: '',
  outputDeviceId: null,
  outputDeviceLabel: '',
  outputLevel: 0.5,
  startTone: true,
  checklist: { focus: false, clicks: false, volume: false, sounds: false, output: false, power: false },
  rxHz: 1500,
  txHz: 1500,
  holdTx: true,
  freqPicked: false,
  grid: '',
  ack: 'RR73',
  workDupes: false,
  cqParity: 'even',
  queueOrder: 'first',
  run: false,
  tailEnd: true,
  huntOrder: 'unworked',
  watchdog: true,
  watchdogMin: 6,
  watchdogRefresh: false,
  huntCalls: 4,
  houndBands: [],
  houndDialHz: {},
  ftDialHz: { FT8: {}, FT4: {} },
  features: { ...FEATURES_OFF },
  highlights: defaultHighlights(),
  waterfallContrast: 'normal',
  waterfallPalette: 'rr73',
  waterfallCalls: false,
  nightAfterMin: 0,
  wspr: { ...WSPR_DEFAULTS },
  myName: '',
  myQth: '',
  rtty: { ...RTTY_DEFAULTS, dialHz: {} },
  keyboard: keyboardDefaults(),
  cat: { ...CAT_DEFAULTS },
};

const KEY = 'settings';

/** The night display's idle times, min; 0 is never. */
export const NIGHT_AFTER = [0, 2, 5, 10] as const;
export type NightAfter = (typeof NIGHT_AFTER)[number];

/**
 * The stored record's format, kept in it as `schema`:
 *
 * 1. 0.5.0 and earlier, with no `schema` field and no optional features.
 * 2. Optional features. Every feature starts off, including activations, which 0.5.0 always showed.
 * 3. Decode colours. Every category starts on, in WSJT-X's order and colours.
 * 4. Never released. It was set aside for the waterfall contrast, which arrived in 6.
 * 5. Run, tail-ending, Hunt's order and the watchdog become settings, stored at their defaults:
 *    Run off, tail-ending on, not worked first, the watchdog on at 6 min.
 * 6. Waterfall contrast, starting at Normal.
 * 7. WSPR's settings, at their defaults: 20%, 37 dBm, 1500 Hz, Stop beacon after 1 h, sorted by
 *    distance. FT8 and FT4 keep their fields at the top level.
 * 8. RTTY's settings, the keyboard modes' macros and contest, and the operator's name and QTH,
 *    at their defaults. Every other value stays where it was.
 * 9. The Report macro as 0.14.0 stored it gets Return to Rx (macros.ts fixShippedReport).
 * 10. Released in 0.19.3, when decode colours left as shipped took RR73's scheme. The step is
 *     gone: stored colours stay.
 * 11. Light is the default theme; a stored theme stays. The LoTW users feature is gone, and
 *     validate() ignores its stored switch.
 */
export const SETTINGS_SCHEMA = 11;

/** The sequencer settings schema 5 adds. */
const SEQUENCER_DEFAULTS = { run: false, tailEnd: true, huntOrder: 'unworked', watchdog: true, watchdogMin: 6 } as const;

function schemaOf(raw: unknown): number {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).schema : undefined;
  return typeof v === 'number' ? v : 1;
}

/** The changes that bring a stored record up to SETTINGS_SCHEMA; empty when it is current. */
export function migration(raw: unknown): Record<string, unknown> {
  const from = schemaOf(raw);
  if (from >= SETTINGS_SCHEMA) return {};
  const patch: Record<string, unknown> = { schema: SETTINGS_SCHEMA };
  if (from < 2) patch.features = { ...FEATURES_OFF };
  if (from < 3) patch.highlights = defaultHighlights();
  if (from < 5) Object.assign(patch, SEQUENCER_DEFAULTS);
  if (from < 6) patch.waterfallContrast = 'normal';
  if (from < 7) patch.wspr = { ...WSPR_DEFAULTS };
  if (from < 8) Object.assign(patch, { myName: '', myQth: '', rtty: { ...RTTY_DEFAULTS, dialHz: {} }, keyboard: keyboardDefaults() });
  else if (from < 9) {
    const k = (raw as Record<string, unknown>).keyboard;
    if (k && typeof k === 'object') {
      const kb = k as Record<string, unknown>;
      patch.keyboard = { ...kb, macros: fixShippedReport(normaliseMacros(kb.macros)) };
    }
  }
  return patch;
}

export const settings = $state<Settings>(structuredClone(DEFAULTS));

/** True once the stored settings have been read, or storage has failed for good. */
export const settingsStatus = $state({ loaded: false });

/** Upper case, callsign characters only, at most 13: "vk3/9v1ne" gives "VK3/9V1NE". */
export function normaliseCallsign(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9/]/g, '')
    .slice(0, 13);
}

/** Grid squares as written: field and square upper case, subsquare lower case, "OJ11ab". */
export function normaliseGrid(s: string): string {
  const g = s.trim().replace(/\s+/g, '');
  return g.slice(0, 4).toUpperCase() + g.slice(4, 6).toLowerCase();
}

/** Name and QTH as sent in keyboard modes: upper case, single spaces, at most 40 characters. */
export function normaliseText(s: string): string {
  return s.toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** A watchdog limit, min: positive, to 0.1 min, at most 9999; null when not one. */
export function normaliseMinutes(v: number): number | null {
  if (!Number.isFinite(v)) return null;
  const m = Math.round(v * 10) / 10;
  return m > 0 && m <= 9999 ? m : null;
}

function validateCat(raw: unknown): CatSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const c = { ...CAT_DEFAULTS };
  for (const k of ['keyPtt', 'shiftDial', 'connect', 'leftKeyed'] as const) if (typeof r[k] === 'boolean') c[k] = r[k];
  if (typeof r.kx2MicBtn === 'number' && Number.isInteger(r.kx2MicBtn) && r.kx2MicBtn >= 0 && r.kx2MicBtn <= 255) c.kx2MicBtn = r.kx2MicBtn;
  if (r.radio === 'ic705' || r.radio === 'kx2') c.radio = r.radio;
  if (KX2_BAUDS.includes(r.kx2Baud as Kx2Baud)) c.kx2Baud = r.kx2Baud as Kx2Baud;
  if (IC705_BAUDS.includes(r.ic705Baud as Ic705Baud)) c.ic705Baud = r.ic705Baud as Ic705Baud;
  for (const k of ['usbVendorId', 'usbProductId'] as const) {
    const v = r[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffff) c[k] = v;
  }
  return c;
}

function validateWspr(raw: unknown): WsprSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const w = { ...WSPR_DEFAULTS };
  w.txPct = normalisePct(r.txPct) ?? w.txPct;
  if (isPowerDbm(r.powerDbm)) w.powerDbm = r.powerDbm;
  if (typeof r.txHz === 'number' && Number.isFinite(r.txHz)) w.txHz = clampHz(r.txHz, 'WSPR');
  w.stopAfterMin = normaliseStopAfter(r.stopAfterMin) ?? w.stopAfterMin;
  if (SPOT_SORTS.includes(r.sort as SpotSort)) w.sort = r.sort as SpotSort;
  return w;
}

/** Merges stored values over the defaults, keeping only values of the right type. */
export function validate(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = structuredClone(DEFAULTS);
  if (typeof r.callsign === 'string') s.callsign = normaliseCallsign(r.callsign);
  if (r.theme === 'light' || r.theme === 'dark' || r.theme === 'sun' || r.theme === 'system') s.theme = r.theme;
  if (isBand(r.band)) s.band = r.band;
  if ((r.mode === 'FT8' || r.mode === 'FT4' || r.mode === 'WSPR' || r.mode === 'RTTY') && dialHz(s.band, r.mode) !== null) s.mode = r.mode;
  else if (dialHz(s.band, s.mode) === null) s.mode = 'WSPR';
  if (typeof r.inputDeviceId === 'string' && r.inputDeviceId) s.inputDeviceId = r.inputDeviceId;
  if (typeof r.inputDeviceLabel === 'string') s.inputDeviceLabel = r.inputDeviceLabel;
  if (typeof r.outputDeviceId === 'string' && r.outputDeviceId) s.outputDeviceId = r.outputDeviceId;
  if (typeof r.outputDeviceLabel === 'string') s.outputDeviceLabel = r.outputDeviceLabel;
  if (typeof r.outputLevel === 'number' && r.outputLevel >= 0 && r.outputLevel <= 1) s.outputLevel = r.outputLevel;
  if (typeof r.startTone === 'boolean') s.startTone = r.startTone;
  const c = r.checklist as Partial<Checklist> | undefined;
  if (c && typeof c === 'object') for (const k of ['focus', 'clicks', 'volume', 'sounds', 'output', 'power'] as const) if (typeof c[k] === 'boolean') s.checklist[k] = c[k];
  if (typeof r.grid === 'string' && /^[A-R]{2}\d{2}([A-X]{2})?$/i.test(r.grid.trim())) s.grid = normaliseGrid(r.grid);
  if (r.ack === 'RR73' || r.ack === 'RRR') s.ack = r.ack;
  if (typeof r.workDupes === 'boolean') s.workDupes = r.workDupes;
  if (typeof r.holdTx === 'boolean') s.holdTx = r.holdTx;
  if (typeof r.freqPicked === 'boolean') s.freqPicked = r.freqPicked;
  if (r.cqParity === 'even' || r.cqParity === 'odd') s.cqParity = r.cqParity;
  if (QUEUE_ORDERS.includes(r.queueOrder as QueueOrder)) s.queueOrder = r.queueOrder as QueueOrder;
  for (const k of ['run', 'tailEnd', 'watchdog', 'watchdogRefresh'] as const) if (typeof r[k] === 'boolean') s[k] = r[k];
  if (HUNT_ORDERS.includes(r.huntOrder as HuntOrder)) s.huntOrder = r.huntOrder as HuntOrder;
  if (typeof r.huntCalls === 'number' && Number.isInteger(r.huntCalls) && r.huntCalls >= 1 && r.huntCalls <= 99) s.huntCalls = r.huntCalls;
  if (typeof r.watchdogMin === 'number') {
    const m = normaliseMinutes(r.watchdogMin);
    if (m !== null) s.watchdogMin = m;
  }
  // Hound runs in FT8, so only on bands with an FT8 frequency.
  const ft8 = (b: unknown): b is BandId => isBand(b) && dialHz(b, 'FT8') !== null;
  if (Array.isArray(r.houndBands)) s.houndBands = [...new Set(r.houndBands.filter(ft8))];
  const dials = r.houndDialHz as Record<string, unknown> | undefined;
  if (dials && typeof dials === 'object') {
    for (const [b, hz] of Object.entries(dials)) if (ft8(b) && typeof hz === 'number' && inBand(b, hz)) s.houndDialHz[b] = Math.round(hz);
  }
  const own = r.ftDialHz as Record<string, unknown> | undefined;
  s.ftDialHz = { FT8: {}, FT4: {} };
  for (const m of ['FT8', 'FT4'] as const) {
    const byBand = own && typeof own === 'object' ? (own[m] as Record<string, unknown> | undefined) : undefined;
    if (byBand && typeof byBand === 'object')
      for (const [b, hz] of Object.entries(byBand)) if (isBand(b) && dialHz(b, m) !== null && typeof hz === 'number' && inBand(b, hz)) s.ftDialHz[m][b] = Math.round(hz);
  }
  for (const k of ['rxHz', 'txHz'] as const) {
    const v = r[k];
    if (typeof v === 'number' && v >= 100 && v <= 2900) s[k] = Math.round(v);
  }
  const f = r.features as Partial<Features> | undefined;
  if (f && typeof f === 'object') for (const k of FEATURE_IDS) if (typeof f[k] === 'boolean') s.features[k] = f[k];
  if (r.highlights !== undefined) s.highlights = normaliseHighlights(r.highlights);
  if (r.waterfallContrast === 'low' || r.waterfallContrast === 'normal' || r.waterfallContrast === 'high') s.waterfallContrast = r.waterfallContrast;
  if (isPaletteId(r.waterfallPalette)) s.waterfallPalette = r.waterfallPalette;
  if (typeof r.waterfallCalls === 'boolean') s.waterfallCalls = r.waterfallCalls;
  if (NIGHT_AFTER.includes(r.nightAfterMin as NightAfter)) s.nightAfterMin = r.nightAfterMin as NightAfter;
  s.wspr = validateWspr(r.wspr);
  for (const k of ['myName', 'myQth'] as const) if (typeof r[k] === 'string') s[k] = normaliseText(r[k]);
  s.rtty = validateRtty(r.rtty);
  s.keyboard = validateKeyboard(r.keyboard);
  s.cat = validateCat(r.cat);
  return s;
}

/** Changes made before the stored settings arrived; they win over the stored values. */
let early: Partial<Settings>[] | null = [];

function apply(stored: unknown) {
  if (!early) return;
  const m = migration(stored);
  Object.assign(settings, validate({ ...(stored as object), ...m }));
  const mine = early;
  early = null;
  for (const p of mine) Object.assign(settings, p);
  settingsStatus.loaded = true;
  if (stored === undefined) return;
  // Store the migration, except for values the operator has changed since: theirs are stored already.
  for (const p of mine) for (const k of Object.keys(p)) delete m[k];
  if (Object.keys(m).length) void mergeKv(KEY, m).catch(() => undefined);
}

/**
 * Loads the stored settings. The first read does not wait for a database upgrade (peekKv), so
 * the first screen shows them even while an older copy of RR73 holds the database; when even
 * that read cannot answer, this waits for the shared connection.
 */
export async function loadSettings(): Promise<void> {
  try {
    const peeked = await peekKv(KEY);
    apply(peeked ? peeked.value : await getKv(KEY));
  } catch {
    // No IndexedDB (a private window): the defaults stay and changes last until the page closes.
    early = null;
    settingsStatus.loaded = true;
  }
}

/** Changes settings at once and stores only the changed values, so stored values this copy has not read are kept. */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  Object.assign(settings, patch);
  const plain = $state.snapshot(patch) as Partial<Settings>;
  early?.push(plain);
  try {
    await mergeKv(KEY, { ...plain, schema: SETTINGS_SCHEMA });
  } catch {
    // As in loadSettings.
  }
}

/** Forgets what was loaded; tests use it to start again. */
export function resetSettings() {
  Object.assign(settings, structuredClone(DEFAULTS));
  early = [];
  settingsStatus.loaded = false;
}
