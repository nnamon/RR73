import { describe, expect, it } from 'vitest';
import { SIGNAL_WIDTH_HZ, bracket, rulerLabels, ticks } from './axis';

describe('waterfall ruler', () => {
  it('has a tick every 100 Hz and a taller one every 500 Hz', () => {
    const t = ticks();
    expect(t).toHaveLength(29);
    expect(t[0]).toEqual({ hz: 100, x: 100 / 3000, major: false });
    expect(t.at(-1)?.hz).toBe(2900);
    expect(t.filter((x) => x.major).map((x) => x.hz)).toEqual([500, 1000, 1500, 2000, 2500]);
  });

  it('labels 500 to 3000 Hz, with 3000 ending at the right edge', () => {
    const l = rulerLabels();
    expect(l.map((x) => x.text)).toEqual(['500', '1000', '1500', '2000', '2500', '3000']);
    expect(l.map((x) => x.align)).toEqual(['centre', 'centre', 'centre', 'centre', 'centre', 'end']);
    expect(l[0].x).toBeCloseTo(1 / 6, 9);
    expect(l.at(-1)?.x).toBe(1);
  });
});

describe('marker width', () => {
  it('spans the signal: 50 Hz in FT8, 4 × 20.83 Hz in FT4', () => {
    expect(SIGNAL_WIDTH_HZ.FT8).toBe(50);
    expect(SIGNAL_WIDTH_HZ.FT4).toBeCloseTo(83.33, 2);
    expect(bracket(1500, 'FT8')).toEqual({ x0: 0.5, x1: 1550 / 3000 });
    expect(bracket(1500, 'FT4').x1 * 3000).toBeCloseTo(1583.33, 2);
  });

  it('stops at the right edge', () => {
    expect(bracket(2990, 'FT8').x1).toBe(1);
  });
});
