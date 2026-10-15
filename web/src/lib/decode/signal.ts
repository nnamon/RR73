/**
 * A station's signal over its last slots, for the station detail: the SNR of its decode in each
 * of the last SIGNAL_SLOTS slots it could have sent in (its parity), oldest first, null where it
 * was not decoded. The slots run back from its latest decode.
 */

import { SLOT_MS, type FtMode } from '../clock/slots';
import { baseCall } from './marking';
import { parseExchange } from '../qso/messages';
import type { SlotDecodes } from './list';

/** Slots the chart covers. */
export const SIGNAL_SLOTS = 8;

export interface SignalPoint {
  /** Slot start, UTC ms. */
  slotStartMs: number;
  /** SNR of the station's decode in the slot, dB, or null for none. */
  snrDb: number | null;
}

/**
 * The station's last SIGNAL_SLOTS slots of its parity, oldest first; [] when the kept slots hold
 * no decode from it. A slot with several of its decodes takes the strongest.
 */
export function signalHistory(slots: readonly SlotDecodes[], call: string, mode: FtMode): SignalPoint[] {
  const key = baseCall(call.toUpperCase());
  const heard = new Map<number, number>();
  for (const s of slots) {
    if (s.mode !== mode) continue;
    for (const d of s.decodes) {
      const from = parseExchange(d.text).from;
      if (!from || baseCall(from) !== key) continue;
      heard.set(s.startUtcMs, Math.max(heard.get(s.startUtcMs) ?? -Infinity, d.snr_db));
    }
  }
  if (!heard.size) return [];
  const latest = Math.max(...heard.keys());
  // Every other slot: the station's parity.
  const step = 2 * SLOT_MS[mode];
  return Array.from({ length: SIGNAL_SLOTS }, (_, i) => {
    const at = latest - (SIGNAL_SLOTS - 1 - i) * step;
    return { slotStartMs: at, snrDb: heard.get(at) ?? null };
  });
}
