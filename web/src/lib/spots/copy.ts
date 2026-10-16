// Text for the spot list: rows, the open row, empty states and the status line.

import { MINUS, utcHm } from '../clock/format';
import type { FilterContext, SpotFilter } from './filter';
import type { FailingSource, SpotFeedView } from './feed.svelte';
import type { Spot, SpotClass } from './types';
import { device } from '../app/platform';

const DOT = ' · ';

/** Whole minutes from `at` to `now`; a spot time ahead of this phone's clock counts as 0. */
function minutesSince(at: number, now: number): number {
  return Math.max(0, Math.floor((now - at) / 60_000));
}

/** "now", "2 min", "1 h". */
export function ageText(at: number, now: number): string {
  const m = minutesSince(at, now);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h`;
}

/** "less than a minute ago", "2 minutes ago", "1 hour ago". */
export function ageSpoken(at: number, now: number): string {
  const m = minutesSince(at, now);
  if (m < 1) return 'less than a minute ago';
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  const h = Math.floor(m / 60);
  return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
}

/** MHz with 3 decimals, more where needed: "14.074", "7.0105". The style of `mhz` without the unit. */
export function mhzText(hz: number): string {
  return (hz / 1e6).toFixed(6).replace(/0{1,3}$/, '');
}

/** The mode a row shows: FT8 or FT4 when detected, else the spotted mode. */
export function modeText(s: Spot): string {
  return s.digital ?? s.mode;
}

/** "14.074 FT8"; the frequency or the mode alone when the other is missing. */
export function freqModeText(s: Spot): string {
  return [s.freqHz === null ? '' : mhzText(s.freqHz), modeText(s)].filter(Boolean).join(' ');
}

/** "POTA VK-0921", "POTA NZ-0008, IOTA OC-134"; "DX" for a spot without references. */
export function refsText(s: Spot): string {
  return s.refs.length ? s.refs.map((r) => `${r.programme} ${r.ref}`).join(', ') : 'DX';
}

/** The first reference name, or the country of a DX spot: "Example park", "New Zealand". */
function placeText(s: Spot): string {
  return s.refs.find((r) => r.name)?.name ?? (s.refs.length ? '' : s.country);
}

/** The second line of a row: "POTA VK-0921 · Example park", "DX · New Zealand". */
export function referenceText(s: Spot): string {
  const place = placeText(s);
  return place ? refsText(s) + DOT + place : refsText(s);
}

/** The open row's line: "Spotted by VK2ESN at 13:19 UTC", with the skimmer's SNR: "· −15 dB". */
export function spottedText(s: Spot): string {
  const by = s.spotter ? `Spotted by ${s.spotter}${s.automatic ? ' (RBN)' : ''} at ` : 'Spotted at ';
  const snr = s.snrDb === null ? '' : DOT + (s.snrDb < 0 ? MINUS + Math.abs(s.snrDb) : String(s.snrDb)) + ' dB';
  return `${by}${utcHm(s.spottedAt)} UTC${snr}`;
}

/** The spotter's comments for the open row, or '' when they repeat the mode or come from a skimmer. */
export function noteText(s: Spot): string {
  if (s.automatic || !s.comments) return '';
  const c = s.comments.toUpperCase();
  return c === s.mode || c === s.digital ? '' : s.comments;
}

/** What a screen reader says for a row. */
export function rowSpoken(s: Spot, badge: string | null, now: number): string {
  const freq = s.freqHz === null ? '' : `${mhzText(s.freqHz)} MHz`;
  return [s.activator, badge ?? '', [freq, modeText(s)].filter(Boolean).join(' '), refsText(s), placeText(s), ageSpoken(s.spottedAt, now)].filter(Boolean).join(', ');
}

/** "POTA", "POTA or SOTA", "POTA, SOTA or DX". */
function orList(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
}

/** The classes a filter shows, for "No … spots": "", "activation ", "POTA or SOTA ". */
function classWords(available: readonly SpotClass[], chosen: readonly SpotClass[]): string {
  if (chosen.length === available.length) return '';
  const programmes = available.filter((c) => c !== 'DX');
  if (!chosen.includes('DX') && programmes.length > 1 && programmes.every((p) => chosen.includes(p))) return 'activation ';
  return `${orList(chosen)} `;
}

/** The empty list's text: why nothing shows, and what will appear when. */
export function emptyText(view: SpotFeedView, filter: SpotFilter, ctx: FilterContext): string {
  if (!view.sources.length) return 'Spots are off. Turn on POTA spots or Cluster spots in Settings › Optional features.';
  const chosen = view.classes.filter((c) => filter.classes.includes(c));
  if (!chosen.length) return `Choose ${orList(view.classes)} to see spots.`;
  if (view.updatedAt === null) {
    if (!view.online) return `Spots appear here when the ${device} is back online.`;
    if (view.failing.length) return `Spots appear here when ${orList(view.failing.map((f) => f.name))} answers.`;
    return 'Fetching spots.';
  }
  const isNew = filter.newOnly && ctx.isNew ? 'new ' : '';
  const digital = filter.digitalOnly ? 'FT8 or FT4 ' : '';
  const bands = filter.myBandsOnly && ctx.myBands.length ? ' on your bands' : '';
  return `No ${isNew}${digital}${classWords(view.classes, chosen)}spots${bands}.`;
}

function failureText(f: FailingSource): string {
  switch (f.kind) {
    case 'network':
      return `${f.name} is unreachable.`;
    case 'timeout':
      return `${f.name} did not answer within ${Math.round((f.afterMs ?? 0) / 1000)} s.`;
    case 'http':
      return f.status === null ? `${f.name} answered with an error.` : `${f.name} answered with error ${f.status}.`;
    case 'format':
      return `${f.name} sent spots RR73 cannot read.`;
  }
}

/** The line under the list: how fresh it is, or what went wrong and when RR73 tries again. */
export function statusText(view: SpotFeedView): string {
  if (!view.sources.length) return '';
  const at = view.updatedAt === null ? null : `${utcHm(view.updatedAt)} UTC`;
  if (!view.online) return at ? `Offline. The list is from ${at} and refreshes when the ${device} is back online.` : '';
  if (view.failing.length) {
    const parts = view.failing.map(failureText);
    if (at) parts.push(`Showing spots from ${at}.`);
    const retry = view.failing.flatMap((f) => (f.retryAt === null ? [] : [f.retryAt]));
    if (retry.length) parts.push(`Next try at ${utcHm(Math.min(...retry))} UTC.`);
    return parts.join(' ');
  }
  return at ? `Updated ${at}` : '';
}
