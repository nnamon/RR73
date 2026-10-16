import { describe, expect, it } from 'vitest';
import { dialText, inBand, operatingDialHz, parseDialMhz } from './hound-dial';
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
    const s = validate({ houndDialHz: { '20m': 14_090_000, '40m': 14_090_000, '6m': 50_323_000.4, '2m': 144_174_000, '70cm': 144_174_000, '17m': 'x' } });
    expect(s.houndDialHz).toEqual({ '20m': 14_090_000, '6m': 50_323_000, '2m': 144_174_000 });
    expect(validate({}).houndDialHz).toEqual({});
  });
});

describe('the operator’s own FT8 and FT4 dials', () => {
  const own = { FT8: { '60m': 5_313_000, '20m': 14_076_000 }, FT4: { '40m': 7_048_000 } } as const;

  it('apply by band and mode, Hound’s dial first while Hound is on', () => {
    expect(operatingDialHz('60m', 'FT8', false, {}, own)).toBe(5_313_000);
    expect(operatingDialHz('40m', 'FT4', false, {}, own)).toBe(7_048_000);
    expect(operatingDialHz('40m', 'FT8', false, {}, own)).toBe(7_074_000);
    expect(operatingDialHz('20m', 'FT8', true, { '20m': 14_090_000 }, own)).toBe(14_090_000);
    // Hound on with no DXpedition dial for the band: the operator's own.
    expect(operatingDialHz('20m', 'FT8', true, {}, own)).toBe(14_076_000);
    // WSPR and RTTY keep theirs; a mode with no dial on the band has none.
    expect(operatingDialHz('20m', 'WSPR', false, {}, own)).toBe(14_095_600);
    expect(operatingDialHz('70cm', 'FT4', false, {}, own)).toBeNull();
  });

  it('show 3 decimals, or 4 where the dial needs them', () => {
    expect(dialText(14_074_000)).toBe('14.074');
    expect(dialText(7_047_500)).toBe('7.0475');
    expect(dialText(50_313_000)).toBe('50.313');
  });

  it('are stored per mode and band, inside the band, on bands with that mode', () => {
    const s = validate({ ftDialHz: { FT8: { '60m': 5_313_000, '20m': 7_074_000, xx: 1, '2m': 144_175_000 }, FT4: { '160m': 1_840_000, '40m': 7_048_000.4, '70cm': 432_170_000 }, WSPR: { '20m': 14_000_000 } } });
    expect(s.ftDialHz).toEqual({ FT8: { '60m': 5_313_000, '2m': 144_175_000 }, FT4: { '40m': 7_048_000 } });
    expect(validate({}).ftDialHz).toEqual({ FT8: {}, FT4: {} });
  });
});
