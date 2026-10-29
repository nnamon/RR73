/**
 * Reads decoded FT8, FT4 and LQ8 messages for the sequencer, and builds Tx1 to Tx6
 * (docs/design/sequencer.md). Only the standard exchange is read: CQ, grid, report, R-report,
 * RRR, RR73 and 73, and the Fox's multi-call message of FT8 DXpedition mode (parseParts).
 * With `formats`, the exchange formats too (lib/qso/exchange.ts): their exchange reads as a
 * report, with R as an R-report. Anything else is 'other'.
 *
 * LQ8 (docs/design/lq8.md) has its own shapes, which FT8 and FT4 decodes never take: a call
 * carries a grid and a report ("AB4SS 9V1NE OJ11 -03", read as a report with a grid), REPORT+73
 * reads as an R-report, and the multi-station messages ("<9V1NE> R+05 <OE3OGC> R-03 <AB4SS>",
 * "<9V1NE> <OE3OGC> <AB4SS> 73") give one part per target, the sender's callsign always in
 * brackets.
 */

import { baseCall, looksLikeCall } from '../decode/marking';
import type { Format, ReceivedExchange } from './exchange';

export type TxNum = 1 | 2 | 3 | 4 | 5 | 6;
export const TX_NUMS: readonly TxNum[] = [1, 2, 3, 4, 5, 6];
/** LQ8's messages: the call, REPORT+73, 73 and CQ (buildMessages). */
export const LQ8_TX_NUMS: readonly TxNum[] = [1, 3, 5, 6];

/** The messages a mode uses, Tx1 to Tx6 or LQ8's 4. */
export function txNums(mode: string): readonly TxNum[] {
  return mode === 'LQ8' ? LQ8_TX_NUMS : TX_NUMS;
}

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
  /** The format of a report or R-report: standard, or an exchange format with what it carried. */
  format?: Format;
  rcvd?: ReceivedExchange;
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

/**
 * An exchange format's message, its words after the callsigns: class and section ("17B EMA"),
 * report with state, province or serial ("579 MA", "579 0013"), report and serial with a
 * 6-character grid ("570007 JO22DB"). Text as the codec shows it.
 */
function readFormat(w: string[]): { format: Format; rcvd: ReceivedExchange; grid: string | null } | null {
  if (w.length !== 2) return null;
  const [a, b] = w;
  if (/^\d{1,2}[A-H]$/.test(a) && /^[A-Z]{2,3}$/.test(b)) return { format: 'fd', rcvd: { rst: '', srx: `${a} ${b}` }, grid: null };
  if (/^5\d9$/.test(a) && /^(\d{4}|[A-Z]{2,3})$/.test(b)) return { format: 'ru', rcvd: { rst: a, srx: b }, grid: null };
  if (/^5\d{5}$/.test(a) && /^[A-R]{2}\d{2}[A-X]{2}$/.test(b)) return { format: 'vhf', rcvd: { rst: a.slice(0, 2), srx: `${a.slice(2)} ${b}` }, grid: b };
  return null;
}

export function parseExchange(text: string, formats = false): Exchange {
  let t = text.trim().toUpperCase().split(/\s+/);
  // "TU; W9XYZ K1ABC 579 MA": the sender ends its QSO before and sends its exchange to W9XYZ.
  if (formats && t[0] === 'TU;') t = t.slice(1);
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
  if (formats && t.length >= 4 && t.length <= 5 && looksLikeCall(t[0]) && looksLikeCall(t[1])) {
    const ack = t.length === 5 && t[2] === 'R';
    const f = (t.length === 4 || ack) && readFormat(t.slice(-2));
    if (f) return { to: t[0], from: t[1], kind: ack ? 'rreport' : 'report', grid: f.grid, report: null, modifier: null, format: f.format, rcvd: f.rcvd };
  }
  // LQ8: the call with a grid and a report.
  if (t.length === 4 && looksLikeCall(t[0]) && looksLikeCall(t[1]) && GRID.test(t[2]) && REPORT.test(t[3])) {
    return { to: t[0], from: t[1], kind: 'report', grid: t[2], report: Number(t[3]), modifier: null };
  }
  const multi = lq8Multi(t);
  if (multi) return multi[0];
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

const BRACKETED = /^<[^>]+>$/;

/**
 * LQ8's MULTI-REPORT+73 ("<T1> R+05 <T2> R-03 <DX>", or one target, "<T1> R+05 <DX>") and
 * MULTI-73 ("<T1> <T2> <DX> 73"): one part per target, from the sender DX. Null for other words.
 */
function lq8Multi(t: string[]): Exchange[] | null {
  const part = (to: string, kind: ExchangeKind, report: number | null): Exchange => ({ to, from: t.at(t.at(-1) === '73' ? -2 : -1)!, kind, grid: null, report, modifier: null, multi: true });
  const bracketed = (...i: number[]) => i.every((k) => BRACKETED.test(t[k]));
  if (t.length === 5 && bracketed(0, 2, 4) && RREPORT.test(t[1]) && RREPORT.test(t[3])) {
    return [part(t[0], 'rreport', Number(t[1].slice(1))), part(t[2], 'rreport', Number(t[3].slice(1)))];
  }
  if (t.length === 3 && bracketed(0, 2) && RREPORT.test(t[1])) return [part(t[0], 'rreport', Number(t[1].slice(1)))];
  if (t.length === 4 && t[3] === '73' && bracketed(0, 1, 2)) return [part(t[0], '73', null), part(t[1], '73', null)];
  return null;
}

/** A Fox's multi-call message: RR73 to one Hound, a report to the next, the Fox's callsign hashed. */
const MULTI = /^(\S+) RR73; (\S+) (<[^>]+>) ([+-]\d{2})$/;

/**
 * The parts of a decoded message. A Fox's multi-call message (FT8 DXpedition mode,
 * "K1ABC RR73; W9XYZ <KH1/KH7Z> -08") gives two, both from the Fox: RR73 to the first station
 * and a report to the second. The Fox's callsign shows as <...> until the decoder has heard it
 * in full. Any other message gives one part, as parseExchange reads it (with `formats`, the
 * exchange formats too).
 */
export function parseParts(text: string, formats = false): Exchange[] {
  const lq8 = lq8Multi(text.trim().toUpperCase().split(/\s+/));
  if (lq8) return lq8;
  const m = MULTI.exec(text.trim().toUpperCase().replace(/\s+/g, ' '));
  if (!m || !looksLikeCall(m[1]) || !looksLikeCall(m[2])) return [parseExchange(text, formats)];
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

/** Reports LQ8 carries, dB: its 5-bit field holds −26 to +5. */
export const LQ8_REPORT = { min: -26, max: 5 } as const;

/** A report as sent on air: whole dB, −50 to +49 (−26 to +5 in LQ8), signed, two digits: "-09", "+03". */
export function formatReport(snrDb: number, lq8 = false): string {
  const [lo, hi] = lq8 ? [LQ8_REPORT.min, LQ8_REPORT.max] : [-50, 49];
  const v = Math.max(lo, Math.min(hi, Math.round(snrDb)));
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
  /**
   * Tx2 and Tx3 in an exchange format: its words after the callsigns, or '' when Contest exchange
   * lacks a part, which leaves both empty. Absent or null: standard reports.
   */
  exchange?: { format: Exclude<Format, 'standard'>; text: string } | null;
  /** LQ8's 4 messages: Tx1 the call with grid and report, Tx3 REPORT+73, Tx5 73, Tx6 CQ; Tx2 and Tx4 stay empty. */
  lq8?: boolean;
}

/** Tx1 to Tx6 for the current partner; messages that need a partner or report are empty without one. */
export function buildMessages(p: MessageParts): Record<TxNum, string> {
  const grid4 = p.grid.slice(0, 4).toUpperCase();
  const me = p.me.toUpperCase();
  const dx = p.dx ? p.dx.toUpperCase() : null;
  const rpt = p.report === null ? null : formatReport(p.report, p.lq8);
  const cq = ['CQ', p.cqModifier?.trim().toUpperCase() || null, me, grid4].filter(Boolean).join(' ');
  if (p.lq8) {
    return {
      1: dx && rpt ? `${dx} ${me} ${grid4} ${rpt}` : '',
      2: '',
      3: dx && rpt ? `${dx} ${me} R${rpt}` : '',
      4: '',
      5: dx ? `${dx} ${me} 73` : '',
      6: cq,
    };
  }
  const x = p.exchange;
  if (x && dx) {
    // Type 5 carries both callsigns as hashes,
    // and the other messages send them in full where the codec can, as type 1 or 4 decides.
    const call = bare(dx);
    const pair = x.format === 'vhf' ? `<${call}> <${bare(me)}>` : `${call} ${me}`;
    return {
      1: `${call} ${me} ${grid4}`,
      2: x.text ? `${pair} ${x.text}` : '',
      3: x.text ? `${pair} R ${x.text}` : '',
      4: `${call} ${me} ${p.ack}`,
      5: `${call} ${me} 73`,
      6: cq,
    };
  }
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
