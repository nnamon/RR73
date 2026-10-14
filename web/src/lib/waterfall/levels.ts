/**
 * Maps display spectrum power to the 0 to 255 colormap scale. Each bin is levelled against its
 * own noise floor, so the radio's passband shape drops out and a weak signal near a filter edge
 * shows as clearly as one in the middle; then the whole row follows the noise level.
 *
 * - Per bin, the level averaged over about 10 s.
 * - Across frequency, a smooth floor under those averages is the bin's baseline (baseline()):
 *   signals 50 or 83 Hz wide fall out of it, even when they transmit in both slots, and the slopes
 *   of the passband stay in it.
 * - The 30th percentile of the levelled bins from 200 to 2800 Hz, smoothed over about 2 s, gives
 *   the average noise: noise power is exponential, so its average is 4.5 dB over the 30th
 *   percentile.
 *
 * For the first 2 s the averages are too noisy for a baseline, and rows follow the noise level only.
 *
 * WSPR's view (spectrum.ts) has its own bins: 1.46 Hz wide from 1400 to 1600 Hz. There the
 * baseline window is ±25 Hz, wide enough for a 6 Hz signal to fall out of it, and the noise level
 * comes from every bin of the view (bandFor).
 *
 * Average noise maps to 0.2 of the scale. The contrast setting sets how many dB over the average
 * noise reach the top: 20 dB by default, so a signal 3 dB over the noise sits on the cyan stop
 * (colormap.ts).
 */

import { BIN_HZ, DISPLAY_BINS, binHz, binsOf, type View } from './spectrum';

export type Contrast = 'low' | 'normal' | 'high';

/** dB from average noise to the top of the scale, per contrast setting. */
export const SPAN_DB: Record<Contrast, number> = { low: 28, normal: 20, high: 14 };
/** Where average noise sits on the 0 to 1 scale. */
export const NOISE_POSITION = 0.2;
/** Average power of noise bins over their 30th percentile, dB (exponential distribution). */
const MEAN_OVER_P30_DB = -10 * Math.log10(-Math.log(0.7));
/** Stands in for an empty bin (exact silence), dB. */
const SILENT_DB = -200;

const LOW = Math.round(200 / BIN_HZ);
const HIGH = Math.min(DISPLAY_BINS - 1, Math.round(2800 / BIN_HZ));
/** Half the width of the baseline window, bins: ±100 Hz. */
export const HALF_WINDOW = Math.round(100 / BIN_HZ);

/** The bins a mapper works on: how many, the range the noise level is read from, and the baseline's half window. */
export interface Band {
  bins: number;
  low: number;
  high: number;
  half: number;
}

/** FT8 and FT4: 0 to 3000 Hz, noise from 200 to 2800 Hz, baseline ±100 Hz. */
export const FT_BAND: Band = { bins: DISPLAY_BINS, low: LOW, high: HIGH, half: HALF_WINDOW };

/** The mapper's bins for a view: FT_BAND for 0 to 3000 Hz; for a narrow view, every bin, baseline ±25 Hz. */
export function bandFor(v: View): Band {
  if (v.minHz === 0 && v.maxHz === 3000 && binHz(v) === BIN_HZ) return FT_BAND;
  const { count } = binsOf(v);
  return { bins: count, low: 0, high: count - 1, half: Math.round(25 / binHz(v)) };
}

/** The 0 to 1 scale position of a level `dbOverNoise` over the average noise, unclamped. */
export function scalePosition(dbOverNoise: number, contrast: Contrast = 'normal'): number {
  return NOISE_POSITION + (dbOverNoise * (1 - NOISE_POSITION)) / SPAN_DB[contrast];
}

function extreme(values: Float32Array, half: number, out: Float32Array, low: boolean): Float32Array {
  const n = values.length;
  for (let k = 0; k < n; k++) {
    let m = low ? Infinity : -Infinity;
    for (let j = Math.max(0, k - half); j <= Math.min(n - 1, k + half); j++) if (low ? values[j] < m : values[j] > m) m = values[j];
    out[k] = m;
  }
  return out;
}

/**
 * A smooth floor under `values`: the lowest value within ±`half`, then the highest of those within
 * ±`half` (peaks narrower than the window drop out, slopes stay), then the mean within ±`half`.
 * `a` and `b` are work arrays of the same length.
 */
export function baseline(values: Float32Array, half: number, a: Float32Array, b: Float32Array, out: Float32Array): Float32Array {
  extreme(values, half, a, true);
  extreme(a, half, b, false);
  const n = values.length;
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let k = 0; k < n; k++) {
    const from = Math.max(0, k - half);
    const to = Math.min(n - 1, k + half);
    while (hi < to) sum += b[++hi];
    while (lo < from) sum -= b[lo++];
    out[k] = sum / (to - from + 1);
  }
  return out;
}

export class LevelMapper {
  private floor: number | null = null;
  private track: Float32Array | null = null;
  private readonly band: Band;
  private readonly work: Float32Array[];
  private readonly base: Float32Array;
  private readonly level: Float32Array;
  private readonly scratch: Float32Array;
  private alpha = 0;
  private slow = 0;
  /** Rows averaged so far, for the start of the average. */
  private count = 0;
  /** Rows before the baseline is used: 2 s. */
  private warm = 24;
  private contrast: Contrast = 'normal';

  /** `rowsPerSecond` sets the smoothing times in rows. */
  constructor(rowsPerSecond = 12, band: Band = FT_BAND) {
    this.band = band;
    this.work = [new Float32Array(band.bins), new Float32Array(band.bins)];
    this.base = new Float32Array(band.bins);
    this.level = new Float32Array(band.bins);
    this.scratch = new Float32Array(band.high - band.low + 1);
    this.setRate(rowsPerSecond);
  }

  /** Rows per second, as the row period changes with the canvas height. */
  setRate(rowsPerSecond: number) {
    const a = (seconds: number) => 1 - Math.exp(-1 / (seconds * rowsPerSecond));
    this.alpha = a(2);
    this.slow = a(10);
    this.warm = Math.max(1, Math.round(2 * rowsPerSecond));
  }

  setContrast(c: Contrast) {
    this.contrast = c;
  }

  /** Current average-noise estimate on the levelled scale, dB (30th percentile), or null before the first row with signal. */
  get floorDb(): number | null {
    return this.floor;
  }

  /** Levels 0..255 for one row of dB values, which the baseline and the noise level learn from. */
  map(db: Float32Array, out = new Uint8Array(db.length)): Uint8Array {
    return this.levels(db, out, true);
  }

  /**
   * Levels for one row as `map` gives them, without learning from it: for a row that may hold the
   * radio's own transmission, which would raise the noise level for the rows after it.
   */
  peek(db: Float32Array, out = new Uint8Array(db.length)): Uint8Array {
    return this.levels(db, out, false);
  }

  private levels(db: Float32Array, out: Uint8Array, learn: boolean): Uint8Array {
    const { bins, low, high, half } = this.band;
    const n = Math.min(db.length, bins);
    let any = false;
    for (let k = 0; k < n && !any; k++) any = Number.isFinite(db[k]);
    if (!any) return out.fill(0);
    const v = (k: number) => (Number.isFinite(db[k]) ? db[k] : SILENT_DB);
    if (learn) {
      const t = (this.track ??= new Float32Array(bins));
      const w = Math.max(this.slow, 1 / ++this.count);
      for (let k = 0; k < n; k++) t[k] += w * (v(k) - t[k]);
      if (this.count >= this.warm) {
        // The noise level is measured afresh on the levelled scale.
        if (this.count === this.warm) this.floor = null;
        baseline(t, half, this.work[0], this.work[1], this.base);
      } else this.base.fill(0);
    }
    for (let k = 0; k < n; k++) this.level[k] = v(k) - this.base[k];
    this.scratch.set(this.level.subarray(low, high + 1));
    this.scratch.sort();
    const p30 = this.scratch[Math.floor(0.3 * (this.scratch.length - 1))];
    const floor = this.floor === null ? p30 : this.floor + this.alpha * (p30 - this.floor);
    if (learn) this.floor = floor;
    const noise = (learn ? floor : (this.floor ?? p30)) + MEAN_OVER_P30_DB;
    for (let k = 0; k < db.length; k++) {
      if (k >= n || !Number.isFinite(db[k])) {
        out[k] = 0;
        continue;
      }
      const p = scalePosition(this.level[k] - noise, this.contrast);
      out[k] = p <= 0 ? 0 : p >= 1 ? 255 : Math.round(p * 255);
    }
    return out;
  }

  reset() {
    this.floor = null;
    this.track = null;
    this.count = 0;
  }
}
