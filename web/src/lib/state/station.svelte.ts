/**
 * The running station: audio capture, slots, decodes and Tune, as reactive state for the
 * screens. Capture chunks flow to the slot assembler (then the recorder and the decoder) and to
 * whoever listens for the waterfall.
 *
 * Transmit safety: only Tune plays, and output halts when audio stops, when the page is hidden
 * or closed, and on Halt.
 */

import { CaptureEngine, type Chunk, type StartError, type StopReason, type AudioStatus } from '../audio/engine';
import { START_TONE, playClip, silentClipUri, startToneSamples, wavDataUri } from '../audio/unlock';
import { FLOOR_DB } from '../audio/level';
import { TransmitOutput, TUNE, type TuneEnd } from '../audio/output';
import type { CaptureReport } from '../audio/report';
import { WakeLockKeeper, type WakeState } from '../audio/wakelock';
import { SLOT_SAMPLES, type Mode } from '../clock/slots';
import { NullDecoder } from '../decode/null-client';
import type { Decode, DecoderClient, DecoderStatus } from '../decode/types';
import { DecoderBusyError, createDecoder } from '../decode/worker-client';
import { dialHz } from '../radio/bands';
import { SlotAssembler, type AssembledSlot } from '../slots/assembler';
import { SlotRecorder, slotFiles } from '../slots/recorder';
import { saveSlot, type SaveResult } from '../slots/share';
import { settings } from './settings.svelte';
import { noteLoadFailure } from '../app/update.svelte';

export interface SlotSummary {
  startUtcMs: number;
  mode: Mode;
  filled: number;
  lateStart: boolean;
  gap: boolean;
}

export interface DecodedSlot {
  startUtcMs: number;
  mode: Mode;
  decodes: Decode[];
  /** Time from handing the slot to the decoder to its decodes, ms. */
  ms: number;
  /** True when the decoder was still busy with earlier slots and this one was not decoded. */
  skipped?: boolean;
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
});

export const recent = $state<{ slots: SlotSummary[] }>({ slots: [] });
/** Decoded slots, newest first, and the decoder's state. */
export const band = $state<{ slots: DecodedSlot[]; decoder: DecoderStatus }>({ slots: [], decoder: { state: 'idle' } });

/** Slots kept in the decode list: 2 minutes of FT8. */
const KEEP_SLOTS = 8;
export const tx = $state({ tuning: false, endsAtMs: 0, keying: null as KeyingResult | null });

let engine: CaptureEngine | null = null;
const output = new TransmitOutput();
let wake: WakeLockKeeper | null = null;
let assembler: SlotAssembler | null = null;
const recorder = new SlotRecorder(8);
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
/** Recent input levels for the keying check: [performance.now() ms, RMS dBFS]. */
let levelLog: [number, number][] = [];
let peakHold: { db: number; at: number } = { db: FLOOR_DB, at: 0 };

function getEngine(): CaptureEngine {
  if (engine) return engine;
  engine = new CaptureEngine();
  wake = new WakeLockKeeper();
  wake.onChange = (s) => (audio.wake = s);
  engine.onState((s) => {
    audio.status = s.status;
    audio.reason = s.reason;
    audio.stoppedAtUtcMs = s.stoppedAtUtcMs;
    audio.error = s.error;
    // The capture worklet may be gone from the server because a newer build replaced it.
    if (s.error === 'worklet' || s.error === 'busy' || s.error === 'unknown') void noteLoadFailure();
    if (s.status !== 'running' && s.status !== 'starting') {
      output.halt();
      const partial = assembler?.flush();
      if (partial) onSlot(partial);
      audio.rmsDb = FLOOR_DB;
      audio.peakDb = FLOOR_DB;
    }
    wake?.set(s.status === 'running' || tx.tuning);
  });
  engine.onReport((r) => (audio.report = r));
  engine.onChunk(onChunk);
  return engine;
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

  if (!assembler || assembler.mode !== settings.mode) {
    const partial = assembler?.flush();
    if (partial) onSlot(partial);
    assembler = new SlotAssembler(settings.mode);
  }
  for (const slot of assembler.push(c)) onSlot(slot);
  for (const l of chunkListeners) l(c);
}

function onSlot(slot: AssembledSlot) {
  recorder.add(slot);
  recent.slots = recorder.list().map(({ startUtcMs, mode, filled, lateStart, gap }) => ({ startUtcMs, mode, filled, lateStart, gap }));
  // A slot with less than half its audio cannot hold a whole FT8 or FT4 message.
  if (slot.filled < SLOT_SAMPLES[slot.mode] / 2 || !decoder.available) return;
  const t0 = performance.now();
  const keep = (entry: DecodedSlot) => {
    band.slots = [entry, ...band.slots.filter((s) => s.startUtcMs !== entry.startUtcMs)].sort((a, b) => b.startUtcMs - a.startUtcMs).slice(0, KEEP_SLOTS);
  };
  // The decoder gets a copy: the recorder keeps the slot for Save slot.
  decoder.decodeSlot({ mode: slot.mode, startUtcMs: slot.startUtcMs, samples: slot.samples.slice() }).then(
    (decodes) => keep({ startUtcMs: slot.startUtcMs, mode: slot.mode, decodes, ms: performance.now() - t0 }),
    (e: unknown) => {
      if (e instanceof DecoderBusyError) keep({ startUtcMs: slot.startUtcMs, mode: slot.mode, decodes: [], ms: 0, skipped: true });
    },
  );
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
  if (!settings.startTone) {
    playClip(silentClipUri());
    return null;
  }
  if (startToneUri?.level !== settings.outputLevel) {
    startToneUri = { level: settings.outputLevel, uri: wavDataUri(startToneSamples(settings.outputLevel)) };
  }
  return playClip(startToneUri.uri) + START_TONE.leadS * 1000;
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

/** Starts audio, and loads the decoder the first time. Call from a tap: the start clip must play inside it. */
export function startAudio() {
  const toneAt = playStartClip();
  decoder.load();
  const started = getEngine().start(settings.inputDeviceId);
  if (toneAt !== null) checkKeyingAt(toneAt);
  return started;
}

/** Resumes audio after an interruption. Call from a tap. */
export function resumeAudio() {
  playClip(silentClipUri());
  return getEngine().resume();
}

/** Switches the input device. Call from a change event. */
export function useInput(deviceId: string | null) {
  return getEngine().useInput(deviceId);
}

export async function inputDevices(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
}

/** Saves a recent slot through the share sheet, or returns download links. Call from a tap. */
export function saveRecentSlot(startUtcMs: number): Promise<SaveResult> | null {
  const slot = recorder.get(startUtcMs);
  if (!slot) return null;
  const files = slotFiles(slot, {
    dialHz: dialHz(settings.band, slot.mode) ?? 0,
    input: audio.report?.inputLabel ?? 'Microphone',
    captureRateHz: audio.report?.contextRate ?? 0,
    appVersion: __APP_VERSION__,
    offsetS: engine?.mapper.offsetS ?? 0,
  });
  return saveSlot(files);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** Plays the Tune tone (1500 Hz, 10 s). Call from the confirming tap. */
export function startTune() {
  playClip(silentClipUri());
  const e = getEngine();
  const ctx = e.ensureContext();
  const t0 = performance.now();
  const baseline = audio.status === 'running' ? median(levelLog.filter(([t]) => t > t0 - 2000).map(([, db]) => db)) : null;
  const handle = output.tune(ctx, { ...TUNE, level: settings.outputLevel });
  tx.tuning = true;
  tx.endsAtMs = handle.endsAtMs;
  wake?.set(true);
  void handle.done.then((end: TuneEnd) => {
    tx.tuning = false;
    wake?.set(audio.status === 'running');
    const during = median(levelLog.filter(([t]) => t > t0 + 1000).map(([, db]) => db));
    const long = performance.now() - t0 > 3000;
    if (baseline !== null && during !== null && long) tx.keying = keyingResult('tune', baseline, during);
    else if (end === 'finished') tx.keying = keyingResult('tune', null, null);
  });
}

/** Stops all output at once. */
export function halt() {
  output.halt();
}

/** True while audio runs or Tune plays: a reload would interrupt the operator. */
export function busy(): boolean {
  return audio.status === 'running' || audio.status === 'starting' || tx.tuning;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') output.halt();
  });
  window.addEventListener('pagehide', () => output.halt());
}
