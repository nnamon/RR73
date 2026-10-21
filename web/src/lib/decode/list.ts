/**
 * Builds the decode list: newest slot first, a bar per slot, rows marked as in WSJT-X, the
 * callers in Run, and the chip filters. Our own transmission sits at the top as soon as it is
 * planned (Next), then while on air (Sending), then stays in its slot (Sent). Rows of slots older
 * than the newest slot with decodes are marked old, so they fade. Messages to you lead their
 * slot. Consecutive slots with no decodes share one bar that gives the span.
 */

import { utcTime } from '../clock/format';
import { SLOT_MS, parity, type FtMode as Mode, type Parity } from '../clock/slots';
import { toYou } from './focus';
import type { DecodeHighlight } from './highlight';
import { markDecode, type DecodeRowData } from './marking';
import { parseExchange, type ExchangeKind } from '../qso/messages';
import type { Decode } from './types';

/** The decode colours for a decode; `sent` is true for the operator's own transmissions. */
export type Classify = (decode: Decode, sent: boolean) => DecodeHighlight;

const NO_COLOUR: DecodeHighlight = { bg: null, ink: null, isNew: false, worked: false };

function colours(classify: Classify | undefined, d: Decode, sent: boolean): Pick<DecodeRowData, 'hl' | 'ink' | 'isNew' | 'worked'> {
  const h = classify ? classify(d, sent) : NO_COLOUR;
  return { hl: h.bg, ink: h.ink, isNew: h.isNew, worked: h.worked };
}

/** A decode as the list shows it, and whether it is addressed to the operator. */
export interface RowFacts {
  row: DecodeRowData;
  toYou: boolean;
}

/** A decode's RowFacts. */
export type Facts = (d: Decode) => RowFacts;

/**
 * Works out each decode's RowFacts once for `myCall` and `classify`, and keeps them while the decode
 * lives: the list and the chip counts go over an hour of slots each time a slot arrives.
 */
export function rowFacts(myCall: string, classify?: Classify): Facts {
  const seen = new WeakMap<Decode, RowFacts>();
  return (d) => {
    let f = seen.get(d);
    if (!f) seen.set(d, (f = { row: { decode: d, ...markDecode(d, myCall), ...colours(classify, d, false) }, toYou: toYou(d.text, myCall) }));
    return f;
  };
}

/** The chips: every decode, CQs, decodes new by the decode colours, messages to me, and decodes near Rx. */
export type Filter = 'all' | 'cq' | 'new' | 'me' | 'rx';
const FILTERS: readonly Filter[] = ['all', 'cq', 'new', 'me', 'rx'];

/** Decodes within this distance of the receive frequency pass the Rx freq filter, Hz. */
export const RX_WINDOW_HZ = 10;

/** Decodes within this distance of the receive frequency show in the Rx frequency pane (regular width), Hz. */
export const RX_PANE_HZ = 50;

/**
 * The two panes of regular width. Band activity has every decode and marks the slots we
 * transmitted in with a grey Tx slot bar; Rx frequency has the decodes near Rx, the messages to
 * us and our own Next, Sending and Sent rows, under bars that count what it shows.
 */
export interface ListOptions {
  /** rows: our transmissions as rows (the phone's list); bar: a Tx slot bar for each sent slot. */
  own?: 'rows' | 'bar';
  /** The Rx frequency pane: decodes within RX_PANE_HZ of Rx or to us, whatever the filter. */
  rxPane?: boolean;
  /** Hide worked: leaves out decodes from stations in the log on this band and mode, but messages to us. */
  hideWorked?: boolean;
  /** The decodes' facts, from rowFacts for the same `myCall` and `classify`; worked out afresh without. */
  facts?: Facts;
  /** Sort decodes: in each slot, messages to us, then CQs, then the other kinds in KIND_ORDER, each by frequency. */
  sorted?: boolean;
}

/** The order of message kinds with Sort decodes on: CQs first, then calls, reports and endings. */
const KIND_ORDER: Record<ExchangeKind, number> = { cq: 0, call: 1, grid: 1, report: 2, rreport: 3, rrr: 4, rr73: 4, '73': 5, other: 6 };

export interface SlotDecodes {
  startUtcMs: number;
  mode: Mode;
  decodes: Decode[];
  /** Time the decoder took, ms. */
  ms: number;
  skipped?: boolean;
}

/**
 * A slot bar: "09:50:15", "9 decodes", even or odd; `text` is the whole line for screen readers.
 * A run of consecutive slots with no decodes has one bar, from `time` (its oldest slot) to
 * `until` (its newest), with no parity.
 */
export interface HeaderItem {
  kind: 'header';
  id: string;
  time: string;
  /** Start of the newest slot of a run of slots with no decodes. */
  until?: string;
  detail: string;
  parity: Parity | null;
  text: string;
  /** Time the decoder took, ms; on decoded slots only. */
  ms?: number;
}

/** Where our own transmission stands: planned, on air, or sent. */
export type OutStage = 'next' | 'sending' | 'sent';

export interface OutInfo {
  stage: OutStage;
  /** Start of the transmission, UTC ms. */
  startMs: number;
  /** End of the transmission, UTC ms: on air only. */
  endMs?: number;
}

export interface RowItem {
  kind: 'row';
  id: string;
  row: DecodeRowData;
  slotStartMs: number;
  /** From a slot older than the newest slot with decodes: drawn faded. */
  old?: boolean;
  /** Our own transmission. */
  out?: OutInfo;
  /** Addressed to the operator's callsign: leads its slot, with a red edge and bold text. */
  toYou?: boolean;
  /** Unrelated to the station being worked: drawn dimmed (focus.ts). */
  dim?: boolean;
}

export type ListItem = HeaderItem | RowItem;

/**
 * What an outgoing row says at `nowMs`: its tag ("Next · :00", "Sending", "Sent"), the text on
 * the right ("in 6 s", "1500 Hz") and, on air, how much of the transmission is done (0 to 1).
 */
export function outText(out: OutInfo, slotStartMs: number, freqHz: number, nowMs: number): { tag: string; meta: string; progress: number | null } {
  if (out.stage === 'next') return { tag: `Next · :${utcTime(slotStartMs).slice(6)}`, meta: `in ${Math.max(0, Math.ceil((out.startMs - nowMs) / 1000))} s`, progress: null };
  const meta = `${Math.round(freqHz)} Hz`;
  if (out.stage === 'sent') return { tag: 'Sent', meta, progress: null };
  const span = (out.endMs ?? out.startMs) - out.startMs;
  const progress = span > 0 ? Math.min(1, Math.max(0, (nowMs - out.startMs) / span)) : 0;
  return { tag: 'Sending', meta, progress };
}

/** Our transmission, planned or on air, for the top of the list. */
export interface Outgoing {
  /** The next transmission, while Tx is on and it waits for its slot. */
  next?: { slotStartMs: number; startMs: number; text: string; freqHz: number } | null;
  /** The transmission on air: its slot, start and end, UTC ms. */
  onAir?: { slotStartMs: number; startMs: number; endMs: number } | null;
}

function header(id: string, startMs: number, mode: Mode, detail: string): HeaderItem {
  const time = utcTime(startMs);
  return { kind: 'header', id, time, detail, parity: parity(startMs, mode), text: `${time} UTC · ${detail}` };
}

/** A message we transmitted, shown as an amber row: Sending while on air, then Sent. */
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

/** The slot bar for `s` in the Rx frequency pane: it counts the `n` decodes the pane shows. */
function countedHeader(s: SlotDecodes, n: number): HeaderItem {
  return header(`h${s.startUtcMs}`, s.startUtcMs, s.mode, `${n} ${n === 1 ? 'decode' : 'decodes'}`);
}

/** One bar for a run of slots with no decodes, from the oldest slot's start to the newest's. */
export function quietHeader(oldestMs: number, newestMs: number): HeaderItem {
  const time = utcTime(oldestMs);
  const until = utcTime(newestMs);
  return { kind: 'header', id: `hq${oldestMs}`, time, until, detail: 'no decodes', parity: null, text: `${time} to ${until} UTC · no decodes` };
}

function passes(row: DecodeRowData, filter: Filter, rxHz: number): boolean {
  if (filter === 'all') return true;
  if (filter === 'rx') return Math.abs(row.decode.freq_hz - rxHz) <= RX_WINDOW_HZ;
  if (filter === 'new') return !!row.isNew;
  return row.mark === filter;
}

/** True for a row Hide worked leaves out: a station in the log on this band and mode, in a message not to us. */
function hidden(row: DecodeRowData, toYou: boolean, hideWorked: boolean): boolean {
  return hideWorked && !!row.worked && !toYou;
}

/**
 * List items for `slots` and our own transmissions, newest first. A transmission sorts by its
 * start (slot + 0.5 s) under a bar that says next, sending or sent, a decoded slot by its end. With a filter, slots
 * with no matching decode are left out; with none, every slot shows its bar, and consecutive slots
 * with no decodes share one. Within a slot, messages to `myCall` come first, the rest in the
 * decoder's order. Transmissions show with All and To me; `mode` gives their slot parity.
 */
export function buildList(
  slots: SlotDecodes[],
  myCall: string,
  filter: Filter,
  rxHz: number,
  sent: SentItem[] = [],
  mode: Mode = 'FT8',
  classify?: Classify,
  outgoing: Outgoing = {},
  options: ListOptions = {},
): ListItem[] {
  /** `quiet`: a decoded slot with no decodes and none of our rows, which can join a run. */
  type Group = { at: number; items: ListItem[]; quiet?: { startMs: number; mode: Mode } };
  const groups: Group[] = [];
  const rxPane = !!options.rxPane;
  const showOut = options.own !== 'bar' && (rxPane || filter === 'all' || filter === 'me');
  const keep = (r: { row: DecodeRowData; toYou: boolean }) =>
    rxPane ? r.toYou || Math.abs(r.row.decode.freq_hz - rxHz) <= RX_PANE_HZ : passes(r.row, filter, rxHz) && !hidden(r.row, r.toYou, !!options.hideWorked);
  // A slot holding one of our rows is never empty.
  const ours = new Set<number>();
  if (showOut) {
    for (const t of sent) ours.add(t.slotStartMs);
    if (outgoing.next) ours.add(outgoing.next.slotStartMs);
    if (outgoing.onAir) ours.add(outgoing.onAir.slotStartMs);
  }
  // The newest slot with decodes keeps full contrast; anything older fades. An empty slot after
  // it leaves it as the latest news.
  const newest = slots.reduce((m, s) => (s.decodes.length ? Math.max(m, s.startUtcMs) : m), -Infinity);
  const old = (slotStartMs: number) => slotStartMs < newest;
  const facts = options.facts ?? rowFacts(myCall, classify);
  for (const s of slots) {
    // Ids follow the decoder's order, so a row keeps its id when it moves up.
    const rows = s.decodes.map((d, i) => ({ i, ...facts(d) })).filter(keep);
    if (!rows.length && (filter !== 'all' || rxPane || options.hideWorked)) continue;
    const items: ListItem[] = [rxPane ? countedHeader(s, rows.length) : slotHeader(s)];
    const byFreq = (a: (typeof rows)[number], b: (typeof rows)[number]) => a.row.decode.freq_hz - b.row.decode.freq_hz;
    const kind = (r: (typeof rows)[number]) => KIND_ORDER[parseExchange(r.row.decode.text).kind];
    const toUs = rows.filter((x) => x.toYou);
    const rest = rows.filter((x) => !x.toYou);
    if (options.sorted) {
      toUs.sort(byFreq);
      rest.sort((a, b) => kind(a) - kind(b) || byFreq(a, b));
    }
    for (const r of [...toUs, ...rest]) {
      const item: RowItem = { kind: 'row', id: `${s.startUtcMs}-${r.i}`, row: r.row, slotStartMs: s.startUtcMs, old: old(s.startUtcMs) };
      items.push(r.toYou ? { ...item, toYou: true } : item);
    }
    const quiet = !s.decodes.length && !s.skipped && !ours.has(s.startUtcMs);
    groups.push({ at: s.startUtcMs + SLOT_MS[s.mode], items, quiet: quiet ? { startMs: s.startUtcMs, mode: s.mode } : undefined });
  }
  if (showOut) {
    const air = outgoing.onAir ?? null;
    for (const t of sent) {
      const d = { text: t.text, freq_hz: t.freqHz, dt_s: 0, snr_db: 0 };
      const row: DecodeRowData = { decode: d, ...markDecode(d, myCall, true), time: utcTime(t.slotStartMs), ...colours(classify, d, true) };
      const out: OutInfo = air?.slotStartMs === t.slotStartMs ? { stage: 'sending', startMs: air.startMs, endMs: air.endMs } : { stage: 'sent', startMs: t.slotStartMs + 500 };
      const item: RowItem = { kind: 'row', id: `s${t.slotStartMs}`, row, slotStartMs: t.slotStartMs, out, old: out.stage === 'sent' && old(t.slotStartMs) };
      groups.push({ at: t.slotStartMs + 500, items: [header(`hs${t.slotStartMs}`, t.slotStartMs, mode, out.stage), item] });
    }
    const n = outgoing.next;
    if (n && !sent.some((t) => t.slotStartMs === n.slotStartMs)) {
      const d = { text: n.text, freq_hz: n.freqHz, dt_s: 0, snr_db: 0 };
      const row: DecodeRowData = { decode: d, ...markDecode(d, myCall, true), time: utcTime(n.slotStartMs), hl: null, ink: null };
      const item: RowItem = { kind: 'row', id: `n${n.slotStartMs}`, row, slotStartMs: n.slotStartMs, out: { stage: 'next', startMs: n.startMs } };
      groups.push({ at: n.slotStartMs + 500, items: [header(`hn${n.slotStartMs}`, n.slotStartMs, mode, 'next'), item] });
    }
  }
  if (options.own === 'bar') {
    // A slot we transmitted in has no decodes of its own: a grey bar says why.
    const air = outgoing.onAir?.slotStartMs ?? null;
    for (const t of sent) {
      if (t.slotStartMs === air) continue;
      const time = utcTime(t.slotStartMs);
      groups.push({ at: t.slotStartMs + 500, items: [{ kind: 'header', id: `ht${t.slotStartMs}`, time, detail: 'Tx slot', parity: null, text: `${time} UTC · Tx slot` }] });
    }
  }
  groups.sort((a, b) => b.at - a.at);
  // Consecutive empty slots, next to each other in the list and in time, share one bar. A gap in
  // time (a slot not decoded) or a change of mode ends the run.
  const items: ListItem[] = [];
  for (let i = 0; i < groups.length; ) {
    let j = i;
    for (;;) {
      const a = groups[j].quiet;
      const b = groups[j + 1]?.quiet;
      if (!a || !b || a.mode !== b.mode || a.startMs - b.startMs !== SLOT_MS[a.mode]) break;
      j++;
    }
    if (j === i) items.push(...groups[i].items);
    else items.push(quietHeader(groups[j].quiet!.startMs, groups[i].quiet!.startMs));
    i = j + 1;
  }
  return items;
}

/** Decodes per filter, for the chips; with `hideWorked`, those it leaves out are not counted. */
export function filterCounts(slots: SlotDecodes[], myCall: string, rxHz: number, options: { classify?: Classify; hideWorked?: boolean; facts?: Facts } = {}): Record<Filter, number> {
  const facts = options.facts ?? rowFacts(myCall, options.classify);
  const counts: Record<Filter, number> = { all: 0, cq: 0, new: 0, me: 0, rx: 0 };
  for (const s of slots)
    for (const d of s.decodes) {
      const { row, toYou: you } = facts(d);
      if (hidden(row, you, !!options.hideWorked)) continue;
      for (const f of FILTERS) if (passes(row, f, rxHz)) counts[f]++;
    }
  return counts;
}


