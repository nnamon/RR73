/**
 * Keying the radio by PTT over rig control (docs/design/cat.md, Transmit). With rig control off,
 * or its keying switch off, there is no keyer and the radio keys by VOX on the audio alone.
 *
 * Every transmission keys, waits for the radio's OK, and starts its audio PTT_SETTLE_MS or more
 * after it. Without an OK within PTT_TIMEOUT_MS no audio plays. The end of the audio releases
 * PTT after PTT_TAIL_MS, so the output's buffer has played out; Halt releases it at once.
 */

import { STATUS } from '../qso/status';

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
/** PTT goes off this long after the audio ends, ms, so the output buffer has played out. */
export const PTT_TAIL_MS = 100;

/** The radio's answer to PTT on: OK, NG, no answer in time, or no link. */
export type KeyResult = 'ok' | 'ng' | 'timeout' | 'closed';

/** One transmission's hold on PTT. */
export interface Keying {
  /** Resolves with the radio's answer to PTT on. */
  readonly result: Promise<KeyResult>;
  /**
   * PTT off, now or after `tailMs`, unless a later keying holds PTT by then. Safe to call more
   * than once.
   */
  release(tailMs?: number): void;
}

export interface Keyer {
  /** PTT on. PTT goes off `maxMs` later whatever else happens. */
  key(maxMs: number): Keying;
}

/** The status line when a transmission cannot key the radio. */
export function keyFailedText(r: Exclude<KeyResult, 'ok'>): string {
  return r === 'ng' ? STATUS.pttRefused : r === 'timeout' ? STATUS.pttNoReply : STATUS.radioDown;
}

/** Waits `ms`; resolves at once for 0. */
export function pause(ms: number, timer: (fn: () => void, ms: number) => unknown = (fn, t) => setTimeout(fn, t)): Promise<void> {
  return ms > 0 ? new Promise((r) => timer(r, ms)) : Promise.resolve();
}
