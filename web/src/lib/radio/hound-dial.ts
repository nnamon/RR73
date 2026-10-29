/**
 * The FT8 and FT4 dial in use. The band sheet takes a dial of the operator's own per band and
 * mode, such as a 60m channel or a regional 160m frequency; with none, the band's usual one
 * applies. A DXpedition's dial for Hound mode (docs/design/hound.md) is kept apart, per band,
 * and applies while Hound is on.
 */

import type { Mode } from '../clock/slots';
import { bandEdges } from '../log/bandplan';
import { dialHz, type BandId } from './bands';

/** Dial frequencies entered for Hound mode, Hz, by band. */
export type HoundDials = Partial<Record<BandId, number>>;

/** The operator's own FT8, FT4 and LQ8 dials, Hz, by mode and band. */
export type FtDials = Record<'FT8' | 'FT4' | 'LQ8', Partial<Record<BandId, number>>>;

export const NO_FT_DIALS: FtDials = { FT8: {}, FT4: {}, LQ8: {} };

/**
 * The dial frequency in use, Hz: the DXpedition's while Hound is on, else the operator's own for
 * the band and mode, else the band's usual one.
 */
export function operatingDialHz(band: BandId, mode: Mode, hound: boolean, dials: HoundDials, own: FtDials = NO_FT_DIALS): number | null {
  if (dialHz(band, mode) === null) return null;
  if (hound && mode === 'FT8' && dials[band] !== undefined) return dials[band];
  if (mode === 'FT8' || mode === 'FT4' || mode === 'LQ8') return own[mode][band] ?? dialHz(band, mode);
  return dialHz(band, mode);
}

/** "14.074" or "7.0475": MHz to 3 decimals, or 4 where the dial needs them. */
export function dialText(hz: number): string {
  const four = (hz / 1e6).toFixed(4);
  return four.endsWith('0') ? four.slice(0, -1) : four;
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
