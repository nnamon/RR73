/**
 * Suggestions for the reference fields from the POTA and SOTA lists (lib/reference): references
 * that begin with the text typed, and the active ones nearest the phone. WWFF and IOTA have no
 * list, so they get none. A list that cannot be read gives no suggestions; typing still works.
 */

import { ReferenceUnavailableError, type LatLon, type Park, type ReferenceList, type Summit } from '../reference';
import type { Programme } from './types';

export interface RefSuggestion {
  programme: 'POTA' | 'SOTA';
  ref: string;
  name: string;
  /** From the phone, km; null for a typed suggestion. */
  km: number | null;
}

export interface RefLists {
  parks: ReferenceList<Park> | null;
  summits: ReferenceList<Summit> | null;
}

/** Nearby references: within this distance, km. */
export const NEARBY_KM = 50;
/** Nearby references shown, nearest first. */
export const NEARBY_LIMIT = 6;

function listFor(programme: Programme, lists: RefLists): ReferenceList<Park | Summit> | null {
  return programme === 'POTA' ? lists.parks : programme === 'SOTA' ? lists.summits : null;
}

/** References of `programme` that begin with `text`, those that count today first; none for WWFF and IOTA. */
export async function typedSuggestions(programme: Programme, text: string, lists: RefLists, limit = 5): Promise<RefSuggestion[]> {
  const list = listFor(programme, lists);
  if (!list || !text.trim()) return [];
  try {
    return (await list.suggest(text, limit)).map((r) => ({ programme: r.programme, ref: r.ref, name: r.name, km: null }));
  } catch (e) {
    if (e instanceof ReferenceUnavailableError) return [];
    throw e;
  }
}

/**
 * Active parks and summits within NEARBY_KM of a position, nearest first. `complete` is false when
 * part of a list that could hold a nearer one could not be read.
 */
export async function nearbySuggestions(at: LatLon, lists: RefLists): Promise<{ refs: RefSuggestion[]; complete: boolean }> {
  const out: RefSuggestion[] = [];
  let complete = true;
  for (const list of [lists.parks, lists.summits]) {
    if (!list) continue;
    try {
      const r = await list.nearest(at, { limit: NEARBY_LIMIT, maxKm: NEARBY_KM });
      complete &&= r.complete;
      for (const n of r.refs) out.push({ programme: n.ref.programme, ref: n.ref.ref, name: n.ref.name, km: n.km });
    } catch (e) {
      if (!(e instanceof ReferenceUnavailableError)) throw e;
      complete = false;
    }
  }
  out.sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
  return { refs: out.slice(0, NEARBY_LIMIT), complete };
}

/** A distance as the suggestions show it: 0.4 km under 10 km, then whole km. */
export function kmText(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
