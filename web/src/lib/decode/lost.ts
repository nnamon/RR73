/**
 * Rows that read Lost: a message from a station we were calling to the station it answered
 * instead (the sequencer's lostStation), in the slot where that showed and for a minute after,
 * so the other QSO's next messages carry it too. The mark sits where a CQ row has its country.
 */

import { parseExchange, sameCall } from '../qso/messages';

/** A station we were calling that answered `other`, first seen in the slot at `slotStartMs`, UTC ms. */
export interface LostMark {
  call: string;
  other: string;
  slotStartMs: number;
}

/** How long after the slot where it showed a lost station's messages to the other station read Lost, ms. */
export const LOST_WINDOW_MS = 60_000;

/** True when `text`, decoded in the slot at `slotStartMs`, is from a lost station to the station it answered. */
export function isLost(text: string, slotStartMs: number, marks: readonly LostMark[]): boolean {
  if (!marks.length) return false;
  const ex = parseExchange(text);
  if (!ex.from || !ex.to) return false;
  return marks.some((m) => sameCall(m.call, ex.from) && sameCall(m.other, ex.to) && slotStartMs >= m.slotStartMs && slotStartMs - m.slotStartMs < LOST_WINDOW_MS);
}
