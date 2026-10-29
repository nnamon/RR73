/**
 * UTC slot arithmetic. Slots are aligned to the Unix epoch, which is aligned to UTC minutes, so
 * FT8 and LQ8 slots start at :00, :15, :30 and :45 seconds, FT4 slots every 7.5 s and WSPR slots
 * on even minutes. Times are UTC milliseconds since the epoch. RTTY is continuous and has no slots.
 */

/** Every mode RR73 operates. */
export type Mode = 'FT8' | 'FT4' | 'LQ8' | 'WSPR' | 'RTTY';
/** The modes that transmit in UTC slots. */
export type SlotMode = Exclude<Mode, 'RTTY'>;
/** FT8, FT4 and LQ8: the QSO modes the sequencer runs (lib/qso). */
export type FtMode = Exclude<SlotMode, 'WSPR'>;
/** Keyboard modes: text typed and received as it goes, with no slots (lib/keyboard). */
export type KeyboardMode = Exclude<Mode, SlotMode>;
export const MODES: readonly Mode[] = ['FT8', 'FT4', 'LQ8', 'WSPR', 'RTTY'];

/** True for FT8, FT4 and LQ8. */
export function isFt(mode: Mode): mode is FtMode {
  return mode === 'FT8' || mode === 'FT4' || mode === 'LQ8';
}

/** True for the modes with UTC slots: FT8, FT4 and WSPR. */
export function hasSlots(mode: Mode): mode is SlotMode {
  return mode !== 'RTTY';
}

/** True for the keyboard modes: RTTY. */
export function isKeyboard(mode: Mode): mode is KeyboardMode {
  return mode === 'RTTY';
}
export type Parity = 'even' | 'odd';

/** Sample rate of every slot, Hz. */
export const SLOT_RATE = 12000;

/** Slot length, ms. */
export const SLOT_MS: Record<SlotMode, number> = { FT8: 15000, FT4: 7500, LQ8: 15000, WSPR: 120000 };

/** Samples per slot at 12 kHz. */
export const SLOT_SAMPLES: Record<SlotMode, number> = { FT8: 180000, FT4: 90000, LQ8: 180000, WSPR: 1440000 };

/**
 * When the early pass decodes a slot still being received, s from the slot start: a message at
 * DT 0 ends at 13.14 s in FT8 and 5.54 s in FT4. WSPR has none. docs/experiments/0006-early-pass.md
 * has the measurements.
 */
export const EARLY_S: Partial<Record<SlotMode, number>> = { FT8: 13.5, FT4: 6, LQ8: 13.5 };

/** Index of the slot containing `utcMs`, counted from the epoch. */
export function slotIndex(utcMs: number, mode: SlotMode): number {
  return Math.floor(utcMs / SLOT_MS[mode]);
}

/** Start of the slot containing `utcMs`, UTC ms. */
export function slotStart(utcMs: number, mode: SlotMode): number {
  return slotIndex(utcMs, mode) * SLOT_MS[mode];
}

/** Start of the slot after the one containing `utcMs`, UTC ms. */
export function nextSlotStart(utcMs: number, mode: SlotMode): number {
  return (slotIndex(utcMs, mode) + 1) * SLOT_MS[mode];
}

/** Even slots start at :00 and :30 for FT8 and LQ8; for FT4 they alternate from :00. WSPR has no parity. */
export function parity(utcMs: number, mode: SlotMode): Parity {
  return slotIndex(utcMs, mode) % 2 === 0 ? 'even' : 'odd';
}

/** Fraction of the slot containing `utcMs` that has passed, 0 to 1. */
export function slotProgress(utcMs: number, mode: SlotMode): number {
  return (utcMs - slotStart(utcMs, mode)) / SLOT_MS[mode];
}
