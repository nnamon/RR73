import { describe, expect, it } from 'vitest';
import { SIGNAL_WIDTH_HZ, bracket, denseRuler, ruler, rulerLabels, ticks } from './axis';

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

describe('the WSPR ruler', () => {
  it('ticks every 10 Hz, taller and labelled every 50 Hz, with the ends inside the edges', () => {
    const { ticks: t, labels } = ruler('WSPR');
    expect(t).toHaveLength(19);
    expect(t.filter((x) => x.major).map((x) => x.hz)).toEqual([1450, 1500, 1550]);
    expect(labels.map((l) => [l.text, l.x, l.align])).toEqual([
      ['1400', 0, 'start'],
      ['1450', 0.25, 'centre'],
      ['1500', 0.5, 'centre'],
      ['1550', 0.75, 'centre'],
      ['1600', 1, 'end'],
    ]);
  });

  it('marks a WSPR signal 6 Hz wide around its centre', () => {
    const b = bracket(1500, 'WSPR');
    expect(b.x0).toBeCloseTo(0.485, 9);
    expect(b.x1).toBeCloseTo(0.515, 9);
    expect(SIGNAL_WIDTH_HZ.WSPR).toBe(6);
  });
});


describe('the ruler in regular width', () => {
  const hz = (widthPx: number, mode: 'FT8' | 'WSPR' = 'FT8') => denseRuler(mode, widthPx).labels.map((l) => l.hz);

  it('labels every 100 Hz on a desktop or an iPad on its side, without the ends', () => {
    for (const w of [1440, 1180]) {
      const l = hz(w);
      expect(l[0]).toBe(100);
      expect(l.at(-1)).toBe(2900);
      expect(l).toHaveLength(29);
    }
  });

  it('labels every 200 Hz on an iPad upright and every 500 Hz when narrower', () => {
    expect(hz(820)).toEqual([200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800]);
    expect(hz(700)).toEqual([200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800]);
    expect(hz(500)).toEqual([500, 1000, 1500, 2000, 2500]);
  });

  it('labels WSPR every 10 Hz on a desktop', () => {
    const l = hz(1440, 'WSPR');
    expect(l[0]).toBe(1410);
    expect(l.at(-1)).toBe(1590);
    expect(l).toHaveLength(19);
  });

  it('keeps the phone ruler’s ticks', () => {
    expect(denseRuler('FT8', 1440).ticks).toEqual(ruler('FT8').ticks);
    expect(denseRuler('WSPR', 1440).ticks).toEqual(ruler('WSPR').ticks);
  });
});
