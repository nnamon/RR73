import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BATCH, KEEP, PskQueue, SEND_EVERY_MS } from './queue';
import type { PskSpot } from './spots';

const spot = (callsign: string, frequencyHz = 14_075_000): PskSpot => ({ callsign, locator: '', frequencyHz, snrDb: -10, mode: 'FT8', time: 1_792_000_013 });
const SLOT = 1_792_000_000_000;

function setup(answer: () => Promise<{ taken: number; repeats: number; rejected: number }> = async () => ({ taken: 1, repeats: 0, rejected: 0 })) {
  const sent: PskSpot[][] = [];
  const events = { ok: 0, failed: 0 };
  const q = new PskQueue(
    (s) => {
      sent.push(s);
      return answer();
    },
    { sent: () => events.ok++, failed: () => events.failed++ },
    () => Date.now(),
  );
  return { q, sent, events };
}

beforeEach(() => vi.useFakeTimers({ now: Date.UTC(2026, 9, 15, 1, 0, 0) }));
afterEach(() => vi.useRealTimers());

describe('the PSK Reporter queue', () => {
  it('sends the first spots at once, then at most once a minute', async () => {
    const { q, sent } = setup();
    q.add([spot('K1ABC')], SLOT);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((b) => b.map((s) => s.callsign))).toEqual([['K1ABC']]);
    q.add([spot('JA1XYZ')], SLOT + 15_000);
    await vi.advanceTimersByTimeAsync(SEND_EVERY_MS - 1);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent.map((b) => b.map((s) => s.callsign))).toEqual([['K1ABC'], ['JA1XYZ']]);
    expect(q.waiting).toBe(0);
  });

  it('takes each station once per band and slot', async () => {
    const { q, sent } = setup();
    q.add([spot('K1ABC'), spot('K1ABC')], SLOT);
    q.add([spot('K1ABC')], SLOT);
    q.add([spot('K1ABC')], SLOT + 15_000);
    q.add([spot('K1ABC', 7_075_000)], SLOT);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent[0].map((s) => s.frequencyHz)).toEqual([14_075_000, 14_075_000, 7_075_000]);
  });

  it('keeps what the relay did not take and tries again a minute later', async () => {
    let fail = true;
    const { q, sent, events } = setup(async () => {
      if (fail) throw new Error('offline');
      return { taken: 2, repeats: 0, rejected: 0 };
    });
    q.add([spot('K1ABC'), spot('JA1XYZ')], SLOT);
    await vi.advanceTimersByTimeAsync(0);
    expect([events.failed, q.waiting]).toEqual([1, 2]);
    fail = false;
    await vi.advanceTimersByTimeAsync(SEND_EVERY_MS);
    expect([events.ok, q.waiting, sent.length]).toEqual([1, 0, 2]);
  });

  it('sends 500 spots a request and keeps 1000 at most', async () => {
    const { q, sent } = setup(async () => {
      throw new Error('offline');
    });
    q.add(Array.from({ length: 1200 }, (_, i) => spot(`K${i}AA`)), SLOT);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent[0]).toHaveLength(BATCH);
    expect(q.waiting).toBe(KEEP);
    expect(sent[0][0].callsign).toBe('K200AA');
    q.clear();
    expect(q.waiting).toBe(0);
  });
});
