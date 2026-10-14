/**
 * Keeps the most recent slots in memory and turns one into corpus files: a 16-bit 12 kHz mono
 * WAV and its sidecar JSON, named by the WSJT-X stem of the slot start.
 */

import type { AssembledSlot } from './assembler';
import { slotStem } from '../clock/format';
import { SLOT_RATE, type SlotMode as Mode } from '../clock/slots';
import { encodeWav16 } from './wav';
import { sidecar, type SidecarInput } from './sidecar';

export interface SlotFiles {
  stem: string;
  wav: Uint8Array<ArrayBuffer>;
  json: string;
}

export class SlotRecorder {
  readonly capacity: number;
  private readonly perMode: Partial<Record<Mode, number>>;
  private slots: AssembledSlot[] = [];

  /**
   * Keeps `capacity` slots: 8 FT8 slots are 2 minutes and about 5.8 MB. `perMode` keeps fewer of
   * a mode's slots: a WSPR slot alone is 2 minutes.
   */
  constructor(capacity = 8, perMode: Partial<Record<Mode, number>> = {}) {
    this.capacity = capacity;
    this.perMode = perMode;
  }

  add(slot: AssembledSlot) {
    this.slots = this.slots.filter((s) => s.startUtcMs !== slot.startUtcMs);
    this.slots.push(slot);
    this.slots.sort((a, b) => a.startUtcMs - b.startUtcMs);
    if (this.slots.length > this.capacity) this.slots.splice(0, this.slots.length - this.capacity);
    const cap = this.perMode[slot.mode];
    if (cap !== undefined) {
      const mine = this.slots.filter((s) => s.mode === slot.mode);
      if (mine.length > cap) {
        const drop = new Set(mine.slice(0, mine.length - cap));
        this.slots = this.slots.filter((s) => !drop.has(s));
      }
    }
  }

  /** Slots held, newest first. */
  list(): AssembledSlot[] {
    return [...this.slots].reverse();
  }

  get(startUtcMs: number): AssembledSlot | undefined {
    return this.slots.find((s) => s.startUtcMs === startUtcMs);
  }

  clear() {
    this.slots = [];
  }
}

type FileMeta = Omit<SidecarInput, 'mode' | 'startUtcMs' | 'filled' | 'lateStart' | 'gap'>;

export function slotFiles(slot: AssembledSlot, meta: FileMeta): SlotFiles {
  const json = sidecar({ ...meta, mode: slot.mode, startUtcMs: slot.startUtcMs, filled: slot.filled, lateStart: slot.lateStart, gap: slot.gap });
  return { stem: slotStem(slot.startUtcMs), wav: encodeWav16(slot.samples, SLOT_RATE), json: `${JSON.stringify(json, null, 2)}\n` };
}
