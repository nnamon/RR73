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
  /** Receive and transmit audio frequencies, Hz. */
  rxHz: number;
  txHz: number;
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
