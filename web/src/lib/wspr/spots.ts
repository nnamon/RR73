/**
 * WSPR spots: one decode of one slot, as Operate's list shows it. A spot is a reception report
 * with no exchange, so spots never enter the QSO log (docs/design/wspr.md, Spots and logging).
 *
 * Distance and bearing run from the station's grid (6 characters when set) to the centre of the
 * spot's grid, great circle, in km. A Type 2 spot carries no grid: it takes the grid its station
 * sent in a Type 1 or Type 3 message heard earlier, when there is one.
 */

import { gridPath } from '../reference/grid';
import { readMessage, type WsprMessage } from './message';
import { TX_SECONDS } from './schedule';

/** One decode as the WSPR decoder returns it (rr73-wasm decode_wspr). */
export interface WsprDecode {
  text: string;
  /** Signal centre, audio Hz. */
  freq_hz: number;
  /** From the nominal start, 1 s into the slot, s. */
  dt_s: number;
  /** Linear drift, Hz/s. */
  drift_hz_per_s: number;
  /** dB in 2500 Hz. */
  snr_db: number;
}

export interface Spot extends WsprMessage {
  /** Unique in the list: slot start and text. */
  id: string;
  /** Slot start, UTC ms. */
  slotStartMs: number;
  text: string;
  snrDb: number;
  dtS: number;
  /** Signal centre, audio Hz. */
  audioHz: number;
  /** Signal centre on air, Hz: dial + audio. */
  freqHz: number;
  /** Frequency change over the transmission, Hz, as wsprd and WSPRnet give it. */
  driftHz: number;
  /** Great-circle distance from the station's grid, km; null without both grids. */
  km: number | null;
  bearingDeg: number | null;
  /** The grid shown came from an earlier message of the station (a Type 2 spot). */
  gridHeard: boolean;
  /** The spot carries the station's own callsign. */
  mine: boolean;
}

/**
 * The decoder's drift in Hz over the transmission. wsprd prints drift as an integer: on four
 * synthetic slots drifting −0.03, −0.01, 0.01 and 0.03 Hz/s it gave −3, −1, 0 and 3, the change
 * over the 110.6 s transmission (−3.3, −1.1, 1.1 and 3.3 Hz).
 */
export function driftHz(hzPerS: number): number {
  return hzPerS * TX_SECONDS;
}

/** Reads the decoder's JSON: entries with a missing or non-finite field are dropped. */
export function parseWsprDecodes(json: string): WsprDecode[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: WsprDecode[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const { text, freq_hz, dt_s, drift_hz_per_s, snr_db } = r;
    if (typeof text !== 'string' || !text.trim()) continue;
    if (![freq_hz, dt_s, drift_hz_per_s, snr_db].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    out.push({ text: text.trim(), freq_hz: freq_hz as number, dt_s: dt_s as number, drift_hz_per_s: drift_hz_per_s as number, snr_db: snr_db as number });
  }
  return out;
}

export interface SpotContext {
  /** The station's grid; distance needs it. */
  myGrid: string;
  myCall: string;
  dialHz: number;
  /** Grids heard from stations earlier, by callsign, for Type 2 spots. */
  grids: ReadonlyMap<string, string>;
}

/** A slot's decodes as spots, in decode order. */
export function toSpots(decodes: readonly WsprDecode[], slotStartMs: number, ctx: SpotContext): Spot[] {
  const me = ctx.myCall.toUpperCase();
  return decodes.map((d) => {
    const m = readMessage(d.text);
    const heard = !m.grid && m.call ? (ctx.grids.get(m.call) ?? null) : null;
    const grid = m.grid ?? heard;
    const path = grid && ctx.myGrid ? gridPath(ctx.myGrid, grid) : null;
    return {
      ...m,
      grid,
      id: `${slotStartMs}:${d.text}`,
      slotStartMs,
      text: d.text,
      snrDb: d.snr_db,
      dtS: d.dt_s,
      audioHz: d.freq_hz,
      freqHz: ctx.dialHz + d.freq_hz,
      driftHz: driftHz(d.drift_hz_per_s),
      km: path ? path.km : null,
      bearingDeg: path ? path.bearingDeg : null,
      gridHeard: heard !== null,
      mine: !!me && m.call !== null && sameStation(m.call, me),
    };
  });
}

/** True when two callsigns name the same station, prefixes and suffixes aside: "9V1NE/P" and "9V1NE". */
function sameStation(a: string, b: string): boolean {
  const base = (c: string) => c.split('/').reduce((x, y) => (y.length > x.length ? y : x), '');
  return a === b || base(a) === base(b);
}

/** Adds the grids of Type 1 and Type 3 spots to `grids`, by callsign. */
export function learnGrids(spots: readonly Spot[], grids: Map<string, string>) {
  for (const s of spots) if (s.call && s.grid && !s.gridHeard) grids.set(s.call, s.grid);
}

export type SpotSort = 'distance' | 'snr' | 'call';
export const SPOT_SORTS: readonly SpotSort[] = ['distance', 'snr', 'call'];
export const SORT_LABELS: Record<SpotSort, string> = { distance: 'Distance', snr: 'SNR', call: 'Callsign' };

/**
 * Spots in the chosen order: distance farthest first (spots without one last), SNR strongest
 * first, or callsign A to Z. Ties keep the decoder's order.
 */
export function sortSpots(spots: readonly Spot[], sort: SpotSort): Spot[] {
  const by: Record<SpotSort, (a: Spot, b: Spot) => number> = {
    distance: (a, b) => (b.km ?? -1) - (a.km ?? -1),
    snr: (a, b) => b.snrDb - a.snrDb,
    call: (a, b) => (a.call ?? '￿').localeCompare(b.call ?? '￿'),
  };
  return spots
    .map((s, i) => ({ s, i }))
    .sort((a, b) => by[sort](a.s, b.s) || a.i - b.i)
    .map((x) => x.s);
}
