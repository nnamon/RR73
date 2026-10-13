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
import type { Decode } from '../decode/types';
import { pathBetween } from './grid';
import { buildMessages, formatReport, isGrid, parseExchange, sameCall, bare, type Exchange, type ExchangeKind, type TxNum } from './messages';
import { buildRecord, type QsoRecord } from './record';

export type QueueOrder = 'first' | 'strongest' | 'farthest' | 'new';
export type Phase = 'idle' | 'answering' | 'cq';

/** How late a transmission may start after slot + 0.5 s, s. */
export const LATE_S: Record<Mode, number> = { FT8: 1.5, FT4: 1.0 };
/** Time the audio layer needs to synthesise and start a transmission after a decision, s. */
export const LEAD_S = 0.2;
/** A caller not heard for this many slots leaves the queue. */
const STALE_SLOTS = 4;

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
  /** Watchdog limit, ms. */
  watchdogMs: number;
  /** Parity for calling CQ. */
  cqParity: Parity;
  cqModifier: string | null;
  /** Decoder preset, recorded with each QSO. */
  preset: string;
  activationId: string | null;
  /** Makes QSO record ids (crypto.randomUUID in the app). */
  newId: () => string;
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

export type NoticeKind = 'watchdog' | 'audio' | 'band' | 'no-reply' | 'dropped' | 'incomplete' | 'not-ready' | 'cannot-call';

export interface SeqState {
  config: SeqConfig;
  phase: Phase;
  run: boolean;
  txEnabled: boolean;
  stopAfter: boolean;
  /** Answering gave up after the retries; Tx stays enabled on the last message. */
  paused: boolean;
  partner: Partner | null;
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
  watchdogFromMs: number;
  lastTxText: string | null;
  bandConfirmed: boolean;
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
  | { type: 'runMode'; on: boolean; nowMs: number }
  | { type: 'stopAfterQso'; on: boolean; nowMs: number }
  | { type: 'halt'; nowMs: number }
  | { type: 'txStarted'; slotStartMs: number; text: string; nowMs: number }
  | { type: 'txEnded'; slotStartMs: number; text: string; complete: boolean; nowMs: number }
  | { type: 'txMissed'; slotStartMs: number; nowMs: number }
  | { type: 'audioStopped'; nowMs: number }
  | { type: 'audioResumed'; nowMs: number }
  | { type: 'bandChanged'; nowMs: number }
  | { type: 'bandConfirmed'; band: string; dialHz: number; mode: Mode; nowMs: number }
  | { type: 'touch'; nowMs: number }
  | { type: 'tick'; nowMs: number }
  | { type: 'editMessage'; tx: TxNum; text: string; nowMs: number }
  | { type: 'chooseNext'; tx: TxNum; nowMs: number }
  | { type: 'configure'; patch: Partial<SeqConfig>; nowMs: number }
  | { type: 'setWorked'; worked: Worked[]; nowMs: number };

export type SeqEffect =
  | { type: 'scheduleTx'; tx: TxNum; text: string; slotStartMs: number; startOffsetS: number }
  | { type: 'cancelTx'; stopPlaying: boolean }
  | { type: 'logQso'; record: QsoRecord }
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
    run: false,
    txEnabled: false,
    stopAfter: false,
    paused: false,
    partner: null,
    edits: {},
    current: null,
    next: null,
    onAir: null,
    lastSent: null,
    retries: 0,
    parity: null,
    queue: [],
    seq: 0,
    watchdogFromMs: 0,
    lastTxText: null,
    bandConfirmed: false,
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
  if (!c.myCall.trim() || !isGrid(c.myGrid)) return 'Set your callsign and grid in Settings to transmit.';
  if (!st.bandConfirmed) return 'Confirm the band in the band sheet to transmit.';
  if (!st.audioOk) return 'Resume audio to transmit.';
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

class Machine {
  st: SeqState;
  fx: SeqEffect[] = [];

  constructor(st: SeqState) {
    this.st = st;
  }

  get cfg() {
    return this.st.config;
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

  /** Stops everything at once: Halt, audio stops, band changes, the watchdog. */
  stopAll(nowMs: number) {
    const st = this.st;
    st.txEnabled = false;
    st.run = false;
    st.stopAfter = false;
    st.paused = false;
    if (st.next) st.next.scheduled = false;
    this.fx.push({ type: 'cancelTx', stopPlaying: true });
    void nowMs;
  }

  resetWatchdog(nowMs: number) {
    this.st.watchdogFromMs = nowMs;
  }

  newPartner(call: string, d: { grid: string | null; freqHz: number; snrDb: number; dtS: number }) {
    const st = this.st;
    st.partner = {
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
    const tx6 = st.edits[6];
    st.edits = tx6 ? { 6: tx6 } : {};
    st.retries = 0;
    st.paused = false;
  }

  /** Ends the QSO with the partner. Answering stops Tx; CQ carries on at the next decision. */
  endQso() {
    const st = this.st;
    st.partner = null;
    st.retries = 0;
    const tx6 = st.edits[6];
    st.edits = tx6 ? { 6: tx6 } : {};
    if (st.phase === 'answering' || st.stopAfter) {
      st.phase = 'idle';
      st.txEnabled = false;
      st.run = false;
      st.stopAfter = false;
      st.current = null;
      if (st.next?.scheduled) this.fx.push({ type: 'cancelTx', stopPlaying: false });
      st.next = null;
    }
  }

  complete(nowMs: number) {
    const st = this.st;
    const p = st.partner;
    if (!p || p.logged) return;
    p.logged = true;
    const c = this.cfg;
    const record = buildRecord(
      {
        call: p.call,
        grid: p.grid,
        mode: c.mode,
        band: c.band,
        dialHz: c.dialHz,
        txHz: c.txHz,
        startMs: p.startMs ?? nowMs,
        endMs: nowMs,
        sent: formatReport(p.reportSent ?? p.snrDb),
        rcvd: p.reportRcvd === null ? '' : formatReport(p.reportRcvd),
        stationCall: c.myCall,
        myGrid: c.myGrid,
        activationId: c.activationId,
        preset: c.preset,
        snrDb: p.snrDb,
        dtS: p.dtS,
        audioHz: p.freqHz,
      },
      c.newId(),
      nowMs,
    );
    st.worked.push({ call: record.CALL, band: c.band, mode: c.mode, day: dayOf(nowMs), grid: p.grid });
    st.completed++;
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

  giveUp(nowMs: number) {
    const st = this.st;
    const call = st.partner?.call ?? '';
    const n = this.cfg.maxRetries;
    if (st.phase === 'answering') {
      st.paused = true;
      if (st.next?.scheduled) this.fx.push({ type: 'cancelTx', stopPlaying: false });
      if (st.next) st.next.scheduled = false;
      this.notice('no-reply', `No reply from ${bare(call)} after ${n} repeats. Tap Call to try again.`);
      return;
    }
    this.notice('dropped', `${bare(call)} went quiet after ${n} repeats and was not logged.`);
    st.partner = null;
    st.retries = 0;
    this.nextCaller(nowMs);
  }

  /** CQ and Run: answers the next caller in the queue, or calls CQ again. */
  nextCaller(nowMs: number) {
    const st = this.st;
    const pick = this.ordered().find((c) => this.cfg.workDupes || !c.dupe);
    if (!pick) {
      st.partner = null;
      st.retries = 0;
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
    const c = this.cfg;
    const day = dayOf(nowMs);
    return this.st.worked.some((w) => sameCall(w.call, call) && w.band === c.band && w.mode === c.mode && w.day === day);
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
    if (!st.run) {
      // Without Run, only the stations calling in the latest slot are candidates.
      if (st.queue.length) changed = true;
      st.queue = [];
    } else {
      const before = st.queue.length;
      st.queue = st.queue.filter((c) => slotStartMs - c.heardMs <= STALE_SLOTS * SLOT_MS[this.cfg.mode]);
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

  slotDecoded(e: Extract<SeqEvent, { type: 'slotDecoded' }>) {
    const st = this.st;
    const me = this.cfg.myCall;
    const len = SLOT_MS[this.cfg.mode];
    // Keep the partner's latest signal for the report and the log.
    if (st.partner) {
      const heard = e.decodes.filter((d) => sameCall(parseExchange(d.text).from, st.partner!.call));
      const last = heard[heard.length - 1];
      if (last) Object.assign(st.partner, { snrDb: last.snr_db, dtS: last.dt_s, freqHz: last.freq_hz });
    }
    if (st.phase === 'cq' && e.pass === 'early') {
      if (st.run) this.addCallers(e.slotStartMs, e.decodes, e.nowMs);
      return;
    }
    if (e.pass !== 'final' || st.phase === 'idle') return;
    // Replies come in the other parity; the slot we transmitted in tells us nothing.
    if (st.parity && parityOf(e.slotStartMs, this.cfg.mode) === st.parity) return;
    const sentLastSlot = st.lastSent?.slotStartMs === e.slotStartMs - len;

    if (st.phase === 'cq') this.addCallers(e.slotStartMs, e.decodes, e.nowMs);

    if (st.partner) {
      const p = st.partner;
      const replies = e.decodes.map((d) => parseExchange(d.text)).filter((x) => sameCall(x.to, me) && sameCall(x.from, p.call));
      const ex = replies[replies.length - 1];
      if (p.logged) {
        // Calling side after RR73: the QSO is in the log. Without Run, a station that missed our
        // RR73 and repeats its R-report gets it again; otherwise move on.
        if (!st.run && ex?.kind === 'rreport') {
          this.goTo(4, e.nowMs);
          return;
        }
        this.endQso();
        if (st.phase === 'cq') this.nextCaller(e.nowMs);
        return;
      }
      const r = ex ? this.reply(ex, e.nowMs) : null;
      if (r === 'complete') {
        this.complete(e.nowMs);
        this.goTo(5, e.nowMs);
        return;
      }
      if (r === 'incomplete') {
        this.notice('incomplete', `${bare(p.call)} ended the QSO before the reports were exchanged. It was not logged.`);
        this.endQso();
        if (st.phase === 'cq') this.nextCaller(e.nowMs);
        return;
      }
      if (r === 'done') {
        this.endQso();
        if (st.phase === 'cq') this.nextCaller(e.nowMs);
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
      this.notice('cannot-call', 'There is no other callsign in this message to call.');
      return;
    }
    this.resetWatchdog(e.nowMs);
    if (!st.partner || !sameCall(st.partner.call, dx)) {
      this.newPartner(dx, { grid: ex.grid, freqHz: e.decode.freq_hz, snrDb: e.decode.snr_db, dtS: e.decode.dt_s });
    } else {
      Object.assign(st.partner, { freqHz: e.decode.freq_hz, snrDb: e.decode.snr_db, dtS: e.decode.dt_s });
      st.paused = false;
      st.retries = 0;
    }
    st.queue = st.queue.filter((c) => !sameCall(c.call, dx));
    st.parity = opposite(parityOf(e.slotStartMs, this.cfg.mode));
    if (st.phase !== 'cq') st.phase = 'answering';
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
    st.phase = 'cq';
    st.partner = null;
    st.retries = 0;
    st.paused = false;
    st.lastSent = null;
    st.parity = this.cfg.cqParity;
    st.txEnabled = true;
    this.plan(6, nowMs);
    const why = notReady(st);
    if (why) this.notice('not-ready', why);
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
        if (st.phase === 'answering' || st.stopAfter) this.endQso();
      }
    }
    if (sent.tx === 5) this.endQso();
  }

  tick(nowMs: number) {
    const st = this.st;
    if (st.txEnabled && nowMs - st.watchdogFromMs >= this.cfg.watchdogMs) {
      const min = Math.round(this.cfg.watchdogMs / 60000);
      this.stopAll(nowMs);
      this.notice('watchdog', `Tx stopped: ${min} min without a touch or a new message. Enable Tx to carry on.`);
      return;
    }
    const n = st.next;
    if (n && !n.scheduled && st.current && nowMs > n.slotStartMs + (0.5 + LATE_S[this.cfg.mode]) * 1000) this.plan(st.current, nowMs);
  }
}

/** Applies one event. The input state is not changed. */
export function reduce(state: SeqState, e: SeqEvent): SeqResult {
  const { newId } = state.config;
  const st: SeqState = structuredClone({ ...state, config: { ...state.config, newId: undefined as unknown as () => string } });
  st.config.newId = newId;
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
    case 'enableTx':
      st.txEnabled = e.on;
      if (e.on) {
        m.resetWatchdog(e.nowMs);
        st.paused = false;
        if (st.current && (!st.next || st.next.slotStartMs + (0.5 + LATE_S[st.config.mode]) * 1000 < e.nowMs)) m.plan(st.current, e.nowMs);
        const why = notReady(st);
        if (why) m.notice('not-ready', why);
      } else if (st.next) st.next.scheduled = false;
      if (!e.on) m.fx.push({ type: 'cancelTx', stopPlaying: false });
      m.flush();
      break;
    case 'runMode':
      st.run = e.on;
      m.resetWatchdog(e.nowMs);
      if (e.on && st.phase !== 'cq') m.callCq(e.nowMs);
      if (!e.on && st.queue.length) {
        st.queue = [];
        m.fx.push({ type: 'queueChanged', callers: [] });
      }
      break;
    case 'stopAfterQso':
      st.stopAfter = e.on;
      m.resetWatchdog(e.nowMs);
      break;
    case 'halt':
      m.stopAll(e.nowMs);
      // Calling CQ with nobody in a QSO has no state worth keeping: back to idle.
      if (st.phase === 'cq' && !st.partner) {
        st.phase = 'idle';
        st.current = null;
        st.next = null;
        st.queue = [];
      }
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
      if (st.txEnabled || st.run) m.notice('audio', 'Tx stopped because the audio stopped. The QSO keeps its place; resume audio, then enable Tx.');
      m.stopAll(e.nowMs);
      st.audioOk = false;
      break;
    case 'audioResumed':
      st.audioOk = true;
      break;
    case 'bandChanged':
      if (st.txEnabled || st.run) m.notice('band', 'Tx stopped for the band change. Confirm the band to transmit again.');
      m.stopAll(e.nowMs);
      st.bandConfirmed = false;
      break;
    case 'bandConfirmed': {
      const modeChanged = e.mode !== st.config.mode;
      Object.assign(st.config, { band: e.band, dialHz: e.dialHz, mode: e.mode });
      st.bandConfirmed = true;
      if (modeChanged) {
        st.partner = null;
        st.phase = 'idle';
        st.current = null;
        st.next = null;
        st.queue = [];
      }
      break;
    }
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
      m.fixReport(e.tx);
      st.retries = 0;
      m.plan(e.tx, e.nowMs);
      break;
    case 'configure': {
      const was = { ...st.config };
      Object.assign(st.config, e.patch);
      const changed = (k: keyof SeqConfig) => e.patch[k] !== undefined && e.patch[k] !== was[k];
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
