import { describe, expect, it } from 'vitest';
import { inBand, operatingDialHz, parseDialMhz } from './hound-dial';
import { validate } from '../state/settings.svelte';

describe('Hound dial frequency', () => {
  it('applies with Hound on in FT8, else the usual frequency', () => {
    const dials = { '20m': 14_090_000 } as const;
    expect(operatingDialHz('20m', 'FT8', true, dials)).toBe(14_090_000);
    expect(operatingDialHz('20m', 'FT8', false, dials)).toBe(14_074_000);
    expect(operatingDialHz('20m', 'FT4', true, dials)).toBe(14_080_000);
    // Nothing entered for the band: its FT8 frequency.
    expect(operatingDialHz('40m', 'FT8', true, dials)).toBe(7_074_000);
  });

  it('reads MHz with a point or a comma, inside the band edges', () => {
    expect(parseDialMhz('14.090', '20m')).toEqual({ hz: 14_090_000 });
    expect(parseDialMhz(' 14,0855 ', '20m')).toEqual({ hz: 14_085_500 });
    expect(parseDialMhz('14.350', '20m')).toEqual({ hz: 14_350_000 });
    expect(inBand('20m', 14_000_000)).toBe(true);
    expect(inBand('20m', 13_999_999)).toBe(false);
  });

  it('names the band edges for a value outside the band or not a number', () => {
    expect(parseDialMhz('14.4', '20m')).toEqual({ error: '14.4 MHz is outside 20m. Enter 14.000 to 14.350 MHz.' });
    expect(parseDialMhz('7.074', '20m')).toEqual({ error: '7.074 MHz is outside 20m. Enter 14.000 to 14.350 MHz.' });
    expect(parseDialMhz('', '160m')).toEqual({ error: 'Enter 1.800 to 2.000 MHz.' });
    expect(parseDialMhz('14.09.1', '20m')).toEqual({ error: 'Enter 14.000 to 14.350 MHz.' });
  });

  it('is stored per band and keeps only values inside the band', () => {
    const s = validate({ houndDialHz: { '20m': 14_090_000, '40m': 14_090_000, '6m': 50_323_000.4, '2m': 144_174_000, '17m': 'x' } });
    expect(s.houndDialHz).toEqual({ '20m': 14_090_000, '6m': 50_323_000 });
    expect(validate({}).houndDialHz).toEqual({});
  });
});
