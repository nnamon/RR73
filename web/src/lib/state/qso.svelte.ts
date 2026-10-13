/**
 * The QSO runtime: feeds the sequencer (lib/qso) with decodes, audio and band state, touches
 * and a 1 s tick, and carries out its effects through the transmit scheduler (lib/tx).
 * Completed QSOs go to the log (lib/log logQso), which stores them, shows the Logged notice
 * and sends them on; the log's QSOs are also the worked-before list for dupes.
 */

import { untrack } from 'svelte';
import { initialState, messages, notReady, reduce, ourSlot, type Caller, type NoticeKind, type SeqEvent, type SeqState, type Worked } from '../qso/sequencer';
import type { TxNum } from '../qso/messages';
import { parity as parityOf, type Parity } from '../clock/slots';
import { dialHz } from '../radio/bands';
import type { Decode } from '../decode/types';
import { PRESET } from '../decode/worker-client';
import { TxScheduler, type TxReport } from '../tx/scheduler';
import { webAudioOut } from '../tx/web-audio';
import { playClip, silentClipUri } from '../audio/unlock';
import { clampHz } from '../waterfall/pick';
import { log, logQso } from '../log/log.svelte';
import { features } from './features.svelte';
import type { Qso } from '../log/types';
import { settings, updateSettings } from './settings.svelte';
import { txLevel } from './practice.svelte';
import { audio, audioOut, codec, markTransmitted, onAudioStatus, onHalt, onSlotDecoded } from './station.svelte';

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
  kind: NoticeKind | 'refused' | 'encode' | 'info';
  text: string;
  atMs: number;
}

class QsoRuntime {
  st = $state.raw<SeqState>(initialState(configNow()));
  sent = $state<SentRow[]>([]);
  selected = $state<Selected | null>(null);
  notice = $state<Notice | null>(null);
  /** On air now: start and end, UTC ms. */
  onAir = $state<{ text: string; tx: TxNum; startMs: number; endMs: number } | null>(null);
}

export const qso = new QsoRuntime();

/** When this session started, UTC ms: the Run rate counts QSOs from here. */
const sessionStart = Date.now();

/** The call and grid on air: the running activation's (with Activations on), else Settings. Exported for tests. */
export function configNow() {
  const a = features.activations ? log.current : null;
  return {
    myCall: a?.callsign || settings.callsign,
    myGrid: a?.grid || settings.grid,
    mode: settings.mode,
    band: settings.band,
    dialHz: dialHz(settings.band, settings.mode) ?? 0,
    txHz: settings.txHz,
    ack: settings.ack,
    maxRetries: 3,
    order: settings.queueOrder,
    workDupes: settings.workDupes,
    run: settings.run,
    tailEnd: settings.tailEnd,
    huntOrder: settings.huntOrder,
    watchdogMs: settings.watchdog ? Math.round(settings.watchdogMin * 60_000) : 0,
    cqParity: settings.cqParity,
    cqModifier: null,
    preset: PRESET,
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
          level: txLevel(settings.outputLevel),
        });
        break;
      case 'cancelTx':
        if (f.stopPlaying) scheduler.halt();
        else scheduler.cancel();
        break;
      case 'logQso':
        void logQso(f.record);
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
    // The slot it was scheduled in: a transmission, late start included, ends inside its slot.
    markTransmitted(r.slotStartMs, r.slotStartMs + 1, qso.st.config.mode, { text: r.text, f0Hz: settings.txHz });
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
    level: txLevel(settings.outputLevel),
  });
}

export function select(s: Selected | null) {
  qso.selected = s;
}

/** A tap on a decode row: selects it, or clears the selection when the row is already selected. */
export function tapRow(s: Selected) {
  qso.selected = qso.selected?.id === s.id ? null : s;
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

/** Run on or off: what the CQ loop does after a QSO. It starts nothing by itself. */
export function setRun(on: boolean) {
  void updateSettings({ run: on });
}

/** Turns Hunt on or off. Call from the tap. */
export function setHunt(on: boolean) {
  if (on) unmute();
  dispatch({ type: 'hunt', on, nowMs: Date.now() });
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

/** End QSO from the ••• menu: stops Tx and Run and goes back to idle. Nothing is logged. */
export function endQso() {
  dispatch({ type: 'endQso', nowMs: Date.now() });
}

/** A notice in the status line, such as the result of Find clear Tx. */
export function showNotice(text: string) {
  qso.notice = { kind: 'info', text, atMs: Date.now() };
}

/** When a call to a decode heard in `slotStartMs` would start, and in which parity. */
export function callStart(slotStartMs: number, nowMs = Date.now()): { startMs: number; parity: Parity; tooLateFor: number | null } {
  const st = qso.st;
  const parity: Parity = parityOf(slotStartMs, st.config.mode) === 'even' ? 'odd' : 'even';
  const s = ourSlot({ ...st, parity }, nowMs);
  return { startMs: s.slotStartMs + s.offsetS * 1000, parity, tooLateFor: s.tooLateFor };
}

/** FT8 and FT4 QSOs in the log, as the sequencer's worked-before list. */
export function workedFrom(qsos: readonly Qso[]): Worked[] {
  const out: Worked[] = [];
  for (const q of qsos) {
    if (q.deletedAt !== null) continue;
    const mode = q.mode === 'FT8' ? 'FT8' : q.mode === 'MFSK' && q.submode === 'FT4' ? 'FT4' : null;
    if (!mode) continue;
    out.push({ call: q.call, band: q.band, mode, day: new Date(q.start).toISOString().slice(0, 10).replace(/-/g, ''), grid: q.gridsquare || null });
  }
  return out;
}

/** QSOs logged by the sequencer in this session, and in the last hour, for the Run line. */
export function runRate(nowMs: number): { total: number; hour: number } {
  const mine = log.live.filter((q) => q.source === 'sequencer' && q.createdAt >= sessionStart);
  return { total: mine.length, hour: mine.filter((q) => nowMs - q.createdAt < 3_600_000).length };
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
  // Settings and the running activation feed the sequencer's configuration; the log's QSOs are
  // its worked-before list, so dupes survive a reload.
  $effect.root(() => {
    $effect(() => {
      const worked = workedFrom(log.qsos);
      untrack(() => dispatch({ type: 'setWorked', worked, nowMs: Date.now() }));
    });
    $effect(() => {
      const c = configNow();
      const patch = {
        myCall: c.myCall,
        myGrid: c.myGrid,
        band: c.band,
        mode: c.mode,
        dialHz: c.dialHz,
        txHz: c.txHz,
        ack: c.ack,
        order: c.order,
        workDupes: c.workDupes,
        cqParity: c.cqParity,
        run: c.run,
        tailEnd: c.tailEnd,
        huntOrder: c.huntOrder,
        watchdogMs: c.watchdogMs,
      };
      // The dispatch reads and writes the sequencer state; only Settings should re-run this.
      untrack(() => dispatch({ type: 'configure', patch, nowMs: Date.now() }));
    });
  });
}
