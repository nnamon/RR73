// Settings, kept in IndexedDB. Loaded once at start; every change is written at once.

import { getKv, mergeKv, peekKv } from './db';
import { dialHz, isBand, type BandId } from '../radio/bands';
import { inBand, type HoundDials } from '../radio/hound-dial';
import type { Mode } from '../clock/slots';
import { defaultHighlights, normaliseHighlights, type HighlightEntry } from '../decode/highlight';
import type { Contrast } from '../waterfall/levels';
import { clampHz } from '../waterfall/pick';
import { HUNT_ORDERS, type HuntOrder } from '../qso/sequencer';
import { DEFAULT_POWER_DBM, isPowerDbm } from '../wspr/power';
import { DEFAULT_STOP_AFTER_MIN, DEFAULT_TX_PCT, normalisePct, normaliseStopAfter } from '../wspr/schedule';
import { SPOT_SORTS, type SpotSort } from '../wspr/spots';

export type Theme = 'system' | 'light' | 'dark';

/** The VOX checklist items the operator ticks; RR73 cannot read these phone settings. */
export interface Checklist {
  focus: boolean;
  clicks: boolean;
  volume: boolean;
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
  /** Marks stations that use LoTW, from the LoTW user list. */
  lotw: boolean;
}

export type FeatureId = keyof Features;

export const FEATURE_IDS: readonly FeatureId[] = ['activations', 'potaSpots', 'clusterSpots', 'lotw'];

export const FEATURES_OFF: Readonly<Features> = { activations: false, potaSpots: false, clusterSpots: false, lotw: false };

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

export interface Settings {
  /** Operator callsign, upper case; empty until set. */
  callsign: string;
  theme: Theme;
  band: BandId;
  mode: Mode;
  /** Input device, or null for the system default. */
  inputDeviceId: string | null;
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
  queueOrder: 'first' | 'strongest' | 'farthest' | 'new';
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
  /** Bands where FT8 runs in Hound mode (FT8 DXpedition mode). */
  houndBands: BandId[];
  /** The DXpedition's dial frequency entered for Hound mode, Hz, by band. */
  houndDialHz: HoundDials;
  features: Features;
  /** Decode colours in priority order: the first enabled match colours a decode. */
  highlights: HighlightEntry[];
  /** How many dB over the noise reach the top of the waterfall's colours (waterfall/levels.ts). */
  waterfallContrast: Contrast;
  wspr: WsprSettings;
}

export const DEFAULTS: Settings = {
  callsign: '',
  theme: 'system',
  band: '20m',
  mode: 'FT8',
  inputDeviceId: null,
  outputLevel: 0.5,
  startTone: true,
  checklist: { focus: false, clicks: false, volume: false },
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
  houndBands: [],
  houndDialHz: {},
  features: { ...FEATURES_OFF },
  highlights: defaultHighlights(),
  waterfallContrast: 'normal',
  wspr: { ...WSPR_DEFAULTS },
};

const KEY = 'settings';

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
 */
export const SETTINGS_SCHEMA = 7;

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

/** A watchdog limit, min: positive, to 0.1 min, at most 9999; null when not one. */
export function normaliseMinutes(v: number): number | null {
  if (!Number.isFinite(v)) return null;
  const m = Math.round(v * 10) / 10;
  return m > 0 && m <= 9999 ? m : null;
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
  if (r.theme === 'light' || r.theme === 'dark' || r.theme === 'system') s.theme = r.theme;
  if (isBand(r.band)) s.band = r.band;
  if ((r.mode === 'FT8' || r.mode === 'FT4' || r.mode === 'WSPR') && dialHz(s.band, r.mode) !== null) s.mode = r.mode;
  else if (dialHz(s.band, s.mode) === null) s.mode = 'WSPR';
  if (typeof r.inputDeviceId === 'string' && r.inputDeviceId) s.inputDeviceId = r.inputDeviceId;
  if (typeof r.outputLevel === 'number' && r.outputLevel >= 0 && r.outputLevel <= 1) s.outputLevel = r.outputLevel;
  if (typeof r.startTone === 'boolean') s.startTone = r.startTone;
  const c = r.checklist as Partial<Checklist> | undefined;
  if (c && typeof c === 'object') for (const k of ['focus', 'clicks', 'volume'] as const) if (typeof c[k] === 'boolean') s.checklist[k] = c[k];
  if (typeof r.grid === 'string' && /^[A-R]{2}\d{2}([A-X]{2})?$/i.test(r.grid.trim())) s.grid = normaliseGrid(r.grid);
  if (r.ack === 'RR73' || r.ack === 'RRR') s.ack = r.ack;
  if (typeof r.workDupes === 'boolean') s.workDupes = r.workDupes;
  if (typeof r.holdTx === 'boolean') s.holdTx = r.holdTx;
  if (typeof r.freqPicked === 'boolean') s.freqPicked = r.freqPicked;
  if (r.cqParity === 'even' || r.cqParity === 'odd') s.cqParity = r.cqParity;
  if (r.queueOrder === 'first' || r.queueOrder === 'strongest' || r.queueOrder === 'farthest' || r.queueOrder === 'new') s.queueOrder = r.queueOrder;
  for (const k of ['run', 'tailEnd', 'watchdog', 'watchdogRefresh'] as const) if (typeof r[k] === 'boolean') s[k] = r[k];
  if (HUNT_ORDERS.includes(r.huntOrder as HuntOrder)) s.huntOrder = r.huntOrder as HuntOrder;
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
  for (const k of ['rxHz', 'txHz'] as const) {
    const v = r[k];
    if (typeof v === 'number' && v >= 100 && v <= 2900) s[k] = Math.round(v);
  }
  const f = r.features as Partial<Features> | undefined;
  if (f && typeof f === 'object') for (const k of FEATURE_IDS) if (typeof f[k] === 'boolean') s.features[k] = f[k];
  if (r.highlights !== undefined) s.highlights = normaliseHighlights(r.highlights);
  if (r.waterfallContrast === 'low' || r.waterfallContrast === 'normal' || r.waterfallContrast === 'high') s.waterfallContrast = r.waterfallContrast;
  s.wspr = validateWspr(r.wspr);
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
