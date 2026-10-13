// Settings, kept in IndexedDB. Loaded once at start; every change is written at once.

import { getKv, mergeKv, peekKv } from './db';
import { isBand, type BandId } from '../radio/bands';
import type { Mode } from '../clock/slots';

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
  features: Features;
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
  features: { ...FEATURES_OFF },
};

const KEY = 'settings';

/**
 * The stored record's format, kept in it as `schema`:
 *
 * 1. 0.5.0 and earlier, with no `schema` field and no optional features.
 * 2. Optional features. Every feature starts off, including activations, which 0.5.0 always showed.
 */
export const SETTINGS_SCHEMA = 2;

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
  const f = r.features as Partial<Features> | undefined;
  if (f && typeof f === 'object') for (const k of FEATURE_IDS) if (typeof f[k] === 'boolean') s.features[k] = f[k];
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
