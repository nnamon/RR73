// One spot per station and band at a time, across sources.

import { newestFirst } from './filter';
import { baseCall } from './normalise';
import type { Spot } from './types';

/** Spots of one station and band this close in time are one spot, ms. */
export const MERGE_WINDOW_MS = 10 * 60_000;

/**
 * Merges the sources' lists, given in order of preference (the POTA API before the cluster).
 * Spots of one station (portable suffixes aside) on one band within 10 min of the kept spot
 * are folded into it: the most preferred source's spot stays, newest first within a source,
 * and gains the references the others name. Spots without a band are never merged. Returns
 * new spot objects, newest first; the inputs are not changed.
 */
export function mergeSpots(lists: readonly (readonly Spot[])[]): Spot[] {
  const ordered = lists.flatMap((list, rank) => list.map((s) => ({ s, rank }))).sort((a, b) => a.rank - b.rank || newestFirst(a.s, b.s));
  const kept: Spot[] = [];
  const byStation = new Map<string, Spot[]>();
  for (const { s } of ordered) {
    const key = `${baseCall(s.activator)} ${s.band ?? ''}`;
    const group = byStation.get(key) ?? [];
    const into = s.band === null ? undefined : group.find((k) => Math.abs(k.spottedAt - s.spottedAt) <= MERGE_WINDOW_MS);
    if (into) {
      for (const r of s.refs) {
        const same = into.refs.find((x) => x.programme === r.programme && x.ref === r.ref);
        if (!same) into.refs.push({ ...r });
        else if (!same.name) same.name = r.name;
      }
      continue;
    }
    const copy: Spot = { ...s, refs: s.refs.map((r) => ({ ...r })) };
    group.push(copy);
    byStation.set(key, group);
    kept.push(copy);
  }
  return kept.sort(newestFirst);
}
