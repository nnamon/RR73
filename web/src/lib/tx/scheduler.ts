/**
 * Executes the sequencer's transmit effects on the audio clock. A transmission is synthesised
 * at the output rate as soon as it is decided, then handed to the audio graph 0.5 s before it
 * starts, with the clock mapping of that moment: the audio clock can drift against UTC, and a
 * sound scheduled 15 s ahead would carry that drift into its start. It starts at slot + offset
 * (0.5 s in FT8 and FT4, 1 s in WSPR, or later for a late start). A late start up to the shift
 * limit plays the whole message; later than that the message keeps its place in the slot and
 * leaves out its first part. A start that would come more than the late-start limit after the
 * nominal start is reported as missed. Halt stops the sound within one render quantum (128
 * frames).
 *
 * Transmitting needs running audio, a callsign and a grid; otherwise the request is refused.
 * The scheduler plays through the output only while it transmits.
 */

import type { SlotMode as Mode } from '../clock/slots';
import { LATE_S, SHIFT_LIMIT_S } from '../qso/sequencer';

/** Where a transmission starts in its slot, s. */
export const NOMINAL_S: Record<Mode, number> = { FT8: 0.5, FT4: 0.5, WSPR: 1 };
/** How late after the nominal start a transmission may still start, s. WSPR decoders take DT up to 2 s and more. */
const LATE_LIMIT_S: Record<Mode, number> = { ...LATE_S, WSPR: 1 };
/**
 * Up to this many seconds after the nominal start a late transmission goes out whole. Later, it
 * keeps its place in the slot and leaves out its first part, so it ends on time and its DT stays
 * near 0 (docs/design/sequencer.md, late start). WSPR always goes out whole.
 */
export const SHIFT_S: Record<Mode, number> = { ...SHIFT_LIMIT_S, WSPR: Infinity };
/** Fade-in where a transmission starts part way through, s: no click on the air. */
const CUT_FADE_S = 0.005;

/** `samples` from `skip` on, faded in over `fade` samples. */
export function cutStart(samples: Float32Array, skip: number, fade: number): Float32Array {
  const out = samples.slice(Math.min(skip, samples.length));
  const n = Math.min(fade, out.length);
  for (let i = 0; i < n; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
  return out;
}

/** The audio clock and output, behind an interface so tests can run on a fake clock. */
export interface TxAudio {
  readonly sampleRate: number;
  /** Audio-clock time, s. */
  readonly currentTime: number;
  /** Audio-clock time at which a sound started now is heard at `utcMs`, or null without a clock mapping. */
  toContextTime(utcMs: number): number | null;
  /** UTC ms at which audio-clock time `t` is heard. */
  toUtcMs(t: number): number | null;
  /** Plays `samples` at audio-clock time `when` with gain `level`. */
  play(samples: Float32Array, when: number, level: number): Playing;
}

export interface Playing {
  /** Fades out over one render quantum from now and stops. */
  stop(): void;
  onended: (() => void) | null;
}

export interface Encoder {
  synthesize(text: string, mode: Mode, f0Hz: number, sampleRate: number): Promise<Float32Array>;
}

export interface TxRequest {
  text: string;
  mode: Mode;
  slotStartMs: number;
  /** Start after the slot start, s. */
  startOffsetS: number;
  f0Hz: number;
  /** Output gain, 0 to 1. */
  level: number;
}

export type TxReport =
  /** `skippedS`: seconds left out of the start of a transmission that started part way through. */
  | { type: 'started'; slotStartMs: number; text: string; startUtcMs: number; lateS: number; skippedS: number }
  | { type: 'ended'; slotStartMs: number; text: string; complete: boolean }
  | { type: 'missed'; slotStartMs: number; text: string; reason: 'late' | 'encode' | 'busy' }
  | { type: 'refused'; slotStartMs: number; text: string; reason: string };

/** Earliest start after now, s: room for the audio thread to pick the node up. */
const MIN_LEAD_S = 0.02;
/** How long before its start a transmission goes to the audio graph, ms. */
export const PRE_ROLL_MS = 500;

export class TxScheduler {
  private readonly audio: () => TxAudio | null;
  private readonly encoder: Encoder;
  private readonly gate: () => string | null;
  private readonly report: (r: TxReport) => void;
  private readonly timer: (fn: () => void, ms: number) => unknown;
  private readonly clear: (h: unknown) => void;
  /** Bumped by cancel and halt so a synthesis still running is dropped when it finishes. */
  private generation = 0;
  private playing: { slotStartMs: number; text: string; when: number; skippedS: number; handle: Playing; started: boolean; startTimer: unknown } | null = null;
  /** The wait before a transmission goes to the audio graph; resolved early by cancel and halt. */
  private preroll: { timer: unknown; release: () => void } | null = null;

  constructor(opts: {
    audio: () => TxAudio | null;
    encoder: Encoder;
    /** Why transmitting is not allowed now (audio stopped, no callsign), or null. */
    gate: () => string | null;
    report: (r: TxReport) => void;
    timer?: (fn: () => void, ms: number) => unknown;
    clear?: (h: unknown) => void;
  }) {
    this.audio = opts.audio;
    this.encoder = opts.encoder;
    this.gate = opts.gate;
    this.report = opts.report;
    this.timer = opts.timer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clear = opts.clear ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** True while a transmission is waiting, scheduled or playing. */
  get busy(): boolean {
    return this.playing !== null || this.preroll !== null;
  }

  async schedule(req: TxRequest): Promise<void> {
    const gen = ++this.generation;
    this.stopPending();
    const why = this.gate();
    const audio = this.audio();
    if (why || !audio) {
      this.report({ type: 'refused', slotStartMs: req.slotStartMs, text: req.text, reason: why ?? 'Audio is not running.' });
      return;
    }
    let samples: Float32Array;
    try {
      samples = await this.encoder.synthesize(req.text, req.mode, req.f0Hz, audio.sampleRate);
    } catch {
      if (gen === this.generation) this.report({ type: 'missed', slotStartMs: req.slotStartMs, text: req.text, reason: 'encode' });
      return;
    }
    if (gen !== this.generation) return;
    const clockNow = this.audio();
    const nowUtc = clockNow?.toUtcMs(clockNow.currentTime) ?? null;
    const wait = nowUtc === null ? 0 : req.slotStartMs + req.startOffsetS * 1000 - PRE_ROLL_MS - nowUtc;
    if (wait > 0) {
      await new Promise<void>((release) => {
        this.preroll = { timer: this.timer(release, wait), release };
      });
      this.preroll = null;
      if (gen !== this.generation) return;
    }
    // Checked again: audio may have stopped in the meantime.
    const now = this.audio();
    const target = now?.toContextTime(req.slotStartMs + req.startOffsetS * 1000) ?? null;
    if (!now || target === null || this.gate()) {
      this.report({ type: 'refused', slotStartMs: req.slotStartMs, text: req.text, reason: this.gate() ?? 'Audio is not running.' });
      return;
    }
    // A transmission already on air keeps the output: this one waits for another slot.
    this.stopPending();
    if (this.playing) {
      this.report({ type: 'missed', slotStartMs: req.slotStartMs, text: req.text, reason: 'busy' });
      return;
    }
    const earliest = now.currentTime + MIN_LEAD_S;
    const when = Math.max(target, earliest);
    const lateS = req.startOffsetS - NOMINAL_S[req.mode] + (when - target);
    if (lateS > LATE_LIMIT_S[req.mode] + 1e-3) {
      this.report({ type: 'missed', slotStartMs: req.slotStartMs, text: req.text, reason: 'late' });
      return;
    }
    const skippedS = lateS > SHIFT_S[req.mode] + 1e-3 ? lateS : 0;
    const out = skippedS > 0 ? cutStart(samples, Math.round(skippedS * now.sampleRate), Math.round(CUT_FADE_S * now.sampleRate)) : samples;
    const handle = now.play(out, when, req.level);
    const entry = { slotStartMs: req.slotStartMs, text: req.text, when, skippedS, handle, started: false, startTimer: null as unknown };
    this.playing = entry;
    const startUtcMs = now.toUtcMs(when) ?? req.slotStartMs + (req.startOffsetS + (when - target)) * 1000;
    entry.startTimer = this.timer(() => {
      if (this.playing !== entry) return;
      entry.started = true;
      this.report({ type: 'started', slotStartMs: req.slotStartMs, text: req.text, startUtcMs, lateS: Math.max(0, lateS), skippedS });
    }, Math.max(0, (when - now.currentTime) * 1000));
    handle.onended = () => {
      if (this.playing !== entry) return;
      this.playing = null;
      this.clear(entry.startTimer);
      if (!entry.started) this.report({ type: 'started', slotStartMs: req.slotStartMs, text: req.text, startUtcMs, lateS: Math.max(0, lateS), skippedS });
      this.report({ type: 'ended', slotStartMs: req.slotStartMs, text: req.text, complete: true });
    };
  }

  /** Withdraws a transmission that has not started. One already on air plays to its end. */
  cancel() {
    this.generation++;
    this.endPreroll();
    this.stopPending();
  }

  /** Stops everything at once, on air or not. */
  halt() {
    this.generation++;
    this.endPreroll();
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    this.clear(p.startTimer);
    p.handle.onended = null;
    p.handle.stop();
    if (p.started || this.audible(p)) {
      if (!p.started) this.report({ type: 'started', slotStartMs: p.slotStartMs, text: p.text, startUtcMs: this.audio()?.toUtcMs(p.when) ?? Date.now(), lateS: 0, skippedS: p.skippedS });
      this.report({ type: 'ended', slotStartMs: p.slotStartMs, text: p.text, complete: false });
    } else this.report({ type: 'missed', slotStartMs: p.slotStartMs, text: p.text, reason: 'late' });
  }

  /** True once the audio clock has reached the transmission's start, whatever the timers say. */
  private audible(p: { when: number; started: boolean }): boolean {
    const a = this.audio();
    return p.started || (a !== null && a.currentTime >= p.when);
  }

  private endPreroll() {
    const p = this.preroll;
    if (!p) return;
    this.preroll = null;
    this.clear(p.timer);
    p.release();
  }

  /** Stops a transmission handed to the audio graph that has not started yet. */
  private stopPending() {
    const p = this.playing;
    if (!p || this.audible(p)) return;
    this.playing = null;
    this.clear(p.startTimer);
    p.handle.onended = null;
    p.handle.stop();
  }
}
