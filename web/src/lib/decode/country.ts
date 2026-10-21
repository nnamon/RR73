/**
 * The country on a CQ row and on a row calling us: the sending station's DXCC entity from the
 * country file (lib/reference), by its short name: "Australia" for CQ VK2LAW QF56 or
 * 9V1NE VK2LAW QF56, "Germany" for DL1ABC, "Italy" for a station in Sicily. Other rows have none.
 */

import type { DxccIndex } from '../reference';
import { displayName } from '../reference/names';
import type { DecodeRowData } from './marking';

/**
 * The DXCC entity of the station calling CQ or calling us in `row`, or null: on other rows, before
 * the country file has loaded, and when the lookup fails (unknown prefix, /MM, /AM, a hashed
 * callsign whose full form is unknown).
 */
export function cqCountry(row: Pick<DecodeRowData, 'mark' | 'key' | 'decode'>, countries: DxccIndex | null): string | null {
  if (!row.key || !countries) return null;
  // A row marked me is to us when its first callsign is ours: "9V1NE VK2LAW QF56". "VK2LAW 9V1NE
  // QF56" is ours to them, with no country.
  const toUs = row.mark === 'me' && row.decode.text.trim().split(/\s+/)[0] !== row.key;
  if (row.mark !== 'cq' && !toUs) return null;
  const r = countries.lookup(row.key);
  return r.found ? displayName(r.dxccEntity) : null;
}
