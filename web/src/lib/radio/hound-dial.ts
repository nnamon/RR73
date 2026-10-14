/**
 * A DXpedition's dial frequency for Hound mode (docs/design/hound.md). DXpeditions run Fox and
 * Hound on frequencies of their own, so the band sheet takes the dial frequency per band while
 * Hound is on. With Hound off, or with nothing entered, the band's usual FT8 frequency applies.
 */

import type { Mode } from '../clock/slots';
import { bandEdges } from '../log/bandplan';
import { dialHz, type BandId } from './bands';

/** Dial frequencies entered for Hound mode, Hz, by band. */
export type HoundDials = Partial<Record<BandId, number>>;

/** The dial frequency in use, Hz: the DXpedition's while Hound is on, else the band's usual one. */
export function operatingDialHz(band: BandId, mode: Mode, hound: boolean, dials: HoundDials): number | null {
  if (hound && mode === 'FT8') return dials[band] ?? dialHz(band, 'FT8');
  return dialHz(band, mode);
}

/** True when `hz` lies within the band's edges. */
export function inBand(band: BandId, hz: number): boolean {
  const e = bandEdges(band);
  return !!e && Number.isFinite(hz) && hz >= e[0] && hz <= e[1];
}

const mhz3 = (hz: number) => (hz / 1e6).toFixed(3);

/** Reads a dial frequency typed in MHz ("14.090", "14,090"): Hz, or the error to show under the field. */
export function parseDialMhz(text: string, band: BandId): { hz: number } | { error: string } {
  const e = bandEdges(band);
  if (!e) return { error: `${band} has no band edges.` };
  const range = `Enter ${mhz3(e[0])} to ${mhz3(e[1])} MHz.`;
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return { error: range };
  const hz = Math.round(Number(t) * 1e6);
  if (!inBand(band, hz)) return { error: `${t} MHz is outside ${band}. ${range}` };
  return { hz };
}
