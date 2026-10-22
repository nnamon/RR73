// The Worked stations and New ones QSOs, on fake IndexedDB: they go into the practice database
// only, whichever log is in use, and a second seeding adds nothing.
import { describe, expect, it } from 'vitest';
import { db, openRr73 } from '../state/db';
import { settings } from '../state/settings.svelte';
import { addQso, loadLog, log, useLog } from '../log/log.svelte';
import { PRACTICE_DB } from '../log/store';
import { PracticeBand } from './sim';
import { seedPracticeLog, seedRecords } from './seed-log';

const NOW = Date.UTC(2026, 9, 22, 9, 30, 0);
const DAY = 86_400_000;
const ctx = { nowMs: NOW, band: '20m' as const, mode: 'FT8' as const, myCall: '9V1NE', myGrid: 'OJ11', scenario: 'Worked stations' };
const band = new PracticeBand({ seed: 3, scenario: 'worked', crowded: false, myCall: '9V1NE', myGrid: 'OJ11', mode: 'FT8' });

describe('seeding the practice log', () => {
  it("puts today's QSOs in today and the others on their day, band and mode", () => {
    const seeds = band.logSeed();
    const r = seedRecords(seeds, ctx);
    const today = Date.UTC(2026, 9, 22);
    for (const [i, q] of seeds.entries()) {
      expect(r[i].call).toBe(q.call);
      expect(r[i].band).toBe(q.sameBand ? '20m' : '40m');
      expect(r[i].mode).toBe(q.sameMode ? 'FT8' : 'FT4');
      const day = Math.floor(r[i].endUtcMs / DAY) * DAY;
      expect(day).toBe(today - q.daysAgo * DAY);
      expect(r[i].endUtcMs).toBeLessThanOrEqual(NOW);
      expect(r[i].comment).toBe('Practice: Worked stations');
    }
    // Shortly after 00:00 UTC, today's QSOs stay in today.
    const early = seedRecords(seeds, { ...ctx, nowMs: today + 5 * 60_000 });
    for (const [i, q] of seeds.entries()) if (q.daysAgo === 0) expect(early[i].startUtcMs).toBeGreaterThanOrEqual(today);
    expect(seedRecords(seeds, { ...ctx, band: '40m' }).find((x, i) => !seeds[i].sameBand)!.band).toBe('20m');
  });

  it('writes to the practice database only, even with the log in use, and only once', async () => {
    settings.callsign = '9V1NE';
    await loadLog();
    await addQso({ call: 'VK2ESN', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: NOW - 60_000, endUtcMs: NOW, reportSent: -1, reportRcvd: -2 });
    expect(log.practice).toBe(false);
    expect(await seedPracticeLog(band.logSeed(), ctx)).toBe(6);
    expect(await seedPracticeLog(band.logSeed(), ctx)).toBe(0);
    expect((await (await db()).getAll('qsos')).map((q) => q.call)).toEqual(['VK2ESN']);
    const practice = await openRr73(PRACTICE_DB);
    expect((await practice.getAll('qsos')).map((q) => q.call).sort()).toEqual(band.logSeed().map((q) => q.call).sort());
    practice.close();
    await useLog(true);
    expect(log.live).toHaveLength(6);
    await useLog(false);
  });
});
