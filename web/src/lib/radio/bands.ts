/** Bands and the usual FT8 and FT4 dial frequencies (USB), Hz. */

import type { Mode } from '../clock/slots';

export const BAND_IDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m'] as const;
export type BandId = (typeof BAND_IDS)[number];

const DIAL: Record<BandId, { FT8: number; FT4: number | null }> = {
  '160m': { FT8: 1840000, FT4: null },
  '80m': { FT8: 3573000, FT4: 3575000 },
  '60m': { FT8: 5357000, FT4: null },
  '40m': { FT8: 7074000, FT4: 7047500 },
  '30m': { FT8: 10136000, FT4: 10140000 },
  '20m': { FT8: 14074000, FT4: 14080000 },
  '17m': { FT8: 18100000, FT4: 18104000 },
  '15m': { FT8: 21074000, FT4: 21140000 },
  '12m': { FT8: 24915000, FT4: 24919000 },
  '10m': { FT8: 28074000, FT4: 28180000 },
  '6m': { FT8: 50313000, FT4: 50318000 },
};

/** Dial frequency for a band and mode, Hz, or null where the mode has no usual frequency. */
export function dialHz(band: BandId, mode: Mode): number | null {
  return DIAL[band][mode];
}

export function isBand(v: unknown): v is BandId {
  return typeof v === 'string' && (BAND_IDS as readonly string[]).includes(v);
}
