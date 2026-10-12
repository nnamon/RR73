import { describe, expect, it } from 'vitest';
import { LevelMapper, NOISE_POSITION, RANGE_DB } from './levels';
import { DISPLAY_BINS } from './spectrum';
import { prng } from '../testing/signal';

/** A row of noise bins: exponentially distributed power around `meanDb`. */
function noiseRow(meanDb: number, r: () => number): Float32Array {
  const row = new Float32Array(DISPLAY_BINS);
  for (let k = 0; k < DISPLAY_BINS; k++) row[k] = meanDb + 10 * Math.log10(-Math.log(1 - r()));
  return row;
}

describe('LevelMapper', () => {
  it('puts average noise near 0.24 of the scale at any input level', () => {
    for (const meanDb of [-90, -60, -30]) {
      const r = prng(5);
      const m = new LevelMapper();
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const levels = m.map(noiseRow(meanDb, r));
        if (i < 30) continue;
        // Average power, back in dB, of the mapped noise.
        for (let k = 0; k < levels.length; k++) {
          sum += 10 ** (((levels[k] / 255) * RANGE_DB) / 10);
          n++;
        }
      }
      const meanPos = (10 * Math.log10(sum / n)) / RANGE_DB;
      expect(Math.abs(meanPos - NOISE_POSITION)).toBeLessThan(0.05);
    }
  });

  it('maps a signal 25 dB or more over the average noise to the top', () => {
    const r = prng(6);
    const m = new LevelMapper();
    for (let i = 0; i < 40; i++) m.map(noiseRow(-60, r));
    const row = noiseRow(-60, r);
    row[256] = -60 + 26;
    const levels = m.map(row);
    expect(levels[256]).toBe(255);
  });

  it('shows silence as the bottom of the scale', () => {
    const m = new LevelMapper();
    const levels = m.map(new Float32Array(DISPLAY_BINS).fill(-Infinity));
    expect(levels.every((v) => v === 0)).toBe(true);
    expect(m.floorDb).toBeNull();
  });
});
