// The practice log beside the log, in Node on fake-indexeddb: QSOs logged in practice stay in
// their own database, Send to Wavelog goes to the stand-in, and the log and its Wavelog are
// untouched when practice ends. No request reaches the page's fetch.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../state/db';
import { settings } from '../state/settings.svelte';
import { addQso, loadLog, log, sendToWavelog, setFetch, setWavelog, useLog } from '../log/log.svelte';
import { PRACTICE_DB, countPracticeQsos, restorePracticeRecords, takePracticeRecords } from '../log/store';
import type { LogQsoRecord } from '../log/types';
import { openRr73 } from '../state/db';
import { STAND_IN_URL, refusesFirst, standInConfig, wavelogStandIn } from './wavelog-stand-in';
import { testConnection } from '../log/wavelog';

const T = Date.UTC(2026, 9, 13, 13, 14, 0);
const record = (call: string, i: number): LogQsoRecord => ({ call, grid: 'FN42', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: T + i * 60_000, endUtcMs: T + i * 60_000 + 45_000, reportSent: -12, reportRcvd: -10 });
// A callsign the stand-in delivers at once, and one it refuses the first time.
const DELIVERED = ['K1ABC', 'K1ABD', 'K1ABE', 'K1ABF'].find((c) => !refusesFirst(c))!;
const REFUSED = Array.from({ length: 40 }, (_, i) => `JA1A${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`).find(refusesFirst)!;

const pageFetch = vi.fn(async () => new Response('', { status: 500 }));
const standIn = wavelogStandIn(() => ({ callsign: '9V1NE', grid: 'OJ11' }));

async function realQsoCalls(): Promise<string[]> {
  return (await (await db()).getAll('qsos')).map((q) => q.call);
}

beforeAll(async () => {
  vi.stubGlobal('fetch', pageFetch);
  settings.callsign = '9V1NE';
  settings.grid = 'OJ11';
  await loadLog();
  await addQso(record('VK2ESN', 0));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('the practice log', () => {
  it('opens empty, with the Wavelog stand-in ready', async () => {
    setFetch(standIn.fetch);
    await useLog(true);
    expect(log.live).toEqual([]);
    await setWavelog(standInConfig('9V1NE', 'OJ11'));
    expect(log.wavelog.url).toBe(STAND_IN_URL);
    const test = await testConnection({ url: log.wavelog.url, apiKey: log.wavelog.apiKey, stationId: log.wavelog.stationId }, standIn.fetch, T);
    expect(test.ok).toBe(true);
  });

  it('keeps practice QSOs out of the log', async () => {
    await addQso(record(DELIVERED, 1));
    await addQso(record(REFUSED, 2));
    expect(log.live.map((q) => q.call).sort()).toEqual([DELIVERED, REFUSED].sort());
    expect(await realQsoCalls()).toEqual(['VK2ESN']);
    expect(await countPracticeQsos()).toBe(2);
  });

  it('sends to the stand-in, which delivers most QSOs and refuses some as Wavelog does', async () => {
    const summary = await sendToWavelog();
    expect(summary).toMatchObject({ delivered: 1, refused: 1 });
    const refused = log.ledger.find((e) => e.destinationId === 'wavelog' && log.live.find((q) => q.id === e.qsoId)?.call === REFUSED);
    expect(refused?.state).toBe('refused');
    expect(refused?.lastError).toBe('Wavelog refused the QSO: 20m is not in its band list. Add the band in Wavelog, then send the QSO again.');
    // Sent again, it goes through.
    expect(await sendToWavelog([refused!.qsoId])).toMatchObject({ delivered: 1, refused: 0 });
    expect(standIn.requests.filter((r) => r.path === '/api/qso')).toHaveLength(3);
    expect(pageFetch).not.toHaveBeenCalled();
  });

  it('gives back the log and its Wavelog settings when practice ends', async () => {
    setFetch(null);
    await useLog(false);
    expect(log.live.map((q) => q.call)).toEqual(['VK2ESN']);
    expect(log.wavelog.url).toBe('');
    expect(log.ledger.every((e) => e.state !== 'delivered')).toBe(true);
    const practiceDb = await openRr73(PRACTICE_DB);
    expect((await practiceDb.getAll('qsos')).map((q) => q.call).sort()).toEqual([DELIVERED, REFUSED].sort());
    practiceDb.close();
  });

  it('clears in one step and comes back on Undo', async () => {
    const taken = await takePracticeRecords();
    expect(taken.qsos).toHaveLength(2);
    expect(await countPracticeQsos()).toBe(0);
    await restorePracticeRecords(taken);
    expect(await countPracticeQsos()).toBe(2);
    await useLog(true);
    expect(log.live).toHaveLength(2);
    expect(log.wavelog.url).toBe(STAND_IN_URL);
    await useLog(false);
    expect(await realQsoCalls()).toEqual(['VK2ESN']);
  });
});
