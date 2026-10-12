import { describe, expect, it } from 'vitest';
import { MINUS, dt, isoUtc, mhz, signed, slotStem, snr, utcHm, utcTime } from './format';

const T = Date.UTC(2026, 9, 13, 3, 4, 5, 678);

describe('formats', () => {
  it('writes UTC times', () => {
    expect(utcTime(T)).toBe('03:04:05');
    expect(utcHm(T)).toBe('03:04');
    expect(isoUtc(T)).toBe('2026-10-13T03:04:05Z');
  });

  it('writes WSJT-X style stems', () => {
    expect(slotStem(Date.UTC(2026, 9, 13, 13, 14, 15))).toBe('261013_131415');
    expect(slotStem(Date.UTC(2031, 0, 2, 0, 0, 0))).toBe('310102_000000');
  });

  it('writes SNR and DT as WSJT-X does, with the minus sign', () => {
    expect(snr(-9)).toBe(`${MINUS}09`);
    expect(snr(-21.4)).toBe(`${MINUS}21`);
    expect(snr(3)).toBe('+03');
    expect(snr(0)).toBe('+00');
    expect(dt(0.2)).toBe('0.2');
    expect(dt(-0.44)).toBe(`${MINUS}0.4`);
    expect(dt(-0.01)).toBe('0.0');
  });

  it('writes signed numbers and frequencies', () => {
    expect(signed(-24)).toBe(`${MINUS}24`);
    expect(signed(7)).toBe('7');
    expect(mhz(14074000)).toBe('14.074 MHz');
    expect(mhz(7047500)).toBe('7.0475 MHz');
    expect(mhz(1840000)).toBe('1.840 MHz');
    expect(mhz(50313000)).toBe('50.313 MHz');
  });
});
