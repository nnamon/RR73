// What the log says about spots: stations worked today, references not hunted before, and the
// operator's bands, for the badges and the New only and My bands chips.

import { theirRefs } from '../log/qso';
import type { Qso } from '../log/types';
import { baseCall } from './normalise';
import type { Programme, Spot, SpotBadge } from './types';

/** The log read once, for every row. */
export interface SpotLog {
  /** References in QSOs, as "POTA K-0817". */
  refs: ReadonlySet<string>;
  /** Base callsigns of every QSO. */
  calls: ReadonlySet<string>;
  /** "K1ABC 20m" for each station worked on a band on the UTC day of `nowMs`. */
  today: ReadonlySet<string>;
  /** Bands with QSOs, as ADIF names, and the band chosen now, in the order first met. */
  bands: readonly string[];
}

const DAY_MS = 86_400_000;

/** What `qsos` (not deleted) say about spots at `nowMs`, with `band` the band chosen now. */
export function spotLog(qsos: readonly Qso[], nowMs: number, band: string | null = null): SpotLog {
  const day = Math.floor(nowMs / DAY_MS);
  const refs = new Set<string>();
  const calls = new Set<string>();
  const today = new Set<string>();
  const bands = new Set<string>(band ? [band] : []);
  for (const q of qsos) {
    if (q.deletedAt !== null) continue;
    const call = baseCall(q.call);
    calls.add(call);
    bands.add(q.band);
    if (Math.floor(q.start / DAY_MS) === day) today.add(`${call} ${q.band}`);
    for (const r of theirRefs(q)) refs.add(`${r.programme} ${r.ref}`);
  }
  return { refs, calls, today, bands: [...bands] };
}

/** True when the station was worked on the spot's band today, UTC. */
export function workedToday(s: Spot, log: SpotLog): boolean {
  return s.band !== null && log.today.has(`${baseCall(s.activator)} ${s.band}`);
}

/** The first reference of the spot that no QSO names, or null. */
function newRef(s: Spot, log: SpotLog): Programme | null {
  return s.refs.find((r) => !log.refs.has(`${r.programme} ${r.ref}`))?.programme ?? null;
}

/** A spot not worked before: a reference no QSO names, or, for a DX spot, a callsign never worked. */
export function isNewSpot(s: Spot, log: SpotLog): boolean {
  if (s.refs.length) return newRef(s, log) !== null;
  return !log.calls.has(baseCall(s.activator));
}

const NEW: Record<Programme, string> = { POTA: 'New park', SOTA: 'New summit', WWFF: 'New WWFF', IOTA: 'New IOTA' };

/**
 * Worked today in grey, else New park, New summit, New WWFF or New IOTA in teal; null for the
 * rest, and for a station gone QRT, which the list tags QRT.
 */
export function spotBadge(s: Spot, log: SpotLog): SpotBadge | null {
  if (s.qrt) return null;
  if (workedToday(s, log)) return { text: 'Worked today', tone: 'muted' };
  const p = newRef(s, log);
  return p ? { text: NEW[p], tone: 'teal' } : null;
}
