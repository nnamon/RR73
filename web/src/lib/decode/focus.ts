/**
 * Messages to you and the focus during a QSO, for the decode list. A message to you names the
 * operator's callsign as its addressee, by base call, so 9V1NE matches VK3/9V1NE and 9V1NE/P. It
 * leads its slot. While RR73 calls a station or works it, every decode that is not to you and
 * neither comes from nor goes to that station dims; our own rows stay as they are.
 */

import { sameCall } from '../qso/messages';
import type { SeqState } from '../qso/sequencer';
import type { ListItem, RowItem } from './list';
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

/** True when `call` is one of the callsigns in `text`, as sender or addressee, by base call. */
export function mentions(text: string, call: string): boolean {
  if (!call.trim()) return false;
  return text
    .toUpperCase()
    .split(/[\s;]+/)
    .some((t) => looksLikeCall(t) && sameCall(t, call));
}

/** What the focus reads from the sequencer. */
export type FocusState = Pick<SeqState, 'partner' | 'txEnabled' | 'paused' | 'onAir'>;

/**
 * The station the list focuses on: the partner while RR73 calls it or works it, by hand, in Run
 * or in Hunt. Tx has to be on and calling (answering that gave up after its repeats does not
 * count), or a transmission still on air. Null otherwise, and while calling CQ with no partner.
 */
export function focusCall(st: FocusState): string | null {
  const p = st.partner;
  if (!p) return null;
  return (st.txEnabled && !st.paused) || st.onAir ? p.call : null;
}

/** True when a row keeps full contrast while the list focuses on `call`. */
export function related(item: RowItem, call: string): boolean {
  return !!item.out || !!item.toYou || mentions(item.row.decode.text, call);
}

/** Marks every row unrelated to `call` as dimmed. With no call, the items come back unchanged. */
export function applyFocus(items: ListItem[], call: string | null): ListItem[] {
  if (!call) return items;
  return items.map((i) => (i.kind === 'row' && !related(i, call) ? { ...i, dim: true } : i));
}
