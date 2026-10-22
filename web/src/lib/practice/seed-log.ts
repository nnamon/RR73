/**
 * The practice log's QSOs for the Worked stations and New ones scenarios (sim.ts, logSeed). They
 * go straight into the practice database, whichever log is in use when the write lands, so the
 * operator's log is never touched. A QSO already there (same callsign, band, mode and UTC day)
 * is not added again.
 */

import type { FtMode } from '../clock/slots';
import { utcDayStart } from '../log/activation';
import { createQso, newId } from '../log/qso';
import { practiceQsos, restorePracticeRecords } from '../log/store';
import type { LogQsoRecord, Qso } from '../log/types';
import { dialHz, type BandId } from '../radio/bands';
import type { SeedQso } from './sim';

const DAY_MS = 86_400_000;

export interface SeedContext {
  nowMs: number;
  band: BandId;
  mode: FtMode;
  myCall: string;
  myGrid: string;
  /** The scenario's name, for the QSO's comment. */
  scenario: string;
}

/** Another band for the QSOs worked elsewhere: 40m, or 20m when on 40m. */
export function otherBand(band: BandId): BandId {
  return band === '40m' ? '20m' : '40m';
}

/**
 * The log records for `seeds`: today's QSOs from 20 minutes ago back, 7 minutes apart (never
 * before 00:00 UTC), earlier days' at 12:00 UTC on their day.
 */
export function seedRecords(seeds: readonly SeedQso[], c: SeedContext): LogQsoRecord[] {
  const today = utcDayStart(c.nowMs);
  return seeds.map((q, i) => {
    const band = q.sameBand ? c.band : otherBand(c.band);
    const mode: FtMode = q.sameMode ? c.mode : c.mode === 'FT8' ? 'FT4' : 'FT8';
    const end = q.daysAgo === 0 ? Math.max(today + 60_000 * (i + 2), c.nowMs - (20 + 7 * i) * 60_000) : today - q.daysAgo * DAY_MS + 12 * 3_600_000 + i * 60_000;
    return {
      call: q.call,
      grid: q.grid,
      mode,
      band,
      dialHz: dialHz(band, mode) ?? dialHz(band, 'FT8') ?? 0,
      audioHz: 1500,
      startUtcMs: end - 60_000,
      endUtcMs: end,
      reportSent: -10,
      reportRcvd: -12,
      source: 'manual',
      activationId: null,
      comment: `Practice: ${c.scenario}`,
      stationCallsign: c.myCall,
      myGridsquare: c.myGrid,
    };
  });
}

const sameDay = (a: number, b: number) => utcDayStart(a) === utcDayStart(b);

/** Adds the seeds' QSOs to the practice database; returns how many were added. */
export async function seedPracticeLog(seeds: readonly SeedQso[], c: SeedContext): Promise<number> {
  const have = (await practiceQsos()).filter((q) => q.deletedAt === null);
  const add: Qso[] = [];
  for (const r of seedRecords(seeds, c)) {
    const there = have.some((q) => q.call === r.call && q.band === r.band && (q.submode || q.mode) === r.mode && sameDay(q.start, r.startUtcMs));
    if (!there) add.push(createQso(r, { id: newId(), now: c.nowMs, activation: null, callsign: c.myCall }));
  }
  if (add.length) await restorePracticeRecords({ qsos: add, ledger: [], activations: [] });
  return add.length;
}
