/**
 * The QSO sequencer (docs/design/sequencer.md): a pure state machine. Events go in; the new
 * state and effects come out. Nothing here reads a clock or touches audio: every event carries
 * the time, and the audio layer executes the effects and reports back with txStarted and
 * txEnded.
 *
 * Transmissions use one slot parity: the opposite of the station answered, or the operator's
 * choice for CQ. The sequencer decides on the final decoding pass of each slot of the other
 * parity and plans the next transmission for the slot that follows.
 */

import { SLOT_MS, parity as parityOf, slotStart, type Mode, type Parity } from '../clock/slots';
import { PAUSED, STATUS } from './status';
import type { Decode } from '../decode/types';
import { pathBetween } from './grid';
import { buildMessages, formatReport, isGrid, parseExchange, sameCall, bare, type Exchange, type ExchangeKind, type TxNum } from './messages';
import type { LogQsoRecord } from '../log/types';

export type QueueOrder = 'first' | 'strongest' | 'farthest' | 'new';
/**
 * Order Hunt picks CQs in: not worked on this band and mode, strongest, newest (the CQ that
 * started most recently), farthest, or new call (never worked). Ties go to the strongest.
 */
export type HuntOrder = 'unworked' | 'strongest' | 'newest' | 'farthest' | 'new';
export const HUNT_ORDERS: readonly HuntOrder[] = ['unworked', 'strongest', 'newest', 'farthest', 'new'];
/** Answering: we call them (by hand or from Hunt). CQ: they call us. */
export type Phase = 'idle' | 'answering' | 'cq';

/** How late a transmission may start after slot + 0.5 s, s. */
export const LATE_S: Record<Mode, number> = { FT8: 1.5, FT4: 1.0 };
/** Time the audio layer needs to synthesise and start a transmission after a decision, s. */
export const LEAD_S = 0.2;
/** A caller not heard for this many slots leaves the queue; Hunt forgets a CQ as old. */
const STALE_SLOTS = 4;
/** Hunt does not call a station that ignored it again for this long, ms. */
export const IGNORE_MS = 10 * 60_000;
/** Slots to wait for a lost station to end its QSO before giving up. */
export const TAIL_WATCH_SLOTS = 8;

export interface SeqConfig {
  myCall: string;
  myGrid: string;
  mode: Mode;
  band: string;
  dialHz: number;
  /** Our transmit audio frequency, Hz (held). */
  txHz: number;
  ack: 'RR73' | 'RRR';
  /** Repeats of an unanswered message before giving up. */
  maxRetries: number;
  order: QueueOrder;
  workDupes: boolean;
  /** Run: after a QSO from CQ, answer the next caller or call CQ again. Off: Tx goes off after the QSO. */
  run: boolean;
  /** Call a lost station once more after it ends its QSO with the other station. */
  tailEnd: boolean;
  huntOrder: HuntOrder;
  /** Watchdog limit, ms; 0 turns the watchdog off. */
  watchdogMs: number;
  /** Parity for calling CQ. */
  cqParity: Parity;
  cqModifier: string | null;
  /** Decoder preset, recorded with each QSO. */
  preset: string;
}

export interface Worked {
  call: string;
  band: string;
  mode: Mode;
  /** UTC day, YYYYMMDD. */
  day: string;
  grid: string | null;
}

export interface Caller {
  call: string;
  grid: string | null;
  kind: ExchangeKind;
  report: number | null;
  snrDb: number;
  dtS: number;
  freqHz: number;
  /** Start of the slot it was last heard in, UTC ms. */
  heardMs: number;
  /** Decode order, for First. */
  seq: number;
  dupe: boolean;
  /** Not worked before on any band. */
  isNew: boolean;
  distanceKm: number | null;
}

/** A plain CQ heard, for Hunt. */
export interface HeardCq {
  call: string;
  grid: string | null;
  snrDb: number;
  dtS: number;
  freqHz: number;
  /** Slot of the latest CQ heard, UTC ms. */
  heardMs: number;
  /** First slot of this run of CQs, UTC ms. */
  sinceMs: number;
  /** Decode order. */
  seq: number;
}

/** The station we call answered another station. */
export interface Lost {
  other: string;
  /** Waiting for the end of their QSO, or our one more call is planned or sent. */
  state: 'watching' | 'called';
  /** Slot their message to the other station was heard in, UTC ms. */
  sinceMs: number;
}

export interface Partner {
  call: string;
  grid: string | null;
  freqHz: number;
  snrDb: number;
  dtS: number;
  /** Report we send, dB; fixed once first sent. */
  reportSent: number | null;
  reportRcvd: number | null;
  sentRpt: boolean;
  sentRRpt: boolean;
  sentAck: boolean;
  rcvdRpt: boolean;
  rcvdRRpt: boolean;
  rcvdAck: boolean;
  /** Start of our first transmission to them, UTC ms. */
  startMs: number | null;
  logged: boolean;
}

export interface Planned {
  tx: TxNum;
  text: string;
  /** Slot start, UTC ms. */
  slotStartMs: number;
  /** Start of the transmission after the slot start, s: 0.5, or more for a late start. */
  offsetS: number;
  /** A slot of our parity that came too late for this decision, UTC ms. */
  tooLateFor: number | null;
  scheduled: boolean;
}

export interface Sent {
  tx: TxNum;
  text: string;
  slotStartMs: number;
}

export type NoticeKind = 'watchdog' | 'audio' | 'no-reply' | 'dropped' | 'incomplete' | 'not-ready' | 'cannot-call' | 'lost';

export interface SeqState {
  config: SeqConfig;
  phase: Phase;
  /** Hunt: answers CQs one after another until the operator stops it. */
  hunt: boolean;
  /** QSOs logged since Hunt started. */
  huntQsos: number;
  /** The station answered was called from CQ: the CQ loop carries on after this QSO when Run is on. */
  resumeCq: boolean;
  txEnabled: boolean;
  stopAfter: boolean;
  /** Answering gave up; Tx stays enabled on the last message. */
  paused: boolean;
  /** Why answering gave up, for the status line. */
  pausedWhy: string | null;
  partner: Partner | null;
  lost: Lost | null;
  /** Operator edits to Tx1 to Tx6, kept until the partner changes (Tx6 is kept). */
  edits: Partial<Record<TxNum, string>>;
  current: TxNum | null;
  next: Planned | null;
  onAir: Sent | null;
  lastSent: Sent | null;
  retries: number;
  parity: Parity | null;
  queue: Caller[];
  seq: number;
  /** Plain CQs of the last few slots, for Hunt. */
  cqs: HeardCq[];
  /** Stations that did not answer Hunt, with when they were given up, UTC ms. */
  ignored: { call: string; atMs: number }[];
  watchdogFromMs: number;
  lastTxText: string | null;
  audioOk: boolean;
  worked: Worked[];
  /** QSOs completed with this state, newest last; the app keeps the records. */
  completed: number;
}

export type SeqEvent =
  | { type: 'slotDecoded'; slotStartMs: number; pass: 'early' | 'final'; decodes: Decode[]; nowMs: number }
  | { type: 'callStation'; decode: Decode; slotStartMs: number; nowMs: number }
  | { type: 'callCq'; nowMs: number }
  | { type: 'enableTx'; on: boolean; nowMs: number }
  | { type: 'hunt'; on: boolean; nowMs: number }
  | { type: 'stopAfterQso'; on: boolean; nowMs: number }
  | { type: 'halt'; nowMs: number }
  | { type: 'endQso'; nowMs: number }
  | { type: 'txStarted'; slotStartMs: number; text: string; nowMs: number }
  | { type: 'txEnded'; slotStartMs: number; text: string; complete: boolean; nowMs: number }
  | { type: 'txMissed'; slotStartMs: number; nowMs: number }
  | { type: 'audioStopped'; nowMs: number }
  | { type: 'audioResumed'; nowMs: number }
  | { type: 'touch'; nowMs: number }
  | { type: 'tick'; nowMs: number }
  | { type: 'editMessage'; tx: TxNum; text: string; nowMs: number }
  | { type: 'chooseNext'; tx: TxNum; nowMs: number }
  | { type: 'configure'; patch: Partial<SeqConfig>; nowMs: number }
  | { type: 'setWorked'; worked: Worked[]; nowMs: number };

export type SeqEffect =
  | { type: 'scheduleTx'; tx: TxNum; text: string; slotStartMs: number; startOffsetS: number }
  | { type: 'cancelTx'; stopPlaying: boolean }
  | { type: 'logQso'; record: LogQsoRecord }
  | { type: 'notice'; kind: NoticeKind; text: string }
  | { type: 'queueChanged'; callers: Caller[] };

export interface SeqResult {
  state: SeqState;
  effects: SeqEffect[];
}

/** The queue in answering order: dupes last, then by the chosen order. */
export function orderQueue(queue: Caller[], order: QueueOrder): Caller[] {
  const by: Record<QueueOrder, (a: Caller, b: Caller) => number> = {
    first: (a, b) => a.seq - b.seq,
    strongest: (a, b) => b.snrDb - a.snrDb || a.seq - b.seq,
    farthest: (a, b) => (b.distanceKm ?? -1) - (a.distanceKm ?? -1) || a.seq - b.seq,
    new: (a, b) => Number(b.isNew) - Number(a.isNew) || a.seq - b.seq,
  };
  return [...queue].sort((a, b) => Number(a.dupe) - Number(b.dupe) || by[order](a, b));
}

export function initialState(config: SeqConfig): SeqState {
  return {
    config,
    phase: 'idle',
    hunt: false,
    huntQsos: 0,
    resumeCq: false,
    txEnabled: false,
    stopAfter: false,
    paused: false,
    pausedWhy: null,
    partner: null,
    lost: null,
    edits: {},
    current: null,
    next: null,
    onAir: null,
    lastSent: null,
    retries: 0,
    parity: null,
    queue: [],
    seq: 0,
    cqs: [],
    ignored: [],
    watchdogFromMs: 0,
    lastTxText: null,
    audioOk: true,
    worked: [],
    completed: 0,
  };
}

const opposite = (p: Parity): Parity => (p === 'even' ? 'odd' : 'even');

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

/** Why transmitting is not possible now, or null. */
export function notReady(st: SeqState): string | null {
  const c = st.config;
  if (!c.myCall.trim() || !isGrid(c.myGrid)) return STATUS.setUp;
  if (!st.audioOk) return STATUS.audioOff;
  return null;
}

export function messages(st: SeqState): Record<TxNum, string> {
  const p = st.partner;
  const generated = buildMessages({
    dx: p?.call ?? null,
    me: st.config.myCall,
    grid: st.config.myGrid,
    report: p ? (p.reportSent ?? p.snrDb) : null,
    ack: st.config.ack,
    cqModifier: st.config.cqModifier,
  });
  for (const k of Object.keys(st.edits) as unknown as TxNum[]) {
    const e = st.edits[k];
    if (e) generated[k] = e;
  }
  return generated;
}

/** The slot of our parity for a transmission decided at `nowMs`, with the start offset. */
export function ourSlot(st: SeqState, nowMs: number): { slotStartMs: number; offsetS: number; tooLateFor: number | null } {
  const mode = st.config.mode;
  const len = SLOT_MS[mode];
  const cur = slotStart(nowMs, mode);
  const p = st.parity ?? st.config.cqParity;
  if (parityOf(cur, mode) !== p) return { slotStartMs: cur + len, offsetS: 0.5, tooLateFor: null };
  const offset = Math.max(0.5, (nowMs - cur) / 1000 + LEAD_S);
  if (offset <= 0.5 + LATE_S[mode] + 1e-9) return { slotStartMs: cur, offsetS: Math.round(offset * 1000) / 1000, tooLateFor: null };
  return { slotStartMs: cur + 2 * len, offsetS: 0.5, tooLateFor: cur };
}

/** Worked on this band and mode, on any day. */
function workedHere(worked: Worked[], call: string, c: SeqConfig): boolean {
  return worked.some((w) => sameCall(w.call, call) && w.band === c.band && w.mode === c.mode);
}

/** Worked today on this band and mode: a dupe. */
function dupeOf(worked: Worked[], call: string, c: SeqConfig, nowMs: number): boolean {
  const day = dayOf(nowMs);
  return worked.some((w) => sameCall(w.call, call) && w.band === c.band && w.mode === c.mode && w.day === day);
}

/** Plain CQs in Hunt's order. */
export function orderHunt(cqs: HeardCq[], order: HuntOrder, worked: Worked[], config: SeqConfig): HeardCq[] {
  const strongest = (a: HeardCq, b: HeardCq) => b.snrDb - a.snrDb || a.seq - b.seq;
  const km = (q: HeardCq) => (q.grid ? (pathBetween(config.myGrid, q.grid)?.km ?? -1) : -1);
  const fresh = (q: HeardCq) => Number(!workedHere(worked, q.call, config));
  const newCall = (q: HeardCq) => Number(!worked.some((w) => sameCall(w.call, q.call)));
  const by: Record<HuntOrder, (a: HeardCq, b: HeardCq) => number> = {
    unworked: (a, b) => fresh(b) - fresh(a) || strongest(a, b),
    strongest,
    newest: (a, b) => b.sinceMs - a.sinceMs || strongest(a, b),
    farthest: (a, b) => km(b) - km(a) || strongest(a, b),
    new: (a, b) => newCall(b) - newCall(a) || strongest(a, b),
  };
  return [...cqs].sort(by[order]);
}

/**
 * The CQs Hunt may answer after the slot starting at `slotStartMs`: plain CQs heard in it, less
 * dupes and stations that ignored Hunt in the last 10 min, in Hunt's order.
 */
export function huntCandidates(st: SeqState, slotStartMs: number, nowMs: number): HeardCq[] {
  const c = st.config;
  const ignored = st.ignored.filter((i) => nowMs - i.atMs < IGNORE_MS);
  const open = st.cqs.filter((q) => q.heardMs === slotStartMs && !dupeOf(st.worked, q.call, c, nowMs) && !ignored.some((i) => sameCall(i.call, q.call)));
  return orderHunt(open, c.huntOrder, st.worked, c);
}

const ENDS: ExchangeKind[] = ['rr73', 'rrr', '73'];
const TO_OTHER: ExchangeKind[] = ['report', 'rreport', ...ENDS];


class Machine {
  st: SeqState;
  fx: SeqEffect[] = [];

  constructor(st: SeqState) {
    this.st = st;
  }

  get cfg() {
    return this.st.config;
  }

  get len() {
    return SLOT_MS[this.cfg.mode];
  }

  notice(kind: NoticeKind, text: string) {
    this.fx.push({ type: 'notice', kind, text });
  }

  canTransmit(): boolean {
    return this.st.txEnabled && !this.st.paused && notReady(this.st) === null;
  }

  /** Plans `tx` for the next slot of our parity and schedules it when transmitting is possible. */
  plan(tx: TxNum, nowMs: number) {
    const st = this.st;
    if (st.next?.scheduled) this.fx.push({ type: 'cancelTx', stopPlaying: false });
    st.current = tx;
    const text = messages(st)[tx];
    if (!text) {
      st.next = null;
      return;
    }
    st.next = { tx, text, ...ourSlot(st, nowMs), scheduled: false };
    this.flush();
  }

  /** Withdraws the planned transmission. */
  unplan() {
    const st = this.st;
    if (st.next?.scheduled) this.fx.push({ type: 'cancelTx', stopPlaying: false });
    st.next = null;
  }

  /** Schedules the planned transmission if it can go out, or withdraws it if it no longer can. */
  flush() {
    const n = this.st.next;
    if (!n) return;
    if (!n.scheduled && this.canTransmit()) {
      this.fx.push({ type: 'scheduleTx', tx: n.tx, text: n.text, slotStartMs: n.slotStartMs, startOffsetS: n.offsetS });
      n.scheduled = true;
    } else if (n.scheduled && !this.canTransmit()) {
      this.fx.push({ type: 'cancelTx', stopPlaying: false });
      n.scheduled = false;
    }
  }

  /** Stops everything at once: Halt, End QSO, audio stops, a mode change, the watchdog. */
  stopAll() {
    const st = this.st;
    st.txEnabled = false;
    st.hunt = false;
    st.stopAfter = false;
    st.paused = false;
    st.pausedWhy = null;
    if (st.next) st.next.scheduled = false;
    this.fx.push({ type: 'cancelTx', stopPlaying: true });
  }

  clearQueue() {
    if (!this.st.queue.length) return;
    this.st.queue = [];
    this.fx.push({ type: 'queueChanged', callers: [] });
  }

  /** Back to idle: no partner, no plan, an empty queue. Operator edits other than Tx6 go. */
  reset() {
    const st = this.st;
    this.clearPartner();
    st.phase = 'idle';
    st.resumeCq = false;
    st.current = null;
    st.next = null;
    this.clearQueue();
  }

  resetWatchdog(nowMs: number) {
    this.st.watchdogFromMs = nowMs;
  }

  /** No partner: operator edits other than Tx6 go, and nothing is paused or lost. */
  clearPartner() {
    const st = this.st;
    st.partner = null;
    st.retries = 0;
    st.lost = null;
    st.paused = false;
    st.pausedWhy = null;
    const tx6 = st.edits[6];
    st.edits = tx6 ? { 6: tx6 } : {};
  }

  newPartner(call: string, d: { grid: string | null; freqHz: number; snrDb: number; dtS: number }) {
    this.clearPartner();
    this.st.partner = {
      call,
      grid: d.grid,
      freqHz: d.freqHz,
      snrDb: d.snrDb,
      dtS: d.dtS,
      reportSent: null,
      reportRcvd: null,
      sentRpt: false,
      sentRRpt: false,
      sentAck: false,
      rcvdRpt: false,
      rcvdRRpt: false,
      rcvdAck: false,
      startMs: null,
      logged: false,
    };
  }

  /**
   * The QSO with the partner is over, logged (`done`) or not. Hunt picks the next station at its
   * next decision. The CQ loop carries on with the next caller or CQ when Run is on, and after a
   * caller who did not finish; a station called from CQ returns to it only when logged with Run
   * on. Otherwise Tx goes off, as WSJT-X does with "Disable Tx after sending 73".
   */
  afterQso(nowMs: number, done: boolean) {
    const st = this.st;
    const fromCq = st.phase === 'cq';
    const loop = fromCq || (st.resumeCq && done);
    this.clearPartner();
    st.resumeCq = false;
    if (st.hunt && !st.stopAfter) {
      st.phase = 'idle';
      st.current = null;
      this.unplan();
      return;
    }
    if (!st.hunt && loop && !st.stopAfter && (this.cfg.run || (fromCq && !done))) {
      st.phase = 'cq';
      this.nextCaller(nowMs);
      return;
    }
    st.phase = 'idle';
    st.txEnabled = false;
    st.hunt = false;
    st.stopAfter = false;
    st.current = null;
    this.unplan();
  }

  complete(nowMs: number) {
    const st = this.st;
    const p = st.partner;
    if (!p || p.logged) return;
    p.logged = true;
    const c = this.cfg;
    // The log attaches the running activation and builds the ADIF fields (MFSK for FT4).
    const record: LogQsoRecord = {
      call: bare(p.call),
      grid: p.grid,
      mode: c.mode,
      band: c.band,
      dialHz: c.dialHz,
      audioHz: c.txHz,
      startUtcMs: p.startMs ?? nowMs,
      endUtcMs: nowMs,
      reportSent: formatReport(p.reportSent ?? p.snrDb),
      reportRcvd: p.reportRcvd === null ? '' : formatReport(p.reportRcvd),
      source: 'sequencer',
      decode: { preset: c.preset, snrDb: p.snrDb, dtS: p.dtS, audioHz: p.freqHz },
      stationCallsign: c.myCall,
      myGridsquare: c.myGrid,
    };
    st.worked.push({ call: record.call, band: c.band, mode: c.mode, day: dayOf(nowMs), grid: p.grid });
    st.completed++;
    if (st.hunt) st.huntQsos++;
    this.fx.push({ type: 'logQso', record });
    this.markQueue(nowMs);
  }

  /** The message that answers the partner's last message, or null when there is none. */
  reply(ex: Exchange, nowMs: number): TxNum | 'complete' | 'incomplete' | 'done' | null {
    const p = this.st.partner!;
    switch (ex.kind) {
      case 'grid':
        if (ex.grid) p.grid = ex.grid;
        return 2;
      case 'call':
        return 2;
      case 'report':
        p.reportRcvd = ex.report;
        p.rcvdRpt = true;
        return 3;
      case 'rreport':
        p.reportRcvd = ex.report;
        p.rcvdRpt = true;
        p.rcvdRRpt = true;
        return 4;
      case 'rr73':
      case 'rrr':
        p.rcvdAck = true;
        if (p.logged) return 'done';
        if (p.sentRRpt) return 'complete';
        return 'incomplete';
      case '73':
        p.rcvdAck = true;
        if (p.logged) return 'done';
        if (p.sentRRpt) {
          this.complete(nowMs);
          return 'done';
        }
        return 'incomplete';
      default:
        return null;
    }
  }

  /** Fixes the report we send the first time a report goes into a message. */
  fixReport(tx: TxNum) {
    const p = this.st.partner;
    if (p && (tx === 2 || tx === 3) && p.reportSent === null) p.reportSent = Math.max(-50, Math.min(49, Math.round(p.snrDb)));
  }

  goTo(tx: TxNum, nowMs: number) {
    const st = this.st;
    const same = st.lastSent?.tx === tx && st.current === tx;
    st.retries = same ? st.retries + 1 : 0;
    if (same && st.retries > this.cfg.maxRetries) {
      this.giveUp(nowMs);
      return;
    }
    this.fixReport(tx);
    this.plan(tx, nowMs);
  }

  /** Answering stops calling and keeps Tx enabled on the last message, as WSJT-X does. */
  pause(why: string) {
    const st = this.st;
    st.paused = true;
    st.pausedWhy = why;
    if (st.next?.scheduled) this.fx.push({ type: 'cancelTx', stopPlaying: false });
    if (st.next) st.next.scheduled = false;
  }

  /** Hunt leaves a station that did not answer alone for 10 min. */
  ignore(call: string, nowMs: number) {
    const st = this.st;
    st.ignored = [...st.ignored.filter((i) => !sameCall(i.call, call) && nowMs - i.atMs < IGNORE_MS), { call: bare(call), atMs: nowMs }];
  }

  giveUp(nowMs: number) {
    const st = this.st;
    const call = bare(st.partner?.call ?? '');
    if (st.phase === 'answering') {
      if (st.hunt) {
        this.ignore(call, nowMs);
        this.notice('no-reply', STATUS.noReply(call));
        this.afterQso(nowMs, false);
        return;
      }
      this.pause(PAUSED.noReply);
      this.notice('no-reply', STATUS.noReply(call));
      return;
    }
    this.notice('dropped', STATUS.noReplyNotLogged(call));
    this.afterQso(nowMs, false);
  }

  /** CQ and Run: answers the next caller in the queue, or calls CQ again. */
  nextCaller(nowMs: number) {
    const st = this.st;
    const pick = this.ordered().find((c) => this.cfg.workDupes || !c.dupe);
    if (!pick) {
      this.clearPartner();
      st.parity = this.cfg.cqParity;
      this.plan(6, nowMs);
      return;
    }
    st.queue = st.queue.filter((c) => c !== pick);
    this.fx.push({ type: 'queueChanged', callers: this.ordered() });
    this.newPartner(pick.call, pick);
    st.parity = opposite(parityOf(pick.heardMs, this.cfg.mode));
    const tx = this.reply({ to: this.cfg.myCall, from: pick.call, kind: pick.kind, grid: pick.grid, report: pick.report, modifier: null }, nowMs);
    const t: TxNum = typeof tx === 'number' ? tx : 2;
    this.fixReport(t);
    st.retries = 0;
    this.plan(t, nowMs);
  }

  ordered(): Caller[] {
    return orderQueue(this.st.queue, this.cfg.order);
  }

  isDupe(call: string, nowMs: number): boolean {
    return dupeOf(this.st.worked, call, this.cfg, nowMs);
  }

  markQueue(nowMs: number) {
    for (const c of this.st.queue) {
      c.dupe = this.isDupe(c.call, nowMs);
      c.isNew = !this.st.worked.some((w) => sameCall(w.call, c.call));
    }
  }

  /** Adds stations calling us to the queue (CQ and Run). Returns true when the queue changed. */
  addCallers(slotStartMs: number, decodes: Decode[], nowMs: number): boolean {
    const st = this.st;
    const me = this.cfg.myCall;
    let changed = false;
    if (!this.cfg.run) {
      // Without Run, only the stations calling in the latest slot are candidates.
      if (st.queue.length) changed = true;
      st.queue = [];
    } else {
      const before = st.queue.length;
      st.queue = st.queue.filter((c) => slotStartMs - c.heardMs <= STALE_SLOTS * this.len);
      changed ||= st.queue.length !== before;
    }
    for (const d of decodes) {
      const ex = parseExchange(d.text);
      if (!sameCall(ex.to, me) || !ex.from || sameCall(ex.from, me)) continue;
      if (!['grid', 'call', 'report', 'rreport'].includes(ex.kind)) continue;
      if (st.partner && sameCall(st.partner.call, ex.from)) continue;
      const found = st.queue.find((c) => sameCall(c.call, ex.from));
      const grid = ex.grid ?? found?.grid ?? null;
      const entry: Caller = {
        call: ex.from,
        grid,
        kind: ex.kind,
        report: ex.report,
        snrDb: d.snr_db,
        dtS: d.dt_s,
        freqHz: d.freq_hz,
        heardMs: slotStartMs,
        seq: found?.seq ?? st.seq++,
        dupe: this.isDupe(ex.from, nowMs),
        isNew: !st.worked.some((w) => sameCall(w.call, ex.from)),
        distanceKm: grid ? (pathBetween(this.cfg.myGrid, grid)?.km ?? null) : null,
      };
      if (found) Object.assign(found, entry);
      else st.queue.push(entry);
      changed = true;
    }
    if (changed) this.fx.push({ type: 'queueChanged', callers: this.ordered() });
    return changed;
  }

  /**
   * Keeps the plain CQs of the last few slots for Hunt. A station heard sending anything else is
   * in a QSO and leaves the list. Directed CQs (CQ DX, CQ NA, CQ POTA) are left out until RR73
   * has the reference data to judge them.
   */
  noteCqs(slotStartMs: number, decodes: Decode[], nowMs: number) {
    const st = this.st;
    const me = this.cfg.myCall;
    const busy: string[] = [];
    const cqs = st.cqs.filter((q) => slotStartMs - q.heardMs <= STALE_SLOTS * this.len);
    for (const d of decodes) {
      const ex = parseExchange(d.text);
      if (!ex.from || sameCall(ex.from, me)) continue;
      if (ex.kind !== 'cq') {
        busy.push(ex.from);
        continue;
      }
      if (ex.modifier) continue;
      const found = cqs.find((q) => sameCall(q.call, ex.from));
      const entry: HeardCq = {
        call: ex.from,
        grid: ex.grid ?? found?.grid ?? null,
        snrDb: d.snr_db,
        dtS: d.dt_s,
        freqHz: d.freq_hz,
        heardMs: slotStartMs,
        sinceMs: found && slotStartMs - found.heardMs <= 2 * this.len ? found.sinceMs : slotStartMs,
        seq: found?.heardMs === slotStartMs ? found.seq : st.seq++,
      };
      if (found) Object.assign(found, entry);
      else cqs.push(entry);
    }
    st.cqs = cqs.filter((q) => !busy.some((b) => sameCall(b, q.call)));
    if (st.ignored.length) st.ignored = st.ignored.filter((i) => nowMs - i.atMs < IGNORE_MS);
  }

  /** Hunt with nobody in a QSO: calls the first CQ heard in the slot just decoded. */
  huntPick(slotStartMs: number, nowMs: number) {
    const st = this.st;
    if (!st.hunt || !st.txEnabled || st.partner) return;
    const pick = huntCandidates(st, slotStartMs, nowMs)[0];
    if (!pick) return;
    this.newPartner(pick.call, pick);
    st.phase = 'answering';
    st.parity = opposite(parityOf(pick.heardMs, this.cfg.mode));
    st.lastSent = null;
    this.plan(1, nowMs);
  }

  /**
   * The station we call, before it has answered us, sends a report, an R-report, RR73 or 73 to
   * another station: calling stops. Hunt moves on to the next CQ at once. Called by hand with
   * tail-ending on, one more call goes out in the next slot of our parity once they send RR73 or
   * 73 to that station (or call CQ). Returns true when this decides the slot.
   */
  lostStation(e: Extract<SeqEvent, { type: 'slotDecoded' }>, sentLastSlot: boolean): boolean {
    const st = this.st;
    const p = st.partner!;
    if (p.rcvdRpt || p.rcvdAck || p.logged) return false;
    const me = this.cfg.myCall;
    const theirs = e.decodes.map((d) => parseExchange(d.text)).filter((x) => sameCall(x.from, p.call));
    const toOther = theirs.filter((x) => x.to && !sameCall(x.to, me) && TO_OTHER.includes(x.kind)).at(-1);
    const call = bare(p.call);
    const lost = st.lost;
    if (!lost) {
      if (!toOther) return false;
      const other = bare(toOther.to!);
      st.lost = { other, state: 'watching', sinceMs: e.slotStartMs };
      this.unplan();
      // Hunt never waits for a lost station: another CQ is worth more than a tail-end call.
      if (!this.cfg.tailEnd || st.hunt) {
        this.notice('lost', STATUS.answered(call, other));
        this.drop(PAUSED.answered(other), e.nowMs, false);
        return true;
      }
      this.notice('lost', STATUS.answered(call, other));
      if (ENDS.includes(toOther.kind)) this.tailCall(e);
      return true;
    }
    if (lost.state === 'watching') {
      const ended = theirs.some((x) => x.kind === 'cq' || (ENDS.includes(x.kind) && x.to && !sameCall(x.to, me)));
      if (ended) {
        this.tailCall(e);
        return true;
      }
      if (e.slotStartMs - lost.sinceMs > TAIL_WATCH_SLOTS * this.len) {
        this.notice('lost', STATUS.stillWorking(call, lost.other));
        this.drop(PAUSED.working(lost.other), e.nowMs, false);
      }
      return true;
    }
    // One more call went out: an answer goes on as usual, anything else ends it.
    if (sentLastSlot || toOther) {
      this.notice('no-reply', STATUS.noReply(call));
      this.drop(PAUSED.noReply, e.nowMs, true);
      return true;
    }
    return false;
  }

  /** Calls the lost station once more, in the next slot of our parity. */
  tailCall(e: Extract<SeqEvent, { type: 'slotDecoded' }>) {
    const st = this.st;
    st.lost = { ...st.lost!, state: 'called' };
    st.parity = opposite(parityOf(e.slotStartMs, this.cfg.mode));
    st.retries = 0;
    st.lastSent = null;
    this.plan(st.current ?? 1, e.nowMs);
  }

  /** Answering gives up on a station: Hunt moves on, by hand the call pauses on its last message. */
  drop(why: string, nowMs: number, ignored: boolean) {
    const st = this.st;
    if (st.hunt) {
      if (ignored && st.partner) this.ignore(st.partner.call, nowMs);
      this.afterQso(nowMs, false);
      return;
    }
    st.lost = null;
    this.pause(why);
  }

  slotDecoded(e: Extract<SeqEvent, { type: 'slotDecoded' }>) {
    const st = this.st;
    // Keep the partner's latest signal for the report and the log.
    if (st.partner) {
      const heard = e.decodes.filter((d) => sameCall(parseExchange(d.text).from, st.partner!.call));
      const last = heard[heard.length - 1];
      if (last) Object.assign(st.partner, { snrDb: last.snr_db, dtS: last.dt_s, freqHz: last.freq_hz });
    }
    if (st.phase === 'cq' && e.pass === 'early') {
      if (this.cfg.run) this.addCallers(e.slotStartMs, e.decodes, e.nowMs);
      return;
    }
    if (e.pass !== 'final') return;
    this.noteCqs(e.slotStartMs, e.decodes, e.nowMs);
    this.decide(e);
    if (st.hunt && st.phase === 'idle') this.huntPick(e.slotStartMs, e.nowMs);
  }

  decide(e: Extract<SeqEvent, { type: 'slotDecoded' }>) {
    const st = this.st;
    const me = this.cfg.myCall;
    if (st.phase === 'idle') return;
    // Replies come in the other parity; the slot we transmitted in tells us nothing.
    if (st.parity && parityOf(e.slotStartMs, this.cfg.mode) === st.parity) return;
    const sentLastSlot = st.lastSent?.slotStartMs === e.slotStartMs - this.len;

    if (st.phase === 'cq') this.addCallers(e.slotStartMs, e.decodes, e.nowMs);

    if (st.partner) {
      const p = st.partner;
      const replies = e.decodes.map((d) => parseExchange(d.text)).filter((x) => sameCall(x.to, me) && sameCall(x.from, p.call));
      const ex = replies[replies.length - 1];
      if (p.logged) {
        // Calling side after RR73: the QSO is in the log. Without Run, a station that missed our
        // RR73 and repeats its R-report gets it again; otherwise the QSO is over.
        if (!this.cfg.run && ex?.kind === 'rreport') {
          this.goTo(4, e.nowMs);
          return;
        }
        this.afterQso(e.nowMs, true);
        return;
      }
      if (ex) st.lost = null;
      else if (st.phase === 'answering' && !st.paused && this.lostStation(e, sentLastSlot)) return;
      const r = ex ? this.reply(ex, e.nowMs) : null;
      if (r === 'complete') {
        this.complete(e.nowMs);
        this.goTo(5, e.nowMs);
        return;
      }
      if (r === 'incomplete') {
        this.notice('incomplete', STATUS.endedEarly(bare(p.call)));
        this.afterQso(e.nowMs, false);
        return;
      }
      if (r === 'done') {
        this.afterQso(e.nowMs, true);
        return;
      }
      if (typeof r === 'number') {
        this.goTo(r, e.nowMs);
        return;
      }
      if (sentLastSlot && st.current) {
        if (st.paused) return;
        this.goTo(st.current, e.nowMs);
        return;
      }
      if (st.next && !st.next.scheduled && st.current) this.plan(st.current, e.nowMs);
      return;
    }

    // Calling CQ with nobody in the QSO.
    if (st.phase === 'cq') {
      const callers = this.ordered().filter((c) => this.cfg.workDupes || !c.dupe);
      if (callers.length) {
        this.nextCaller(e.nowMs);
        return;
      }
      if (sentLastSlot || !st.next) this.plan(6, e.nowMs);
    }
  }

  callStation(e: Extract<SeqEvent, { type: 'callStation' }>) {
    const st = this.st;
    const me = this.cfg.myCall;
    const ex = parseExchange(e.decode.text);
    let dx: string | null;
    if (ex.kind === 'cq') dx = ex.from;
    else if (sameCall(ex.to, me)) dx = ex.from;
    else if (sameCall(ex.from, me)) dx = ex.to;
    else dx = ex.from ?? ex.to;
    if (!dx || sameCall(dx, me)) {
      this.notice('cannot-call', STATUS.noCall);
      return;
    }
    this.resetWatchdog(e.nowMs);
    if (!st.partner || !sameCall(st.partner.call, dx)) {
      this.newPartner(dx, { grid: ex.grid, freqHz: e.decode.freq_hz, snrDb: e.decode.snr_db, dtS: e.decode.dt_s });
    } else {
      Object.assign(st.partner, { freqHz: e.decode.freq_hz, snrDb: e.decode.snr_db, dtS: e.decode.dt_s });
      st.paused = false;
      st.pausedWhy = null;
      st.lost = null;
      st.retries = 0;
    }
    // A station called by hand follows the answering path: CQ stops until this QSO is done.
    const fromCq = st.phase === 'cq' && !st.hunt;
    st.resumeCq = fromCq || (st.phase === 'answering' && st.resumeCq);
    if (fromCq) this.clearQueue();
    st.queue = st.queue.filter((c) => !sameCall(c.call, dx));
    st.parity = opposite(parityOf(e.slotStartMs, this.cfg.mode));
    st.phase = 'answering';
    st.txEnabled = true;
    st.lastSent = null;
    const addressed = sameCall(ex.to, me) ? this.reply(ex, e.nowMs) : null;
    if (addressed === 'complete') {
      this.complete(e.nowMs);
      this.goTo(5, e.nowMs);
      return;
    }
    const tx: TxNum = typeof addressed === 'number' ? addressed : 1;
    this.fixReport(tx);
    this.plan(tx, e.nowMs);
    const why = notReady(st);
    if (why) this.notice('not-ready', why);
  }

  callCq(nowMs: number) {
    const st = this.st;
    this.resetWatchdog(nowMs);
    this.clearPartner();
    st.phase = 'cq';
    st.hunt = false;
    st.resumeCq = false;
    st.lastSent = null;
    st.parity = this.cfg.cqParity;
    st.txEnabled = true;
    this.plan(6, nowMs);
    const why = notReady(st);
    if (why) this.notice('not-ready', why);
  }

  /**
   * Hunt on: CQ stops. A QSO under way carries on and Hunt picks after it; a CQ with nobody in a
   * QSO, or a call that gave up, ends at once. Picks at once when a CQ from the slot just ended
   * can still be answered in the slot under way. Hunt off: a QSO under way finishes, then Tx goes
   * off.
   */
  hunt(on: boolean, nowMs: number) {
    const st = this.st;
    this.resetWatchdog(nowMs);
    st.stopAfter = false;
    if (!on) {
      st.hunt = false;
      if (!st.partner || st.paused) {
        this.clearPartner();
        st.phase = 'idle';
        st.txEnabled = false;
        st.current = null;
        this.unplan();
      }
      return;
    }
    st.hunt = true;
    st.huntQsos = 0;
    st.resumeCq = false;
    if (!st.partner || st.paused || st.lost?.state === 'watching') {
      this.clearPartner();
      st.phase = 'idle';
      st.current = null;
      this.unplan();
      this.clearQueue();
    }
    st.txEnabled = true;
    const why = notReady(st);
    if (why) this.notice('not-ready', why);
    const cur = slotStart(nowMs, this.cfg.mode);
    if (!st.partner && (nowMs - cur) / 1000 + LEAD_S <= 0.5 + LATE_S[this.cfg.mode]) this.huntPick(cur - this.len, nowMs);
    this.flush();
  }

  txStarted(e: Extract<SeqEvent, { type: 'txStarted' }>) {
    const st = this.st;
    const n = st.next;
    // A transmission other than the planned one (replaced after it reached the audio graph)
    // is on air: note it, and keep the plan, which the audio layer reports as missed.
    if (!n || n.slotStartMs !== e.slotStartMs || n.text !== e.text) {
      const tx = (Object.entries(messages(st)).find(([, t]) => t === e.text)?.[0] ?? '6') as unknown as TxNum;
      st.onAir = { tx: Number(tx) as TxNum, text: e.text, slotStartMs: e.slotStartMs };
      if (e.text !== st.lastTxText) this.resetWatchdog(e.nowMs);
      st.lastTxText = e.text;
      return;
    }
    st.onAir = { tx: n.tx, text: n.text, slotStartMs: n.slotStartMs };
    if (n.text !== st.lastTxText) this.resetWatchdog(e.nowMs);
    st.lastTxText = n.text;
    if (st.partner && st.partner.startMs === null && n.tx !== 6) st.partner.startMs = e.slotStartMs + n.offsetS * 1000;
    st.next = null;
  }

  txEnded(e: Extract<SeqEvent, { type: 'txEnded' }>) {
    const st = this.st;
    const sent = st.onAir;
    if (!sent || sent.slotStartMs !== e.slotStartMs || sent.text !== e.text) return;
    st.onAir = null;
    if (!e.complete) return;
    st.lastSent = sent;
    const p = st.partner;
    if (!p) return;
    if (sent.tx === 2) p.sentRpt = true;
    if (sent.tx === 3) {
      p.sentRpt = true;
      p.sentRRpt = true;
    }
    if (sent.tx === 4) {
      p.sentAck = true;
      if (p.rcvdRRpt) {
        this.complete(e.nowMs);
        // Calling CQ, the next decode decides: a repeated R-report, the next caller or the end.
        if (st.phase === 'answering' || st.stopAfter) this.afterQso(e.nowMs, true);
      }
    }
    if (sent.tx === 5) this.afterQso(e.nowMs, true);
  }

  tick(nowMs: number) {
    const st = this.st;
    const limit = this.cfg.watchdogMs;
    if (st.txEnabled && limit > 0 && nowMs - st.watchdogFromMs >= limit) {
      const min = Math.round((limit / 60000) * 10) / 10;
      this.stopAll();
      this.notice('watchdog', STATUS.watchdog(min));
      return;
    }
    const n = st.next;
    if (n && !n.scheduled && st.current && nowMs > n.slotStartMs + (0.5 + LATE_S[this.cfg.mode]) * 1000) this.plan(st.current, nowMs);
  }
}

/** Applies one event. The input state is not changed. */
export function reduce(state: SeqState, e: SeqEvent): SeqResult {
  const st: SeqState = structuredClone(state);
  const m = new Machine(st);
  switch (e.type) {
    case 'slotDecoded':
      m.slotDecoded(e);
      break;
    case 'callStation':
      m.callStation(e);
      break;
    case 'callCq':
      m.callCq(e.nowMs);
      break;
    case 'hunt':
      m.hunt(e.on, e.nowMs);
      break;
    case 'enableTx':
      st.txEnabled = e.on;
      if (e.on) {
        m.resetWatchdog(e.nowMs);
        st.paused = false;
        st.pausedWhy = null;
        // Never while a lost station is still in its QSO.
        const watching = st.lost?.state === 'watching';
        if (st.current && !watching && (!st.next || st.next.slotStartMs + (0.5 + LATE_S[st.config.mode]) * 1000 < e.nowMs)) m.plan(st.current, e.nowMs);
        const why = notReady(st);
        if (why) m.notice('not-ready', why);
      } else if (st.next) st.next.scheduled = false;
      if (!e.on) m.fx.push({ type: 'cancelTx', stopPlaying: false });
      m.flush();
      break;
    case 'stopAfterQso':
      st.stopAfter = e.on;
      m.resetWatchdog(e.nowMs);
      break;
    case 'halt':
      m.stopAll();
      // Calling CQ with nobody in a QSO has no state worth keeping: back to idle.
      if (st.phase === 'cq' && !st.partner) {
        st.phase = 'idle';
        st.current = null;
        st.next = null;
        st.queue = [];
      }
      break;
    case 'endQso':
      // The operator ends the QSO: Tx, Run and Hunt stop and the sequencer goes back to idle.
      // Nothing is logged; a QSO already logged stays in the log.
      m.stopAll();
      m.reset();
      break;
    case 'txStarted':
      m.txStarted(e);
      break;
    case 'txEnded':
      m.txEnded(e);
      break;
    case 'txMissed':
      if (st.next?.slotStartMs === e.slotStartMs && st.current) {
        st.next.scheduled = false;
        // Not the same slot again: it went by, or another transmission holds the output.
        const len = SLOT_MS[st.config.mode];
        m.plan(st.current, Math.max(e.nowMs, e.slotStartMs + len + 1));
      }
      break;
    case 'audioStopped':
      if (st.txEnabled || st.hunt) m.notice('audio', STATUS.audioStopped);
      m.stopAll();
      st.audioOk = false;
      break;
    case 'audioResumed':
      st.audioOk = true;
      break;
    case 'touch':
      m.resetWatchdog(e.nowMs);
      break;
    case 'tick':
      m.tick(e.nowMs);
      break;
    case 'editMessage': {
      const text = e.text.trim().toUpperCase().replace(/\s+/g, ' ');
      if (text) st.edits[e.tx] = text;
      else delete st.edits[e.tx];
      m.resetWatchdog(e.nowMs);
      if (st.next && st.next.tx === e.tx && !st.onAir) m.plan(e.tx, e.nowMs);
      break;
    }
    case 'chooseNext':
      m.resetWatchdog(e.nowMs);
      if (e.tx === 6 && st.phase !== 'cq') {
        m.callCq(e.nowMs);
        break;
      }
      st.lost = null;
      m.fixReport(e.tx);
      st.retries = 0;
      m.plan(e.tx, e.nowMs);
      break;
    case 'configure': {
      const was = { ...st.config };
      Object.assign(st.config, e.patch);
      const changed = (k: keyof SeqConfig) => e.patch[k] !== undefined && e.patch[k] !== was[k];
      // Choosing a band applies it and Tx keeps its state. A new mode changes the slot length,
      // so a QSO in progress cannot carry on: everything stops.
      if (changed('mode')) {
        m.stopAll();
        m.reset();
        break;
      }
      // Run off: the queue goes; the QSO in progress carries on.
      if (changed('run') && !st.config.run) m.clearQueue();
      if (changed('order') || changed('workDupes')) m.fx.push({ type: 'queueChanged', callers: m.ordered() });
      // Only a change to the message text plans the transmission again; Settings sends every
      // value whenever one changes, and a new plan would replace a transmission about to start.
      if (st.next && !st.onAir && st.current && (changed('myCall') || changed('myGrid') || changed('ack') || changed('cqModifier'))) m.plan(st.current, e.nowMs);
      m.flush();
      break;
    }
    case 'setWorked':
      st.worked = e.worked;
      m.markQueue(e.nowMs);
      break;
  }
  return { state: st, effects: m.fx };
}
