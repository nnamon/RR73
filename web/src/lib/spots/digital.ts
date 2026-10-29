/**
 * FT8, FT4 and LQ8 detection: from the mode, then the comments, then the frequency. LQ8 comes
 * from the mode or the comments only: its dials sit 2 kHz above FT4's on 17m, where a window
 * would read FT4 spots as LQ8, and little LQ8 traffic is on air yet.
 *
 * Dial frequencies (USB), kHz, from the app's own table (lib/radio/bands.ts).
 *
 * | Band | FT8 | FT4 |
 * | --- | --- | --- |
 * | 160m | 1840 | |
 * | 80m | 3573 | 3575 |
 * | 60m | 5357 | |
 * | 40m | 7074 | 7047.5 |
 * | 30m | 10136 | 10140 |
 * | 20m | 14074 | 14080 |
 * | 17m | 18100 | 18104 |
 * | 15m | 21074 | 21140 |
 * | 12m | 24915 | 24919 |
 * | 10m | 28074 | 28180 |
 * | 6m | 50313 | 50318 |
 * | 2m | 144174 | 144170 |
 * | 70cm | 432174 | |
 *
 * A spot carries the dial frequency or the dial plus the audio frequency of the signal (up to
 * 3000 Hz), so the window runs from 0.5 kHz below a dial to 3 kHz above it, and the nearest dial
 * wins where windows overlap (80m). A symmetric window would read 30m FT8 at 10138.5 kHz as FT4.
 */

import { BAND_IDS, dialHz } from '../radio/bands';
import type { DigitalMode } from './types';

interface Dial {
  mode: DigitalMode;
  hz: number;
}

export const DIALS: readonly Dial[] = [
  ...BAND_IDS.flatMap((b) =>
    (['FT8', 'FT4'] as const).flatMap((mode) => {
      const hz = dialHz(b, mode);
      return hz === null ? [] : [{ mode, hz }];
    }),
  ),
];

const BELOW_HZ = 500;
const ABOVE_HZ = 3000;

/** FT8 or FT4 when the frequency sits in a dial's window, Hz. */
export function digitalByFrequency(hz: number): DigitalMode | null {
  let best: { mode: DigitalMode; off: number } | null = null;
  for (const d of DIALS) {
    const off = hz - d.hz;
    if (off < -BELOW_HZ || off > ABOVE_HZ) continue;
    if (!best || Math.abs(off) < Math.abs(best.off)) best = { mode: d.mode, off };
  }
  return best?.mode ?? null;
}

/** Modes that say "digital" without naming one. */
const GENERIC_MODES = new Set(['', 'DATA', 'DIGI', 'DIGITAL', 'DIG', 'MFSK', 'OTHER']);

/** Other modes a comment can name, which rule out FT8 and FT4 by frequency: WSPR sits in the 30m FT8 window. */
const OTHER_MODE = /\b(CW|SSB|USB|LSB|FM|JS8|JT65|JT9|JT4|Q65|MSK144|FST4W?|WSPR|RTTY|B?PSK\d*|OLIVIA|SSTV|VARA|FSK441|ISCAT|MFSK\d+)\b/i;

/**
 * FT8, FT4 or LQ8 for a spot.
 *
 * 1. A mode of FT8, FT4 or LQ8.
 * 2. Any other specific mode (CW, SSB) rules them out.
 * 3. With an empty or generic mode (DATA, DIGI), the first of FT8, FT4 or LQ8 the comments name.
 * 4. A comment naming another mode (WSPR, JS8, CW) rules them out.
 * 5. The frequency, against the dial table above (FT8 and FT4).
 */
export function detectDigital(spotMode: string, comments: string, freqHz: number | null): DigitalMode | null {
  const m = spotMode.toUpperCase().replace(/[\s-]/g, '');
  if (m === 'FT8') return 'FT8';
  if (m === 'FT4') return 'FT4';
  if (m === 'LQ8') return 'LQ8';
  if (!GENERIC_MODES.has(m)) return null;
  const hit = /\b(?:FT[\s-]?([48])|(LQ)[\s-]?8)\b/i.exec(comments);
  if (hit) return hit[2] ? 'LQ8' : hit[1] === '8' ? 'FT8' : 'FT4';
  if (OTHER_MODE.test(comments)) return null;
  return freqHz === null ? null : digitalByFrequency(freqHz);
}
