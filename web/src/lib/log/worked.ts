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
 *
 * What Wavelog's log holds (wavelog-worked.ts) is indexed by the same rules from its keys
 * (buildKeysIndex) and laid over the phone's log (mergeLogIndex) for decode colours only.
 */

import { baseCall } from '../decode/marking';
import { bandEdges } from './bandplan';
import type { DxccIndex } from '../reference/dxcc';
import type { Qso } from './types';

export type PlaceKind = 'dxcc' | 'continent' | 'cqZone' | 'ituZone';

/** Where a callsign is, as the index keys it: the DXCC entity code ("248"), continent ("EU"), CQ and ITU zones ("15", "28"). */
export type Place = Record<PlaceKind, string>;

const PLACE_KINDS: readonly PlaceKind[] = ['dxcc', 'continent', 'cqZone', 'ituZone'];

/** A set of index keys: a Set, or two laid over each other (mergeLogIndex). */
export interface KeySet extends Iterable<string> {
  has(key: string): boolean;
}

/** The places of one kind in the log, on any band and per band. */
export interface PlaceSets {
  all: KeySet;
  byBand: ReadonlyMap<string, KeySet>;
}

export interface LogIndex {
  /** Every call in the log, on any band and mode. */
  calls: KeySet;
  /** Every 4-character grid in the log. */
  grids: KeySet;
  /** Calls per band. */
  callsByBand: ReadonlyMap<string, KeySet>;
  /** Grids per band. */
  gridsByBand: ReadonlyMap<string, KeySet>;
  /** Calls per band and mode, keyed by bandModeKey. */
  callsByBandMode: ReadonlyMap<string, KeySet>;
  /** DXCC entities, continents and zones in the log. */
  places: Readonly<Record<PlaceKind, PlaceSets>>;
  /** Where a callsign is, from the country file the index was built with; null without one, or for a call it cannot place. */
  place(call: string): Place | null;
}

export type IndexedQso = Pick<Qso, 'call' | 'gridsquare' | 'band' | 'mode' | 'submode'>;

const NONE: KeySet = new Set<string>();

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
export function setOf(map: ReadonlyMap<string, KeySet>, key: string): KeySet {
  return map.get(key) ?? NONE;
}

export const EMPTY_LOG_INDEX: LogIndex = buildLogIndex([]);

/** What `a` or `b` holds, looked up in both: nothing is copied, so laying a large set over a small one costs nothing. */
class Union implements KeySet {
  constructor(
    private readonly a: KeySet,
    private readonly b: KeySet,
  ) {}

  has(key: string): boolean {
    return this.a.has(key) || this.b.has(key);
  }

  *[Symbol.iterator](): Iterator<string> {
    yield* this.a;
    for (const k of this.b) if (!this.a.has(k)) yield k;
  }
}

function unionMap(a: ReadonlyMap<string, KeySet>, b: ReadonlyMap<string, KeySet>): ReadonlyMap<string, KeySet> {
  const out = new Map<string, KeySet>(a);
  for (const [k, set] of b) {
    const mine = a.get(k);
    out.set(k, mine ? new Union(mine, set) : set);
  }
  return out;
}

/**
 * The phone's log with another index laid over it, such as what Wavelog's log holds: a call,
 * grid or place in either counts. `place` is the log's. With no other index the log's comes back.
 */
export function mergeLogIndex(log: LogIndex, other: LogIndex | null): LogIndex {
  if (!other) return log;
  const places = {} as Record<PlaceKind, PlaceSets>;
  for (const k of PLACE_KINDS) places[k] = { all: new Union(log.places[k].all, other.places[k].all), byBand: unionMap(log.places[k].byBand, other.places[k].byBand) };
  return {
    calls: new Union(log.calls, other.calls),
    grids: new Union(log.grids, other.grids),
    callsByBand: unionMap(log.callsByBand, other.callsByBand),
    gridsByBand: unionMap(log.gridsByBand, other.gridsByBand),
    callsByBandMode: unionMap(log.callsByBandMode, other.callsByBandMode),
    places,
    place: log.place,
  };
}

/**
 * Worked keys, the compact form of a log kept for decode colours: "CALL band MODE" for each call
 * as logged on a band and mode, and "GRID band" for each 4-character grid on a band. The call is
 * kept whole (VK3/9V1NE) so the country file can place it.
 */
export interface WorkedKeys {
  calls: ReadonlySet<string>;
  grids: ReadonlySet<string>;
}

/**
 * One QSO's call key in worked keys, by the log's rules: the whole call in upper case, the band in
 * lower case, and the submode, else the mode (MFSK with SUBMODE FT4 gives FT4). '' for a call with
 * no base callsign.
 */
export function workedCallKey(call: string, band: string, mode: string, submode: string): string {
  const c = call.trim().toUpperCase().replace(/\s+/g, '');
  if (!callKey(c)) return '';
  return `${c} ${band.trim().toLowerCase().replace(/\s+/g, '')} ${(submode.trim() || mode.trim()).toUpperCase().replace(/\s+/g, '')}`;
}

/** The grid key for a QSO: "OJ02 20m", or '' without a grid. */
export function workedGridKey(grid: string, band: string): string {
  const g = gridKey(grid);
  return g ? `${g} ${band.trim().toLowerCase().replace(/\s+/g, '')}` : '';
}

/** Indexes worked keys by the same rules as the log's QSOs. */
export function buildKeysIndex(keys: WorkedKeys, countries?: DxccIndex | null): LogIndex {
  const rows: IndexedQso[] = [];
  for (const k of keys.calls) {
    const [call = '', band = '', mode = ''] = k.split(' ');
    rows.push({ call, band, mode, submode: '', gridsquare: '' });
  }
  for (const k of keys.grids) {
    const [grid = '', band = ''] = k.split(' ');
    rows.push({ call: '', band, mode: '', submode: '', gridsquare: grid });
  }
  return buildLogIndex(rows, countries);
}

/** The bands and modes `call` (by its base callsign) has in worked keys, as "20m FT8", lowest band first. */
export function bandModesOf(keys: WorkedKeys, call: string): string[] {
  const want = callKey(call);
  if (!want) return [];
  const out = new Set<string>();
  for (const k of keys.calls) {
    const [c = '', band = '', mode = ''] = k.split(' ');
    if (callKey(c) === want) out.add(`${band} ${mode}`.trim());
  }
  const low = (bm: string) => bandEdges(bm.split(' ')[0])?.[0] ?? Number.MAX_SAFE_INTEGER;
  return [...out].sort((a, b) => low(a) - low(b) || a.localeCompare(b));
}
