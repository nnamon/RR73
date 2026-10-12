/** Ticks and markers for the frequency axis under the waterfall. */

import { MAX_HZ } from './spectrum';

export interface Tick {
  hz: number;
  /** Position from the left, 0 to 1. */
  x: number;
  major: boolean;
  /** Label for major ticks away from the edges. */
  label: string | null;
}

/** 100 Hz minor ticks and 500 Hz major ticks from 0 to MAX_HZ, labelled at 500 Hz steps. */
export function ticks(minor = 100, major = 500, maxHz = MAX_HZ): Tick[] {
  const out: Tick[] = [];
  for (let hz = minor; hz < maxHz; hz += minor) {
    const isMajor = hz % major === 0;
    out.push({ hz, x: hz / maxHz, major: isMajor, label: isMajor ? String(hz) : null });
  }
  return out;
}

/** Width of the Rx and Tx brackets, Hz: an FT8 signal is 50 Hz wide. */
export const MARKER_HZ = 50;

/** Left and right edges, 0 to 1, of a bracket for a signal whose lowest tone is at `hz`. */
export function bracket(hz: number, widthHz = MARKER_HZ, maxHz = MAX_HZ): { x0: number; x1: number } {
  return { x0: Math.max(0, hz / maxHz), x1: Math.min(1, (hz + widthHz) / maxHz) };
}
