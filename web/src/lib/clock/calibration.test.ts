import { describe, expect, it } from 'vitest';
import { CALIBRATION, RxCalibration } from './calibration';
import type { Decode } from '../decode/types';

const T0 = Date.UTC(2026, 9, 13, 13, 35, 0);
const decode = (dt_s: number, snr_db = 0, text = 'CQ K1ABC FN42'): Decode => ({ text, freq_hz: 1500, dt_s, snr_db });

/** A band whose stations are on time: DTs scatter ±0.1 s about the receive error. */
function band(errorS: number, n = 12, snr = -5): Decode[] {
  return Array.from({ length: n }, (_, i) => decode(errorS + ((i % 5) - 2) * 0.05, snr));
}

/**
 * Runs `slots` slots through the calibration on a receive path whose DTs read `errorS` with no
 * offset. A slot's audio carries the offset in force when it started; its decodes arrive 1 s after
 * it ends. Returns the offsets.
 */
function settle(cal: RxCalibration, errorS: number, slots: number, start = T0): number[] {
  const out: number[] = [];
  let inForce = cal.offsetS;
  let pending = cal.offsetS;
  for (let k = 0; k < slots; k++) {
    const slot = start + k * 15000;
    inForce = pending;
    pending = cal.add(slot, band(errorS + inForce), slot + 16000);
    out.push(pending);
  }
  return out;
}

describe('RxCalibration', () => {
  it('waits for 8 decodes at -10 dB or stronger', () => {
    const cal = new RxCalibration();
    expect(cal.add(T0, [decode(-0.8), decode(-0.8, -11), decode(-0.8, -15)], T0 + 16000)).toBe(0);
    expect(cal.count).toBe(1);
    expect(cal.add(T0 + 15000, Array.from({ length: 6 }, () => decode(-0.8)), T0 + 31000)).toBe(0);
    expect(cal.count).toBe(7);
    expect(cal.add(T0 + 30000, [decode(-0.8)], T0 + 46000)).toBeCloseTo(CALIBRATION.maxStepS, 9);
    expect(cal.medianDtS).toBeCloseTo(-0.8, 9);
  });

  it('moves the offset by at most 0.08 s per slot and settles on minus the median DT', () => {
    const cal = new RxCalibration();
    const offsets = settle(cal, -0.8, 40);
    for (let k = 1; k < offsets.length; k++) expect(Math.abs(offsets[k] - offsets[k - 1])).toBeLessThanOrEqual(CALIBRATION.maxStepS + 1e-9);
    expect(offsets[0]).toBeCloseTo(0.08, 9);
    expect(offsets.at(-1)!).toBeGreaterThan(0.8 - CALIBRATION.deadbandS - 0.001);
    expect(offsets.at(-1)!).toBeLessThan(0.8 + 0.001);
    // Once settled, the decodes it holds read close to DT 0.
    expect(Math.abs(cal.medianDtS!)).toBeLessThan(0.05);
  });

  it('follows a step in the receive error', () => {
    const cal = new RxCalibration();
    settle(cal, -0.8, 40);
    const offsets = settle(cal, -1.6, 60, T0 + 40 * 15000);
    expect(offsets.at(-1)!).toBeGreaterThan(1.6 - CALIBRATION.deadbandS - 0.001);
  });

  it('stays within ±2.5 s', () => {
    const cal = new RxCalibration();
    const offsets = settle(cal, 9, 200);
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(-CALIBRATION.maxOffsetS);
    expect(offsets.at(-1)!).toBeLessThan(-CALIBRATION.maxOffsetS + CALIBRATION.deadbandS);
  });

  it('leaves the offset alone inside the dead band', () => {
    const cal = new RxCalibration();
    expect(settle(cal, 0.02, 10).every((o) => o === 0)).toBe(true);
  });

  it('drops decodes older than 2 minutes', () => {
    const cal = new RxCalibration();
    cal.add(T0, band(-0.8, 7), T0 + 16000);
    cal.add(T0 + 150_000, [decode(-0.8)], T0 + 166_000);
    expect(cal.count).toBe(1);
    expect(cal.offsetS).toBe(0);
  });

  it('reads each slot against the offset in force when the slot started', () => {
    const cal = new RxCalibration();
    cal.add(T0, band(-0.8, 8), T0 + 16000);
    expect(cal.offsetS).toBeCloseTo(0.08, 9);
    // The change at T0 + 16 s lands in the slot from T0 + 15 s, which was stamped without it.
    expect(cal.appliedAt(T0 + 15000)).toBe(0);
    expect(cal.appliedAt(T0 + 30000)).toBeCloseTo(0.08, 9);
  });

  it('starts over on reset', () => {
    const cal = new RxCalibration();
    settle(cal, -0.8, 5);
    cal.reset();
    expect(cal.offsetS).toBe(0);
    expect(cal.count).toBe(0);
    expect(cal.medianDtS).toBeNull();
  });
});
