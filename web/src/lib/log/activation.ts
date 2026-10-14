// Activations: reference formats, the counting rules shown while operating, the UTC day timer and
// the grid from a GPS position.

import { displayMode } from './qso';
import type { Activation, Programme, Qso, Reference } from './types';

const FORMATS: Record<Programme, { re: RegExp; example: string }> = {
  // Programme prefix, a dash, 4 or 5 digits: US-1234, VK-0921, SG-0014.
  POTA: { re: /^[A-Z0-9]{1,4}-\d{4,5}$/, example: 'VK-0921' },
  // Association, a slash, a 2-character region, a dash, 3 digits: VK3/VC-012, W7O/CN-001.
  SOTA: { re: /^[A-Z0-9]{1,4}\/[A-Z0-9]{2}-\d{3}$/, example: 'VK3/VC-012' },
  // National prefix, FF, a dash, 4 digits: VKFF-0921, GFF-0001.
  WWFF: { re: /^[A-Z0-9]{1,4}FF-\d{4}$/, example: 'VKFF-0921' },
  // Continent, a dash, 3 digits: OC-001.
  IOTA: { re: /^(AF|AN|AS|EU|NA|OC|SA)-\d{3}$/, example: 'OC-001' },
};

export type RefCheck = { ok: true; ref: string } | { ok: false; message: string };

/** Upper case without spaces: "vk-0921 " gives "VK-0921". */
export function normaliseRef(s: string): string {
  return s.toUpperCase().replace(/\s+/g, '');
}

const article = (p: Programme) => (p === 'IOTA' ? 'an' : 'a');

/** Checks a typed reference against its programme's format. Lists ship later; the format is all RR73 checks now. */
export function checkRef(programme: Programme, raw: string): RefCheck {
  const ref = normaliseRef(raw);
  const a = article(programme);
  if (!ref) return { ok: false, message: `Type ${a} ${programme} reference, such as ${FORMATS[programme].example}.` };
  if (!FORMATS[programme].re.test(ref)) return { ok: false, message: `${ref} is not ${a} ${programme} reference. They look like ${FORMATS[programme].example}.` };
  return { ok: true, ref };
}

export function refExample(programme: Programme): string {
  return FORMATS[programme].example;
}

/** Checks a whole set: at least one reference, no repeats, one summit, one WWFF reference and one island at most. */
export function checkRefs(refs: Reference[]): string | null {
  if (!refs.length) return 'Add at least one reference.';
  const keys = refs.map((r) => `${r.programme} ${r.ref}`);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) return `${dup} is listed twice.`;
  for (const p of ['SOTA', 'WWFF', 'IOTA'] as const) {
    if (refs.filter((r) => r.programme === p).length > 1) return `An activation has one ${p} reference at most.`;
  }
  return null;
}

/** "POTA VK-0921 · SOTA VK3/VC-012". */
export function refsLabel(refs: readonly Reference[]): string {
  return refs.map((r) => `${r.programme} ${r.ref}`).join(' · ');
}

const DAY_MS = 86_400_000;

/** Start of the UTC day containing `ms`. */
export function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** "20261013": the UTC day of a time, as in ADIF dates and file names. */
export function utcDayKey(ms: number): string {
  return new Date(utcDayStart(ms)).toISOString().slice(0, 10).replace(/-/g, '');
}

/** ms until the UTC day ends. */
export function utcDayLeftMs(now: number): number {
  return utcDayStart(now) + DAY_MS - now;
}

/** "5 h 4 min", "12 min", "45 s" for a duration in ms. */
export function hoursMinutes(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}

/** QSOs per programme that the programme counts. */
export const TARGETS: Partial<Record<Programme, number>> = { POTA: 10, SOTA: 4, WWFF: 44 };

export interface Progress {
  programme: Programme;
  ref: string;
  /** QSOs the programme counts so far. */
  count: number;
  target: number | null;
  qualified: boolean;
  /** "7 of 10 · 3 more", "7 QSOs · Qualified", "7 QSOs". */
  label: string;
  /** What is counted, for a screen reader and the foot of the card. */
  rule: string;
}

const live = (q: Qso) => q.deletedAt === null;
const has = (a: Activation, r: Reference) => a.refs.some((x) => x.programme === r.programme && x.ref === r.ref);

/**
 * Progress towards each reference's rule, counted over every activation that holds the
 * reference, as the programmes count it:
 * - POTA: 10 QSOs in the UTC day of `now`; a repeat of the same call, band and mode counts once.
 * - SOTA: 4 different stations in the UTC day of `now`.
 * - WWFF: 44 QSOs at the reference across all activations; a repeat of the same call, band,
 *   mode and UTC day counts once.
 * - IOTA: no count rule; shows the number of QSOs in this activation.
 */
export function progress(activation: Activation, qsos: readonly Qso[], activations: readonly Activation[], now: number): Progress[] {
  const day = utcDayStart(now);
  return activation.refs.map((r) => {
    const ids = new Set(activations.filter((a) => has(a, r)).map((a) => a.id));
    ids.add(activation.id);
    const at = qsos.filter((q) => live(q) && q.activationId !== null && ids.has(q.activationId));
    const today = at.filter((q) => utcDayStart(q.start) === day);
    let count: number;
    let shown: number;
    let rule: string;
    if (r.programme === 'POTA') {
      count = new Set(today.map((q) => `${q.call} ${q.band} ${displayMode(q)}`)).size;
      shown = today.length;
      rule = '10 QSOs in one UTC day';
    } else if (r.programme === 'SOTA') {
      count = new Set(today.map((q) => q.call)).size;
      shown = today.length;
      rule = '4 different stations in one UTC day';
    } else if (r.programme === 'WWFF') {
      count = new Set(at.map((q) => `${q.call} ${q.band} ${displayMode(q)} ${utcDayKey(q.start)}`)).size;
      shown = count;
      rule = '44 QSOs, added up over activations';
    } else {
      count = qsos.filter((q) => live(q) && q.activationId === activation.id).length;
      shown = count;
      rule = 'No minimum';
    }
    const target = TARGETS[r.programme] ?? null;
    const qualified = target !== null && count >= target;
    const qsosText = `${shown} ${shown === 1 ? 'QSO' : 'QSOs'}`;
    let label: string;
    if (target === null || qualified) label = qualified ? `${qsosText} · Qualified` : qsosText;
    else label = `${count} of ${target}${r.programme === 'SOTA' ? ' stations' : ''} · ${target - count} more`;
    return { programme: r.programme, ref: r.ref, count, target, qualified, label, rule };
  });
}

/** QSOs per band in an activation, most first: [["20m", 5], ["40m", 2]]. */
export function countsByBand(qsos: readonly Qso[], activationId: string): [string, number][] {
  const m = new Map<string, number>();
  for (const q of qsos) if (live(q) && q.activationId === activationId) m.set(q.band || '?', (m.get(q.band || '?') ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Maidenhead locator of a position: 6 characters by default, as in QF22lb. */
export function gridFromLatLon(lat: number, lon: number, chars: 4 | 6 | 8 = 6): string {
  const L = Math.min(Math.max(lon + 180, 0), 359.999999);
  const A = Math.min(Math.max(lat + 90, 0), 179.999999);
  const A_ = 'A'.charCodeAt(0);
  let g = String.fromCharCode(A_ + Math.floor(L / 20)) + String.fromCharCode(A_ + Math.floor(A / 10));
  g += String(Math.floor((L % 20) / 2)) + String(Math.floor(A % 10));
  if (chars >= 6) g += String.fromCharCode(97 + Math.floor((L % 2) * 12)) + String.fromCharCode(97 + Math.floor((A % 1) * 24));
  if (chars === 8) g += String(Math.floor(((L % 2) * 120) % 10)) + String(Math.floor(((A % 1) * 240) % 10));
  return g;
}
