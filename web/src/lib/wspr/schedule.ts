/**
 * The WSPR beacon's schedule (docs/design/wspr.md, Beacon schedule). Slots are 2 minutes from
 * an even UTC minute; a transmission starts 1 s into its slot and lasts 110.6 s.
 *
 * - Beacon on: the first Tx is the next slot that starts at least 10 s later, the time needed to
 *   build and queue the audio.
 * - Each later gap is 1 + x slots, where n = 100 ÷ Tx percentage and x is drawn uniformly from
 *   0 to 2(n − 1), then rounded up or down at random in proportion to its fraction: the mean gap
 *   is n slots and the longest 2n − 1 (at 20%: 1 to 9 slots, mean 5).
 * - Stop beacon after counts from Beacon on; 0 is Off.
 *
 * Pure functions of the time and a random source, so tests run them on any clock.
 */

import { SLOT_MS } from '../clock/slots';

export const WSPR_SLOT_MS = SLOT_MS.WSPR;
/** A transmission starts this long after its slot start, s. */
export const TX_OFFSET_S = 1;
/** 162 symbols of 8192 samples at 12 kHz, s. */
export const TX_SECONDS = (162 * 8192) / 12000;
/** The least time between turning the beacon on and its first transmission's slot, ms. */
export const LEAD_MS = 10_000;

/** Tx percentages offered: 5 to 100 in steps of 5. */
export const TX_PCTS: readonly number[] = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
export const DEFAULT_TX_PCT = 20;
/** Stop beacon after, min: the default, and the values the ••• menu steps through (0 is Off). */
export const DEFAULT_STOP_AFTER_MIN = 60;
export const STOP_AFTER_STEPS_MIN: readonly number[] = [0, 30, 60, 120, 240, 480, 720];

/** A Tx percentage from 5 to 100 in steps of 5, or null. */
export function normalisePct(v: unknown): number | null {
  return typeof v === 'number' && TX_PCTS.includes(v) ? v : null;
}

/** Start of the WSPR slot containing `ms`. */
export function wsprSlot(ms: number): number {
  return Math.floor(ms / WSPR_SLOT_MS) * WSPR_SLOT_MS;
}

/** The first slot start after `nowMs` at least `leadMs` away. */
export function soonestSlot(nowMs: number, leadMs: number = LEAD_MS): number {
  const next = wsprSlot(nowMs) + WSPR_SLOT_MS;
  return next - nowMs >= leadMs ? next : next + WSPR_SLOT_MS;
}

/** The first Tx slot after Beacon turns on at `nowMs`: the next slot start at least LEAD_MS away. */
export function firstTxSlot(nowMs: number): number {
  return soonestSlot(nowMs, LEAD_MS);
}

/**
 * Slots from one transmission to the next, at `pct` percent: 1 + x, x uniform from 0 to
 * 2(n − 1) with n = 100 ÷ pct, rounded at random in proportion to its fraction. `random`
 * returns values in [0, 1), as Math.random.
 */
export function gapSlots(pct: number, random: () => number = Math.random): number {
  const n = 100 / pct;
  const x = random() * 2 * (n - 1);
  const whole = Math.floor(x);
  return 1 + (random() < x - whole ? whole + 1 : whole);
}

/**
 * The next Tx slot, drawn at `nowMs`. After a transmission in `lastTxSlot` the gap counts from
 * it; with none yet (Beacon just on), from the slot before the first one Beacon on would take,
 * so a gap of 1 is that slot. The slot is at least `leadMs` away: LEAD_MS when Beacon turns on
 * or the percentage changes, 0 when a transmission has just ended and the next one may follow
 * at once.
 */
export function nextTxSlot(nowMs: number, pct: number, lastTxSlot: number | null, leadMs: number = LEAD_MS, random: () => number = Math.random): number {
  const gap = gapSlots(pct, random);
  const soonest = soonestSlot(nowMs, leadMs);
  if (lastTxSlot === null) return soonest + (gap - 1) * WSPR_SLOT_MS;
  return Math.max(lastTxSlot + gap * WSPR_SLOT_MS, soonest);
}

/** When Stop beacon after ends a beacon turned on at `startedAtMs`, UTC ms; null when it is Off. */
export function stopsAtMs(startedAtMs: number, stopAfterMin: number): number | null {
  return stopAfterMin > 0 ? startedAtMs + stopAfterMin * 60_000 : null;
}

/** A Stop beacon after value, min: positive, to 1 min, at most 7 days; 0 for Off; null when not one. */
export function normaliseStopAfter(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  const m = Math.round(v);
  return m <= 7 * 24 * 60 ? m : null;
}

/** "1 h", "90 min", "2 h 30 min", "Off". */
export function durationText(min: number): string {
  if (min <= 0) return 'Off';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The next value the ••• menu steps to from `min`: the next step above it, then Off. */
export function nextStopAfter(min: number): number {
  return STOP_AFTER_STEPS_MIN.find((s) => s > min) ?? 0;
}
