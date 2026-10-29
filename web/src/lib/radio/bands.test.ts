import { describe, expect, it } from 'vitest';
import { BAND_IDS, dialHz, isBand } from './bands';
import { bandOfHz } from '../log/bandplan';

describe('bands', () => {
  it('has the usual dial frequencies', () => {
    expect(dialHz('20m', 'FT8')).toBe(14074000);
    expect(dialHz('20m', 'FT4')).toBe(14080000);
    expect(dialHz('40m', 'FT4')).toBe(7047500);
    expect(dialHz('60m', 'FT4')).toBeNull();
  });

  it('has the LQ8 portal’s dials on 40m to 10m and none elsewhere', () => {
    const lq8 = Object.fromEntries(BAND_IDS.map((b) => [b, dialHz(b, 'LQ8')]));
    expect(lq8).toEqual({
      '160m': null,
      '80m': null,
      '60m': null,
      '40m': 7_084_000,
      '30m': 10_146_000,
      '20m': 14_084_000,
      '17m': 18_106_000,
      '15m': 21_084_000,
      '12m': 24_925_000,
      '10m': 28_084_000,
      '6m': null,
      '2m': null,
      '70cm': null,
    });
    // Each sits in its band with the 3 kHz of audio above it.
    for (const [b, hz] of Object.entries(lq8)) if (hz) expect(bandOfHz(hz + 3000), b).toBe(b);
  });

  it('lists 13 bands, each with an FT8 frequency inside the band', () => {
    expect(BAND_IDS).toHaveLength(13);
    for (const b of BAND_IDS) expect(bandOfHz(dialHz(b, 'FT8')!)).toBe(b);
  });

  it('has the published FT8 and FT4 dials on 2m and 70cm, and no FT4 dial on 70cm', () => {
    expect(dialHz('2m', 'FT8')).toBe(144174000);
    expect(dialHz('2m', 'FT4')).toBe(144170000);
    expect(dialHz('70cm', 'FT8')).toBe(432174000);
    expect(dialHz('70cm', 'FT4')).toBeNull();
    // FT4's 3 kHz on 2m ends below the FT8 dial.
    expect(dialHz('2m', 'FT4')! + 3000).toBeLessThan(dialHz('2m', 'FT8')!);
  });

  it("has WSPRnet's WSPR dial on every band", () => {
    const kHz = Object.fromEntries(BAND_IDS.map((b) => [b, dialHz(b, 'WSPR')! / 1000]));
    expect(kHz).toEqual({
      '160m': 1836.6,
      '80m': 3568.6,
      '60m': 5287.2,
      '40m': 7038.6,
      '30m': 10138.7,
      '20m': 14095.6,
      '17m': 18104.6,
      '15m': 21094.6,
      '12m': 24924.6,
      '10m': 28124.6,
      '6m': 50293.0,
      '2m': 144489,
      '70cm': 432300,
    });
    // The 200 Hz of signals, 1400 to 1600 Hz above the dial, stay inside the band.
    for (const b of BAND_IDS) {
      expect(bandOfHz(dialHz(b, 'WSPR')! + 1400)).toBe(b);
      expect(bandOfHz(dialHz(b, 'WSPR')! + 1600)).toBe(b);
    }
  });

  it('recognises band names', () => {
    expect(isBand('20m')).toBe(true);
    expect(isBand('2m')).toBe(true);
    expect(isBand('70cm')).toBe(true);
    expect(isBand('4m')).toBe(false);
    expect(isBand(20)).toBe(false);
  });
  it('has the approved RTTY dials, clear of FT4 on 20m, with the pair inside the band', () => {
    const kHz = Object.fromEntries(BAND_IDS.map((b) => [b, (dialHz(b, 'RTTY') ?? 0) / 1000]));
    expect(kHz).toEqual({
      '160m': 1805,
      '80m': 3580,
      '60m': 0,
      '40m': 7040,
      '30m': 10143,
      '20m': 14083,
      '17m': 18107,
      '15m': 21080,
      '12m': 24922,
      '10m': 28080,
      '6m': 50300,
      '2m': 0,
      '70cm': 0,
    });
    // FT4 on 20m sits 14.0802 to 14.0830 MHz: the RTTY pair starts above it.
    expect(dialHz('20m', 'RTTY')! + 1415).toBeGreaterThan(14083000);
    for (const b of BAND_IDS) {
      const d = dialHz(b, 'RTTY');
      if (d === null) continue;
      expect(bandOfHz(d + 1415)).toBe(b);
      expect(bandOfHz(d + 1585)).toBe(b);
    }
  });
});
