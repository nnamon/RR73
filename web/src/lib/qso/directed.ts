/**
 * Whether we are a station a directed CQ asks for, from the country file (lib/reference). Hunt
 * calls a directed CQ only when this says yes (docs/design/sequencer.md, Hunt):
 *
 * - An activity (CQ POTA, CQ SOTA, CQ WWFF, CQ IOTA, CQ QRP): anyone may answer.
 * - A continent (CQ EU, CQ NA): we are on it.
 * - CQ DX: we are on another continent from the caller.
 * - A prefix (CQ JA, CQ VK, CQ 9V): we are in the DXCC entity it names.
 * - A contest (CQ TEST, CQ WW, CQ FD, CQ RU), a frequency (CQ 290), anything else, or a call the
 *   country file cannot place: no. Hunt has no contest exchange, and a CQ it cannot judge is left
 *   for the operator.
 *
 * Each word of a modifier must pass: CQ POTA DX asks for both.
 */

import type { DxccResult } from '../reference/dxcc';

export interface CountryLookup {
  lookup(call: string): DxccResult;
}

const ACTIVITIES = new Set(['POTA', 'SOTA', 'WWFF', 'IOTA', 'QRP', 'BOTA', 'LLOTA']);
const CONTINENTS = new Set(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA']);
const CONTESTS = new Set(['TEST', 'WW', 'FD', 'RU', 'WPX', 'ARRL']);

/** A callsign in the prefix's entity, for the lookup: JA as JA1AA, EA8 as EA8AA. */
function probe(prefix: string): string {
  return /\d$/.test(prefix) ? `${prefix}AA` : `${prefix}1AA`;
}

export function answersDirected(modifier: string, caller: string, me: string, countries: CountryLookup | null): boolean {
  if (!countries) return false;
  const mine = countries.lookup(me);
  if (!mine.found) return false;
  return modifier
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .every((word) => {
      if (ACTIVITIES.has(word)) return true;
      if (CONTINENTS.has(word)) return mine.continent === word;
      if (word === 'DX') {
        const theirs = countries.lookup(caller);
        return theirs.found && theirs.continent !== mine.continent;
      }
      if (CONTESTS.has(word) || !/^[A-Z0-9]{1,4}$/.test(word) || /^\d+$/.test(word)) return false;
      const there = countries.lookup(probe(word));
      return there.found && there.dxcc !== null && there.dxcc === mine.dxcc;
    });
}
