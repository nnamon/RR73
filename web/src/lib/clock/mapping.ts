/**
 * Maps the audio clock (AudioContext time, s) to UTC (ms since the epoch).
 *
 * Each observation pairs an audio-clock time with a performance.now() time from
 * AudioContext.getOutputTimestamp(), and performance.now() with Date.now(). Their difference is
 * the offset between the clocks. The mapper keeps the median of the last 31 observations, which
 * rejects the jitter of single timestamps (a few ms) and follows slow drift between the sound
 * card and the system clock.
 *
 * The mapping gives the time a frame is heard, which is what transmit scheduling needs. Captured
 * audio goes through `captureUtcMs`, which adds `inputOffsetS`: the receive calibration learned
 * from decode DTs (lib/clock/calibration.ts). Transmit timing never uses it.
 *
 * An output timestamp is only as good as the browser's. `outputLatencyMs` checks one against
 * currentTime and performance.now(): in Playwright's WebKit on Linux, performanceTime advances
 * 2 s per second, and a mapping built on it runs ahead of UTC by the time audio has run.
 */

export interface OutputTimestamp {
  /** Audio-clock time, s. */
  contextTime: number;
  /** performance.now() time at which that audio-clock time is heard, ms. */
  performanceTime: number;
}

/**
 * Output latencies outside this range, ms, mean the timestamp is wrong. The upper bound is above
 * the latency of wired and Bluetooth headsets; no output plays a frame before it is rendered,
 * and the lower bound leaves room for timestamps rounded to 1 ms and render quanta of 2.7 ms.
 */
export const LATENCY_RANGE_MS = { min: -200, max: 500 } as const;

/**
 * Output latency an output timestamp implies, ms: how long after `perfNow` the frame rendered at
 * `currentTime` (s) is heard. A correct timestamp gives a few ms to a few hundred.
 */
export function outputLatencyMs(ts: OutputTimestamp, currentTime: number, perfNow: number): number {
  return ts.performanceTime + (currentTime - ts.contextTime) * 1000 - perfNow;
}

/** True when an output timestamp agrees with currentTime and performance.now() read with it. */
export function plausibleTimestamp(ts: OutputTimestamp, currentTime: number, perfNow: number): boolean {
  const ms = outputLatencyMs(ts, currentTime, perfNow);
  return ms >= LATENCY_RANGE_MS.min && ms <= LATENCY_RANGE_MS.max;
}

/** Spacing of the mapping history kept for the drift estimate, ms. */
const DRIFT_STEP_MS = 5000;
/** History kept for the drift estimate: 10 minutes. */
const DRIFT_KEEP = 120;
/** History needed before the drift estimate shows, ms. */
const DRIFT_MIN_MS = 60_000;

export class AudioClockMapper {
  /**
   * Seconds added to the UTC of captured audio only. The receive calibration sets it to minus
   * the median DT of strong decodes, so audio stamped early or late moves to when it was received.
   */
  inputOffsetS = 0;
  private readonly size: number;
  private readonly obs: number[] = [];
  private next = 0;
  private median: number | null = null;
  /** [Date.now() ms, median ms], one every DRIFT_STEP_MS since the last reset. */
  private history: [number, number][] = [];

  constructor(size = 31) {
    this.size = size;
  }

  /** True once at least one observation is in. */
  get ready(): boolean {
    return this.median !== null;
  }

  /** Observations since the last reset, up to the window size. */
  get count(): number {
    return this.obs.length;
  }

  /** The observations, UTC ms minus audio-clock ms, oldest first. */
  get observations(): number[] {
    return this.obs.length < this.size ? [...this.obs] : [...this.obs.slice(this.next), ...this.obs.slice(0, this.next)];
  }

  /** UTC ms minus audio-clock ms; null until ready. */
  get baseMs(): number | null {
    return this.median;
  }

  /**
   * How fast the audio clock runs against UTC, ppm, from the mapping over up to the last
   * 10 minutes: positive when it runs slow. Null until a minute of mapping is in.
   */
  get driftPpm(): number | null {
    const h = this.history;
    if (h.length < 3 || h[h.length - 1][0] - h[0][0] < DRIFT_MIN_MS) return null;
    // Least-squares slope of the mapping offset against time.
    const t0 = h[0][0];
    const b0 = h[0][1];
    let st = 0;
    let sb = 0;
    for (const [t, b] of h) {
      st += t - t0;
      sb += b - b0;
    }
    const mt = st / h.length;
    const mb = sb / h.length;
    let num = 0;
    let den = 0;
    for (const [t, b] of h) {
      num += (t - t0 - mt) * (b - b0 - mb);
      den += (t - t0 - mt) ** 2;
    }
    return den > 0 ? (num / den) * 1e6 : null;
  }

  /**
   * Adds one observation. `perfNow` and `dateNow` are performance.now() and Date.now() read
   * together. Returns false for timestamps from a context that has not started output yet.
   */
  observe(ts: OutputTimestamp, perfNow: number, dateNow: number): boolean {
    if (!(ts.performanceTime > 0) || !(ts.contextTime > 0) || !Number.isFinite(perfNow) || !Number.isFinite(dateNow)) return false;
    const value = dateNow - perfNow + ts.performanceTime - ts.contextTime * 1000;
    if (this.obs.length < this.size) this.obs.push(value);
    else this.obs[this.next] = value;
    this.next = (this.next + 1) % this.size;
    const sorted = [...this.obs].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    this.median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const last = this.history[this.history.length - 1];
    if (!last || dateNow - last[0] >= DRIFT_STEP_MS) {
      this.history.push([dateNow, this.median]);
      if (this.history.length > DRIFT_KEEP) this.history.shift();
    }
    return true;
  }

  /** Forgets every observation, for when the audio clock stopped (suspend, interruption). */
  reset() {
    this.obs.length = 0;
    this.next = 0;
    this.median = null;
    this.history = [];
  }

  /** UTC ms at which audio-clock time `contextTime` (s) is heard. */
  toUtcMs(contextTime: number): number {
    if (this.median === null) throw new Error('The audio clock has no UTC reference yet.');
    return contextTime * 1000 + this.median;
  }

  /** Audio-clock time in s that is heard at UTC `utcMs`. */
  toContextTime(utcMs: number): number {
    if (this.median === null) throw new Error('The audio clock has no UTC reference yet.');
    return (utcMs - this.median) / 1000;
  }

  /** UTC ms of captured audio at audio-clock time `contextTime` (s), with the receive calibration. */
  captureUtcMs(contextTime: number): number {
    return this.toUtcMs(contextTime) + this.inputOffsetS * 1000;
  }
}
