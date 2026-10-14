import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { form, mhz, records, dateTime } from './records';
import { JITTER_MS, RETRY_MS, SPACING_MS, WsprnetQueue } from './queue';
import { TX_SECONDS } from '../wspr/schedule';

const reporter = { callsign: 'KA1ABC', grid: 'FN42AB', version: '3.0.2' };
/** 2026-10-14 19:32 UTC. */
const SLOT = Date.UTC(2026, 9, 14, 19, 32);
const DIAL = 14_095_600;
const TX = { pct: 20, frequencyHz: 14_097_123, dbm: 37 };
/** A decode at `hz` on air: the decoder gives audio Hz and drift in Hz/s. */
const decode = (text: string, snr_db: number, dt_s: number, driftHz: number, hz: number) => ({ text, snr_db, dt_s, drift_hz_per_s: driftHz / TX_SECONDS, freq_hz: hz - DIAL });

describe('WSPRnet records', () => {
  it('match the described spot records byte for byte, Type 1 and Type 2', () => {
    expect(dateTime(SLOT)).toEqual(['261014', '1932']);
    expect(records(reporter, SLOT, DIAL, [decode('DU1MGA PK04 37', -21, -0.3, 0, 14_097_090), decode('PJ4/K1ABC 37', -27, 1.2, -2, 14_097_151)], TX)).toEqual([
      'function=wspr&date=261014&time=1932&sig=-21&dt=-0.3&drift=0&tqrg=14.097090&tcall=DU1MGA&tgrid=PK04&dbm=37&version=3.0.2&rcall=KA1ABC&rgrid=FN42AB&rqrg=14.097100&mode=2',
      'function=wspr&date=261014&time=1932&sig=-27&dt=1.2&drift=-2&tqrg=14.097151&tcall=PJ4/K1ABC&tgrid=&dbm=37&version=3.0.2&rcall=KA1ABC&rgrid=FN42AB&rqrg=14.097100&mode=2',
    ]);
  });

  it('match the described status record for a slot without spots', () => {
    expect(records(reporter, SLOT, DIAL, [], TX)).toEqual(['function=wsprstat&rcall=KA1ABC&rgrid=FN42AB&rqrg=14.097100&tpct=20&tqrg=14.097123&dbm=37&version=3.0.2&mode=2']);
  });

  it('send Type 3 without brackets, leave out unresolved hashes and spots beyond 10 kHz, and encode spaces', () => {
    const r = records({ ...reporter, version: 'RR73 0.19.0' }, SLOT, DIAL, [decode('<K1ABC> FN42ab 37', -12, 0.04, 1, 14_097_000), decode('<...> FN42AB 37', -20, 0, 0, 14_097_050), decode('K2ABC FN31 30', -10, 0, 0, 14_107_200)], TX);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('&dt=0.0&drift=1&tqrg=14.097000&tcall=K1ABC&tgrid=FN42AB&dbm=37&version=RR73%200.19.0&');
    // A slot with decodes but nothing to upload sends nothing, as WSJT-X does.
    expect(records(reporter, SLOT, DIAL, [decode('<...> FN42AB 37', -20, 0, 0, 14_097_050)], TX)).toEqual([]);
  });

  it('encode only what form encoding must, keeping /', () => {
    expect(form([['a', 'x&y=z/ü']])).toBe('a=x%26y%3Dz/%C3%BC');
    expect(mhz(7_040_100)).toBe('7.040100');
  });
});

describe('the WSPRnet queue', () => {
  beforeEach(() => vi.useFakeTimers({ now: SLOT + 125_000 }));
  afterEach(() => vi.useRealTimers());

  function setup(post: (body: string) => Promise<void>, random = 0.5) {
    const ev = { sent: [] as string[], failed: [] as [string, boolean][] };
    const q = new WsprnetQueue(post, { sent: (b) => ev.sent.push(b), failed: (b, _e, final) => ev.failed.push([b, final]) }, () => Date.now(), () => random);
    return { q, ev };
  }

  it('sends a slot’s records after the random wait, 200 ms apart', async () => {
    const posted: [string, number][] = [];
    const { q, ev } = setup(async (b) => void posted.push([b, Date.now()]));
    const t0 = Date.now();
    q.addSlot(['a', 'b', 'c']);
    await vi.advanceTimersByTimeAsync(JITTER_MS / 2 - 1);
    expect(posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1 + 2 * SPACING_MS);
    expect(posted.map(([b, t]) => [b, t - t0])).toEqual([
      ['a', JITTER_MS / 2],
      ['b', JITTER_MS / 2 + SPACING_MS],
      ['c', JITTER_MS / 2 + 2 * SPACING_MS],
    ]);
    expect(ev.sent).toEqual(['a', 'b', 'c']);
    expect(q.waiting).toBe(0);
  });

  it('sends again only what never left, after 2, 4, 8, 16 and 30 min, then gives up', async () => {
    let calls = 0;
    const { q, ev } = setup(async () => {
      calls++;
      throw new TypeError('Load failed');
    }, 0);
    q.addSlot(['a']);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    for (const wait of RETRY_MS) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      const before = calls;
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(before + 1);
    }
    expect(ev.failed.map(([, final]) => final)).toEqual([false, false, false, false, false, true]);
    expect(q.waiting).toBe(0);
  });
});
