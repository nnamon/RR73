/**
 * Builds the decode list: newest slot first, a bar per slot, rows marked as in WSJT-X, the
 * callers in Run, and the chip filters.
 */

import { utcTime } from '../clock/format';
import { SLOT_MS, parity, type Mode, type Parity } from '../clock/slots';
import { bare, formatReport, parseExchange, sameCall } from '../qso/messages';
import type { Caller } from '../qso/sequencer';
import type { DecodeHighlight } from './highlight';
import { markDecode, type DecodeRowData } from './marking';
import type { Decode } from './types';

/** The decode colours for a decode; `sent` is true for the operator's own transmissions. */
export type Classify = (decode: Decode, sent: boolean) => DecodeHighlight;

const NO_COLOUR: DecodeHighlight = { bg: null, ink: null };

function colours(classify: Classify | undefined, d: Decode, sent: boolean): { hl: DecodeHighlight['bg']; ink: DecodeHighlight['ink'] } {
  const h = classify ? classify(d, sent) : NO_COLOUR;
  return { hl: h.bg, ink: h.ink };
}

export type Filter = 'all' | 'cq' | 'me' | 'rx';

/** Decodes within this distance of the receive frequency pass the Rx freq filter, Hz. */
export const RX_WINDOW_HZ = 10;

export interface SlotDecodes {
  startUtcMs: number;
  mode: Mode;
  decodes: Decode[];
  /** Time the decoder took, ms. */
  ms: number;
  skipped?: boolean;
}

/** A slot bar: "09:50:15", "9 decodes", even or odd; `text` is the whole line for screen readers. */
export interface HeaderItem {
  kind: 'header';
  id: string;
  time: string;
  detail: string;
  parity: Parity;
  text: string;
  /** Time the decoder took, ms; on decoded slots only. */
  ms?: number;
}

export type ListItem = HeaderItem | { kind: 'row'; id: string; row: DecodeRowData; slotStartMs: number };

function header(id: string, startMs: number, mode: Mode, detail: string): HeaderItem {
  const time = utcTime(startMs);
  return { kind: 'header', id, time, detail, parity: parity(startMs, mode), text: `${time} UTC · ${detail}` };
}

/** A message we transmitted, shown as an amber row. */
export interface SentItem {
  slotStartMs: number;
  text: string;
  freqHz: number;
}

/** What a slot bar says after the time: "23 decodes". */
export function slotDetail(s: SlotDecodes): string {
  if (s.skipped) return 'not decoded: the decoder was busy';
  const n = s.decodes.length;
  return `${n} ${n === 1 ? 'decode' : 'decodes'}`;
}

/** The slot bar for `s`. */
export function slotHeader(s: SlotDecodes): HeaderItem {
  const h = header(`h${s.startUtcMs}`, s.startUtcMs, s.mode, slotDetail(s));
  return s.skipped ? h : { ...h, ms: s.ms };
}

function passes(row: DecodeRowData, filter: Filter, rxHz: number): boolean {
  if (filter === 'all') return true;
  if (filter === 'rx') return Math.abs(row.decode.freq_hz - rxHz) <= RX_WINDOW_HZ;
  return row.mark === filter;
}

/**
 * List items for `slots` and our own transmissions, newest first. A transmission sorts by its
 * start (slot + 0.5 s) under a "you sent" bar, a decoded slot by its end. With a filter, slots
 * with no matching decode are left out; with none, every slot shows its bar. Transmissions show
 * with All and To me; `mode` gives their slot parity.
 */
export function buildList(slots: SlotDecodes[], myCall: string, filter: Filter, rxHz: number, sent: SentItem[] = [], mode: Mode = 'FT8', classify?: Classify): ListItem[] {
  type Group = { at: number; items: ListItem[] };
  const groups: Group[] = [];
  for (const s of slots) {
    const rows = s.decodes
      .map((d) => ({ decode: d, ...markDecode(d, myCall) }))
      .filter((r) => passes(r, filter, rxHz))
      .map((r) => ({ ...r, ...colours(classify, r.decode, false) }));
    if (!rows.length && filter !== 'all') continue;
    const items: ListItem[] = [slotHeader(s)];
    rows.forEach((row, i) => items.push({ kind: 'row', id: `${s.startUtcMs}-${i}`, row, slotStartMs: s.startUtcMs }));
    groups.push({ at: s.startUtcMs + SLOT_MS[s.mode], items });
  }
  if (filter === 'all' || filter === 'me') {
    for (const t of sent) {
      const d = { text: t.text, freq_hz: t.freqHz, dt_s: 0, snr_db: 0 };
      const row: DecodeRowData = { decode: d, ...markDecode(d, myCall, true), time: utcTime(t.slotStartMs), ...colours(classify, d, true) };
      groups.push({ at: t.slotStartMs + 500, items: [header(`hs${t.slotStartMs}`, t.slotStartMs, mode, 'you sent'), { kind: 'row', id: `s${t.slotStartMs}`, row, slotStartMs: t.slotStartMs }] });
    }
  }
  return groups.sort((a, b) => b.at - a.at).flatMap((g) => g.items);
}

/** Decodes per filter, for the chips. */
export function filterCounts(slots: SlotDecodes[], myCall: string, rxHz: number): Record<Filter, number> {
  const rows = slots.flatMap((s) => s.decodes.map((d) => ({ decode: d, ...markDecode(d, myCall) })));
  return {
    all: rows.length,
    cq: rows.filter((r) => r.mark === 'cq').length,
    me: rows.filter((r) => r.mark === 'me').length,
    rx: rows.filter((r) => passes(r, 'rx', rxHz)).length,
  };
}

/** The station being worked in Run. */
export interface Working {
  call: string;
  grid: string | null;
  snrDb: number;
  dtS: number;
  freqHz: number;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/**
 * Run's callers at the top of the list, in answering order: the station being worked, then the
 * queue (`callers`, already ordered), tagged Working, Next, 3rd. Each row is the caller's latest
 * decode addressed to `myCall` in `slots` (newest first), or one made from what the sequencer
 * kept. Dupes show as Dupe and are skipped unless `workDupes`. Empty when nobody calls.
 */
export function callerItems(slots: SlotDecodes[], myCall: string, mode: Mode, working: Working | null, callers: Caller[], workDupes: boolean, classify?: Classify): ListItem[] {
  if (!working && !callers.length) return [];
  const latest = (call: string): { d: Decode; slotStartMs: number } | null => {
    for (const s of slots) {
      for (let i = s.decodes.length - 1; i >= 0; i--) {
        const ex = parseExchange(s.decodes[i].text);
        if (sameCall(ex.from, call) && sameCall(ex.to, myCall)) return { d: s.decodes[i], slotStartMs: s.startUtcMs };
      }
    }
    return null;
  };
  const me = myCall.trim().toUpperCase();
  const made = (call: string, end: string | null, snrDb: number, dtS: number, freqHz: number): Decode => ({ text: [me, call, end].filter(Boolean).join(' '), snr_db: snrDb, dt_s: dtS, freq_hz: freqHz });
  const ends = (c: Caller) => (c.kind === 'report' && c.report !== null ? formatReport(c.report) : c.kind === 'rreport' && c.report !== null ? `R${formatReport(c.report)}` : c.grid);
  const rows: ListItem[] = [];
  let newest = 0;
  const add = (call: string, meta: string, fallback: Decode, heardMs: number) => {
    const found = latest(call);
    const d = found?.d ?? fallback;
    const at = found?.slotStartMs ?? heardMs;
    newest = Math.max(newest, at);
    rows.push({ kind: 'row', id: `c-${bare(call)}`, row: { decode: d, ...markDecode(d, myCall), meta, ...colours(classify, d, false) }, slotStartMs: at });
  };
  if (working) add(working.call, 'Working', made(working.call, working.grid, working.snrDb, working.dtS, working.freqHz), 0);
  let n = working ? 1 : 0;
  for (const c of callers) {
    const live = workDupes || !c.dupe;
    const meta = !live ? 'Dupe' : n === (working ? 1 : 0) ? 'Next' : ordinal(n + 1);
    if (live) n++;
    add(c.call, meta, made(c.call, ends(c), c.snrDb, c.dtS, c.freqHz), c.heardMs);
  }
  const bar = newest ? header('hcallers', newest, mode, 'callers, in answering order') : { ...header('hcallers', 0, mode, 'in answering order'), time: 'Callers', text: 'Callers, in answering order' };
  return [bar, ...rows];
}
