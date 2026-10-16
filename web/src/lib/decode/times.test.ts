import { describe, expect, it } from 'vitest';
import { DECODE_TIMES_KEPT, DecodeTimes } from './times';

describe('DecodeTimes', () => {
  it('gives the last time and the 95th percentile of each mode’s recent slots', () => {
    const t = new DecodeTimes();
    expect(t.summary()).toEqual([]);
    // 20 FT8 slots at 100 to 290 ms, the last 150 ms; 2 WSPR slots.
    for (let i = 0; i < 19; i++) t.add('FT8', 100 + i * 10);
    t.add('FT8', 150);
    t.add('WSPR', 9000);
    t.add('WSPR', 11000);
    expect(t.summary()).toEqual([
      { mode: 'FT8', lastMs: 150, p95Ms: 270, slots: 20 },
      { mode: 'WSPR', lastMs: 11000, p95Ms: 11000, slots: 2 },
    ]);
  });

  it('keeps the last 40 slots of a mode', () => {
    const t = new DecodeTimes();
    t.add('FT4', 5000);
    for (let i = 0; i < DECODE_TIMES_KEPT; i++) t.add('FT4', 50);
    expect(t.summary()).toEqual([{ mode: 'FT4', lastMs: 50, p95Ms: 50, slots: 40 }]);
  });

  it('counts the slots the busy decoder skipped', () => {
    const t = new DecodeTimes();
    t.skip();
    t.skip();
    expect(t.skipped).toBe(2);
  });
});
