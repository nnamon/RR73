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

describe('the radio status', () => {
  it('goes to Wavelog on a change and again after 2 minutes, and not while off', async () => {
    const { sendRadioStatus, RADIO_STATUS_REPEAT_MS, setFetch } = await import('./log.svelte');
    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setFetch(async (url, init) => {
      posts.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response('{"status":"success"}', { status: 200 });
    });
    log.wavelog = { ...log.wavelog, enabled: true, url: 'https://wavelog.example.test', apiKey: 'KEY', stationId: '1' };
    expect(sendRadioStatus(false, 14_074_000, 'FT8', 0)).toBe(false);
    expect(sendRadioStatus(true, 14_074_000, 'FT8', 0)).toBe(true);
    // The same dial and mode within 2 minutes: nothing; a change, or 2 minutes on: again.
    expect(sendRadioStatus(true, 14_074_000, 'FT8', 1000)).toBe(false);
    expect(sendRadioStatus(true, 7_074_000, 'FT8', 2000)).toBe(true);
    expect(sendRadioStatus(true, 7_074_000, 'FT8', 2000 + RADIO_STATUS_REPEAT_MS)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(posts[0]).toEqual({ url: 'https://wavelog.example.test/api/radio', body: { key: 'KEY', radio: 'RR73', frequency: 14_074_000, mode: 'FT8' } });
    expect(posts).toHaveLength(3);
    setFetch(null);
  });
});
