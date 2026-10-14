/** The ruler under the waterfall, and the width of the Rx and Tx markers. */

import { MAX_HZ, viewOf } from './spectrum';
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
  /** Centred on its tick, starting at the left edge for the first one, or ending at the right edge for the last one. */
  align: 'start' | 'centre' | 'end';
}

/** Labels every `step` Hz from `step` to `maxHz`: 500 to 3000. 3000 sits at the right edge, so it ends there. */
export function rulerLabels(step = 500, maxHz = MAX_HZ): RulerLabel[] {
  const out: RulerLabel[] = [];
  for (let hz = step; hz <= maxHz; hz += step) out.push({ hz, text: String(hz), x: hz / maxHz, align: hz >= maxHz ? 'end' : 'centre' });
  return out;
}

/**
 * Width of a signal from its lowest tone, Hz: FT8 8 tones 6.25 Hz apart, FT4 4 tones 20.83 Hz
 * apart. WSPR's 4 tones 1.46 Hz apart sit around the frequency, which is the signal's centre: its
 * marker is 6 Hz wide, centred.
 */
export const SIGNAL_WIDTH_HZ: Record<Mode, number> = { FT8: 8 * 6.25, FT4: (4 * 62.5) / 3, WSPR: 6, RTTY: 170 };

/** Left and right edges, 0 to 1, of the marker for a signal in `mode` at `hz`. */
export function bracket(hz: number, mode: Mode, maxHz = MAX_HZ): { x0: number; x1: number } {
  if (mode === 'WSPR') {
    const v = viewOf(mode);
    const x = (f: number) => Math.min(1, Math.max(0, (f - v.minHz) / (v.maxHz - v.minHz)));
    return { x0: x(hz - SIGNAL_WIDTH_HZ.WSPR / 2), x1: x(hz + SIGNAL_WIDTH_HZ.WSPR / 2) };
  }
  return { x0: Math.max(0, hz / maxHz), x1: Math.min(1, (hz + SIGNAL_WIDTH_HZ[mode]) / maxHz) };
}

/** The ruler for a mode: WSPR's 200 Hz has a tick every 10 Hz, a taller one and a label every 50 Hz, the ends labelled inside the edges. */
export function ruler(mode: Mode): { ticks: Tick[]; labels: RulerLabel[] } {
  if (mode !== 'WSPR') return { ticks: ticks(), labels: rulerLabels() };
  const v = viewOf(mode);
  const span = v.maxHz - v.minHz;
  const t: Tick[] = [];
  for (let hz = v.minHz + 10; hz < v.maxHz; hz += 10) t.push({ hz, x: (hz - v.minHz) / span, major: hz % 50 === 0 });
  const labels: RulerLabel[] = [];
  for (let hz = v.minHz; hz <= v.maxHz; hz += 50) labels.push({ hz, text: String(hz), x: (hz - v.minHz) / span, align: hz === v.minHz ? 'start' : hz === v.maxHz ? 'end' : 'centre' });
  return { ticks: t, labels };
}

/** Regular width: labels at least this far apart, px, so 12 pt numbers keep a gap. */
export const DENSE_LABEL_PX = 38;

/**
 * The ruler in regular width, where the waterfall runs the width of an iPad or a desktop window:
 * the same ticks, with a label on every tick when they are 38 px apart, else on every second
 * tick, else every fifth. The ends carry none.
 */
export function denseRuler(mode: Mode, widthPx: number): { ticks: Tick[]; labels: RulerLabel[] } {
  const { ticks: t } = ruler(mode);
  const v = viewOf(mode);
  const lo = mode === 'WSPR' ? v.minHz : 0;
  const hi = mode === 'WSPR' ? v.maxHz : MAX_HZ;
  const tick = mode === 'WSPR' ? 10 : 100;
  const px = (widthPx / (hi - lo)) * tick;
  const every = px >= DENSE_LABEL_PX ? tick : px >= DENSE_LABEL_PX / 2 ? tick * 2 : tick * 5;
  const labels: RulerLabel[] = [];
  for (let hz = lo + tick; hz < hi; hz += tick) if (hz % every === 0) labels.push({ hz, text: String(hz), x: (hz - lo) / (hi - lo), align: 'centre' });
  return { ticks: t, labels };
}
