/**
 * How long the decoder takes per slot, for Settings › Radio and audio › Timing and the timing
 * report: the last time and the 95th percentile of the recent slots of each mode, and the slots
 * the decoder skipped because it was still busy with earlier ones (lib/decode/worker-client.ts).
 * A time runs from handing the slot to the decoder to its first decodes, waiting included, so a
 * processor that falls behind shows in it.
 */

import type { SlotMode } from '../clock/slots';

/** Slots kept per mode: 10 minutes of FT8. */
export const DECODE_TIMES_KEPT = 40;

/** One mode's decode times. */
export interface DecodeTime {
  mode: SlotMode;
  /** The last slot's time, ms. */
  lastMs: number;
  /** The 95th percentile of the slots kept, nearest rank, ms. */
  p95Ms: number;
  /** Slots it is taken over. */
  slots: number;
}

export class DecodeTimes {
  private readonly byMode = new Map<SlotMode, number[]>();
  /** Slots not decoded because the decoder was busy, since the app opened. */
  skipped = 0;

  /** Notes one decoded slot's time, ms. */
  add(mode: SlotMode, ms: number) {
    const xs = this.byMode.get(mode) ?? [];
    xs.push(ms);
    if (xs.length > DECODE_TIMES_KEPT) xs.shift();
    this.byMode.set(mode, xs);
  }

  /** Notes a slot the busy decoder did not decode. */
  skip() {
    this.skipped++;
  }

  /** The modes with times, in the order FT8, FT4, LQ8, WSPR. */
  summary(): DecodeTime[] {
    const out: DecodeTime[] = [];
    for (const mode of ['FT8', 'FT4', 'LQ8', 'WSPR'] as const) {
      const xs = this.byMode.get(mode);
      if (!xs?.length) continue;
      const sorted = [...xs].sort((a, b) => a - b);
      out.push({ mode, lastMs: xs[xs.length - 1], p95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1], slots: xs.length });
    }
    return out;
  }
}
