/**
 * The slots RR73 transmitted in. The receive audio of those slots holds RR73's own signal, heard
 * back through the radio at +40 dB or more, so they are neither decoded nor shown: the decode list
 * shows what was sent in their place.
 */

import { SLOT_MS, type SlotMode as Mode } from '../clock/slots';

/** Slots kept: 4 minutes of FT8. */
const KEEP = 16;

export class TransmittedSlots {
  private starts: number[] = [];

  /** Marks every slot of `mode` that the output from `fromUtcMs` to `toUtcMs` overlaps. */
  mark(fromUtcMs: number, toUtcMs: number, mode: Mode) {
    const len = SLOT_MS[mode];
    for (let s = Math.floor(fromUtcMs / len) * len; s < toUtcMs; s += len) {
      if (!this.starts.includes(s)) this.starts.push(s);
    }
    this.starts = this.starts.sort((a, b) => a - b).slice(-KEEP);
  }

  /** True when RR73 transmitted in the slot starting at `slotStartMs`. */
  has(slotStartMs: number): boolean {
    return this.starts.includes(slotStartMs);
  }

  /** Slot starts, oldest first, UTC ms. */
  list(): number[] {
    return [...this.starts];
  }
}
