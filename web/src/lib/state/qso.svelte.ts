/**
 * The QSO runtime: feeds the sequencer (lib/qso) with decodes, audio and band state, touches
 * and a 1 s tick, and carries out its effects through the transmit scheduler (lib/tx).
 * Completed QSOs are kept in memory for this session; lib/log subscribes with subscribeQsos.
 */

import { untrack } from 'svelte';
import { initialState, messages, notReady, reduce, ourSlot, type Caller, type NoticeKind, type SeqEvent, type SeqState } from '../qso/sequencer';
import type { TxNum } from '../qso/messages';
import type { QsoRecord } from '../qso/record';
import { parity as parityOf, type Parity } from '../clock/slots';
import { dialHz } from '../radio/bands';
import type { Decode } from '../decode/types';
import { PRESET } from '../decode/worker-client';
import { TxScheduler, type TxReport } from '../tx/scheduler';
import { webAudioOut } from '../tx/web-audio';
import { playClip, silentClipUri } from '../audio/unlock';
import { clampHz } from '../waterfall/pick';
import { settings, updateSettings } from './settings.svelte';
import { audio, audioOut, codec, onAudioStatus, onHalt, onSlotDecoded } from './station.svelte';

export interface SentRow {
  slotStartMs: number;
  text: string;
  freqHz: number;
}

export interface Selected {
  decode: Decode;
  slotStartMs: number;
  /** List item id, for the highlight. */
  id: string;
}

export interface Notice {
  kind: NoticeKind | 'refused' | 'encode';
  text: string;
  atMs: number;
}

export type QsoEvent = { type: 'logged' | 'updated' | 'deleted'; record: QsoRecord };

class QsoRuntime {
  st = $state.raw<SeqState>(initialState(configNow()));
  sent = $state<SentRow[]>([]);
  selected = $state<Selected | null>(null);
  notice = $state<Notice | null>(null);
  /** The QSO just logged, for the notice with Edit and Undo. */
  logged = $state.raw<QsoRecord | null>(null);
  /** QSOs logged in this session, newest first; Undo leaves a tombstone (deletedAt). */
  records = $state.raw<QsoRecord[]>([]);
  /** On air now: start and end, UTC ms. */
  onAir = $state<{ text: string; tx: TxNum; startMs: number; endMs: number } | null>(null);
}

export const qso = new QsoRuntime();

const subscribers = new Set<(e: QsoEvent) => void>();

/**
 * For lib/log: every QSO the sequencer logs ('logged'), and later Edit ('updated') and Undo
 * ('deleted', with deletedAt set). Returns a function that unsubscribes.
 */
export function subscribeQsos(fn: (e: QsoEvent) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function emit(e: QsoEvent) {
  for (const s of subscribers) s(e);
}

function configNow() {
  return {
    myCall: settings.callsign,
    myGrid: settings.grid,
    mode: settings.mode,
    band: settings.band,
    dialHz: dialHz(settings.band, settings.mode) ?? 0,
    txHz: settings.txHz,
    ack: settings.ack,
    maxRetries: 3,
    order: settings.queueOrder,
    workDupes: settings.workDupes,
    watchdogMs: 6 * 60_000,
    cqParity: settings.cqParity,
    cqModifier: null,
    preset: PRESET,
    activationId: null,
    newId: () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
  };
}

const scheduler = new TxScheduler({
  audio: () => {
    const out = audioOut();
    return out ? webAudioOut(out.ctx, out.mapper) : null;
  },
  encoder: { synthesize: (text, mode, f0, rate) => codec().synthesize(text, mode, f0, rate) },
  gate: () => (audio.status !== 'running' ? 'Resume audio to transmit.' : notReady(qso.st)),
  report: onTxReport,
});

/** Applies one event to the sequencer and carries out its effects. */
export function dispatch(e: SeqEvent) {
  const before = qso.st.partner?.call ?? null;
  const r = reduce(qso.st, e);
  qso.st = r.state;
  // A station called by hand, or a new partner answered in Run: Rx moves to their frequency,
  // and Tx too when Hold Tx is off. Done before the effects so the first transmission uses it.
  const p = r.state.partner;
  if (p && (p.call !== before || e.type === 'callStation')) {
    const hz = clampHz(p.freqHz, r.state.config.mode);
    void updateSettings(settings.holdTx ? { rxHz: hz } : { rxHz: hz, txHz: hz });
  }
  for (const f of r.effects) {
    switch (f.type) {
      case 'scheduleTx':
        void scheduler.schedule({
          text: f.text,
          mode: r.state.config.mode,
          slotStartMs: f.slotStartMs,
          startOffsetS: f.startOffsetS,
          f0Hz: settings.txHz,
          level: settings.outputLevel,
        });
        break;
      case 'cancelTx':
        if (f.stopPlaying) scheduler.halt();
        else scheduler.cancel();
        break;
      case 'logQso':
        qso.records = [f.record, ...qso.records];
        qso.logged = f.record;
        emit({ type: 'logged', record: f.record });
        break;
      case 'notice':
        qso.notice = { kind: f.kind, text: f.text, atMs: e.nowMs };
        break;
      case 'queueChanged':
        break;
    }
  }
}

function onTxReport(r: TxReport) {
  const now = Date.now();
  if (r.type === 'started') {
    const txn = (Object.entries(messages(qso.st)).find(([, t]) => t === r.text)?.[0] ?? '6') as unknown as TxNum;
    dispatch({ type: 'txStarted', slotStartMs: r.slotStartMs, text: r.text, nowMs: now });
    const dur = qso.st.config.mode === 'FT8' ? 12_640 : 5_040;
    qso.onAir = { text: r.text, tx: Number(txn) as TxNum, startMs: r.startUtcMs, endMs: r.startUtcMs + dur };
    qso.sent = [{ slotStartMs: r.slotStartMs, text: r.text, freqHz: settings.txHz }, ...qso.sent.filter((s) => s.slotStartMs !== r.slotStartMs)].slice(0, 20);
  } else if (r.type === 'ended') {
    qso.onAir = null;
    dispatch({ type: 'txEnded', slotStartMs: r.slotStartMs, text: r.text, complete: r.complete, nowMs: now });
  } else if (r.type === 'missed') {
    if (r.reason === 'encode') qso.notice = { kind: 'encode', text: 'The message could not be encoded. Check it in Messages.', atMs: now };
    dispatch({ type: 'txMissed', slotStartMs: r.slotStartMs, nowMs: now });
  } else {
    qso.notice = { kind: 'refused', text: r.reason, atMs: now };
    dispatch({ type: 'txMissed', slotStartMs: r.slotStartMs, nowMs: now });
  }
}

/** Halt from the dock: stops Tune and any transmission at once, and Tx and Run. */
export function haltTx() {
  scheduler.halt();
  dispatch({ type: 'halt', nowMs: Date.now() });
}

/**
 * Sets the receive and transmit audio frequencies from the waterfall, Hz. A transmission waiting
 * for its slot is made again at the new Tx frequency when more than 1.5 s remain; one on air
 * finishes where it is.
 */
export function setFrequencies(f: { rxHz?: number; txHz?: number }) {
  const mode = settings.mode;
  const patch: { rxHz?: number; txHz?: number; freqPicked: true } = { freqPicked: true };
  if (f.rxHz !== undefined) patch.rxHz = clampHz(f.rxHz, mode);
  if (f.txHz !== undefined) patch.txHz = clampHz(f.txHz, mode);
  const moved = patch.txHz !== undefined && patch.txHz !== settings.txHz;
  void updateSettings(patch);
  if (moved) retune();
}

const RETUNE_MARGIN_MS = 1500;

function retune() {
  const p = qso.st.next;
  if (!p?.scheduled || qso.onAir) return;
  if (p.slotStartMs + p.offsetS * 1000 - Date.now() < RETUNE_MARGIN_MS) return;
  void scheduler.schedule({
    text: p.text,
    mode: qso.st.config.mode,
    slotStartMs: p.slotStartMs,
    startOffsetS: p.offsetS,
    f0Hz: settings.txHz,
    level: settings.outputLevel,
  });
}

export function select(s: Selected | null) {
  qso.selected = s;
}

/**
 * iOS keeps Web Audio silent on the ring switch's silent setting until a media clip plays inside
 * a tap. Every tap that can lead to a transmission plays the silent clip first, before any await.
 */
function unmute() {
  playClip(silentClipUri());
}

/** Calls a station. Call from the tap (or double-tap). */
export function callStation(decode: Decode, slotStartMs: number) {
  unmute();
  dispatch({ type: 'callStation', decode, slotStartMs, nowMs: Date.now() });
  qso.selected = null;
}

/** Calls CQ. Call from the tap. */
export function callCq() {
  unmute();
  dispatch({ type: 'callCq', nowMs: Date.now() });
}

/** Turns Tx on or off. Call from the tap. */
export function setTxEnabled(on: boolean) {
  if (on) unmute();
  dispatch({ type: 'enableTx', on, nowMs: Date.now() });
}

/** Turns Run on or off. Call from the tap. */
export function setRun(on: boolean) {
  if (on) unmute();
  dispatch({ type: 'runMode', on, nowMs: Date.now() });
}

export function setStopAfter(on: boolean) {
  dispatch({ type: 'stopAfterQso', on, nowMs: Date.now() });
}

export function chooseNext(tx: TxNum) {
  dispatch({ type: 'chooseNext', tx, nowMs: Date.now() });
}

export function editMessage(tx: TxNum, text: string) {
  dispatch({ type: 'editMessage', tx, text, nowMs: Date.now() });
}

/** The band sheet confirmed the radio's dial. A different band or mode first stops Tx. */
export function confirmBand(band: string, mode: 'FT8' | 'FT4') {
  const c = qso.st.config;
  const now = Date.now();
  if (c.band !== band || c.mode !== mode) dispatch({ type: 'bandChanged', nowMs: now });
  dispatch({ type: 'bandConfirmed', band, dialHz: dialHz(band as never, mode) ?? 0, mode, nowMs: now });
}

/** When a call to a decode heard in `slotStartMs` would start, and in which parity. */
export function callStart(slotStartMs: number, nowMs = Date.now()): { startMs: number; parity: Parity; tooLateFor: number | null } {
  const st = qso.st;
  const parity: Parity = parityOf(slotStartMs, st.config.mode) === 'even' ? 'odd' : 'even';
  const s = ourSlot({ ...st, parity }, nowMs);
  return { startMs: s.slotStartMs + s.offsetS * 1000, parity, tooLateFor: s.tooLateFor };
}

export function undoQso(id: string) {
  const r = qso.records.find((q) => q.id === id);
  if (!r || r.deletedAt) return;
  const now = new Date().toISOString();
  const dead: QsoRecord = { ...r, deletedAt: now, updatedAt: now };
  qso.records = qso.records.map((q) => (q.id === id ? dead : q));
  if (qso.logged?.id === id) qso.logged = null;
  syncWorked();
  emit({ type: 'deleted', record: dead });
}

export function editQso(id: string, patch: Partial<Pick<QsoRecord, 'CALL' | 'GRIDSQUARE' | 'RST_SENT' | 'RST_RCVD' | 'COMMENT'>>) {
  const r = qso.records.find((q) => q.id === id);
  if (!r) return;
  const next: QsoRecord = { ...r, ...patch, updatedAt: new Date().toISOString() };
  if (!next.GRIDSQUARE) delete next.GRIDSQUARE;
  if (!next.COMMENT) delete next.COMMENT;
  qso.records = qso.records.map((q) => (q.id === id ? next : q));
  if (qso.logged?.id === id) qso.logged = next;
  syncWorked();
  emit({ type: 'updated', record: next });
}

/** Live QSOs only. */
export function liveRecords(): QsoRecord[] {
  return qso.records.filter((r) => !r.deletedAt);
}

function syncWorked() {
  const worked = liveRecords().map((r) => ({
    call: r.CALL,
    band: r.BAND,
    mode: (r.SUBMODE === 'FT4' ? 'FT4' : 'FT8') as 'FT8' | 'FT4',
    day: r.QSO_DATE,
    grid: r.GRIDSQUARE ?? null,
  }));
  dispatch({ type: 'setWorked', worked, nowMs: Date.now() });
}

/** The caller queue in answering order. */
export function queue(): Caller[] {
  return qso.st.queue;
}

let started = false;

/** Wires the runtime to the station. Called once by the app. */
export function startQso() {
  if (started || typeof window === 'undefined') return;
  started = true;
  onSlotDecoded((slotStartMs, decodes) => dispatch({ type: 'slotDecoded', slotStartMs, pass: 'final', decodes, nowMs: Date.now() }));
  onAudioStatus((s) => {
    if (s === 'running') dispatch({ type: 'audioResumed', nowMs: Date.now() });
    else if (s === 'stopped' || s === 'failed') dispatch({ type: 'audioStopped', nowMs: Date.now() });
  });
  onHalt(() => {
    scheduler.halt();
    dispatch({ type: 'halt', nowMs: Date.now() });
  });
  setInterval(() => dispatch({ type: 'tick', nowMs: Date.now() }), 1000);
  let lastTouch = 0;
  window.addEventListener(
    'pointerdown',
    () => {
      const now = Date.now();
      if (now - lastTouch < 1000) return;
      lastTouch = now;
      dispatch({ type: 'touch', nowMs: now });
    },
    { capture: true, passive: true },
  );
  // The band and mode in Settings until the band sheet confirms them; Tx stays off until then.
  {
    const c = configNow();
    dispatch({ type: 'configure', patch: { band: c.band, mode: c.mode, dialHz: c.dialHz }, nowMs: Date.now() });
  }
  // Settings feed the sequencer's configuration.
  $effect.root(() => {
    $effect(() => {
      const c = configNow();
      const patch = { myCall: c.myCall, myGrid: c.myGrid, txHz: c.txHz, ack: c.ack, order: c.order, workDupes: c.workDupes, cqParity: c.cqParity };
      // The dispatch reads and writes the sequencer state; only Settings should re-run this.
      untrack(() => dispatch({ type: 'configure', patch, nowMs: Date.now() }));
    });
  });
}
