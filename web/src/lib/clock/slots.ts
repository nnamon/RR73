/**
 * UTC slot arithmetic. Slots are aligned to the Unix epoch, which is aligned to UTC minutes, so
 * FT8 slots start at :00, :15, :30 and :45 seconds, FT4 slots every 7.5 s and WSPR slots on even
 * minutes. Times are UTC milliseconds since the epoch.
 */

/** Every mode RR73 operates. */
export type Mode = 'FT8' | 'FT4' | 'WSPR';
/** FT8 and FT4: the QSO modes the sequencer runs (lib/qso). */
export type FtMode = Exclude<Mode, 'WSPR'>;
export const MODES: readonly Mode[] = ['FT8', 'FT4', 'WSPR'];

/** True for FT8 and FT4. */
export function isFt(mode: Mode): mode is FtMode {
  return mode !== 'WSPR';
}
export type Parity = 'even' | 'odd';

/** Sample rate of every slot, Hz. */
export const SLOT_RATE = 12000;

/** Slot length, ms. */
export const SLOT_MS: Record<Mode, number> = { FT8: 15000, FT4: 7500, WSPR: 120000 };

/** Samples per slot at 12 kHz. */
export const SLOT_SAMPLES: Record<Mode, number> = { FT8: 180000, FT4: 90000, WSPR: 1440000 };

/** Index of the slot containing `utcMs`, counted from the epoch. */
export function slotIndex(utcMs: number, mode: Mode): number {
  return Math.floor(utcMs / SLOT_MS[mode]);
}

/** Start of the slot containing `utcMs`, UTC ms. */
export function slotStart(utcMs: number, mode: Mode): number {
  return slotIndex(utcMs, mode) * SLOT_MS[mode];
}

/** Start of the slot after the one containing `utcMs`, UTC ms. */
export function nextSlotStart(utcMs: number, mode: Mode): number {
  return (slotIndex(utcMs, mode) + 1) * SLOT_MS[mode];
}

/** Even slots start at :00 and :30 for FT8; for FT4 they alternate from :00. WSPR has no parity. */
export function parity(utcMs: number, mode: Mode): Parity {
  return slotIndex(utcMs, mode) % 2 === 0 ? 'even' : 'odd';
}

/** Fraction of the slot containing `utcMs` that has passed, 0 to 1. */
export function slotProgress(utcMs: number, mode: Mode): number {
  return (utcMs - slotStart(utcMs, mode)) / SLOT_MS[mode];
}
