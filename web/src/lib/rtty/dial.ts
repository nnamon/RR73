/**
 * RTTY's dial. RTTY has no calling frequency and RR73 cannot read the radio, so in RTTY the band
 * sheet takes the dial: each band starts at the table's dial (lib/radio/bands.ts), and an edited
 * dial is kept per band. QSOs log dial + mark tone as their frequency.
 */

import { bandEdges } from '../log/bandplan';
import { dialHz, type BandId } from '../radio/bands';

/** The dial in RTTY, Hz: the one entered for the band, else the table's; null where RTTY has none. */
export function rttyDialHz(band: BandId, dials: Partial<Record<BandId, number>>): number | null {
  const table = dialHz(band, 'RTTY');
  if (table === null) return null;
  return dials[band] ?? table;
}

/** "14.0830" for 14083000 Hz: MHz to four decimals, as the top bar and the band sheet show it. */
export function dial4(hz: number): string {
  return (hz / 1e6).toFixed(4);
}

/**
 * Reads a dial typed in MHz or kHz: "14.085" and "14085" both give 14.0850 MHz. Returns Hz, or
 * the error to show under the field.
 */
export function parseRttyDial(text: string, band: BandId): { hz: number } | { error: string } {
  const e = bandEdges(band);
  if (!e) return { error: `${band} has no band edges.` };
  const range = `Enter ${dial4(e[0])} to ${dial4(e[1])} MHz.`;
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return { error: range };
  const v = Number(t);
  const hz = Math.round(v >= 1000 ? v * 1e3 : v * 1e6);
  if (hz < e[0] || hz > e[1]) return { error: `${dial4(hz)} MHz is outside ${band}. ${range}` };
  return { hz };
}
