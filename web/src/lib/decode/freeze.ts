/**
 * Keeps a list still under a finger: frozen while touched and for 0.5 s after the last touch
 * or scroll, so a row never moves away just as it is tapped. New items wait and go in once the
 * list is free.
 */

export const HOLD_MS = 500;

export class TouchFreeze {
  private touches = 0;
  private lastActivity = Number.NEGATIVE_INFINITY;
  private readonly holdMs: number;

  constructor(holdMs = HOLD_MS) {
    this.holdMs = holdMs;
  }

  /** A finger (or pointer) went down on the list. */
  down(now: number) {
    this.touches++;
    this.lastActivity = now;
  }

  /** A finger lifted, or the touch was cancelled. */
  up(now: number) {
    this.touches = Math.max(0, this.touches - 1);
    this.lastActivity = now;
  }

  /** The list scrolled, including momentum after the finger lifted. */
  activity(now: number) {
    this.lastActivity = now;
  }

  frozen(now: number): boolean {
    return this.touches > 0 || now - this.lastActivity < this.holdMs;
  }

  /** Time until the list is free, ms: 0 when free now, Infinity while touched. */
  wait(now: number): number {
    if (this.touches > 0) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.lastActivity + this.holdMs - now);
  }
}
