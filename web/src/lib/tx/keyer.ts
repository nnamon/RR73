/**
 * Keying the radio by PTT over rig control (docs/design/cat.md, Transmit). With rig control off,
 * or its keying switch off, there is no keyer and the radio keys by VOX on the audio alone.
 *
 * Every transmission keys, waits for the radio's OK, and starts its audio PTT_SETTLE_MS or more
 * after it. Without an OK within PTT_TIMEOUT_MS no audio plays. The end of the audio releases
 * PTT after the output's latency and PTT_TAIL_MS (tailMs), so the last sample has left the output;
 * Halt releases it at once.
 */

import { STATUS } from '../qso/status';
import { wake } from '../clock/wake';

/** How long the radio has to answer PTT on with OK, ms. Unverified on a device. */
export const PTT_TIMEOUT_MS = 300;
/** Audio starts at least this long after the radio's OK, ms: the radio's switch to transmit. Unverified on a device. */
export const PTT_SETTLE_MS = 100;
/**
 * FT8, FT4 and WSPR key this long before their audio, ms: PTT_TIMEOUT_MS and PTT_SETTLE_MS fit in
 * it, so the audio starts on time at slot + 0.5 s (slot + 1 s in WSPR) whenever the OK arrives
 * within the timeout. It is the transmit scheduler's pre-roll (lib/tx/scheduler.ts).
 */
export const PTT_LEAD_MS = 500;
/**
 * How long the Tx dial set before PTT on waits for the radio's OK, ms, when the dial shifts for a
 * transmission (lib/cat/passband.ts). Unverified on a device.
 */
export const DIAL_TIMEOUT_MS = 300;
/** PTT goes off this long after the audio ends, ms, on top of the output's latency. */
export const PTT_TAIL_MS = 100;

/** The parts of an AudioContext that give its output latency; Chromium has outputLatency, Safari baseLatency. */
export interface LatencySource {
  readonly outputLatency?: number;
  readonly baseLatency?: number;
}

/**
 * How long after the audio ends PTT goes off, ms: the output's latency, so the last sample has
 * been heard, and PTT_TAIL_MS.
 */
export function tailMs(ctx: LatencySource | null | undefined): number {
  const latencyS = ctx?.outputLatency || ctx?.baseLatency || 0;
  return PTT_TAIL_MS + Math.round(Math.max(0, Math.min(latencyS, 1)) * 1000);
}

/**
 * The radio's answer to PTT on: OK, NG, no answer in time, or no link; `dial` when the Tx dial set
 * before it was refused or unanswered, and PTT on never went out.
 */
export type KeyResult = 'ok' | 'ng' | 'timeout' | 'closed' | 'dial';

/** One transmission's hold on PTT. */
export interface Keying {
  /** Resolves with the radio's answer to PTT on. */
  readonly result: Promise<KeyResult>;
  /**
   * True while this keying holds PTT on: false once released, by its limit, or by Halt, a fault
   * or the link ending. Audio starts only while it is true.
   */
  readonly held: boolean;
  /**
   * PTT off, now or after `tailMs`, unless a later keying holds PTT by then. Safe to call more
   * than once.
   */
  release(tailMs?: number): void;
}

export interface Keyer {
  /**
   * PTT on. PTT goes off `maxMs` later whatever else happens. With `shiftHz` the radio's dial
   * moves that far first, and PTT on goes out after the radio's OK to it; the receive dial is set
   * back once PTT off is confirmed (docs/design/cat.md, Passband shift).
   */
  key(maxMs: number, shiftHz?: number): Keying;
}

/** The status line when a transmission cannot key the radio. */
export function keyFailedText(r: Exclude<KeyResult, 'ok'>): string {
  return r === 'ng' ? STATUS.pttRefused : r === 'timeout' ? STATUS.pttNoReply : r === 'dial' ? STATUS.txDialFailed : STATUS.radioDown;
}

/**
 * Waits `ms`; resolves at once for 0. On the wake timers (lib/clock/wake.ts), so the waits around
 * a keying, such as the 0.1 s from the radio's OK to the audio and Test keying's 1 s, keep time in a
 * hidden page.
 */
export function pause(ms: number, timer: (fn: () => void, ms: number) => unknown = (fn, t) => wake.set(fn, t)): Promise<void> {
  return ms > 0 ? new Promise((r) => timer(r, ms)) : Promise.resolve();
}
