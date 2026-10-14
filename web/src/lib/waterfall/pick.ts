/**
 * Picking audio frequencies on the waterfall: the frequency under a finger, the limits for each
 * mode, and the quietest stretch of the band for a Tx frequency.
 */

import { BIN_HZ, DISPLAY_BINS, viewOf } from './spectrum';
import { SLOT_MS, type FtMode, type Mode } from '../clock/slots';

/** Width of a signal, Hz: FT8 is 8 tones 6.25 Hz apart, FT4 4 tones 20.83 Hz apart. */
export const SIGNAL_HZ: Record<FtMode, number> = { FT8: 50, FT4: 83 };

/**
 * Lowest and highest audio frequency for the lowest tone (FT8 and FT4) or the signal centre
 * (WSPR), Hz. The top tone stays under about 2850 Hz, inside the passband of an SSB filter, in
 * FT8 and FT4. A WSPR signal, 6 Hz wide, stays 7 Hz inside the 1400 to 1600 Hz window.
 */
export const FREQ_LIMITS: Record<Mode, { minHz: number; maxHz: number }> = {
  FT8: { minHz: 200, maxHz: 2800 },
  FT4: { minHz: 200, maxHz: 2767 },
  WSPR: { minHz: 1410, maxHz: 1590 },
  // RTTY's pair: its mark tone, kept so both tones stay inside 200 to 2900 Hz (lib/rtty/settings.ts).
  RTTY: { minHz: 200, maxHz: 2900 },
};

/** `hz` rounded to 1 Hz and kept inside the mode's limits. */
export function clampHz(hz: number, mode: Mode): number {
  const { minHz, maxHz } = FREQ_LIMITS[mode];
  return Math.min(maxHz, Math.max(minHz, Math.round(hz)));
}

/**
 * Frequency under a point `x` CSS pixels from the left edge of a waterfall `width` CSS pixels
 * wide, Hz. The waterfall shows the mode's view (0 to 3000 Hz, or 1400 to 1600 Hz in WSPR) across
 * its width at any device pixel ratio, so CSS pixels map directly.
 */
export function hzAtX(x: number, width: number, mode: Mode): number {
  const v = viewOf(mode);
  if (!(width > 0)) return clampHz((v.minHz + v.maxHz) / 2, mode);
  return clampHz(v.minHz + (x / width) * (v.maxHz - v.minHz), mode);
}

/** Position of `hz` from the left of the mode's view, 0 to 1. */
export function xOfHz(hz: number, mode: Mode = 'FT8'): number {
  const v = viewOf(mode);
  return Math.min(1, Math.max(0, (hz - v.minHz) / (v.maxHz - v.minHz)));
}

/** Slots of spectrum the quiet search uses: at least 2, at most 4. */
export const QUIET_MIN_SLOTS = 2;
export const QUIET_MAX_SLOTS = 4;

/**
 * The pause between transmissions in each slot, s after the slot start: FT8 signals end by
 * 13.1 s plus their DT and FT4 signals by 5.5 s; the next slot's start 0.5 s early at the
 * soonest. A row is in the pause when its window (171 ms) is.
 */
export const PAUSE_S: Record<FtMode, { from: number; to: number }> = { FT8: { from: 14.2, to: 15 }, FT4: { from: 6.3, to: 7.4 } };

/** Power per bin of one slot: the mean over the slot, and the mean over its pause. */
export interface SlotPower {
  mean: Float64Array;
  /** Null when no row fell in the pause. */
  pause: Float64Array | null;
}

/**
 * Power of the display spectrum per slot, for the last QUIET_MAX_SLOTS whole slots. Fed with
 * each waterfall row (dB per bin) and its time.
 */
export class QuietTracker {
  private mode: FtMode;
  private current: { start: number; firstMs: number; lastMs: number; sum: Float64Array; rows: number; pause: Float64Array; pauseRows: number } | null = null;
  private done: { start: number; power: SlotPower }[] = [];

  constructor(mode: FtMode) {
    this.mode = mode;
  }

  setMode(mode: FtMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.reset();
  }

  reset() {
    this.current = null;
    this.done = [];
  }

  /** Adds one row: power per bin, dB, for a window centred at `utcMs`. */
  add(db: Float32Array, utcMs: number) {
    const slotMs = SLOT_MS[this.mode];
    const start = Math.floor(utcMs / slotMs) * slotMs;
    const c = this.current;
    if (c && start !== c.start) {
      // A slot counts when at least half of it was heard. After a gap the older slots are stale.
      if (start !== c.start + slotMs) this.done = [];
      else if (c.lastMs - c.firstMs >= slotMs / 2) {
        const power: SlotPower = { mean: c.sum.map((x) => x / c.rows), pause: c.pauseRows ? c.pause.map((x) => x / c.pauseRows) : null };
        this.done.push({ start: c.start, power });
        if (this.done.length > QUIET_MAX_SLOTS) this.done.shift();
      }
      this.current = null;
    }
    if (!this.current) {
      this.current = { start, firstMs: utcMs, lastMs: utcMs, sum: new Float64Array(DISPLAY_BINS), rows: 0, pause: new Float64Array(DISPLAY_BINS), pauseRows: 0 };
    }
    const cur = this.current;
    const at = (utcMs - start) / 1000;
    const { from, to } = PAUSE_S[this.mode];
    const inPause = at >= from && at < to;
    for (let k = 0; k < DISPLAY_BINS; k++) {
      const p = Number.isFinite(db[k]) ? 10 ** (db[k] / 10) : 0;
      cur.sum[k] += p;
      if (inPause) cur.pause[k] += p;
    }
    cur.rows++;
    if (inPause) cur.pauseRows++;
    cur.lastMs = utcMs;
  }

  /**
   * Power of each whole slot kept, oldest first. Only slots that ended within one slot of
   * `nowMs` and the ones before them count.
   */
  slots(nowMs: number): SlotPower[] {
    const slotMs = SLOT_MS[this.mode];
    const last = this.done.at(-1);
    if (!last || nowMs - (last.start + slotMs) > slotMs) return [];
    return this.done.map((d) => d.power);
  }
}

/** The noise floor is smoothed over this many bins each side: about 60 Hz. */
const FLOOR_BINS = 10;
/** Windows within this much of the quietest (power over noise floor, 1 when clear) count as equally quiet. */
const TIE = 0.25;

/**
 * Lowest tone of the quietest window, one signal wide, between the mode's limits, Hz; null with
 * fewer than QUIET_MIN_SLOTS slots or no pause heard. The noise floor of each bin comes from the
 * pauses between transmissions, when every station is off, smoothed over 120 Hz; a window's
 * score is its mean power over that floor, 1 when nobody transmits there. The floor carries the
 * shape of the radio's filter, so its slope does not pull the choice to the band edges. Among
 * equally quiet windows, the one nearest `nearHz` wins, so a clear Tx frequency stays put.
 */
export function quietestHz(slots: SlotPower[], mode: FtMode, nearHz: number): number | null {
  const use = slots.slice(-QUIET_MAX_SLOTS);
  if (use.length < QUIET_MIN_SLOTS) return null;
  const pauses = use.flatMap((u) => (u.pause ? [u.pause] : []));
  if (!pauses.length) return null;
  const mean = new Float64Array(DISPLAY_BINS);
  const pause = new Float64Array(DISPLAY_BINS);
  for (const u of use) for (let k = 0; k < DISPLAY_BINS; k++) mean[k] += u.mean[k] / use.length;
  for (const p of pauses) for (let k = 0; k < DISPLAY_BINS; k++) pause[k] += p[k] / pauses.length;
  const floor = smooth(pause, FLOOR_BINS);
  const { minHz, maxHz } = FREQ_LIMITS[mode];
  const width = Math.ceil(SIGNAL_HZ[mode] / BIN_HZ);
  const k0 = Math.ceil(minHz / BIN_HZ);
  const k1 = Math.floor(maxHz / BIN_HZ);
  const scores: { k: number; score: number }[] = [];
  for (let k = k0; k <= k1; k++) {
    let m = 0;
    let f = 0;
    for (let j = k; j < k + width && j < DISPLAY_BINS; j++) {
      m += mean[j];
      f += floor[j];
    }
    scores.push({ k, score: f > 0 ? m / f : Number.POSITIVE_INFINITY });
  }
  const min = Math.min(...scores.map((s) => s.score));
  if (!Number.isFinite(min)) return null;
  let best: { hz: number; d: number } | null = null;
  for (const s of scores) {
    if (s.score > min + TIE) continue;
    const hz = clampHz(s.k * BIN_HZ, mode);
    const d = Math.abs(hz - nearHz);
    if (!best || d < best.d) best = { hz, d };
  }
  return best?.hz ?? null;
}

function smooth(p: Float64Array, half: number): Float64Array {
  const out = new Float64Array(p.length);
  for (let k = 0; k < p.length; k++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(p.length - 1, k + half); j++) {
      s += p[j];
      n++;
    }
    out[k] = s / n;
  }
  return out;
}
