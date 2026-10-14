// The spots waiting for the relay. RR73 sends them at most once a minute, up to 500 a request,
// and keeps what the relay has not taken. QSP applies PSK Reporter's own rules after that.

import type { PskSpot } from './spots';

/** Shortest time between two requests to the relay, ms. */
export const SEND_EVERY_MS = 60_000;
/** Most spots in one request, as QSP takes them. */
export const BATCH = 500;
/** Most spots kept while the relay is unreachable; the oldest go first. */
export const KEEP = 1000;

/** What the relay answered. */
export interface SendResult {
  taken: number;
  repeats: number;
  rejected: number;
}

export type Send = (spots: PskSpot[]) => Promise<SendResult>;

export interface QueueEvents {
  sent(r: SendResult, at: number): void;
  failed(e: unknown): void;
}

export class PskQueue {
  private spots: PskSpot[] = [];
  /** `${frequency MHz}|${slot start}|${callsign}` of the spots queued or sent lately: each station once per band and slot. */
  private seen = new Map<string, number>();
  private lastSendMs = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;

  constructor(
    private readonly send: Send,
    private readonly events: QueueEvents,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get waiting(): number {
    return this.spots.length;
  }

  /** Queues one slot's spots, each station once per band and slot, and sends when the minute allows. */
  add(spots: readonly PskSpot[], slotStartMs: number) {
    const now = this.now();
    for (const [k, at] of this.seen) if (now - at > 10 * 60_000) this.seen.delete(k);
    for (const s of spots) {
      const key = `${Math.floor(s.frequencyHz / 1e6)}|${slotStartMs}|${s.callsign}`;
      if (this.seen.has(key)) continue;
      this.seen.set(key, now);
      this.spots.push(s);
    }
    if (this.spots.length > KEEP) this.spots.splice(0, this.spots.length - KEEP);
    this.schedule();
  }

  /** Drops what waits, as when reporting turns off. */
  clear() {
    this.spots = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    if (this.timer || this.sending || !this.spots.length) return;
    const wait = Math.max(0, this.lastSendMs + SEND_EVERY_MS - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  /** Sends one batch now. */
  async flush(): Promise<void> {
    if (this.sending || !this.spots.length) return;
    this.sending = true;
    this.lastSendMs = this.now();
    const batch = this.spots.slice(0, BATCH);
    try {
      const r = await this.send(batch);
      this.spots = this.spots.filter((s) => !batch.includes(s));
      this.events.sent(r, this.now());
    } catch (e) {
      this.events.failed(e);
    } finally {
      this.sending = false;
      this.schedule();
    }
  }
}
