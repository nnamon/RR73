/**
 * Turns the 12 kHz capture stream into UTC-aligned slots of exactly SLOT_SAMPLES samples.
 *
 * Every sample gets a global position on a 12 kHz grid counted from the epoch, so slot k holds
 * positions k × L to (k + 1) × L − 1 and sample 0 of a slot is its UTC start. The stream is
 * anchored to UTC once and then placed by sample count, so jitter in individual chunk times
 * never moves samples. The anchor is replaced:
 * - at once, when the chunk index breaks (a new capture) or the chunk time is more than
 *   100 ms off the anchor (an interruption, or a jump in the clock); the hole is zero-filled;
 * - at the next slot boundary, when the chunk time is 5 to 100 ms off (drift, or an offset
 *   correction), so the shift never lands inside a slot.
 *
 * Positions written twice keep the first write. Slots with no audio at all are not emitted.
 */

import { SLOT_SAMPLES, SLOT_RATE, type SlotMode as Mode } from '../clock/slots';

/** A block of the capture stream. */
export interface StreamChunk {
  /** Mono samples at 12000 Hz. */
  samples: Float32Array;
  /** Running index of samples[0] in the capture stream. */
  index: number;
  /** UTC time of samples[0], ms. */
  utcMs: number;
}

export interface AssembledSlot {
  mode: Mode;
  /** Slot start, UTC ms. */
  startUtcMs: number;
  /** Exactly SLOT_SAMPLES[mode] samples at 12000 Hz; zero where no audio arrived. */
  samples: Float32Array;
  /** Samples that carry audio. */
  filled: number;
  /** Audio began more than 10 ms after the slot start (capture started or resumed mid-slot). */
  lateStart: boolean;
  /** After audio began, a run of more than 10 ms is zero-filled (an interruption or the stream stopped). */
  gap: boolean;
}

const SAMPLES_PER_MS = SLOT_RATE / 1000;
/** Zero runs up to this length (10 ms) are not flagged: they come from small re-anchors. */
const TOLERANCE = 120;

interface OpenSlot {
  start: number;
  end: number;
  buf: Float32Array;
  filled: number;
  first: number;
  gap: boolean;
}

export class SlotAssembler {
  readonly mode: Mode;
  private readonly length: number;
  private readonly hard: number;
  private readonly soft: number;
  private anchor: { index: number; g: number } | null = null;
  private pending: { index: number; g: number } | null = null;
  private nextIndex = -1;
  private writeG = -Infinity;
  private slot: OpenSlot | null = null;
  /** Samples dropped because their positions were already written. */
  dropped = 0;

  constructor(mode: Mode, opts: { hardMs?: number; softMs?: number } = {}) {
    this.mode = mode;
    this.length = SLOT_SAMPLES[mode];
    this.hard = Math.round((opts.hardMs ?? 100) * SAMPLES_PER_MS);
    this.soft = Math.round((opts.softMs ?? 5) * SAMPLES_PER_MS);
  }

  /** Adds a chunk and returns the slots it completed, oldest first. */
  push(chunk: StreamChunk): AssembledSlot[] {
    const out: AssembledSlot[] = [];
    const n = chunk.samples.length;
    const g = Math.round(chunk.utcMs * SAMPLES_PER_MS);
    if (!this.anchor || chunk.index !== this.nextIndex) {
      this.anchor = { index: chunk.index, g };
      this.pending = null;
    } else {
      const err = g - (this.anchor.g + (chunk.index - this.anchor.index));
      if (Math.abs(err) > this.hard) {
        this.anchor = { index: chunk.index, g };
        this.pending = null;
      } else if (Math.abs(err) > this.soft) this.pending = { index: chunk.index, g };
      else this.pending = null;
    }
    this.nextIndex = chunk.index + n;

    for (let i = 0; i < n; ) {
      let pos = this.anchor.g + (chunk.index + i - this.anchor.index);
      if (this.pending && this.slot && pos >= this.slot.end) {
        this.anchor = this.pending;
        this.pending = null;
        pos = this.anchor.g + (chunk.index + i - this.anchor.index);
      }
      if (pos < this.writeG) {
        const skip = Math.min(n - i, this.writeG - pos);
        this.dropped += skip;
        i += skip;
        continue;
      }
      if (!this.slot || pos >= this.slot.end) {
        if (this.slot) out.push(this.finish(this.slot));
        this.slot = this.open(Math.floor(pos / this.length) * this.length);
      }
      const slot = this.slot;
      if (slot.filled > 0 && pos - this.writeG > TOLERANCE) slot.gap = true;
      const m = Math.min(n - i, slot.end - pos);
      slot.buf.set(chunk.samples.subarray(i, i + m), pos - slot.start);
      if (slot.filled === 0) slot.first = pos - slot.start;
      slot.filled += m;
      this.writeG = pos + m;
      i += m;
    }
    return out;
  }

  /** Emits the slot in progress, zero-filled to its end, and starts over. For when audio stops. */
  flush(): AssembledSlot | null {
    const slot = this.slot;
    this.reset();
    return slot && slot.filled ? this.finish(slot) : null;
  }

  /** Drops the slot in progress and the anchor. */
  reset() {
    this.slot = null;
    this.anchor = null;
    this.pending = null;
    this.nextIndex = -1;
    this.writeG = -Infinity;
  }

  private open(start: number): OpenSlot {
    return { start, end: start + this.length, buf: new Float32Array(this.length), filled: 0, first: 0, gap: false };
  }

  private finish(slot: OpenSlot): AssembledSlot {
    const tail = slot.end - Math.min(this.writeG, slot.end);
    return {
      mode: this.mode,
      startUtcMs: Math.round(slot.start / SAMPLES_PER_MS),
      samples: slot.buf,
      filled: slot.filled,
      lateStart: slot.first > TOLERANCE,
      gap: slot.gap || tail > TOLERANCE,
    };
  }
}
