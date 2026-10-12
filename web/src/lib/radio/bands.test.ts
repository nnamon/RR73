import { describe, expect, it } from 'vitest';
import { BAND_IDS, dialHz, isBand } from './bands';

describe('bands', () => {
  it('has the usual dial frequencies', () => {
    expect(dialHz('20m', 'FT8')).toBe(14074000);
    expect(dialHz('20m', 'FT4')).toBe(14080000);
    expect(dialHz('40m', 'FT4')).toBe(7047500);
    expect(dialHz('60m', 'FT4')).toBeNull();
  });

  it('lists 11 bands with an FT8 frequency each, inside the band', () => {
    expect(BAND_IDS).toHaveLength(11);
    for (const b of BAND_IDS) expect(dialHz(b, 'FT8')).toBeGreaterThan(1e6);
  });

  it('recognises band names', () => {
    expect(isBand('20m')).toBe(true);
    expect(isBand('2m')).toBe(false);
    expect(isBand(20)).toBe(false);
  });
});
