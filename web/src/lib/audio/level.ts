/** Level of silence and of anything quieter, dBFS. */
export const FLOOR_DB = -120;

/** Converts a linear amplitude (1 = full scale) to dBFS, clamped at FLOOR_DB. */
export function toDb(amplitude: number): number {
  return amplitude > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(amplitude)) : FLOOR_DB;
}

/**
 * Accumulates peak and RMS for the level meter. RMS is 20 × log10(rms), so a full-scale sine
 * reads −3 dBFS and its peak 0 dBFS.
 */
export class LevelMeter {
  private peak = 0;
  private sumSquares = 0;
  private count = 0;

  add(x: Float32Array, length = x.length) {
    let peak = this.peak;
    let s = 0;
    for (let i = 0; i < length; i++) {
      const v = x[i];
      s += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    this.peak = peak;
    this.sumSquares += s;
    this.count += length;
  }

  /** Peak and RMS since the last read, dBFS, then starts a new window. */
  read(): { peakDb: number; rmsDb: number } {
    const out = {
      peakDb: toDb(this.peak),
      rmsDb: this.count ? toDb(Math.sqrt(this.sumSquares / this.count)) : FLOOR_DB,
    };
    this.peak = 0;
    this.sumSquares = 0;
    this.count = 0;
    return out;
  }
}
