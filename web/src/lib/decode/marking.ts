/**
 * Decode row marking as in WSJT-X: a 4 px bar, a tint and the callsign in bold.
 * - me: a message containing my callsign (red), the other station in bold. It wins over cq;
 * - cq: a CQ call (green), the calling station in bold;
 * - sent: a message I transmitted (amber), the other station in bold.
 */

import type { HighlightId } from './highlight';
import type { Decode } from './types';

export type Mark = 'cq' | 'me' | 'sent' | null;

export type BadgeTone = 'teal' | 'mag' | 'muted' | 'bad';

export interface Badge {
  text: string;
  tone: BadgeTone;
}

export interface DecodeRowData {
  decode: Decode;
  mark: Mark;
  /** The callsign shown in bold, as it appears in the text. */
  key: string | null;
  /** Shown in place of SNR and DT for sent rows: "13:14:30". */
  time?: string;
  badge?: Badge;
  /** Note before the numbers, such as a country or a Run caller's place in the queue. */
  meta?: string;
  /** The background decode colour that matched first (highlight.ts), if any. */
  hl?: HighlightId | null;
  /** The text layer over it, such as worked before, if any. */
  ink?: HighlightId | null;
  /** An enabled new category matches: the New filter shows it. */
  isNew?: boolean;
  /** The sender is a dupe, worked today on this band and mode: Hide worked hides it. */
  worked?: boolean;
  /** Worked on this band and mode on another day (DecodeHighlight.before). */
  before?: boolean;
}

/** Text with one bold span, for rendering without HTML. */
export interface TextParts {
  before: string;
  bold: string;
  after: string;
}

/**
 * A token that can be a callsign: letters and digits with at least one of each, or a hashed
 * call. Two letters A to R and two digits is a grid square (or RR73), never a callsign.
 */
export function looksLikeCall(token: string): boolean {
  if (/^<.+>$/.test(token)) return true;
  if (/^[A-R]{2}\d{2}$/.test(token)) return false;
  return /^[A-Z0-9/]{3,13}$/.test(token) && /[A-Z]/.test(token) && /\d/.test(token);
}

/** The base callsign without prefixes or suffixes: "VK3/9V1NE/P" gives "9V1NE". */
export function baseCall(call: string): string {
  const parts = call.replace(/[<>]/g, '').split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return parts.reduce((a, b) => (looksLikeCall(b) && b.length > a.length ? b : a), parts[0]);
}

function sameStation(a: string, b: string): boolean {
  return !!a && !!b && baseCall(a) === baseCall(b);
}

/** Marks a decode for the list. `sent` is true for messages this station transmitted. */
export function markDecode(decode: Decode, myCall: string, sent = false): { mark: Mark; key: string | null } {
  const tokens = decode.text.trim().split(/\s+/);
  const me = myCall.trim().toUpperCase();
  if (sent) return { mark: 'sent', key: tokens[0] ?? null };
  const mine = me ? tokens.findIndex((t) => looksLikeCall(t) && sameStation(t, me)) : -1;
  if (mine >= 0) {
    // The other station: the callsign beside mine, before it for "CALL MINE ...", after it for
    // "MINE CALL ...".
    const others = tokens.filter((t, i) => i !== mine && t !== 'CQ' && looksLikeCall(t) && !sameStation(t, me));
    const key = mine === 0 ? (tokens[1] ?? null) : (others[0] ?? null);
    return { mark: 'me', key: key && !sameStation(key, me) ? key : null };
  }
  if (tokens[0] === 'CQ') {
    const key = tokens.slice(1).find(looksLikeCall) ?? null;
    return { mark: 'cq', key };
  }
  return { mark: null, key: null };
}

/** Splits the text around the first whole-word occurrence of `key`. */
export function splitKey(text: string, key: string | null): TextParts {
  if (!key) return { before: text, bold: '', after: '' };
  const tokens = text.split(/(\s+)/);
  const i = tokens.indexOf(key);
  if (i < 0) return { before: text, bold: '', after: '' };
  return { before: tokens.slice(0, i).join(''), bold: key, after: tokens.slice(i + 1).join('') };
}
