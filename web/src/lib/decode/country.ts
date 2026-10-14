/**
 * The country on a CQ row: the calling station's DXCC entity from the country file
 * (lib/reference), by its short name: "Australia" for CQ VK2LAW QF56, "Germany" for DL1ABC,
 * "Italy" for a station in Sicily. Other rows have none.
 */

import type { DxccIndex } from '../reference';
import { displayName } from '../reference/names';
import type { DecodeRowData } from './marking';

/**
 * The DXCC entity of the station calling CQ in `row`, or null: on rows that are not a CQ, before
 * the country file has loaded, and when the lookup fails (unknown prefix, /MM, /AM, a hashed
 * callsign whose full form is unknown).
 */
export function cqCountry(row: Pick<DecodeRowData, 'mark' | 'key'>, countries: DxccIndex | null): string | null {
  if (row.mark !== 'cq' || !row.key || !countries) return null;
  const r = countries.lookup(row.key);
  return r.found ? displayName(r.dxccEntity) : null;
}
