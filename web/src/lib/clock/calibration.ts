/**
 * Receive calibration: an offset for the UTC stamped on captured audio, learned from the DT of
 * strong decodes. Stations with good clocks scatter around DT 0, so the median DT of many of them
 * measures how late or early RR73 stamps its receive audio. The offset moves capture stamps only;
 * transmit timing never uses it.
 *
 * The offset changes by at most 0.08 s per decoded slot and stays within ±2.5 s, the range in
 * which FT8 still decodes. The slot assembler applies a change at the next slot boundary, so a
 * slot's audio carries the offset in force when the slot started; its DTs are read against that.
 *
 * The same median measures the phone's clock (clockS). Transmit timing runs on that clock, so a
 * clock 1.2 s slow puts every transmission 1.2 s late on the air; the clock warning (CLOCK_WARN)
 * tells the operator, who sets the clock right.
 */

import type { Decode } from '../decode/types';

export const CALIBRATION = {
  /** Decodes at or above this SNR count, dB. */
  minSnrDb: -10,
  /** Strong decodes needed before the offset moves. */
  minDecodes: 8,
  /** Decodes older than this, relative to the newest slot, drop out, ms. */
  keepMs: 120_000,
  /** Largest change per decoded slot, s. */
  maxStepS: 0.08,
  /** Share of the remaining error corrected per decoded slot. */
  gain: 0.5,
  /** Errors below this leave the offset alone, s. */
  deadbandS: 0.03,
  /** Largest offset, s. */
  maxOffsetS: 2.5,
} as const;

/** The clock warning: on from 1 s off, off again below 0.8 s, so a clock near 1 s does not flicker it. */
export const CLOCK_WARN = { onS: 1, offS: 0.8 } as const;

/** Whether the clock warning holds for a clock `clockS` off (RxCalibration.clockS), given whether it held before. */
export function clockWarns(clockS: number, before: boolean): boolean {
  return Math.abs(clockS) >= (before ? CLOCK_WARN.offS : CLOCK_WARN.onS);
}

/** "1.2 s slow", "0.9 s fast", "On time" within 0.05 s. */
export function clockText(clockS: number): string {
  const s = Math.abs(clockS);
  if (s < 0.05) return 'On time';
  return `${s.toFixed(1)} s ${clockS > 0 ? 'slow' : 'fast'}`;
}

interface Entry {
  slotStartMs: number;
  /** DT the decode would have had with no offset applied, s. */
  rawS: number;
  /** DT as decoded, s. */
  dtS: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export class RxCalibration {
  /** Offset to add to capture stamps, s. */
  offsetS = 0;
  private entries: Entry[] = [];
  /** Offset changes: [UTC ms of the change, offset from then, s], oldest first. */
  private changes: [number, number][] = [];

  /** Offset the audio of the slot starting at `slotStartMs` was stamped with, s. */
  appliedAt(slotStartMs: number): number {
    for (let i = this.changes.length - 1; i >= 0; i--) if (this.changes[i][0] < slotStartMs) return this.changes[i][1];
    return 0;
  }

  /**
   * Takes one slot's decodes at `nowMs` (UTC) and returns the new offset. Callers leave out
   * RR73's own transmissions.
   */
  add(slotStartMs: number, decodes: readonly Decode[], nowMs: number): number {
    const appliedS = this.appliedAt(slotStartMs);
    for (const d of decodes) {
      if (d.snr_db < CALIBRATION.minSnrDb || !Number.isFinite(d.dt_s)) continue;
      // A stamp moved later by appliedS places the signal later in the slot: DT grows by appliedS.
      this.entries.push({ slotStartMs, rawS: d.dt_s - appliedS, dtS: d.dt_s });
    }
    const newest = Math.max(slotStartMs, ...this.entries.map((e) => e.slotStartMs));
    this.entries = this.entries.filter((e) => newest - e.slotStartMs <= CALIBRATION.keepMs);
    if (this.entries.length < CALIBRATION.minDecodes) return this.offsetS;
    const target = clamp(-median(this.entries.map((e) => e.rawS)), CALIBRATION.maxOffsetS);
    const error = target - this.offsetS;
    if (Math.abs(error) < CALIBRATION.deadbandS) return this.offsetS;
    this.offsetS = clamp(this.offsetS + clamp(error * CALIBRATION.gain, CALIBRATION.maxStepS), CALIBRATION.maxOffsetS);
    this.changes.push([nowMs, this.offsetS]);
    if (this.changes.length > 32) this.changes.shift();
    return this.offsetS;
  }

  /** Strong decodes held. */
  get count(): number {
    return this.entries.length;
  }

  /**
   * How far the phone's clock runs behind the stations heard, s: positive slow, negative fast;
   * null below 8 strong decodes. Minus the median DT the decodes would have with no offset.
   * Input latency counts as fast: a few tens of ms through a cable.
   */
  get clockS(): number | null {
    return this.entries.length >= CALIBRATION.minDecodes ? -median(this.entries.map((e) => e.rawS)) : null;
  }

  /** Median DT of the strong decodes held, as decoded, s; null with none. */
  get medianDtS(): number | null {
    return this.entries.length ? median(this.entries.map((e) => e.dtS)) : null;
  }

  /** Forgets the decodes and the offset, for another input. */
  reset() {
    this.entries = [];
    this.changes = [];
    this.offsetS = 0;
  }
}

function clamp(v: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, v));
}
