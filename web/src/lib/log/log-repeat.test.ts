// A QSO logged again within REPEAT_QSO_MS, as when RR73 went again to a station that missed it,
// updates the QSO logged before instead of adding another.
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { settings } from '../state/settings.svelte';
import { loadLog, log, logQso } from './log.svelte';
import type { LogQsoRecord } from './types';

const T = Date.now();
const RECORD: LogQsoRecord = { call: 'VK2ESN', grid: 'QF56', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: T - 60_000, endUtcMs: T, reportSent: -12, reportRcvd: -10 };

beforeAll(async () => {
  settings.callsign = '9V1NE';
  await loadLog();
});

describe('a QSO logged again', () => {
  it('within 10 minutes updates the QSO logged before; another band or later is a QSO of its own', async () => {
    const first = await logQso(RECORD);
    const again = await logQso({ ...RECORD, startUtcMs: T + 15_000, endUtcMs: T + 30_000 });
    expect(again.id).toBe(first.id);
    expect(log.live).toHaveLength(1);
    expect(log.live[0].end).toBe(T + 30_000);
    expect(log.notice).toMatchObject({ text: 'VK2ESN already logged' });
    await logQso({ ...RECORD, band: '40m', dialHz: 7_074_000 });
    await logQso({ ...RECORD, startUtcMs: T + 15 * 60_000, endUtcMs: T + 16 * 60_000 });
    expect(log.live).toHaveLength(3);
    // A QSO added by hand is always its own.
    await logQso({ ...RECORD, source: 'manual', startUtcMs: T + 20_000, endUtcMs: T + 40_000 });
    expect(log.live).toHaveLength(4);
  });
});
