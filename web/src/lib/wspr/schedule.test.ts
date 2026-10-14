import { describe, expect, it } from 'vitest';
import { LEAD_MS, TX_PCTS, beaconOnSlot, durationText, firstTxSlot, gapSlots, minGapSlots, nextStopAfter, nextTxSlot, normalisePct, normaliseStopAfter, soonestSlot, stopsAtMs } from './schedule';

const at = (h: number, m: number, s = 0, ms = 0) => Date.UTC(2026, 9, 14, h, m, s, ms);

/** A seeded source of values in [0, 1) (mulberry32), so draws repeat. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the first Tx slot', () => {
  it('is the next even minute at least 10 s away', () => {
    expect(firstTxSlot(at(14, 5, 28))).toBe(at(14, 6));
    expect(firstTxSlot(at(14, 5, 50))).toBe(at(14, 6));
    expect(firstTxSlot(at(14, 5, 50, 1))).toBe(at(14, 8));
    expect(firstTxSlot(at(14, 4, 0))).toBe(at(14, 6));
    expect(firstTxSlot(at(14, 3, 59, 999))).toBe(at(14, 6));
    expect(firstTxSlot(at(14, 3, 49, 999))).toBe(at(14, 4));
  });

  it('falls on an even UTC minute whenever Beacon turns on', () => {
    for (let t = at(14, 0); t < at(15, 0); t += 7_919) {
      const s = firstTxSlot(t);
      expect(new Date(s).getUTCMinutes() % 2).toBe(0);
      expect(new Date(s).getUTCSeconds()).toBe(0);
      expect(s - t).toBeGreaterThanOrEqual(LEAD_MS);
      expect(s - t).toBeLessThan(120_000 + LEAD_MS);
    }
  });

  it('may be the next slot at once after a transmission ends', () => {
    // A transmission from 14:06:01 ends at 14:07:51.6, 8.4 s before the next slot.
    expect(soonestSlot(at(14, 7, 51, 600), 0)).toBe(at(14, 8));
    expect(soonestSlot(at(14, 7, 51, 600))).toBe(at(14, 10));
  });
});

describe('the gap between transmissions', () => {
  it('is always 1 slot at 100%', () => {
    const r = seeded(1);
    for (let i = 0; i < 200; i++) expect(gapSlots(100, r)).toBe(1);
  });

  it('leaves a receive slot between transmissions at 50% and below; above, they may follow at once', () => {
    for (const pct of TX_PCTS) expect(minGapSlots(pct)).toBe(pct <= 50 ? 2 : 1);
    // At 20% the lowest draw gave a gap of 1 slot: two transmissions back to back.
    expect(gapSlots(20, () => 0)).toBe(2);
  });

  it('is every other slot at 50%', () => {
    const r = seeded(2);
    for (let i = 0; i < 200; i++) expect(gapSlots(50, r)).toBe(2);
  });

  for (const [pct, min, max] of [
    [20, 2, 8],
    [5, 2, 38],
    [25, 2, 6],
    [10, 2, 18],
    [55, 1, 3],
    [75, 1, 2],
  ] as const) {
    it(`at ${pct}% runs from ${min} to ${max} slots with a mean of ${100 / pct}`, () => {
      const r = seeded(pct);
      const n = 40_000;
      const seen = new Map<number, number>();
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const g = gapSlots(pct, r);
        sum += g;
        seen.set(g, (seen.get(g) ?? 0) + 1);
      }
      expect(Math.min(...seen.keys())).toBe(min);
      expect(Math.max(...seen.keys())).toBe(max);
      expect(sum / n).toBeCloseTo(100 / pct, 1);
      // Every gap from the shortest to the longest occurs.
      expect(seen.size).toBe(max - min + 1);
    });
  }

  it('averages 100 ÷ pct slots at every percentage offered, so the beacon transmits pct% of slots', () => {
    for (const pct of TX_PCTS) {
      const r = seeded(pct * 7);
      let sum = 0;
      const n = 20_000;
      for (let i = 0; i < n; i++) sum += gapSlots(pct, r);
      expect(Math.abs(sum / n - 100 / pct) / (100 / pct)).toBeLessThan(0.02);
    }
  });

  it('rounds the drawn gap up in proportion to its fraction', () => {
    // At 20%, x = 0.5 × 6 = 3: no fraction, gap 2 + 3 whatever the second draw.
    expect(gapSlots(20, (() => { const v = [0.5, 0.99]; return () => v.shift()!; })())).toBe(5);
    // x = 0.4 × 6 = 2.4: up when the second draw is under 0.4.
    expect(gapSlots(20, (() => { const v = [0.4, 0.39]; return () => v.shift()!; })())).toBe(5);
    expect(gapSlots(20, (() => { const v = [0.4, 0.41]; return () => v.shift()!; })())).toBe(4);
  });
});

describe('the next Tx slot', () => {
  it('counts the gap from the last transmission', () => {
    const r = () => 0.5; // 20%: x = 4, gap 5
    expect(nextTxSlot(at(14, 7, 51, 600), 20, at(14, 6), 0, r)).toBe(at(14, 16));
  });

  it('follows at once at 100%', () => {
    expect(nextTxSlot(at(14, 7, 51, 600), 100, at(14, 6), 0)).toBe(at(14, 8));
  });

  it('puts the shortest gap on the first slot Beacon on could take when nothing has gone out', () => {
    const zero = () => 0;
    expect(nextTxSlot(at(14, 5, 28), 20, null, LEAD_MS, zero)).toBe(at(14, 6));
    // 0.5 at 20%: a gap of 5, 3 slots after the first one.
    const half = () => 0.5;
    expect(nextTxSlot(at(14, 5, 28), 20, null, LEAD_MS, half)).toBe(at(14, 12));
  });

  it('keeps a receive slot after the last transmission when Beacon turns on again, a cut one included', () => {
    const zero = () => 0;
    // Cut short in 14:04, Beacon on at 14:05:28: 14:06 would follow at once; 14:08 leaves 14:06 to receive.
    expect(beaconOnSlot(at(14, 5, 28), 20, at(14, 4), zero)).toBe(at(14, 8));
    // Long after the last transmission, the first slot is drawn as with none.
    expect(beaconOnSlot(at(14, 5, 28), 20, at(13, 0), zero)).toBe(at(14, 6));
    expect(beaconOnSlot(at(14, 5, 28), 20, null, zero)).toBe(at(14, 6));
    // Above 50% the next slot may follow at once.
    expect(beaconOnSlot(at(14, 5, 28), 100, at(14, 4))).toBe(at(14, 6));
  });

  it('never picks a slot that has started or is less than the lead away', () => {
    // The percentage changed long after the last transmission.
    expect(nextTxSlot(at(15, 1, 55), 100, at(14, 6), LEAD_MS)).toBe(at(15, 4));
    expect(nextTxSlot(at(15, 1, 30), 100, at(14, 6), LEAD_MS)).toBe(at(15, 2));
  });

  it('keeps every slot on an even minute', () => {
    const r = seeded(9);
    let last: number | null = null;
    let now = at(14, 0, 13);
    for (let i = 0; i < 500; i++) {
      const s = nextTxSlot(now, 20, last, last === null ? LEAD_MS : 0, r);
      expect(s % 120_000).toBe(0);
      expect(s).toBeGreaterThan(now);
      last = s;
      now = s + 111_600;
    }
  });
});

describe('Stop beacon after', () => {
  it('counts from Beacon on, and Off never stops', () => {
    expect(stopsAtMs(at(14, 5, 28), 60)).toBe(at(15, 5, 28));
    expect(stopsAtMs(at(14, 5, 28), 90)).toBe(at(15, 35, 28));
    expect(stopsAtMs(at(14, 5, 28), 0)).toBeNull();
  });

  it('reads any whole number of minutes up to 7 days', () => {
    expect(normaliseStopAfter(60)).toBe(60);
    expect(normaliseStopAfter(0)).toBe(0);
    expect(normaliseStopAfter(37.4)).toBe(37);
    expect(normaliseStopAfter(7 * 24 * 60)).toBe(10080);
    expect(normaliseStopAfter(7 * 24 * 60 + 1)).toBeNull();
    expect(normaliseStopAfter(-5)).toBeNull();
    expect(normaliseStopAfter('60')).toBeNull();
  });

  it('writes durations in hours and minutes', () => {
    expect(durationText(60)).toBe('1 h');
    expect(durationText(90)).toBe('1 h 30 min');
    expect(durationText(45)).toBe('45 min');
    expect(durationText(0)).toBe('Off');
  });

  it('steps through the ••• menu values, then Off', () => {
    expect(nextStopAfter(0)).toBe(30);
    expect(nextStopAfter(60)).toBe(120);
    expect(nextStopAfter(90)).toBe(120);
    expect(nextStopAfter(720)).toBe(0);
    expect(nextStopAfter(1000)).toBe(0);
  });
});

describe('Tx percentages', () => {
  it('run from 5 to 100 in steps of 5', () => {
    expect(TX_PCTS).toHaveLength(20);
    expect(TX_PCTS[0]).toBe(5);
    expect(TX_PCTS.at(-1)).toBe(100);
    expect(normalisePct(35)).toBe(35);
    expect(normalisePct(33)).toBeNull();
    expect(normalisePct(0)).toBeNull();
  });
});
