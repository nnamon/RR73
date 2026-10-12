import { describe, expect, it } from 'vitest';
import { FLOOR_DB, LevelMeter, toDb } from './level';
import { tone } from '../testing/signal';

describe('toDb', () => {
  it('converts amplitudes to dBFS', () => {
    expect(toDb(1)).toBe(0);
    expect(toDb(0.1)).toBeCloseTo(-20, 10);
    expect(toDb(0)).toBe(FLOOR_DB);
    expect(toDb(1e-9)).toBe(FLOOR_DB);
  });
});

describe('LevelMeter', () => {
  it('reads a full-scale sine as 0 dBFS peak and −3 dBFS RMS', () => {
    const m = new LevelMeter();
    m.add(tone(1000, 48000, 0.1, 1, Math.PI / 2));
    const r = m.read();
    expect(r.peakDb).toBeCloseTo(0, 3);
    expect(r.rmsDb).toBeCloseTo(-3.0103, 2);
  });

  it('accumulates blocks until read, then starts again', () => {
    const m = new LevelMeter();
    m.add(new Float32Array([0.5, -0.25]));
    m.add(new Float32Array([0, 0]));
    const r = m.read();
    expect(r.peakDb).toBeCloseTo(toDb(0.5), 10);
    expect(r.rmsDb).toBeCloseTo(toDb(Math.sqrt((0.25 + 0.0625) / 4)), 6);
    expect(m.read()).toEqual({ peakDb: FLOOR_DB, rmsDb: FLOOR_DB });
  });

  it('measures only the first `length` samples of a block', () => {
    const m = new LevelMeter();
    m.add(new Float32Array([0.1, 0.9]), 1);
    expect(m.read().peakDb).toBeCloseTo(-20, 5);
  });
});
