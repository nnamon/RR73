/**
 * Calling CQ with Repeat CQ on, the stations waiting to be answered are marked on their latest
 * message to us, where a CQ row has its country: Next, 2nd, 3rd in answering order, or Dupe for a
 * station worked before that Repeat CQ skips. The station being worked is not in the queue.
 */

import type { Caller } from '../qso/sequencer';
import { parseExchange, sameCall } from '../qso/messages';

/** A waiting caller: its tag and the slot it last called in, UTC ms. */
export interface QueueMark {
  call: string;
  slotStartMs: number;
  tag: string;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** Marks for `callers`, already in answering order. Dupes are skipped in the count unless `workDupes`. */
export function queueMarks(callers: readonly Caller[], workDupes: boolean): QueueMark[] {
  let n = 0;
  return callers.map((c) => {
    const live = workDupes || !c.dupe;
    const tag = !live ? 'Dupe' : n === 0 ? 'Next' : ordinal(n + 1);
    if (live) n++;
    return { call: c.call, slotStartMs: c.heardMs, tag };
  });
}

/** The tag for a message to us, decoded in the slot at `slotStartMs`: its caller's, when that is the slot it last called in. */
export function queueTag(text: string, slotStartMs: number, marks: readonly QueueMark[]): string | null {
  if (!marks.length) return null;
  const from = parseExchange(text).from;
  if (!from) return null;
  return marks.find((m) => sameCall(m.call, from) && m.slotStartMs === slotStartMs)?.tag ?? null;
}

/** The tag as a screen reader says it. */
export function queueSpoken(tag: string): string {
  if (tag === 'Next') return 'answered next';
  if (tag === 'Dupe') return 'dupe, skipped';
  return `answered ${tag}`;
}
