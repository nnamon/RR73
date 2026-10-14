import { describe, expect, it } from 'vitest';
import { BIN_HZ, DISPLAY_BINS, DISPLAY_FFT, DisplaySpectrum, WSPR_VIEW, binHz, binsOf, viewOf } from './spectrum';
import { tone } from '../testing/signal';

describe('DisplaySpectrum', () => {
  it('has about 6 Hz bins from 0 to 3000 Hz', () => {
    expect(BIN_HZ).toBeCloseTo(5.859, 3);
    expect((DISPLAY_BINS - 1) * BIN_HZ).toBeGreaterThanOrEqual(3000);
    expect((DISPLAY_BINS - 2) * BIN_HZ).toBeLessThan(3000);
  });

  it('reads a full-scale sine centred on a bin as 0 dB at that bin', () => {
    const k = 256; // 1500 Hz
    const s = new DisplaySpectrum().compute(tone(k * BIN_HZ, 12000, DISPLAY_FFT / 12000, 1));
    expect(s[k]).toBeCloseTo(0, 1);
    let peak = 0;
    for (let i = 0; i < s.length; i++) if (s[i] > s[peak]) peak = i;
    expect(peak).toBe(k);
  });

  it('keeps the Hann sidelobes down: 20 bins away is below −60 dB', () => {
    const s = new DisplaySpectrum().compute(tone(1000, 12000, DISPLAY_FFT / 12000, 1));
    const k = Math.round(1000 / BIN_HZ);
    expect(s[k + 20]).toBeLessThan(-60);
    expect(s[k - 20]).toBeLessThan(-60);
  });

  it('gives −Infinity for silence and rejects wrong frame sizes', () => {
    const d = new DisplaySpectrum();
    expect(d.compute(new Float32Array(DISPLAY_FFT))[10]).toBe(-Infinity);
    expect(() => d.compute(new Float32Array(100))).toThrow(RangeError);
  });
});

describe('the WSPR view', () => {
  it('has 1.46 Hz bins, one tone spacing, from 1400 to 1600 Hz over 240 s', () => {
    expect(viewOf('WSPR')).toBe(WSPR_VIEW);
    expect(binHz(WSPR_VIEW)).toBeCloseTo(12000 / 8192, 9);
    const { first, count } = binsOf(WSPR_VIEW);
    expect(first * binHz(WSPR_VIEW)).toBeLessThanOrEqual(1400);
    expect((first + count - 1) * binHz(WSPR_VIEW)).toBeGreaterThanOrEqual(1600);
    expect(count).toBe(139);
    expect(viewOf('FT8').visibleS).toBe(45);
    expect(WSPR_VIEW.visibleS).toBe(240);
  });

  it('puts a 1500 Hz tone in the bin for 1500 Hz', () => {
    const sp = new DisplaySpectrum(WSPR_VIEW);
    const db = sp.compute(tone(1500, 12000, 8192 / 12000));
    const peak = db.indexOf(Math.max(...db));
    expect((binsOf(WSPR_VIEW).first + peak) * binHz(WSPR_VIEW)).toBeCloseTo(1500, 0);
  });
});

