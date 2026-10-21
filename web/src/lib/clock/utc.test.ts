import { afterEach, describe, expect, it, vi } from 'vitest';
import { ntpText, setUtcCorrection, usableSample, utcCorrectionMs, utcNow } from './utc';

afterEach(() => {
  setUtcCorrection(0);
  vi.useRealTimers();
});

describe('utcNow', () => {
  it('is the system time without a correction', () => {
    vi.useFakeTimers({ now: 1_792_000_000_000 });
    expect(utcNow()).toBe(1_792_000_000_000);
  });

  it('adds the correction', () => {
    vi.useFakeTimers({ now: 1_792_000_000_000 });
    setUtcCorrection(-2_350);
    expect(utcNow()).toBe(1_791_999_997_650);
    expect(utcCorrectionMs()).toBe(-2_350);
  });

  it('refuses a non-finite correction', () => {
    setUtcCorrection(Number.NaN);
    expect(utcCorrectionMs()).toBe(0);
  });
});

describe('usableSample', () => {
  it('takes a sample with a short round trip', () => {
    expect(usableSample({ offsetMs: 1500, delayMs: 40, stratum: 2 })).toBe(true);
  });

  it('refuses a long round trip, a negative one and none', () => {
    expect(usableSample({ offsetMs: 1500, delayMs: 501, stratum: 2 })).toBe(false);
    expect(usableSample({ offsetMs: 1500, delayMs: -1, stratum: 2 })).toBe(false);
    expect(usableSample({ offsetMs: Number.NaN, delayMs: 10, stratum: 2 })).toBe(false);
    expect(usableSample(null)).toBe(false);
  });
});

describe('ntpText', () => {
  it('says how far the system clock is off, which way, and the error', () => {
    expect(ntpText({ offsetMs: 1234.4, delayMs: 24, stratum: 1 })).toBe('1.234 s slow, ±12 ms');
    expect(ntpText({ offsetMs: -20, delayMs: 0.4, stratum: 1 })).toBe('0.020 s fast, ±1 ms');
    expect(ntpText({ offsetMs: 0.2, delayMs: 30, stratum: 1 })).toBe('On time, ±15 ms');
  });
});
