/**
 * The running station: audio capture, slots, decodes and Tune, as reactive state for the
 * screens. Capture chunks flow to the slot assembler (then the recorder and the decoder) and to
 * whoever listens for the waterfall.
 *
 * Transmit safety: only Tune plays, and output halts when audio stops, when the page is closed,
 * when it is hidden where hiding stops capture (iOS), and on Halt. With rig control keying the
 * radio (lib/state/radio.svelte.ts), Tune keys it by PTT first, and Halt's hooks send PTT off
 * (lib/state/cat.svelte.ts).
 */

import { CaptureEngine, type Chunk, type EngineState, type InputSource, type StartError, type StopReason, type AudioStatus } from '../audio/engine';
import { START_TONE, playClip, silentClipUri, startToneSamples, wavDataUri } from '../audio/unlock';
import { FLOOR_DB } from '../audio/level';
import { TransmitOutput, TUNE, type TuneEnd } from '../audio/output';
import { inputChoices, matchInput, matchOutput, outputChange, outputChoices, outputChoiceSupported, type OutputState } from '../audio/sink';
import type { CaptureReport } from '../audio/report';
import type { AudioClockMapper } from '../clock/mapping';
import { RxCalibration, clockWarns } from '../clock/calibration';
import { findOwnDecode, type HeardBack, type SentTx, type TimingSnapshot } from '../clock/timing';
import { WakeLockKeeper, type WakeState } from '../audio/wakelock';
import { EARLY_S, SLOT_MS, SLOT_SAMPLES, hasSlots, type FtMode, type Mode, type SlotMode } from '../clock/slots';
import { NullDecoder } from '../decode/null-client';
import type { Decode, DecoderClient, DecoderStatus, QsoContext } from '../decode/types';
import { DecoderBusyError, createDecoder } from '../decode/worker-client';
import type { WsprDecode } from '../wspr/spots';
import { operatingDialHz } from '../radio/hound-dial';
import { SlotAssembler, type AssembledSlot, type EarlySlot } from '../slots/assembler';
import { SlotRecorder, slotFiles } from '../slots/recorder';
import { saveSlot, type SaveResult } from '../slots/share';
import { TransmittedSlots } from '../slots/transmitted';
import type { TxWave } from '../waterfall/renderer';
import { DISPLAY_RATE } from '../waterfall/spectrum';
import { settings, updateSettings } from './settings.svelte';
import { practice, txLevel } from './practice.svelte';
import { noteLoadFailure } from '../app/update.svelte';
import { dialNow, provideTxOutput, radioNotice, rig, tuneGate, txKeyer, txShiftHz } from './radio.svelte';
import { DIAL_TIMEOUT_MS, PTT_SETTLE_MS, PTT_TIMEOUT_MS, keyFailedText, pause, tailMs, type Keying } from '../tx/keyer';
import { STATUS } from '../qso/status';
import { capturesHidden } from '../app/platform';
import { DecodeTimes } from '../decode/times';

export interface SlotSummary {
  startUtcMs: number;
  mode: SlotMode;
  filled: number;
  lateStart: boolean;
  gap: boolean;
}

export interface DecodedSlot {
  startUtcMs: number;
  mode: FtMode;
  decodes: Decode[];
  /** Time from handing the slot to the decoder to its decodes, ms. */
  ms: number;
  /** True when the decoder was still busy with earlier slots and this one was not decoded. */
  skipped?: boolean;
  /** From the early pass, before the slot ended (EARLY_S); the full slot's decodes join it. */
  early?: boolean;
}

export interface KeyingResult {
  /** When the check finished, UTC ms. */
  atUtcMs: number;
  /** What played: the start chime or Tune. */
  source: 'start' | 'tune';
  /** True when receive audio dropped by 10 dB or more; null when there was no audio to compare. */
  passed: boolean | null;
  /** Drop in receive level while the tone played, dB. */
  dropDb: number | null;
}

/** Receive audio drops at least this much while the radio transmits, dB. */
const KEYED_DROP_DB = 10;

function keyingResult(source: KeyingResult['source'], baseline: number | null, during: number | null): KeyingResult {
  if (baseline === null || during === null) return { atUtcMs: Date.now(), source, passed: null, dropDb: null };
  const drop = baseline - during;
  return { atUtcMs: Date.now(), source, passed: drop >= KEYED_DROP_DB, dropDb: drop };
}

function levelsBetween(fromMs: number, toMs: number): number | null {
  return median(levelLog.filter(([t]) => t >= fromMs && t <= toMs).map(([, db]) => db));
}

export const audio = $state({
  status: 'off' as AudioStatus,
  reason: null as StopReason | null,
  stoppedAtUtcMs: null as number | null,
  error: null as StartError | null,
  /** Smoothed RMS of the input, dBFS. */
  rmsDb: FLOOR_DB as number,
  /** Peak over the last second, dBFS. */
  peakDb: FLOOR_DB as number,
  report: null as CaptureReport | null,
  wake: 'off' as WakeState,
  /** The output device chosen, and why it does not play if it does not (lib/audio/sink.ts). */
  output: { sinkId: null, error: null } as OutputState,
});

export const recent = $state<{ slots: SlotSummary[] }>({ slots: [] });
/** Decoded slots, newest first, and the decoder's state. */
export const band = $state<{ slots: DecodedSlot[]; decoder: DecoderStatus }>({ slots: [], decoder: { state: 'idle' } });

/** A WSPR slot's decodes, or why it has none. */
export interface WsprSlotResult {
  startUtcMs: number;
  decodes: WsprDecode[];
  /** Time in the decoder, ms. */
  ms: number;
  /** The decoder was still busy with earlier slots, and this one was not decoded. */
  skipped?: boolean;
}

/** Band activity keeps the slots of the last hour, 240 of FT8; Operate draws them as its list scrolls. */
const KEEP_MS = 3_600_000;
/**
 * Tune, the keying check, and the slots RR73 transmitted in (UTC ms, oldest first). `tuneRefused`
 * says why the last Tune could not key the radio.
 */
export const tx = $state({ tuning: false, endsAtMs: 0, keying: null as KeyingResult | null, slots: [] as number[], tuneRefused: null as string | null });
const transmitted = new TransmittedSlots();
/** What RR73 sent in its recent slots, by slot start (UTC ms). */
const sentTx = new Map<number, SentTx>();
/** RR73's recent transmissions as decoded from the receive audio, newest first. */
let heardBack: HeardBack[] = [];
/** Transmissions kept for Your Tx, heard back. */
const HEARD_KEEP = 6;
/** Receive calibration from the DT of strong decodes; moves capture stamps only. */
const calibration = new RxCalibration();
/** Each mode's recent decode times and the slots the busy decoder skipped, for Timing. */
const decodeTimes = new DecodeTimes();

/**
 * The clock warning: how far the phone's clock is off by the decodes, s, positive slow, while it
 * is 1 s or more off (lib/clock/calibration.ts); null otherwise. It stays through gaps in the
 * decodes, and goes with another input: a web SDR's audio carries the relay's clock.
 */
export const clockCheck = $state({ offS: null as number | null });
const clockListeners = new Set<(offS: number) => void>();

/** Listens for the clock warning coming on. */
export function onClockWarning(fn: (offS: number) => void): () => void {
  clockListeners.add(fn);
  return () => clockListeners.delete(fn);
}

/**
 * Notes output from `fromUtcMs` to `toUtcMs`: the slots it overlaps hold RR73's own signal, so
 * their decodes are not shown. A transmission's slot is decoded for Your Tx, heard back.
 */
export function markTransmitted(fromUtcMs: number, toUtcMs: number, mode: SlotMode = hasSlots(settings.mode) ? settings.mode : 'FT8', sent?: SentTx) {
  transmitted.mark(fromUtcMs, toUtcMs, mode);
  if (sent) {
    sentTx.set(Math.floor(fromUtcMs / SLOT_MS[mode]) * SLOT_MS[mode], sent);
    if (sentTx.size > HEARD_KEEP) sentTx.delete(sentTx.keys().next().value!);
  }
  tx.slots = transmitted.list();
  if (band.slots.some((s) => transmitted.has(s.startUtcMs))) band.slots = band.slots.filter((s) => !transmitted.has(s.startUtcMs));
}

/** RR73's recent transmissions as the waterfall draws them, oldest first. */
let txWaves: TxWave[] = [];
const txWaveListeners = new Set<(w: TxWave) => void>();

/** Recent transmissions, oldest first, for a waterfall that starts now. */
export function recentTxWaves(): readonly TxWave[] {
  return txWaves;
}

/** Calls `fn` for each transmission to draw, and again when Halt cuts one short. Returns the unsubscribe. */
export function onTxWave(fn: (w: TxWave) => void): () => void {
  txWaveListeners.add(fn);
  return () => txWaveListeners.delete(fn);
}

function emitTxWave(w: TxWave) {
  txWaves = [...txWaves.filter((x) => x.startUtcMs !== w.startUtcMs), w].slice(-8);
  for (const fn of txWaveListeners) fn(w);
}

/**
 * Draws a transmission on the waterfall from its start. The audio is made again at 12 kHz for the
 * display: the same tones the radio sends, at the waterfall's rate.
 */
export async function showTx(startUtcMs: number, text: string, mode: Mode, f0Hz: number, skippedS = 0): Promise<void> {
  try {
    // A transmission that started part way through shows from there.
    const samples = (await codec().synthesize(text, mode, f0Hz, DISPLAY_RATE)).subarray(Math.round(skippedS * DISPLAY_RATE));
    emitTxWave({ startUtcMs, endUtcMs: startUtcMs + (samples.length / DISPLAY_RATE) * 1000, samples });
  } catch {
    // Without the audio the slot stays blank.
  }
}

/** Ends the transmission on the air at `atUtcMs` on the waterfall, after Halt or the end of Tune. */
export function cutTx(atUtcMs: number) {
  const w = txWaves.find((x) => atUtcMs > x.startUtcMs && atUtcMs < x.endUtcMs);
  if (w) emitTxWave({ ...w, endUtcMs: atUtcMs });
}

/** The Tune tone at 12 kHz for the waterfall. */
function toneWave(startUtcMs: number, hz: number, seconds: number): TxWave {
  const samples = new Float32Array(Math.round(seconds * DISPLAY_RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / DISPLAY_RATE);
  return { startUtcMs, endUtcMs: startUtcMs + seconds * 1000, samples };
}

let engine: CaptureEngine | null = null;
/** The practice band while it is on; null for the microphone. */
let inputSource: InputSource | null = null;
const output = new TransmitOutput();
let wake: WakeLockKeeper | null = null;
let assembler: SlotAssembler | null = null;
// 8 FT8 slots are 2 minutes and 5.8 MB; a WSPR slot is 2 minutes and 5.8 MB on its own.
const recorder = new SlotRecorder(8, { WSPR: 2 });
let decoder: DecoderClient = createDecoder();
band.decoder = decoder.status;
decoder.onStatus((st) => {
  band.decoder = st;
  if (st.state === 'ready') console.info(`RR73 decoder ${st.version} loaded in ${Math.round(st.loadMs)} ms`);
  if (st.state === 'failed') {
    console.warn(`RR73 decoder unavailable (${st.reason}): ${st.detail}`);
    // Receive carries on without decodes. The worker or the WebAssembly may be gone from the
    // server because a newer build replaced them.
    decoder = new NullDecoder(st);
    if (st.reason === 'worker' || st.reason === 'load') void noteLoadFailure();
  }
});
const chunkListeners = new Set<(c: Chunk) => void>();
const decodeListeners = new Set<(slotStartMs: number, decodes: Decode[], pass: 'early' | 'final' | 'late') => void>();
const wsprListeners = new Set<(r: WsprSlotResult) => void>();
/** The WSPR slot being decoded, UTC ms, or null. */
export const wsprDecoding = $state<{ startUtcMs: number | null }>({ startUtcMs: null });
const statusListeners = new Set<(s: AudioStatus) => void>();
const haltHooks = new Set<() => void>();
/** Recent input levels for the keying check: [performance.now() ms, RMS dBFS]. */
let levelLog: [number, number][] = [];
let peakHold: { db: number; at: number } = { db: FLOOR_DB, at: 0 };

/** The offset capture applies: the input source's own, or the radio's receive calibration. */
function inputOffsetS(): number {
  return inputSource ? (inputSource.offsetS ?? 0) : calibration.offsetS;
}

function getEngine(): CaptureEngine {
  if (engine) return engine;
  engine = new CaptureEngine(undefined, inputSource);
  engine.mapper.inputOffsetS = inputOffsetS();
  wake = new WakeLockKeeper();
  wake.onChange = (s) => (audio.wake = s);
  engine.onState((s) => {
    const changed = audio.status !== s.status;
    audio.status = s.status;
    if (changed) for (const l of statusListeners) l(s.status);
    audio.reason = s.reason;
    audio.stoppedAtUtcMs = s.stoppedAtUtcMs;
    audio.error = s.error;
    // The capture worklet may be gone from the server because a newer build replaced it.
    if (s.error === 'worklet' || s.error === 'busy' || s.error === 'unknown') void noteLoadFailure();
    if (s.status !== 'running' && s.status !== 'starting') {
      halt();
      const partial = assembler?.flush();
      if (partial) onSlot(partial);
      audio.rmsDb = FLOOR_DB;
      audio.peakDb = FLOOR_DB;
    }
    wake?.set(s.status === 'running' || tx.tuning);
    // Device names are readable once the microphone is allowed, and an output the browser refused
    // before then may be allowed now.
    if (changed && s.status === 'running') {
      void refindOutput().then(retryOutput);
      void refindInput();
    }
  });
  engine.onReport((r) => (audio.report = r));
  engine.onChunk(onChunk);
  engine.onOutput((o) => (audio.output = o));
  // Applies when the context is created, at the first tap that plays or captures.
  void engine.useOutput(chosenOutput());
  return engine;
}

/** The output device to play to: the one chosen, where the browser can choose one. */
function chosenOutput(): string | null {
  return outputChoiceSupported() ? settings.outputDeviceId : null;
}

function onChunk(c: Chunk) {
  const now = performance.now();
  // Power average over about 300 ms for a steady reading.
  const a = 1 - Math.exp(-((c.samples.length / 12000) * 1000) / 300);
  const p = 10 ** (audio.rmsDb / 10) + a * (10 ** (c.rmsDb / 10) - 10 ** (audio.rmsDb / 10));
  audio.rmsDb = Math.max(FLOOR_DB, 10 * Math.log10(p));
  if (c.peakDb >= peakHold.db || now - peakHold.at > 1000) peakHold = { db: c.peakDb, at: now };
  audio.peakDb = peakHold.db;
  levelLog.push([now, c.rmsDb]);
  if (levelLog.length > 600) levelLog = levelLog.slice(-400);

  // RTTY is continuous: its receiver takes the chunks (lib/state/keyboard.svelte.ts), with no slots.
  const mode = settings.mode;
  if (!hasSlots(mode)) {
    const partial = assembler?.flush();
    if (partial) onSlot(partial);
    assembler = null;
  } else {
    if (!assembler || assembler.mode !== mode) {
      const partial = assembler?.flush();
      if (partial) onSlot(partial);
      assembler = new SlotAssembler(mode, { earlyS: EARLY_S[mode], onEarly: onEarlySlot });
    }
    for (const slot of assembler.push(c)) onSlot(slot);
  }
  for (const l of chunkListeners) l(c);
}

function onSlot(slot: AssembledSlot) {
  recorder.add(slot);
  recent.slots = recorder.list().map(({ startUtcMs, mode, filled, lateStart, gap }) => ({ startUtcMs, mode, filled, lateStart, gap }));
  // A slot with less than half its audio cannot hold a whole FT8, FT4 or WSPR message.
  if (slot.filled < SLOT_SAMPLES[slot.mode] / 2 || !decoder.available) return;
  if (slot.mode === 'WSPR') {
    // A WSPR slot RR73 transmitted in holds its own signal: nothing to decode.
    if (!transmitted.has(slot.startUtcMs)) decodeWspr(slot);
    return;
  }
  const mode = slot.mode;
  if (transmitted.has(slot.startUtcMs)) {
    decodeOwn(slot);
    return;
  }
  const t0 = performance.now();
  // The decoder gets a copy: the recorder keeps the slot for Save slot. The QSO under way
  // lets it try weak messages with what it expects.
  decoder.decodeSlot({ mode, startUtcMs: slot.startUtcMs, samples: slot.samples.slice(), qso: qsoContext() ?? undefined }, (more) => addDecodes(slot.startUtcMs, more)).then(
    (decodes) => {
      const ms = performance.now() - t0;
      decodeTimes.add(mode, ms);
      deliverDecodes({ startUtcMs: slot.startUtcMs, mode, decodes, ms });
    },
    (e: unknown) => {
      if (!(e instanceof DecoderBusyError)) return;
      decodeTimes.skip();
      // The early pass's decodes stand for the slot; without them it was not decoded.
      const early = band.slots.find((s) => s.startUtcMs === slot.startUtcMs && s.early);
      if (early) deliverDecodes({ ...early, early: undefined });
      else keepSlot({ startUtcMs: slot.startUtcMs, mode, decodes: [], ms: 0, skipped: true });
    },
  );
}

/**
 * The early pass: decodes the first EARLY_S seconds of a slot while it is still being received,
 * so its messages show about 1.5 s sooner. Slots RR73 transmits in, and slots with less than half
 * that audio, have none. A busy decoder skips it: the full slot follows.
 */
function onEarlySlot(slot: EarlySlot) {
  if (slot.mode === 'WSPR' || slot.filled < slot.samples.length / 2 || !decoder.available || transmitted.has(slot.startUtcMs)) return;
  const mode = slot.mode;
  const t0 = performance.now();
  decoder.decodeSlot({ mode, startUtcMs: slot.startUtcMs, samples: slot.samples, qso: qsoContext() ?? undefined, partial: true }).then(
    (decodes) => deliverEarly({ startUtcMs: slot.startUtcMs, mode, decodes, ms: performance.now() - t0, early: true }),
    () => undefined,
  );
}

let qsoContext: () => QsoContext | null = () => null;

/** Gives the decoder the QSO under way at each slot, for a priori decoding: the sequencer's (qso.svelte.ts). */
export function provideQsoContext(fn: () => QsoContext | null) {
  qsoContext = fn;
}

/** Decodes a WSPR slot in the worker; its spots go to the WSPR listeners. */
function decodeWspr(slot: AssembledSlot) {
  wsprDecoding.startUtcMs = slot.startUtcMs;
  const done = () => {
    if (wsprDecoding.startUtcMs === slot.startUtcMs) wsprDecoding.startUtcMs = null;
  };
  const t0 = performance.now();
  decoder.decodeWspr(slot.samples.slice()).then(
    ({ decodes, ms }) => {
      done();
      console.info(`RR73 WSPR slot ${new Date(slot.startUtcMs).toISOString().slice(11, 16)} decoded in ${Math.round(ms)} ms: ${decodes.length} spots`);
      decodeTimes.add('WSPR', performance.now() - t0);
      deliverWspr({ startUtcMs: slot.startUtcMs, decodes, ms });
    },
    (e: unknown) => {
      done();
      if (!(e instanceof DecoderBusyError)) return;
      decodeTimes.skip();
      deliverWspr({ startUtcMs: slot.startUtcMs, decodes: [], ms: 0, skipped: true });
    },
  );
}

/** A WSPR slot's decodes, to the listeners (the WSPR runtime). The decoder's path, and the review build's. */
export function deliverWspr(r: WsprSlotResult) {
  if (transmitted.has(r.startUtcMs)) return;
  for (const l of wsprListeners) l(r);
}

/** Listens to each WSPR slot's decodes as they arrive. */
export function onWsprDecoded(fn: (r: WsprSlotResult) => void): () => void {
  wsprListeners.add(fn);
  return () => wsprListeners.delete(fn);
}

/** Decodes a slot RR73 transmitted in, for Your Tx, heard back. Its decodes are never shown. */
function decodeOwn(slot: AssembledSlot) {
  const sent = sentTx.get(slot.startUtcMs);
  if (!sent) return;
  decoder.decodeSlot({ mode: slot.mode, startUtcMs: slot.startUtcMs, samples: slot.samples.slice() }).then(
    (decodes) => noteHeardBack(slot.startUtcMs, sent, decodes),
    () => undefined,
  );
}

/** Records whether a transmission came back in its slot's decodes, and at what DT. */
export function noteHeardBack(slotStartUtcMs: number, sent: SentTx, decodes: Decode[]) {
  const own = findOwnDecode(sent, decodes);
  const entry: HeardBack = { slotStartUtcMs, text: sent.text, dtS: own?.dt_s ?? null, snrDb: own?.snr_db ?? null };
  heardBack = [entry, ...heardBack.filter((h) => h.slotStartUtcMs !== slotStartUtcMs)].slice(0, HEARD_KEEP);
}

/** Feeds a slot's decodes to the receive calibration and applies the offset to capture. */
function calibrate(entry: DecodedSlot) {
  // The practice band has no radio path to calibrate, and must not move the radio's correction.
  if (entry.skipped || inputSource) return;
  calibration.add(entry.startUtcMs, entry.decodes, Date.now());
  if (engine) engine.mapper.inputOffsetS = calibration.offsetS;
  const clockS = calibration.clockS;
  if (clockS === null) return;
  const before = clockCheck.offS !== null;
  const warns = clockWarns(clockS, before);
  clockCheck.offS = warns ? clockS : null;
  if (warns && !before) for (const l of clockListeners) l(clockS);
}

/** Timing measurements for Settings › Radio and audio and the timing report. */
export function timingSnapshot(): TimingSnapshot {
  const e = engine;
  const running = audio.status === 'running';
  return {
    atUtcMs: Date.now(),
    appVersion: `${__APP_VERSION__} (${__APP_BUILD__})`,
    audio: audio.status,
    source: running ? (e?.clockSource ?? null) : null,
    offsetMs: running ? (e?.mappingOffsetMs() ?? null) : null,
    driftPpm: running ? (e?.mapper.driftPpm ?? null) : null,
    captureLagMs: running ? (e?.timing.captureLagMs ?? null) : null,
    gaps: e?.timing.gaps ?? 0,
    gapMs: (e?.timing.gapS ?? 0) * 1000,
    inputOffsetS: calibration.offsetS,
    medianDtS: calibration.medianDtS,
    clockS: calibration.clockS,
    strongDecodes: calibration.count,
    heardBack: heardBack.map((h) => ({ ...h })),
    decodeTimes: decodeTimes.summary(),
    skippedSlots: decodeTimes.skipped,
    resumes: e?.timing.resumes ?? [],
    readings: e?.timing.readings ?? [],
    observations: e?.mapper.observations ?? [],
  };
}

function keepSlot(entry: DecodedSlot) {
  const slots = [entry, ...band.slots.filter((s) => s.startUtcMs !== entry.startUtcMs)].sort((a, b) => b.startUtcMs - a.startUtcMs);
  band.slots = slots.filter((s) => s.startUtcMs > slots[0].startUtcMs - KEEP_MS);
}

/** The newest slot Clear decodes took out of the list, while later decoder stages may still add to it. */
let clearedSlot: DecodedSlot | null = null;

/**
 * Clear decodes: empties the decode list. Slots decoded after this appear as usual. What later
 * decoder stages find in a cleared slot still reaches the sequencer, and stays out of the list.
 * Saved slots, Your Tx heard back and the receive calibration keep their data.
 */
export function clearDecodes() {
  clearedSlot = band.slots[0] ?? null;
  band.slots = [];
}

/**
 * The early pass's decodes of a slot still being received: into the decode list, then to the
 * listeners as the `early` pass. Nothing once the full slot's decodes are in.
 */
export function deliverEarly(entry: DecodedSlot) {
  if (transmitted.has(entry.startUtcMs)) return;
  const listed = band.slots.find((s) => s.startUtcMs === entry.startUtcMs);
  if (listed && !listed.early) return;
  keepSlot({ ...entry, early: true });
  for (const l of decodeListeners) l(entry.startUtcMs, entry.decodes, 'early');
}

/**
 * The full slot's decodes after the early pass's: those rows stay where they are, with the
 * full slot's SNR, DT and frequency; new messages follow them. A message only the early pass
 * found stays.
 */
export function mergeDecodes(early: readonly Decode[], full: readonly Decode[]): Decode[] {
  const byText = new Map(full.map((d) => [d.text, d]));
  const seen = new Set(early.map((d) => d.text));
  return [...early.map((d) => byText.get(d.text) ?? d), ...full.filter((d) => !seen.has(d.text))];
}

/**
 * A slot's decodes: into the decode list, then to the listeners (the sequencer) as the `final`
 * pass, joined to the early pass's when it ran. The decoder's path, and the screen-review
 * build's (lib/testing/e2e-hooks.ts).
 */
export function deliverDecodes(entry: DecodedSlot) {
  if (transmitted.has(entry.startUtcMs)) return;
  const listed = band.slots.find((s) => s.startUtcMs === entry.startUtcMs && s.early);
  // Cleared after its early pass: the sequencer still gets the slot, the list does not.
  const cleared = !listed && clearedSlot?.startUtcMs === entry.startUtcMs && clearedSlot.early ? clearedSlot : null;
  const early = listed ?? cleared;
  const merged: DecodedSlot = early ? { ...entry, decodes: mergeDecodes(early.decodes, entry.decodes), early: undefined } : entry;
  if (cleared) clearedSlot = merged;
  else keepSlot(merged);
  for (const l of decodeListeners) l(entry.startUtcMs, merged.decodes, 'final');
  calibrate(entry);
}

/**
 * Adds what the later decoder stages found in a slot already delivered: to the decode list, and
 * to the listeners as a later pass of the slot. These come up to DEEP.budgetMs after decoding
 * started. The receive calibration keeps to the slot's first decodes, which carry its timing.
 */
export function addDecodes(startUtcMs: number, decodes: Decode[]) {
  const listed = band.slots.find((s) => s.startUtcMs === startUtcMs);
  const entry = listed ?? (clearedSlot?.startUtcMs === startUtcMs ? clearedSlot : null);
  if (!entry || transmitted.has(startUtcMs)) return;
  const fresh = decodes.filter((d) => !entry.decodes.some((e) => e.text === d.text));
  if (!fresh.length) return;
  const grown = { ...entry, decodes: [...entry.decodes, ...fresh] };
  if (listed) keepSlot(grown);
  else clearedSlot = grown;
  for (const l of decodeListeners) l(startUtcMs, fresh, 'late');
}

/**
 * Listens to each slot's decodes as they arrive (the sequencer): the early pass's before the
 * slot ends as `early`, the slot's decodes when it ends as `final` (the early pass's included),
 * then what later decoder stages add as `late` passes.
 */
export function onSlotDecoded(fn: (slotStartMs: number, decodes: Decode[], pass: 'early' | 'final' | 'late') => void): () => void {
  decodeListeners.add(fn);
  return () => decodeListeners.delete(fn);
}

/** Listens to changes of the audio status. */
export function onAudioStatus(fn: (s: AudioStatus) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/** Adds to what Halt stops (the transmit scheduler). */
export function onHalt(fn: () => void): () => void {
  haltHooks.add(fn);
  return () => haltHooks.delete(fn);
}

/**
 * The running audio context and its clock mapper, for the transmit schedulers; null while audio is
 * not running. For a moment after audio starts the mapper has no observation yet: the schedulers
 * time their wait by the page's clock then and need the mapping only at the pre-roll
 * (lib/tx/scheduler.ts), so a CQ tapped at once still goes out in its slot.
 */
export function audioOut(): { ctx: AudioContext; mapper: AudioClockMapper } | null {
  return runningOutput(engine?.context ?? null, engine?.mapper ?? null, audio.status);
}

/** audioOut's rule apart from the engine: the context and mapper while audio runs, mapped or not. */
export function runningOutput(ctx: AudioContext | null, mapper: AudioClockMapper | null, status: AudioStatus): { ctx: AudioContext; mapper: AudioClockMapper } | null {
  return ctx && mapper && status === 'running' ? { ctx, mapper } : null;
}

/** The running audio context, for output that needs no clock mapping (a keyboard mode's stream). */
export function outputContext(): AudioContext | null {
  const ctx = engine?.context;
  return ctx && audio.status === 'running' ? ctx : null;
}

/** The wasm client, for encoding transmissions. */
export function codec(): DecoderClient {
  return decoder;
}

/** Listens to the 12 kHz capture stream (the waterfall). */
export function onAudioChunk(fn: (c: Chunk) => void): () => void {
  chunkListeners.add(fn);
  return () => chunkListeners.delete(fn);
}

let startToneUri: { level: number; uri: string } | null = null;

/**
 * Plays the start chime, or silence when it is off, through a media element. Both stop iOS from
 * muting output on the silent switch; the tone also keys the radio for the keying check.
 * Returns when the tone starts, as performance.now() ms, or null when no tone plays.
 */
function playStartClip(): number | null {
  // With rig control keying the radio, the chime has nothing to key: RR73 keys by PTT, and the
  // radio's OK replaces the keying check. It plays silence for iOS's sake.
  if (!settings.startTone || txLevel(1) === 0 || txKeyer() !== null) {
    playClip(silentClipUri(), document, undefined, chosenOutput());
    return null;
  }
  if (startToneUri?.level !== settings.outputLevel) {
    startToneUri = { level: settings.outputLevel, uri: wavDataUri(startToneSamples(settings.outputLevel)) };
  }
  return playClip(startToneUri.uri, document, undefined, chosenOutput()) + START_TONE.leadS * 1000;
}

/** Compares receive level before and during the start chime once it has played. */
function checkKeyingAt(toneStartMs: number) {
  const toneMs = START_TONE.toneS * 1000;
  const wait = Math.max(0, toneStartMs + toneMs + 300 - performance.now());
  setTimeout(() => {
    const baseline = levelsBetween(toneStartMs - 1000, toneStartMs - 100);
    const during = levelsBetween(toneStartMs + 150, toneStartMs + toneMs - 50);
    tx.keying = keyingResult('start', baseline, during);
  }, wait);
}

/**
 * Starts audio, and loads the decoder the first time. Call from a tap: the start clip must play
 * inside it. A chosen input the browser lists under a new ID is found by its name and started.
 */
export function startAudio() {
  const toneAt = playStartClip();
  decoder.load();
  const started = getEngine().start(settings.inputDeviceId).then(orRefound);
  // The practice band has no radio to key.
  if (toneAt !== null && !practice.on) checkKeyingAt(toneAt);
  return started;
}

/**
 * Replaces the microphone with another input (the practice band, a web SDR), or null to go back
 * to it. Capture from the old input stops at once; startAudio() opens the new one. The same input
 * again changes nothing.
 */
export function setInputSource(src: InputSource | null) {
  if (src === inputSource) return;
  inputSource = src;
  if (src) clockCheck.offS = null;
  engine?.useSource(src);
  if (engine) engine.mapper.inputOffsetS = inputOffsetS();
}

/**
 * Resumes audio after an interruption. Call from a tap. An input that ended and came back under a
 * new ID, as after its USB cable moved to another port, is found by its name and started.
 */
export function resumeAudio() {
  playClip(silentClipUri());
  return getEngine().resume().then(orRefound);
}

/** A start that found no input under the saved ID tries again with the ID the input's name has now. */
async function orRefound(st: EngineState): Promise<EngineState> {
  if (st.status !== 'failed' || st.error !== 'no-device') return st;
  const id = await refindInput();
  return id === null ? st : getEngine().start(id);
}

/** Switches the input device. Call from a change event. Another input has its own latency, so the receive calibration starts over. */
export function useInput(deviceId: string | null) {
  calibration.reset();
  getEngine().mapper.inputOffsetS = inputOffsetS();
  return getEngine().useInput(deviceId);
}

export async function inputDevices(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
}

/**
 * Finds the chosen input again by its name when the browser lists it under a new ID, as Chromium
 * does after cleared site data, and saves the new ID. Returns it, or null when nothing changed.
 * Names are readable once the microphone is allowed.
 */
export async function refindInput(): Promise<string | null> {
  const saved = settings.inputDeviceId;
  if (!saved || !settings.inputDeviceLabel || typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return null;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const id = matchInput(devices, saved, settings.inputDeviceLabel);
  if (id === saved || settings.inputDeviceId !== saved || !inputChoices(devices).some((d) => d.deviceId === id)) return null;
  await updateSettings({ inputDeviceId: id });
  return id;
}

/** The audio outputs the browser lists; none where it cannot choose one (Safari). */
export async function outputDevices(): Promise<MediaDeviceInfo[]> {
  if (!outputChoiceSupported() || typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  return outputChoices(await navigator.mediaDevices.enumerateDevices());
}

/**
 * Switches the output device, or to the system default for null. Halts Tune and any transmission
 * first, so none moves between devices. Call from a change event.
 */
export function useOutput(deviceId: string | null): Promise<OutputState> {
  halt();
  // Picked from the list, so it is there.
  outputSeen.listed = true;
  return getEngine().useOutput(deviceId);
}

/**
 * Finds the chosen output again by its name when the browser lists it under a new ID (another USB
 * port, cleared site data, a private window), saves the new ID and switches to it.
 */
export async function refindOutput(): Promise<void> {
  const saved = settings.outputDeviceId;
  if (!saved || !outputChoiceSupported() || typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
  const id = matchOutput(await navigator.mediaDevices.enumerateDevices(), saved, settings.outputDeviceLabel);
  if (id === saved || settings.outputDeviceId !== saved) return;
  await updateSettings({ outputDeviceId: id });
  if (engine && engine.output.sinkId !== id) {
    halt();
    outputSeen.listed = true;
    await engine.useOutput(id);
  }
}

/**
 * Applies the chosen output again after the browser refused it or could not find it, as when the
 * context switched to it before the microphone was allowed. Only Tune plays before audio runs, and
 * it stops before the output moves.
 */
async function retryOutput(): Promise<void> {
  const e = engine;
  if (!e || !outputChoiceSupported()) return;
  const { sinkId, error } = e.output;
  if (sinkId === null || (error !== 'failed' && error !== 'missing')) return;
  if (tx.tuning) halt();
  outputSeen.listed = true;
  await e.useOutput(sinkId);
}

/** Saves a recent slot through the share sheet, or returns download links. Call from a tap. */
export function saveRecentSlot(startUtcMs: number): Promise<SaveResult> | null {
  const slot = recorder.get(startUtcMs);
  if (!slot) return null;
  const files = slotFiles(slot, {
    dialHz: dialNow(operatingDialHz(settings.band, slot.mode, settings.houndBands.includes(settings.band), settings.houndDialHz, settings.ftDialHz)) ?? 0,
    input: audio.report?.inputLabel ?? 'Microphone',
    captureRateHz: audio.report?.contextRate ?? 0,
    appVersion: `${__APP_VERSION__} (${__APP_BUILD__})`,
    offsetS: engine?.mapper.inputOffsetS ?? 0,
  });
  return saveSlot(files);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** Bumped by every Tune and Halt, so a Tune still waiting for the radio's OK gives way. */
let tuneGen = 0;
/** PTT held for a Tune still waiting for the radio's OK. */
let tuneKeying: Keying | null = null;

/**
 * Plays the Tune tone at the Tx frequency (`hz`; FT8 and FT4's by default) for 10 s. Call from the
 * tap. With rig control keying the radio: PTT on, the radio's OK, and the tone 0.1 s later; without
 * an OK no tone plays and the status line says why. In FT8 and FT4 with Keep Tx audio centred on,
 * the dial shifts as for a transmission there, and the tone plays at `hz` minus the shift: the
 * carrier goes out on the Tx frequency's RF.
 */
export function startTune(hz: number = settings.txHz) {
  playClip(silentClipUri(), document, undefined, chosenOutput());
  const e = getEngine();
  const ctx = e.ensureContext();
  const gen = ++tuneGen;
  tuneKeying?.release();
  tuneKeying = null;
  tx.tuneRefused = null;
  const why = tuneGate();
  if (why) {
    refuseTune(why);
    return;
  }
  const keyer = txKeyer();
  if (!keyer) {
    playTune(ctx, hz, null);
    return;
  }
  output.halt();
  const shiftHz = txShiftHz(settings.mode, hz);
  const dialMs = shiftHz !== 0 ? DIAL_TIMEOUT_MS : 0;
  tx.tuning = true;
  tx.endsAtMs = performance.now() + dialMs + PTT_TIMEOUT_MS + PTT_SETTLE_MS + TUNE.seconds * 1000;
  wake?.set(true);
  const maxMs = dialMs + PTT_TIMEOUT_MS + PTT_SETTLE_MS + TUNE.seconds * 1000 + tailMs(ctx) + 1000;
  const k = shiftHz !== 0 ? keyer.key(maxMs, shiftHz) : keyer.key(maxMs);
  tuneKeying = k;
  void k.result.then(async (answer) => {
    if (gen !== tuneGen) return k.release();
    if (answer !== 'ok') {
      tuneKeying = null;
      k.release();
      tx.tuning = false;
      refuseTune(keyFailedText(answer));
      return;
    }
    await pause(PTT_SETTLE_MS);
    if (gen !== tuneGen) return k.release();
    tuneKeying = null;
    // PTT taken back during the wait (a fault, the link gone): no tone without it.
    if (!k.held) {
      k.release();
      tx.tuning = false;
      refuseTune(STATUS.pttTaken);
      return;
    }
    // The context made at the tap switches to the chosen output as it starts: a refusal since then
    // leaves the tone with nowhere to go but another device.
    const late = tuneGate();
    if (late) {
      k.release();
      tx.tuning = false;
      refuseTune(late);
      return;
    }
    playTune(ctx, hz, k, hz - shiftHz);
  });
}

function refuseTune(text: string) {
  tx.tuneRefused = text;
  radioNotice(text);
}

/** The Tune tone itself, with PTT released when it ends. `toneHz`: the audio played, `hz` less a dial shift. */
function playTune(ctx: AudioContext, hz: number, keying: Keying | null, toneHz = hz) {
  const now = Date.now();
  markTransmitted(now, now + TUNE.seconds * 1000);
  emitTxWave(toneWave(now, hz, TUNE.seconds));
  const t0 = performance.now();
  const baseline = audio.status === 'running' ? median(levelLog.filter(([t]) => t > t0 - 2000).map(([, db]) => db)) : null;
  const handle = output.tune(ctx, { ...TUNE, hz: toneHz, level: txLevel(settings.outputLevel) });
  tx.tuning = true;
  tx.endsAtMs = handle.endsAtMs;
  wake?.set(true);
  void handle.done.then((end: TuneEnd) => {
    keying?.release(end === 'finished' ? tailMs(ctx) : 0);
    tx.tuning = false;
    cutTx(Date.now());
    wake?.set(audio.status === 'running');
    const during = median(levelLog.filter(([t]) => t > t0 + 1000).map(([, db]) => db));
    const long = performance.now() - t0 > 3000;
    if (baseline !== null && during !== null && long) tx.keying = keyingResult('tune', baseline, during);
    else if (end === 'finished') tx.keying = keyingResult('tune', null, null);
  });
}

/** Stops all output at once: Tune and any transmission, and with them PTT (the hooks). */
export function halt() {
  tuneGen++;
  if (tuneKeying) {
    tuneKeying.release();
    tuneKeying = null;
    tx.tuning = false;
  }
  output.halt();
  for (const h of haltHooks) h();
}

/** True while audio runs, Tune plays or RR73 holds PTT: a reload would interrupt the operator. */
export function busy(): boolean {
  return audio.status === 'running' || audio.status === 'starting' || tx.tuning || rig.keyed;
}

if (typeof document !== 'undefined') {
  // Desktop Chromium keeps receiving in a hidden page, and the transmit timers keep time there
  // (lib/clock/wake.ts, docs/decisions/0010-hidden-window.md), so Tx carries on. Elsewhere hiding
  // stops capture, and output with it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !capturesHidden(navigator)) halt();
  });
  window.addEventListener('pagehide', () => halt());
}

// The chosen output going (a radio switched off) halts any transmission, so none carries on
// through another device; its return, or any device change after the browser refused it, switches
// back to it. State, so the Tx output for CAT keying follows it.
const outputSeen = $state({ listed: true });

// Keying by CAT, a transmission goes only to the chosen output (lib/state/radio.svelte.ts).
provideTxOutput(() => {
  if (!outputChoiceSupported()) return 'ok';
  const chosen = settings.outputDeviceId;
  if (chosen === null) return 'default';
  const { sinkId, error } = audio.output;
  if (error === 'missing' || !outputSeen.listed) return 'missing';
  if (error !== null) return 'refused';
  return sinkId === chosen ? 'ok' : 'switching';
});

if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
  const md = navigator.mediaDevices;
  md.addEventListener('devicechange', async () => {
    if (!engine || !outputChoiceSupported()) return;
    await refindOutput();
    const { sinkId, error } = engine.output;
    const devices = await md.enumerateDevices().catch(() => []);
    const change = outputChange(sinkId, outputSeen.listed, devices, error);
    if (change === null) return;
    outputSeen.listed = change === 'back';
    halt();
    if (change === 'back') void engine.useOutput(sinkId);
  });
}
