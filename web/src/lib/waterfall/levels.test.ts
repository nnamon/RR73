import { describe, expect, it } from 'vitest';
import { HALF_WINDOW, LevelMapper, NOISE_POSITION, SPAN_DB, baseline, scalePosition, type Contrast } from './levels';
import { STOP_POSITIONS } from './colormap';
import { BIN_HZ, DISPLAY_BINS } from './spectrum';
import { prng } from '../testing/signal';

/** Exponentially distributed noise power around `meanDb`, plus `shape(k)` dB per bin. */
function noiseRow(meanDb: number, r: () => number, shape: (k: number) => number = () => 0): Float32Array {
  const row = new Float32Array(DISPLAY_BINS);
  for (let k = 0; k < DISPLAY_BINS; k++) row[k] = meanDb + shape(k) + 10 * Math.log10(-Math.log(1 - r()));
  return row;
}

/** dB over the average noise that a level 0..255 stands for. */
const dbOf = (level: number, contrast: Contrast = 'normal') => ((level / 255 - NOISE_POSITION) * SPAN_DB[contrast]) / (1 - NOISE_POSITION);

/** Mean power of mapped levels in `bins`, back on the 0 to 1 scale. */
function meanPosition(rows: Uint8Array[], bins: number[]): number {
  let sum = 0;
  for (const row of rows) for (const k of bins) sum += 10 ** (dbOf(row[k]) / 10);
  return scalePosition(10 * Math.log10(sum / (rows.length * bins.length)));
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const bin = (hz: number) => Math.round(hz / BIN_HZ);

describe('scalePosition', () => {
  it('puts average noise on the second stop and 3 dB over it on the cyan stop', () => {
    expect(scalePosition(0)).toBe(NOISE_POSITION);
    expect(NOISE_POSITION).toBe(STOP_POSITIONS[1]);
    expect(scalePosition(3)).toBeCloseTo(STOP_POSITIONS[2], 6);
    expect(scalePosition(6)).toBeCloseTo(STOP_POSITIONS[3], 6);
    expect(scalePosition(20)).toBeCloseTo(1, 6);
  });

  it('reaches the top sooner with more contrast', () => {
    expect(scalePosition(SPAN_DB.high, 'high')).toBeCloseTo(1, 6);
    expect(scalePosition(SPAN_DB.low, 'low')).toBeCloseTo(1, 6);
    expect(scalePosition(3, 'high')).toBeGreaterThan(scalePosition(3, 'normal'));
    expect(scalePosition(3, 'low')).toBeLessThan(scalePosition(3, 'normal'));
  });
});

describe('baseline', () => {
  const run = (v: Float32Array, half: number) => baseline(v, half, new Float32Array(v.length), new Float32Array(v.length), new Float32Array(v.length));

  it('drops peaks narrower than the window', () => {
    const v = new Float32Array(200).fill(-60);
    for (let k = 90; k < 99; k++) v[k] = -40;
    expect(Math.max(...run(v, HALF_WINDOW))).toBe(-60);
  });

  it('keeps a slope, as a passband edge has', () => {
    const v = Float32Array.from({ length: 200 }, (_, k) => -60 + 0.25 * k);
    const out = run(v, HALF_WINDOW);
    for (let k = 2 * HALF_WINDOW; k < 200 - 2 * HALF_WINDOW; k++) expect(out[k]).toBeCloseTo(v[k], 3);
  });
});

describe('LevelMapper', () => {
  it('peeks at a row without learning from it', () => {
    const r = prng(5);
    const row = () => Float32Array.from({ length: DISPLAY_BINS }, () => -90 + 6 * r());
    const a = new LevelMapper();
    const b = new LevelMapper();
    for (let i = 0; i < 40; i++) {
      const x = row();
      a.map(x);
      b.map(x);
    }
    // b peeks at rows 40 dB stronger, as the radio's own transmission comes back; a sees none.
    for (let i = 0; i < 20; i++) expect(Math.max(...b.peek(row().map((v) => v + 40)))).toBe(255);
    expect(b.floorDb).toBe(a.floorDb);
    const next = row();
    expect(b.map(next)).toEqual(a.map(next));
  });
  it('puts average noise on the noise position at any input level', () => {
    for (const meanDb of [-90, -60, -30]) {
      const r = prng(5);
      const m = new LevelMapper();
      const rows: Uint8Array[] = [];
      for (let i = 0; i < 120; i++) {
        const levels = m.map(noiseRow(meanDb, r));
        if (i >= 60) rows.push(levels);
      }
      expect(Math.abs(meanPosition(rows, range(bin(200), bin(2800))) - NOISE_POSITION)).toBeLessThan(0.03);
    }
  });

  it('levels each bin against its own floor, so a passband edge 15 dB down reads as the middle', () => {
    // An SSB filter: flat from 500 to 2500 Hz, 15 dB down by 200 Hz and 2800 Hz.
    const shape = (k: number) => {
      const hz = k * BIN_HZ;
      return hz < 500 ? (-15 * (500 - hz)) / 300 : hz > 2500 ? (-15 * (hz - 2500)) / 300 : 0;
    };
    const r = prng(9);
    const m = new LevelMapper();
    const rows: Uint8Array[] = [];
    for (let i = 0; i < 240; i++) {
      const levels = m.map(noiseRow(-60, r, shape));
      if (i >= 120) rows.push(levels);
    }
    const middle = meanPosition(rows, range(bin(1000), bin(2000)));
    for (const edge of [range(bin(250), bin(350)), range(bin(2650), bin(2750))]) expect(Math.abs(meanPosition(rows, edge) - middle)).toBeLessThan(0.04);
  });

  it('shows a signal 3 dB over the noise on the cyan stop, and 20 dB at the top', () => {
    const r = prng(6);
    const m = new LevelMapper();
    for (let i = 0; i < 120; i++) m.map(noiseRow(-60, r));
    // Steady bins at the average noise power, plus 3 and 20 dB: the noise mean is 0 dB over itself.
    const row = noiseRow(-60, r);
    row[bin(1000)] = -60 + 3;
    row[bin(2000)] = -60 + 20.5;
    const levels = m.map(row);
    expect(Math.abs(levels[bin(1000)] / 255 - STOP_POSITIONS[2])).toBeLessThan(0.03);
    expect(levels[bin(2000)]).toBe(255);
  });

  it('follows the contrast setting', () => {
    const at = (c: Contrast) => {
      const r = prng(6);
      const m = new LevelMapper();
      m.setContrast(c);
      for (let i = 0; i < 120; i++) m.map(noiseRow(-60, r));
      const row = noiseRow(-60, r);
      row[bin(1500)] = -60 + 6;
      return m.map(row)[bin(1500)];
    };
    expect(at('high')).toBeGreaterThan(at('normal'));
    expect(at('normal')).toBeGreaterThan(at('low'));
  });

  it('keeps a 50 Hz signal 6 dB over the noise that transmits in both slots', () => {
    // Two stations on one frequency, even and odd: on 12.6 s of every 15 s for 90 s.
    const r = prng(11);
    const m = new LevelMapper(8);
    const sig = range(bin(1500), bin(1550));
    const quiet = range(bin(1700), bin(1750));
    const on: Uint8Array[] = [];
    const off: Uint8Array[] = [];
    for (let i = 0; i < 90 * 8; i++) {
      const live = (i / 8) % 15 < 12.6;
      const row = noiseRow(-60, r);
      if (live) for (const k of sig) row[k] = 10 * Math.log10(10 ** (row[k] / 10) + 10 ** ((-60 + 6) / 10));
      const levels = m.map(row);
      if (i > 60 * 8 && live) on.push(levels);
      if (i > 60 * 8) off.push(levels);
    }
    expect(meanPosition(on, sig)).toBeGreaterThan(scalePosition(5.5));
    expect(Math.abs(meanPosition(off, quiet) - NOISE_POSITION)).toBeLessThan(0.04);
  });

  it('shows silence as the bottom of the scale', () => {
    const m = new LevelMapper();
    const levels = m.map(new Float32Array(DISPLAY_BINS).fill(-Infinity));
    expect(levels.every((v) => v === 0)).toBe(true);
    expect(m.floorDb).toBeNull();
  });
});
