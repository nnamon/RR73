/**
 * Moving Tx and Rx on the waterfall by touch: which marker a press takes, when a press becomes a
 * drag, a tap or a page scroll, and the frequency under the finger. A tap sets Tx; with Shift
 * held, a click sets Rx (Waterfall.svelte).
 */

import type { Mode } from '../clock/slots';
import { clampHz, hzAtX, xOfHz } from './pick';

/** A press this close to the Rx marker moves Rx, CSS px. */
export const GRAB_PX = 16;
/** Sideways travel that starts a drag, px. */
export const DRAG_PX = 6;
/** The most a tap moves, px, and its longest press, ms. */
export const TAP_PX = 10;
export const TAP_MS = 1000;
/** Frequencies set by touch step by this much, Hz: 5 Hz across FT8's 3000 Hz, 1 Hz across WSPR's 200 Hz. */
export const STEP_HZ = 5;
export const STEP_HZ_OF: Record<Mode, number> = { FT8: STEP_HZ, FT4: STEP_HZ, LQ8: STEP_HZ, WSPR: 1, RTTY: 1 };

export type Marker = 'rx' | 'tx';
export type Gesture = 'pending' | 'drag' | 'scroll';

/**
 * The marker a press at `x` CSS px moves on a waterfall `width` px wide: Rx when the press lands
 * on the Rx marker and nearer to it than to Tx, otherwise Tx.
 */
export function grabbed(x: number, width: number, rxHz: number | null, txHz: number, mode: Mode = 'FT8'): Marker {
  if (rxHz === null) return 'tx';
  const toRx = Math.abs(x - xOfHz(rxHz, mode) * width);
  const toTx = Math.abs(x - xOfHz(txHz, mode) * width);
  return toRx <= GRAB_PX && toRx < toTx ? 'rx' : 'tx';
}

/**
 * What a press has become after moving `dx`, `dy` px: a drag once it travels DRAG_PX more
 * sideways than up or down, a page scroll once it travels TAP_PX more up or down. Once decided,
 * it stays.
 */
export function classify(dx: number, dy: number, was: Gesture): Gesture {
  if (was !== 'pending') return was;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= DRAG_PX && ax > ay) return 'drag';
  if (ay >= TAP_PX && ay >= ax) return 'scroll';
  return 'pending';
}

/** True for a press that moved at most TAP_PX and lasted at most TAP_MS. */
export function isTap(dx: number, dy: number, ms: number): boolean {
  return Math.hypot(dx, dy) <= TAP_PX && ms <= TAP_MS;
}

/** The frequency under `x`, Hz: in the mode's steps, inside its limits. */
export function dragHz(x: number, width: number, mode: Mode): number {
  const step = STEP_HZ_OF[mode];
  return clampHz(Math.round(hzAtX(x, width, mode) / step) * step, mode);
}

/** Left edge of a label `labelWidth` px wide, centred on `markerX` and kept `margin` px inside the waterfall. */
export function labelLeft(markerX: number, labelWidth: number, width: number, margin = 4): number {
  return Math.max(margin, Math.min(width - labelWidth - margin, markerX - labelWidth / 2));
}
