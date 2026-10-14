// What the transmit panel says about the station in a keyboard mode's QSO, as FT8's station
// details do: country, grid, distance and bearing, and the QSOs with it before.

import { utcHm } from '../clock/format';
import { displayMode } from '../log/qso';
import type { Qso } from '../log/types';
import { sameCall } from '../qso/messages';
import type { DxccIndex } from '../reference';
import { gridPath } from '../reference/grid';
import { displayName } from '../reference/names';

export interface StationFacts {
  /** "Japan · PM95 · 5,321 km · 35°", or what is known of it. */
  where: string;
  /** "20m RTTY at 09:14, 40m FT8 on 2026-10-12", or "Not yet". */
  before: string;
}

/**
 * Facts for `call` with their `grid` ('' when not received), from `myGrid`, the country file
 * (null before it loads) and the log (newest first), at `nowMs`. The 3 latest QSOs show.
 */
export function stationFacts(call: string, grid: string, myGrid: string, countries: DxccIndex | null, qsos: readonly Qso[], nowMs: number): StationFacts {
  const r = countries?.lookup(call);
  const country = r?.found ? displayName(r.dxccEntity) : null;
  const path = grid && myGrid ? gridPath(myGrid, grid) : null;
  const parts = [country, grid || null, path ? `${Math.round(path.km).toLocaleString('en-GB')} km` : null, path ? `${Math.round(path.bearingDeg)}°` : null];
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const when = (ms: number) => {
    const day = new Date(ms).toISOString().slice(0, 10);
    return day === today ? `at ${utcHm(ms)}` : `on ${day}`;
  };
  const seen = qsos.filter((q) => q.deletedAt === null && sameCall(q.call, call)).slice(0, 3);
  return {
    where: parts.filter(Boolean).join(' · ') || 'Country not known',
    before: seen.length ? seen.map((q) => `${q.band} ${displayMode(q)} ${when(q.start)}`).join(', ') : 'Not yet',
  };
}
