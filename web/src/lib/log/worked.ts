/**
 * The log's index of calls and grids, for decode colours: built once each time the log changes,
 * so each decode row looks up its station in O(1).
 *
 * Calls are keyed by the base callsign (VK3/9V1NE/P gives 9V1NE), so a station worked portable
 * counts as worked. Grids are keyed by their first 4 characters, upper case. Bands are lower case
 * ("20m"); modes are FT8 or FT4 (FT4 is stored as MODE MFSK with SUBMODE FT4).
 *
 * DXCC entities, continents and CQ and ITU zones come from the country file, by the whole call as
 * logged: a QSO with VK3/9V1NE counts for Australia. Without the country file they stay empty and
 * `place` answers null, so nothing counts as new.
 */

import { baseCall } from '../decode/marking';
import type { DxccIndex } from '../reference/dxcc';
import type { Qso } from './types';

export type PlaceKind = 'dxcc' | 'continent' | 'cqZone' | 'ituZone';

/** Where a callsign is, as the index keys it: the DXCC entity code ("248"), continent ("EU"), CQ and ITU zones ("15", "28"). */
export type Place = Record<PlaceKind, string>;

const PLACE_KINDS: readonly PlaceKind[] = ['dxcc', 'continent', 'cqZone', 'ituZone'];

/** The places of one kind in the log, on any band and per band. */
export interface PlaceSets {
  all: ReadonlySet<string>;
  byBand: ReadonlyMap<string, ReadonlySet<string>>;
}

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
  /** DXCC entities, continents and zones in the log. */
  places: Readonly<Record<PlaceKind, PlaceSets>>;
  /** Where a callsign is, from the country file the index was built with; null without one, or for a call it cannot place. */
  place(call: string): Place | null;
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

/** Places already looked up, per country file: the log is indexed again on every change. */
const PLACES = new WeakMap<DxccIndex, Map<string, Place | null>>();

function placer(countries: DxccIndex | null | undefined): (call: string) => Place | null {
  if (!countries) return () => null;
  let seen = PLACES.get(countries);
  if (!seen) PLACES.set(countries, (seen = new Map()));
  const cache = seen;
  return (call) => {
    const key = call.trim().toUpperCase();
    let p = cache.get(key);
    if (p === undefined) {
      const r = countries.lookup(key);
      p = r.found ? { dxcc: r.dxcc === null ? r.dxccEntity : String(r.dxcc), continent: r.continent, cqZone: String(r.cqZone), ituZone: String(r.ituZone) } : null;
      cache.set(key, p);
    }
    return p;
  };
}


/** Indexes the QSOs that are not deleted; `countries` places them for the DXCC, continent and zone sets. */
export function buildLogIndex(qsos: readonly IndexedQso[], countries?: DxccIndex | null): LogIndex {
  const calls = new Set<string>();
  const grids = new Set<string>();
  const callsByBand = new Map<string, Set<string>>();
  const gridsByBand = new Map<string, Set<string>>();
  const callsByBandMode = new Map<string, Set<string>>();
  const place = placer(countries);
  const places = Object.fromEntries(PLACE_KINDS.map((k) => [k, { all: new Set<string>(), byBand: new Map<string, Set<string>>() }])) as Record<PlaceKind, { all: Set<string>; byBand: Map<string, Set<string>> }>;
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
    const p = call ? place(q.call) : null;
    if (p) {
      for (const k of PLACE_KINDS) {
        places[k].all.add(p[k]);
        add(places[k].byBand, band, p[k]);
      }
    }
  }
  return { calls, grids, callsByBand, gridsByBand, callsByBandMode, places, place };
}

/** True when the log has no QSO in `place`'s entity, continent or zone (`kind`), on `band` when given. False for no place. */
export function isNewPlace(index: LogIndex, place: Place | null, kind: PlaceKind, band?: string): boolean {
  if (!place) return false;
  const sets = index.places[kind];
  return !(band === undefined ? sets.all : setOf(sets.byBand, band.toLowerCase())).has(place[kind]);
}

/** The set for `key`, or an empty one. */
export function setOf(map: ReadonlyMap<string, ReadonlySet<string>>, key: string): ReadonlySet<string> {
  return map.get(key) ?? NONE;
}

export const EMPTY_LOG_INDEX: LogIndex = buildLogIndex([]);
