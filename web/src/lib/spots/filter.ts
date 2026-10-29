// Which spots the list shows, in which order.

import { baseCall } from './normalise';
import { PROGRAMMES, spotClasses, type Spot, type SpotClass } from './types';

/** The Spots chips. */
export interface SpotFilter {
  /** Classes shown: programmes, and DX for spots without a reference. */
  classes: readonly SpotClass[];
  /** Only FT8, FT4 and LQ8 spots. */
  digitalOnly: boolean;
  /** Only spots on the operator's bands. */
  myBandsOnly: boolean;
  /** Only spots the `isNew` predicate accepts. */
  newOnly: boolean;
}

/** Programme spots only (no plain DX), FT8, FT4 and LQ8 only, all bands, worked or not. */
export function defaultFilter(): SpotFilter {
  return { classes: [...PROGRAMMES], digitalOnly: true, myBandsOnly: false, newOnly: false };
}

/** What a filter needs from outside the spot: the operator's bands and the log. */
export interface FilterContext {
  /** Bands the operator uses, as ADIF names such as 20m. Empty: My bands does nothing. */
  myBands: readonly string[];
  /** True for a spot not worked before; null until the log supplies it, when New only does nothing. */
  isNew: ((spot: Spot) => boolean) | null;
}

/** A row of the list: one station on one band. */
export function spotKey(s: Spot): string {
  return `${baseCall(s.activator)} ${s.band ?? ''}`;
}

/** Newest first; equal times by callsign, so the order is stable between polls. */
export function newestFirst(a: Spot, b: Spot): number {
  return b.spottedAt - a.spottedAt || (a.activator < b.activator ? -1 : a.activator > b.activator ? 1 : 0);
}

/**
 * The spots a filter shows, newest first, one row per station and band: when a station was
 * spotted more than once on a band, the newest spot that passes the filter stays.
 */
export function filterSpots(spots: readonly Spot[], filter: SpotFilter, ctx: FilterContext): Spot[] {
  const bands = new Set(ctx.myBands.map((b) => b.toLowerCase()));
  const useBands = filter.myBandsOnly && bands.size > 0;
  const isNew = filter.newOnly ? ctx.isNew : null;
  const seen = new Set<string>();
  const out: Spot[] = [];
  for (const s of [...spots].sort(newestFirst)) {
    if (!spotClasses(s).some((c) => filter.classes.includes(c))) continue;
    if (filter.digitalOnly && !s.digital) continue;
    if (useBands && (s.band === null || !bands.has(s.band))) continue;
    if (isNew && !isNew(s)) continue;
    const key = spotKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
