/**
 * Maps display spectrum power to the 0 to 255 colormap scale, following the noise floor so the
 * waterfall reads the same at any input level. The floor is the 30th percentile of the bins
 * from 200 to 2800 Hz, which stays on noise while fewer than 70 % of bins carry signals,
 * smoothed over about 2 s of rows. The scale spans 33 dB, as in the mockups: average noise maps
 * to 0.24, above the second colour stop (0.18), and a signal 25 dB over it reaches the top.
 */

import { BIN_HZ, DISPLAY_BINS } from './spectrum';

/** Display range, dB: the whole colormap spans 33 dB. */
export const RANGE_DB = 33;
/** Where average noise sits on the 0 to 1 scale. */
export const NOISE_POSITION = 0.24;
/** Average power of noise bins over their 30th percentile, dB (exponential distribution). */
const MEAN_OVER_P30_DB = -10 * Math.log10(-Math.log(0.7));

const LOW = Math.round(200 / BIN_HZ);
const HIGH = Math.min(DISPLAY_BINS - 1, Math.round(2800 / BIN_HZ));

export class LevelMapper {
  private floor: number | null = null;
  private readonly scratch = new Float32Array(HIGH - LOW + 1);
  private readonly alpha: number;

  /** `rowsPerSecond` sets the smoothing to about 2 s. */
  constructor(rowsPerSecond = 12) {
    this.alpha = 1 - Math.exp(-1 / (2 * rowsPerSecond));
  }

  /** Current floor estimate, dB (30th percentile), or null before the first row with signal. */
  get floorDb(): number | null {
    return this.floor;
  }

  /** Levels 0..255 for one row of dB values. */
  map(db: Float32Array, out = new Uint8Array(db.length)): Uint8Array {
    this.scratch.set(db.subarray(LOW, HIGH + 1));
    this.scratch.sort();
    const p30 = this.scratch[Math.floor(0.3 * (this.scratch.length - 1))];
    if (Number.isFinite(p30)) this.floor = this.floor === null ? p30 : this.floor + this.alpha * (p30 - this.floor);
    if (this.floor === null) return out.fill(0);
    const zero = this.floor + MEAN_OVER_P30_DB - NOISE_POSITION * RANGE_DB;
    for (let k = 0; k < db.length; k++) {
      const v = (db[k] - zero) / RANGE_DB;
      out[k] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
    return out;
  }

  reset() {
    this.floor = null;
  }
}
