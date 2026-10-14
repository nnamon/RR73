/**
 * The WSPR beacon's schedule (docs/design/wspr.md, Beacon schedule). Slots are 2 minutes from
 * an even UTC minute; a transmission starts 1 s into its slot and lasts 110.6 s.
 *
 * - Beacon on: the first Tx is drawn from the next slot that starts at least 10 s later, the time
 *   needed to build and queue the audio, and keeps the shortest gap after the last transmission,
 *   a cut-short one included.
 * - Each later gap is m + x slots, where n = 100 ÷ Tx percentage, m is the shortest gap (2 at 50%
 *   and below, so at least one receive slot separates transmissions; 1 above 50%) and x is drawn
 *   uniformly from 0 to 2(n − m), then rounded up or down at random in proportion to its
 *   fraction: the mean gap is n slots (at 20%: 2 to 8 slots, mean 5; at 50%: every other slot).
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
 * The shortest gap between transmissions, slots: 2 at 50% and below, so a receive slot always
 * separates them; 1 above 50%, where the beacon has to transmit in consecutive slots.
 */
export function minGapSlots(pct: number): number {
  return pct <= 50 ? 2 : 1;
}

/**
 * Slots from one transmission to the next, at `pct` percent: m + x, m the shortest gap and x
 * uniform from 0 to 2(n − m) with n = 100 ÷ pct, rounded at random in proportion to its fraction.
 * `random` returns values in [0, 1), as Math.random.
 */
export function gapSlots(pct: number, random: () => number = Math.random): number {
  const n = 100 / pct;
  const min = minGapSlots(pct);
  const x = random() * 2 * (n - min);
  const whole = Math.floor(x);
  return min + (random() < x - whole ? whole + 1 : whole);
}

/**
 * The next Tx slot, drawn at `nowMs`. After a transmission in `lastTxSlot` the gap counts from
 * it; with none, the shortest gap lands on the first slot Beacon on could take. The slot is at
 * least `leadMs` away: LEAD_MS when Beacon turns on or the percentage changes, 0 when a
 * transmission has just ended and the next one may follow at once.
 */
export function nextTxSlot(nowMs: number, pct: number, lastTxSlot: number | null, leadMs: number = LEAD_MS, random: () => number = Math.random): number {
  const gap = gapSlots(pct, random);
  const soonest = soonestSlot(nowMs, leadMs);
  if (lastTxSlot === null) return soonest + (gap - minGapSlots(pct)) * WSPR_SLOT_MS;
  return Math.max(lastTxSlot + gap * WSPR_SLOT_MS, soonest);
}

/**
 * The first Tx slot when Beacon turns on at `nowMs`: drawn as with nothing sent, and no sooner
 * than the shortest gap after `lastTxSlot`, the last transmission, a cut-short one included. A
 * Halt and Beacon on again keep a receive slot between transmissions at 50% and below.
 */
export function beaconOnSlot(nowMs: number, pct: number, lastTxSlot: number | null, random: () => number = Math.random): number {
  const slot = nextTxSlot(nowMs, pct, null, LEAD_MS, random);
  return lastTxSlot === null ? slot : Math.max(slot, lastTxSlot + minGapSlots(pct) * WSPR_SLOT_MS);
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
