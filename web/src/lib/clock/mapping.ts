/**
 * Maps the audio clock (AudioContext time, s) to UTC (ms since the epoch).
 *
 * Each observation pairs an audio-clock time with a performance.now() time from
 * AudioContext.getOutputTimestamp(), and performance.now() with Date.now(). Their difference is
 * the offset between the clocks. The mapper keeps the median of the last 31 observations, which
 * rejects the jitter of single timestamps (a few ms) and follows slow drift between the sound
 * card and the system clock.
 *
 * Input latency is unknown on iOS, so captured audio may be stamped late by a fixed amount.
 * `offsetS` carries the correction measured from decode DTs; it is 0 until that exists.
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

export class AudioClockMapper {
  /**
   * Seconds added to every mapped time. DT-based correction sets it to minus the median decode
   * DT, so audio stamped late by input latency moves back to when it was received.
   */
  offsetS = 0;
  private readonly size: number;
  private readonly obs: number[] = [];
  private next = 0;
  private median: number | null = null;

  constructor(size = 31) {
    this.size = size;
  }

  /** True once at least one observation is in. */
  get ready(): boolean {
    return this.median !== null;
  }

  /** UTC ms minus audio-clock ms, before `offsetS`; null until ready. */
  get baseMs(): number | null {
    return this.median;
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
    return true;
  }

  /** Forgets every observation, for when the audio clock stopped (suspend, interruption). */
  reset() {
    this.obs.length = 0;
    this.next = 0;
    this.median = null;
  }

  /** UTC ms for an audio-clock time in s. */
  toUtcMs(contextTime: number): number {
    if (this.median === null) throw new Error('The audio clock has no UTC reference yet.');
    return contextTime * 1000 + this.median + this.offsetS * 1000;
  }

  /** Audio-clock time in s for a UTC time in ms. */
  toContextTime(utcMs: number): number {
    if (this.median === null) throw new Error('The audio clock has no UTC reference yet.');
    return (utcMs - this.median - this.offsetS * 1000) / 1000;
  }
}
