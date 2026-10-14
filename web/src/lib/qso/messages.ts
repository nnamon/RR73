/**
 * Reads decoded FT8 and FT4 messages for the sequencer, and builds Tx1 to Tx6
 * (docs/design/sequencer.md). Only the standard exchange is read: CQ, grid, report, R-report,
 * RRR, RR73 and 73, and the Fox's multi-call message of FT8 DXpedition mode (parseParts).
 * Anything else is 'other'.
 */

import { baseCall, looksLikeCall } from '../decode/marking';

export type TxNum = 1 | 2 | 3 | 4 | 5 | 6;
export const TX_NUMS: readonly TxNum[] = [1, 2, 3, 4, 5, 6];

export type ExchangeKind = 'cq' | 'call' | 'grid' | 'report' | 'rreport' | 'rrr' | 'rr73' | '73' | 'other';

export interface Exchange {
  /** First callsign, or null for CQ. */
  to: string | null;
  /** The sender. */
  from: string | null;
  kind: ExchangeKind;
  /** Four-character grid square, for cq and grid. */
  grid: string | null;
  /** Report in dB, for report and rreport. */
  report: number | null;
  /** CQ modifier, such as DX or POTA. */
  modifier: string | null;
  /** One of the two parts of a Fox's multi-call message (parseParts). */
  multi?: boolean;
}

const GRID = /^[A-R]{2}\d{2}$/;
const REPORT = /^[+-]\d{2}$/;
const RREPORT = /^R[+-]\d{2}$/;

/** Callsign without hash brackets, upper case. */
export function bare(call: string): string {
  return call.replace(/[<>]/g, '').toUpperCase();
}

/** True when two callsigns name the same station (portable prefixes and suffixes aside). */
export function sameCall(a: string | null, b: string | null): boolean {
  return !!a && !!b && baseCall(bare(a)) === baseCall(bare(b));
}

export function parseExchange(text: string): Exchange {
  const t = text.trim().toUpperCase().split(/\s+/);
  const none: Exchange = { to: null, from: null, kind: 'other', grid: null, report: null, modifier: null };
  if (t[0] === 'CQ') {
    const rest = t.slice(1);
    const i = rest.findIndex(looksLikeCall);
    if (i < 0) return none;
    const modifier = i > 0 ? rest.slice(0, i).join(' ') : null;
    const after = rest[i + 1] ?? null;
    if (rest.length > i + 2) return none;
    const grid = after && GRID.test(after) && after !== 'RR73' ? after : null;
    if (after && !grid) return none;
    return { to: null, from: rest[i], kind: 'cq', grid, report: null, modifier };
  }
  if (t.length < 2 || t.length > 3 || !looksLikeCall(t[0]) || !looksLikeCall(t[1])) return none;
  const base = { to: t[0], from: t[1], grid: null, report: null, modifier: null };
  const w = t[2];
  if (w === undefined) return { ...base, kind: 'call' };
  if (w === 'RR73') return { ...base, kind: 'rr73' };
  if (w === 'RRR') return { ...base, kind: 'rrr' };
  if (w === '73') return { ...base, kind: '73' };
  if (GRID.test(w)) return { ...base, kind: 'grid', grid: w };
  if (REPORT.test(w)) return { ...base, kind: 'report', report: Number(w) };
  if (RREPORT.test(w)) return { ...base, kind: 'rreport', report: Number(w.slice(1)) };
  return { ...base, kind: 'other' };
}

/** A Fox's multi-call message: RR73 to one Hound, a report to the next, the Fox's callsign hashed. */
const MULTI = /^(\S+) RR73; (\S+) (<[^>]+>) ([+-]\d{2})$/;

/**
 * The parts of a decoded message. A Fox's multi-call message (FT8 DXpedition mode,
 * "K1ABC RR73; W9XYZ <KH1/KH7Z> -08") gives two, both from the Fox: RR73 to the first station
 * and a report to the second. The Fox's callsign shows as <...> until the decoder has heard it
 * in full. Any other message gives one part, as parseExchange reads it.
 */
export function parseParts(text: string): Exchange[] {
  const m = MULTI.exec(text.trim().toUpperCase().replace(/\s+/g, ' '));
  if (!m || !looksLikeCall(m[1]) || !looksLikeCall(m[2])) return [parseExchange(text)];
  const part = { from: m[3], grid: null, modifier: null, multi: true };
  return [
    { ...part, to: m[1], kind: 'rr73', report: null },
    { ...part, to: m[2], kind: 'report', report: Number(m[4]) },
  ];
}

/**
 * True when a part comes from the Fox `fox`: its callsign, or the unknown hash <...> of a
 * multi-call message, which only a Fox sends.
 */
export function fromFox(x: Exchange, fox: string): boolean {
  return sameCall(x.from, fox) || (!!x.multi && x.from === '<...>');
}

/** The callsign a Hound sends to a Fox: the base callsign of a compound one ("KH1/KH7Z" gives "KH7Z"). */
export function foxCall(call: string): string {
  return baseCall(bare(call));
}

/** A report as sent on air: whole dB, −50 to +49, signed, two digits: "-09", "+03". */
export function formatReport(snrDb: number): string {
  const v = Math.max(-50, Math.min(49, Math.round(snrDb)));
  const a = Math.abs(v);
  return `${v < 0 ? '-' : '+'}${a < 10 ? '0' : ''}${a}`;
}

export interface MessageParts {
  /** The other station; null when calling CQ only. */
  dx: string | null;
  me: string;
  /** Operator grid; the first 4 characters go on air. */
  grid: string;
  /** Report to send, dB. */
  report: number | null;
  /** RR73 or RRR for Tx4. */
  ack: 'RR73' | 'RRR';
  /** CQ modifier for Tx6, such as POTA. */
  cqModifier: string | null;
}

/** Tx1 to Tx6 for the current partner; messages that need a partner or report are empty without one. */
export function buildMessages(p: MessageParts): Record<TxNum, string> {
  const grid4 = p.grid.slice(0, 4).toUpperCase();
  const me = p.me.toUpperCase();
  const dx = p.dx ? p.dx.toUpperCase() : null;
  const rpt = p.report === null ? null : formatReport(p.report);
  const cq = ['CQ', p.cqModifier?.trim().toUpperCase() || null, me, grid4].filter(Boolean).join(' ');
  return {
    1: dx ? `${dx} ${me} ${grid4}` : '',
    2: dx && rpt ? `${dx} ${me} ${rpt}` : '',
    3: dx && rpt ? `${dx} ${me} R${rpt}` : '',
    4: dx ? `${dx} ${me} ${p.ack}` : '',
    5: dx ? `${dx} ${me} 73` : '',
    6: cq,
  };
}

/** A grid square of 4 or 6 characters: "OJ11", "OJ11ab". */
export function isGrid(g: string): boolean {
  return /^[A-R]{2}\d{2}([A-X]{2})?$/i.test(g.trim());
}
