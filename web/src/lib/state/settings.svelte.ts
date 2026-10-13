// Settings, kept in IndexedDB. Loaded once at start; every change is written at once.

import { getKv, setKv } from './db';
import { isBand, type BandId } from '../radio/bands';
import type { Mode } from '../clock/slots';

export type Theme = 'system' | 'light' | 'dark';

/** The VOX checklist items the operator ticks; RR73 cannot read these phone settings. */
export interface Checklist {
  focus: boolean;
  clicks: boolean;
  volume: boolean;
}

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
};

const KEY = 'settings';

export const settings = $state<Settings>(structuredClone(DEFAULTS));

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

/** Merges stored values over the defaults, keeping only values of the right type. */
export function validate(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = structuredClone(DEFAULTS);
  if (typeof r.callsign === 'string') s.callsign = normaliseCallsign(r.callsign);
  if (r.theme === 'light' || r.theme === 'dark' || r.theme === 'system') s.theme = r.theme;
  if (isBand(r.band)) s.band = r.band;
  if (r.mode === 'FT8' || r.mode === 'FT4') s.mode = r.mode;
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
  for (const k of ['rxHz', 'txHz'] as const) {
    const v = r[k];
    if (typeof v === 'number' && v >= 100 && v <= 2900) s[k] = Math.round(v);
  }
  return s;
}

export async function loadSettings(): Promise<void> {
  try {
    Object.assign(settings, validate(await getKv(KEY)));
  } catch {
    // No IndexedDB (a private window): the defaults stay and changes last until the page closes.
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  Object.assign(settings, patch);
  try {
    await setKv(KEY, $state.snapshot(settings));
  } catch {
    // As in loadSettings.
  }
}
