/**
 * The log's index of calls and grids, for decode colours: built once each time the log changes,
 * so each decode row looks up its station in O(1).
 *
 * Calls are keyed by the base callsign (VK3/9V1NE/P gives 9V1NE), so a station worked portable
 * counts as worked. Grids are keyed by their first 4 characters, upper case. Bands are lower case
 * ("20m"); modes are FT8 or FT4 (FT4 is stored as MODE MFSK with SUBMODE FT4).
 */

import { baseCall } from '../decode/marking';
import type { Qso } from './types';

export interface LogIndex {
  /** Every call in the log, on any band and mode. */
  calls: ReadonlySet<string>;
  /** Every 4-character grid in the log. */
  grids: ReadonlySet<string>;
  /** Calls per band. */
  callsByBand: ReadonlyMap<string, ReadonlySet<string>>;
  /** Grids per band. */
  gridsByBand: ReadonlyMap<string, ReadonlySet<string>>;
  /** Calls per band and mode, keyed by bandModeKey. */
  callsByBandMode: ReadonlyMap<string, ReadonlySet<string>>;
}

export type IndexedQso = Pick<Qso, 'call' | 'gridsquare' | 'band' | 'mode' | 'submode'>;

const NONE: ReadonlySet<string> = new Set();

/** The key for calls on one band and mode: "20m FT8". */
export function bandModeKey(band: string, mode: string): string {
  return `${band.toLowerCase()} ${mode.toUpperCase()}`;
}

/** The base callsign used as the index key: "vk3/9v1ne/p" gives "9V1NE". */
export function callKey(call: string): string {
  return baseCall(call.trim().toUpperCase());
}

/** The 4-character grid used as the index key, or '' when `grid` is not a grid. */
export function gridKey(grid: string): string {
  const g = grid.trim().slice(0, 4).toUpperCase();
  return /^[A-R]{2}\d{2}$/.test(g) ? g : '';
}

function add(map: Map<string, Set<string>>, key: string, value: string) {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(value);
}

/** Indexes the QSOs that are not deleted. */
export function buildLogIndex(qsos: readonly IndexedQso[]): LogIndex {
  const calls = new Set<string>();
  const grids = new Set<string>();
  const callsByBand = new Map<string, Set<string>>();
  const gridsByBand = new Map<string, Set<string>>();
  const callsByBandMode = new Map<string, Set<string>>();
  for (const q of qsos) {
    const band = q.band.toLowerCase();
    const call = callKey(q.call);
    if (call) {
      calls.add(call);
      add(callsByBand, band, call);
      add(callsByBandMode, bandModeKey(band, q.submode || q.mode), call);
    }
    const grid = gridKey(q.gridsquare);
    if (grid) {
      grids.add(grid);
      add(gridsByBand, band, grid);
    }
  }
  return { calls, grids, callsByBand, gridsByBand, callsByBandMode };
}

/** The set for `key`, or an empty one. */
export function setOf(map: ReadonlyMap<string, ReadonlySet<string>>, key: string): ReadonlySet<string> {
  return map.get(key) ?? NONE;
}

export const EMPTY_LOG_INDEX: LogIndex = buildLogIndex([]);
