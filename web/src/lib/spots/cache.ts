// The last good spot list of each source, kept on the phone for viewing offline and after a reload.

import { getKv, setKv } from '../state/db';
import { PROGRAMMES, type SourceId, type Spot } from './types';

export interface CachedSource {
  /** When the source last answered, UTC ms. */
  updatedAt: number;
  spots: Spot[];
}

export type CachedSpots = Partial<Record<SourceId, CachedSource>>;

export interface SpotCache {
  load(): Promise<unknown>;
  save(spots: CachedSpots): Promise<void>;
}

const KEY = 'spots';
const SOURCES: readonly SourceId[] = ['pota', 'hamqth', 'sota'];

/** The cache in IndexedDB's key-value store. */
export const kvSpotCache: SpotCache = {
  load: () => getKv<unknown>(KEY),
  save: (spots) => setKv(KEY, spots),
};

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);

function isRef(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (PROGRAMMES as readonly unknown[]).includes(r.programme) && isStr(r.ref) && r.ref !== '' && isStr(r.name);
}

/** True for a stored value with every Spot field of the right type. */
export function isSpot(v: unknown): v is Spot {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    isStr(s.id) &&
    (SOURCES as readonly unknown[]).includes(s.source) &&
    isStr(s.activator) &&
    s.activator !== '' &&
    Array.isArray(s.refs) &&
    s.refs.every(isRef) &&
    isStr(s.country) &&
    isNumOrNull(s.freqHz) &&
    (s.band === null || isStr(s.band)) &&
    isStr(s.mode) &&
    (s.digital === null || s.digital === 'FT8' || s.digital === 'FT4' || s.digital === 'LQ8') &&
    isNum(s.spottedAt) &&
    isStr(s.spotter) &&
    typeof s.automatic === 'boolean' &&
    isNumOrNull(s.snrDb) &&
    typeof s.qrt === 'boolean' &&
    isStr(s.comments)
  );
}

/** A stored cache read back, keeping only well-formed sources and spots. */
export function reviveCache(raw: unknown): CachedSpots {
  const out: CachedSpots = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const id of SOURCES) {
    const c = r[id] as Record<string, unknown> | undefined;
    if (!c || typeof c !== 'object' || !isNum(c.updatedAt) || !Array.isArray(c.spots)) continue;
    out[id] = { updatedAt: c.updatedAt, spots: c.spots.filter((s): s is Spot => isSpot(s) && s.source === id) };
  }
  return out;
}
