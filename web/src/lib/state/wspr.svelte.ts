/**
 * The WSPR runtime (docs/design/wspr.md): each slot's decodes as spots, and the beacon, which
 * transmits in a share of slots drawn by lib/wspr/schedule.ts until Halt, Beacon off or Stop
 * beacon after. Transmissions go through a TxScheduler of their own (lib/tx), 1 s into their
 * slot. Halt, a change of mode, audio stopping and the page hiding stop the beacon at once, as
 * they stop FT8; a change of band ends a transmission on air and keeps the beacon on.
 *
 * Spots are reception reports with no exchange: they stay out of the QSO log, ADIF and Wavelog.
 * Operate keeps the last 2 hours of them in memory.
 */

import { untrack } from 'svelte';
import { playClip, silentClipUri } from '../audio/unlock';
import { dialHz } from '../radio/bands';
import { STATUS } from '../qso/status';
import { TxScheduler, type TxReport } from '../tx/scheduler';
import { webAudioOut } from '../tx/web-audio';
import { beaconMessages } from '../wspr/message';
import { durationText, firstTxSlot, nextStopAfter, nextTxSlot, stopsAtMs, TX_OFFSET_S, TX_SECONDS, LEAD_MS } from '../wspr/schedule';
import { SORT_LABELS, SPOT_SORTS, learnGrids, toSpots, type Spot } from '../wspr/spots';
import { log } from '../log/log.svelte';
import { features } from './features.svelte';
import { txLevel } from './practice.svelte';
import { settings, updateSettings } from './settings.svelte';
import { audio, audioOut, codec, cutTx, markTransmitted, onAudioStatus, onHalt, onWsprDecoded, showTx, type WsprSlotResult } from './station.svelte';

/** One slot's spots, newest slot first in the list. */
export interface WsprSlot {
  startUtcMs: number;
  /** Band and dial the slot was heard on. */
  band: string;
  dialHz: number;
  spots: Spot[];
  /** Time in the decoder, ms. */
  ms: number;
  /** The decoder was busy with an earlier slot. */
  skipped: boolean;
}

/** A transmission of the beacon, newest first. */
export interface WsprTx {
  slotStartMs: number;
  text: string;
  freqHz: number;
  /** False when Halt or a change of band cut it short. */
  complete: boolean;
}

/** Slots of spots kept: 2 hours. */
const KEEP_SLOTS = 60;
/** A transmission is handed to the scheduler this long before its slot: synthesis takes well under a second. */
const AHEAD_MS = 8_000;

class WsprRuntime {
  slots = $state.raw<WsprSlot[]>([]);
  /** The beacon: on since `startedAtMs`, until `stopsAtMs` (null with Stop beacon after Off). */
  beacon = $state({ on: false, startedAtMs: 0, stopsAtMs: null as number | null });
  /** The next transmission's slot, UTC ms, and whether it is Transmit next slot's single one. Null when none is due. */
  next = $state<{ slotStartMs: number; once: boolean } | null>(null);
  onAir = $state<{ text: string; slotStartMs: number; startMs: number; endMs: number } | null>(null);
  sent = $state.raw<WsprTx[]>([]);
  notice = $state<{ text: string; atMs: number } | null>(null);
  /** The selected spot's id. */
  selected = $state<string | null>(null);
}

export const wspr = new WsprRuntime();

/** The beacon's slot and Transmit next slot's, UTC ms; the earlier one is next. */
let beaconSlot: number | null = null;
let onceSlot: number | null = null;
/** The last slot the beacon transmitted in, for the next gap. */
let lastTxSlot: number | null = null;
/** Which of the messages goes next: a compound callsign alternates Type 2 and Type 3. */
let part = 0;
/** The slot handed to the scheduler, so it is handed over once. */
let scheduledFor: number | null = null;
/** Grids heard from stations, for Type 2 spots. */
const grids = new Map<string, string>();

/** The station's call and grid: the running activation's (with Activations on), else Settings. */
function station(): { call: string; grid: string } {
  const a = features.activations ? log.current : null;
  return { call: a?.callsign || settings.callsign, grid: a?.grid || settings.grid };
}

/** What the beacon sends, in turn, or why it cannot. */
export function beaconTexts() {
  const s = station();
  return beaconMessages(s.call, s.grid, settings.wspr.powerDbm);
}

/** The message of the next transmission, or null. */
export function nextText(): string | null {
  const b = beaconTexts();
  return b.ok ? b.texts[part % b.texts.length] : null;
}

const scheduler = new TxScheduler({
  audio: () => {
    const out = audioOut();
    return out ? webAudioOut(out.ctx, out.mapper) : null;
  },
  encoder: { synthesize: (text, mode, f0, rate) => codec().synthesize(text, mode, f0, rate) },
  gate: () => (audio.status !== 'running' ? STATUS.audioOff : null),
  report: onReport,
});

function notice(text: string, nowMs = Date.now()) {
  wspr.notice = { text, atMs: nowMs };
}

function updateNext() {
  const slots = [beaconSlot, onceSlot].filter((s): s is number => s !== null);
  if (!slots.length) {
    wspr.next = null;
    return;
  }
  const slot = Math.min(...slots);
  wspr.next = { slotStartMs: slot, once: slot === onceSlot && slot !== beaconSlot };
}

/** Withdraws a transmission handed to the scheduler that has not started. */
function withdraw() {
  if (scheduledFor !== null && !wspr.onAir) scheduler.cancel();
  if (!wspr.onAir) scheduledFor = null;
}

/** iOS keeps Web Audio silent on the silent switch until a media clip plays inside a tap. */
function unmute() {
  playClip(silentClipUri());
}

/** Checks the beacon can transmit now; on failure the status line says why. */
function ready(nowMs: number): boolean {
  if (audio.status !== 'running') {
    notice(STATUS.audioOff, nowMs);
    return false;
  }
  if (!beaconTexts().ok) {
    notice(STATUS.setUp, nowMs);
    return false;
  }
  return true;
}

/** Turns the beacon on or off. Off lets a transmission on air finish; Halt stops it. Call from the tap. */
export function setBeacon(on: boolean, nowMs = Date.now()) {
  if (on) {
    unmute();
    if (!ready(nowMs)) return;
    void checkCall(nowMs);
    wspr.beacon = { on: true, startedAtMs: nowMs, stopsAtMs: stopsAtMs(nowMs, settings.wspr.stopAfterMin) };
    lastTxSlot = null;
    beaconSlot = nextTxSlot(nowMs, settings.wspr.txPct, null, LEAD_MS);
  } else {
    wspr.beacon = { on: false, startedAtMs: 0, stopsAtMs: null };
    beaconSlot = null;
    if (scheduledFor !== onceSlot) withdraw();
  }
  updateNext();
  tick(nowMs);
}

/** Refuses a callsign the codec cannot send, such as one too long for a Type 1 message. */
async function checkCall(nowMs: number) {
  const b = beaconTexts();
  if (!b.ok) return;
  for (const text of b.texts) {
    const p = await codec().pack(text, 'WSPR').catch(() => null);
    // Only the codec's own refusal counts: without a decoder, packing fails for every text.
    if (p && !p.ok && codec().available) {
      stopAll();
      notice(STATUS.noWsprCall, nowMs);
      return;
    }
  }
}

/** Transmits once in the next slot at least 10 s away, with the beacon on or off. Call from the tap. */
export function transmitNextSlot(nowMs = Date.now()) {
  unmute();
  if (!ready(nowMs)) return;
  void checkCall(nowMs);
  onceSlot = firstTxSlot(nowMs);
  updateNext();
  tick(nowMs);
}

/** Sets the Tx percentage; with the beacon on, the next Tx slot is drawn again. */
export function setTxPct(pct: number, nowMs = Date.now()) {
  void updateSettings({ wspr: { ...settings.wspr, txPct: pct } });
  if (!wspr.beacon.on || wspr.onAir) return;
  const was = beaconSlot;
  beaconSlot = nextTxSlot(nowMs, pct, lastTxSlot, LEAD_MS);
  if (was !== beaconSlot && scheduledFor === was && scheduledFor !== onceSlot) withdraw();
  updateNext();
  tick(nowMs);
}

/** Steps Stop beacon after to its next value (••• menu). A running beacon counts from when it turned on. */
export function stepStopAfter(nowMs = Date.now()) {
  const min = nextStopAfter(settings.wspr.stopAfterMin);
  void updateSettings({ wspr: { ...settings.wspr, stopAfterMin: min } });
  if (wspr.beacon.on) wspr.beacon = { ...wspr.beacon, stopsAtMs: stopsAtMs(wspr.beacon.startedAtMs, min) };
  notice(STATUS.beaconStopAfter(durationText(min)), nowMs);
  tick(nowMs);
}

/** Steps the spot order (••• menu). */
export function stepSort(nowMs = Date.now()) {
  const sort = SPOT_SORTS[(SPOT_SORTS.indexOf(settings.wspr.sort) + 1) % SPOT_SORTS.length];
  void updateSettings({ wspr: { ...settings.wspr, sort } });
  notice(STATUS.beaconSort(SORT_LABELS[sort].toLowerCase()), nowMs);
}

/** Sets the Tx frequency, Hz (from the waterfall or Settings). A transmission waiting for its slot is made again. */
export function setWsprTxHz(hz: number) {
  if (hz === settings.wspr.txHz) return;
  void updateSettings({ wspr: { ...settings.wspr, txHz: hz }, freqPicked: true });
  if (scheduledFor !== null && !wspr.onAir && scheduledFor - Date.now() > 1500) {
    withdraw();
    tick(Date.now());
  }
}

/**
 * Stops everything at once: Halt, a change of mode, audio stopping. The plan goes first, so the
 * report of the cut transmission finds nothing more to send.
 */
function stopAll() {
  scheduledFor = null;
  beaconSlot = null;
  onceSlot = null;
  wspr.beacon = { on: false, startedAtMs: 0, stopsAtMs: null };
  updateNext();
  scheduler.halt();
}

/** Halt from the bottom bar: ends a transmission on air and turns the beacon off. */
export function haltWspr() {
  stopAll();
}

/** The 1 s tick: Stop beacon after, and handing the next transmission to the scheduler. */
export function tick(nowMs = Date.now()) {
  const b = wspr.beacon;
  if (b.on && b.stopsAtMs !== null && nowMs >= b.stopsAtMs) {
    const min = Math.round((b.stopsAtMs - b.startedAtMs) / 60_000);
    stopAll();
    notice(STATUS.beaconStopped(durationText(min)), nowMs);
    return;
  }
  const n = wspr.next;
  if (!n || scheduledFor === n.slotStartMs || wspr.onAir) return;
  if (nowMs < n.slotStartMs - AHEAD_MS) return;
  const text = nextText();
  if (!text) return;
  scheduledFor = n.slotStartMs;
  void scheduler.schedule({ text, mode: 'WSPR', slotStartMs: n.slotStartMs, startOffsetS: TX_OFFSET_S, f0Hz: settings.wspr.txHz, level: txLevel(settings.outputLevel) });
}

/** After a slot is done with, sent or not: the single transmission goes, and the beacon draws its next slot. */
function afterSlot(slotStartMs: number, nowMs: number, sent: boolean) {
  if (onceSlot === slotStartMs) onceSlot = null;
  if (scheduledFor === slotStartMs) scheduledFor = null;
  if (wspr.beacon.on && (beaconSlot === null || beaconSlot <= slotStartMs)) {
    if (sent) lastTxSlot = slotStartMs;
    beaconSlot = nextTxSlot(nowMs, settings.wspr.txPct, lastTxSlot, sent ? 0 : LEAD_MS);
  }
  updateNext();
}

function onReport(r: TxReport) {
  const now = Date.now();
  if (r.type === 'started') {
    const hz = settings.wspr.txHz;
    wspr.onAir = { text: r.text, slotStartMs: r.slotStartMs, startMs: r.startUtcMs, endMs: r.startUtcMs + TX_SECONDS * 1000 };
    markTransmitted(r.slotStartMs, r.slotStartMs + 1, 'WSPR', { text: r.text, f0Hz: hz });
    wspr.sent = [{ slotStartMs: r.slotStartMs, text: r.text, freqHz: hz, complete: true }, ...wspr.sent.filter((s) => s.slotStartMs !== r.slotStartMs)].slice(0, 30);
    void showTx(r.startUtcMs, r.text, 'WSPR', hz);
    part++;
  } else if (r.type === 'ended') {
    wspr.onAir = null;
    if (!r.complete) {
      cutTx(now);
      wspr.sent = wspr.sent.map((s) => (s.slotStartMs === r.slotStartMs ? { ...s, complete: false } : s));
    }
    afterSlot(r.slotStartMs, now, true);
  } else if (r.type === 'missed') {
    if (r.reason === 'encode') notice(STATUS.encode, now);
    afterSlot(r.slotStartMs, now, false);
  } else {
    // Refused: audio is off. The beacon cannot go on without it.
    notice(r.reason, now);
    stopAll();
  }
  tick(now);
}

/** A slot's decodes as spots, into the list. Exported for the review build's injected spots. */
export function addSlot(r: WsprSlotResult) {
  const s = station();
  const dial = dialHz(settings.band, 'WSPR') ?? 0;
  const spots = toSpots(r.decodes, r.startUtcMs, { myGrid: s.grid, myCall: s.call, dialHz: dial, grids });
  learnGrids(spots, grids);
  const entry: WsprSlot = { startUtcMs: r.startUtcMs, band: settings.band, dialHz: dial, spots, ms: r.ms, skipped: !!r.skipped };
  wspr.slots = [entry, ...wspr.slots.filter((x) => x.startUtcMs !== r.startUtcMs)].sort((a, b) => b.startUtcMs - a.startUtcMs).slice(0, KEEP_SLOTS);
}

/** Spots of `call` in the slots kept, and the start of the oldest slot kept (UTC ms). */
export function heard(call: string): { count: number; sinceMs: number | null } {
  let count = 0;
  for (const s of wspr.slots) for (const p of s.spots) if (p.call === call) count++;
  return { count, sinceMs: wspr.slots.at(-1)?.startUtcMs ?? null };
}

/** Forgets the spots and the schedule; tests use it to start again. */
export function resetWspr() {
  stopAll();
  wspr.slots = [];
  wspr.sent = [];
  wspr.notice = null;
  wspr.selected = null;
  wspr.onAir = null;
  lastTxSlot = null;
  part = 0;
  grids.clear();
}

let started = false;

/** Wires the runtime to the station. Called once by the app. */
export function startWspr() {
  if (started || typeof window === 'undefined') return;
  started = true;
  onWsprDecoded(addSlot);
  onHalt(stopAll);
  onAudioStatus((s) => {
    if ((s === 'stopped' || s === 'failed') && (wspr.beacon.on || wspr.next)) {
      stopAll();
      notice(STATUS.beaconOff);
    }
  });
  setInterval(() => tick(Date.now()), 1000);
  $effect.root(() => {
    // A change of mode stops the beacon; a change of band ends a transmission and keeps it on.
    let mode = settings.mode;
    let band = settings.band;
    $effect(() => {
      const m = settings.mode;
      const b = settings.band;
      untrack(() => {
        if (m !== mode && (m === 'WSPR' || mode === 'WSPR')) stopAll();
        else if (b !== band && m === 'WSPR' && wspr.onAir) scheduler.halt();
        mode = m;
        band = b;
      });
    });
  });
}
