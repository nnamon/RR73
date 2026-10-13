/**
 * Messages to you, for the decode list. A message to you names the operator's callsign as its
 * addressee, by base call, so 9V1NE matches VK3/9V1NE and 9V1NE/P. It leads its slot.
 */

import { sameCall } from '../qso/messages';
import { looksLikeCall } from './marking';

/**
 * True when `text` is addressed to `myCall`: its first callsign is the operator's, or, in a
 * DXpedition message ("K1ABC RR73; 9V1NE <KH1/KH7Z> -08"), the first callsign of either half.
 */
export function toYou(text: string, myCall: string): boolean {
  if (!myCall.trim()) return false;
  return text
    .toUpperCase()
    .split(';')
    .some((part) => {
      const first = part.trim().split(/\s+/)[0] ?? '';
      return looksLikeCall(first) && sameCall(first, myCall);
    });
}
