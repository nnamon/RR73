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

  it('lists 12 bands, each with an FT8 frequency inside the band except 2m', () => {
    expect(BAND_IDS).toHaveLength(12);
    for (const b of BAND_IDS.filter((b) => b !== '2m')) expect(bandOfHz(dialHz(b, 'FT8')!)).toBe(b);
    expect(dialHz('2m', 'FT8')).toBeNull();
    expect(dialHz('2m', 'FT4')).toBeNull();
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
      '2m': 144488.5,
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
    expect(isBand('4m')).toBe(false);
    expect(isBand(20)).toBe(false);
  });
});
