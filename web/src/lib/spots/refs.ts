/**
 * Programme references in spot comments.
 *
 * | Programme | Form | Examples | Needs the word |
 * | --- | --- | --- | --- |
 * | POTA | prefix of 1 to 4, dash, 4 or 5 digits | US-1234, NZ-0008, US-11782 | POTA |
 * | SOTA | association of 1 to 4, slash, region of 2, dash, 3 digits | W7W/LC-001, VK3/VC-012, JA/KN-006 | no |
 * | WWFF | prefix of 1 to 3, FF, dash, 4 digits | VKFF-0921, 9MFF-0003, KFF-1234 | no |
 * | IOTA | continent, dash, 3 digits | OC-134, EU-005 | no |
 *
 * POTA references look like many other things (award numbers, dates), so they count only in a
 * comment that says POTA. The other forms are distinctive enough alone.
 */

import type { Programme, SpotRef } from './types';

const POTA_WORD = /\bPOTA\b/;
const POTA_REF = /\b([A-Z0-9]{1,4}-\d{4,5})\b/g;
const SOTA_REF = /(?<![A-Z0-9/])([A-Z0-9]{1,4}\/[A-Z0-9]{2}-\d{3})\b/g;
const WWFF_REF = /\b([A-Z0-9]{1,3}FF-\d{4})\b/g;
const IOTA_REF = /\b((?:AF|AN|AS|EU|NA|OC|SA)-\d{3})\b/g;

/** The references a comment names, in programme order, each once, upper case, without names. */
export function parseRefs(comments: string): SpotRef[] {
  const t = comments.toUpperCase();
  const out: SpotRef[] = [];
  const add = (programme: Programme, ref: string) => {
    if (!out.some((r) => r.programme === programme && r.ref === ref)) out.push({ programme, ref, name: '' });
  };
  if (POTA_WORD.test(t)) for (const m of t.matchAll(POTA_REF)) if (!/FF-\d{4}$/.test(m[1])) add('POTA', m[1]);
  for (const m of t.matchAll(SOTA_REF)) add('SOTA', m[1]);
  for (const m of t.matchAll(WWFF_REF)) add('WWFF', m[1]);
  for (const m of t.matchAll(IOTA_REF)) add('IOTA', m[1]);
  return out;
}
