/** The ruler under the waterfall, and the width of the Rx and Tx markers. */

import { MAX_HZ } from './spectrum';
import type { Mode } from '../clock/slots';

export interface Tick {
  hz: number;
  /** Position from the left, 0 to 1. */
  x: number;
  /** Every 500 Hz: a taller tick. */
  major: boolean;
}

/** A tick every `minor` Hz and a taller one every `major` Hz, from `minor` up to below `maxHz`. */
export function ticks(minor = 100, major = 500, maxHz = MAX_HZ): Tick[] {
  const out: Tick[] = [];
  for (let hz = minor; hz < maxHz; hz += minor) out.push({ hz, x: hz / maxHz, major: hz % major === 0 });
  return out;
}

export interface RulerLabel {
  hz: number;
  text: string;
  /** Position from the left, 0 to 1. */
  x: number;
  /** Centred on its tick, or ending at the right edge for the last one. */
  align: 'centre' | 'end';
}

/** Labels every `step` Hz from `step` to `maxHz`: 500 to 3000. 3000 sits at the right edge, so it ends there. */
export function rulerLabels(step = 500, maxHz = MAX_HZ): RulerLabel[] {
  const out: RulerLabel[] = [];
  for (let hz = step; hz <= maxHz; hz += step) out.push({ hz, text: String(hz), x: hz / maxHz, align: hz >= maxHz ? 'end' : 'centre' });
  return out;
}

/** Width of a signal from its lowest tone, Hz: FT8 8 tones 6.25 Hz apart, FT4 4 tones 20.83 Hz apart. */
export const SIGNAL_WIDTH_HZ: Record<Mode, number> = { FT8: 8 * 6.25, FT4: (4 * 62.5) / 3 };

/** Left and right edges, 0 to 1, of the marker for a signal in `mode` whose lowest tone is at `hz`. */
export function bracket(hz: number, mode: Mode, maxHz = MAX_HZ): { x0: number; x1: number } {
  return { x0: Math.max(0, hz / maxHz), x1: Math.min(1, (hz + SIGNAL_WIDTH_HZ[mode]) / maxHz) };
}
