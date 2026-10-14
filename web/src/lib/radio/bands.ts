/**
 * Bands and their dial frequencies (USB), Hz: the usual FT8 and FT4 frequencies, and for WSPR
 * the frequencies of WSPRnet's table (wsprnet.org, wspr-qrg.pdf), the same in every region.
 * WSPR signals sit 1400 to 1600 Hz above the dial. 2m has a WSPR dial only.
 */

import type { Mode } from '../clock/slots';

export const BAND_IDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m'] as const;
export type BandId = (typeof BAND_IDS)[number];

const DIAL: Record<BandId, Record<Mode, number | null>> = {
  '160m': { FT8: 1840000, FT4: null, WSPR: 1836600 },
  '80m': { FT8: 3573000, FT4: 3575000, WSPR: 3568600 },
  '60m': { FT8: 5357000, FT4: null, WSPR: 5287200 },
  '40m': { FT8: 7074000, FT4: 7047500, WSPR: 7038600 },
  '30m': { FT8: 10136000, FT4: 10140000, WSPR: 10138700 },
  '20m': { FT8: 14074000, FT4: 14080000, WSPR: 14095600 },
  '17m': { FT8: 18100000, FT4: 18104000, WSPR: 18104600 },
  '15m': { FT8: 21074000, FT4: 21140000, WSPR: 21094600 },
  '12m': { FT8: 24915000, FT4: 24919000, WSPR: 24924600 },
  '10m': { FT8: 28074000, FT4: 28180000, WSPR: 28124600 },
  '6m': { FT8: 50313000, FT4: 50318000, WSPR: 50293000 },
  '2m': { FT8: null, FT4: null, WSPR: 144488500 },
};

/** Dial frequency for a band and mode, Hz, or null where the mode has no usual frequency. */
export function dialHz(band: BandId, mode: Mode): number | null {
  return DIAL[band][mode];
}

export function isBand(v: unknown): v is BandId {
  return typeof v === 'string' && (BAND_IDS as readonly string[]).includes(v);
}
