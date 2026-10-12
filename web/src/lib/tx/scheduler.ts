/**
 * Executes the sequencer's transmit effects on the audio clock. A transmission is synthesised
 * at the output rate, then started at slot + offset on the audio clock (0.5 s, or later for a
 * late start). A start that would come more than the late-start limit after slot + 0.5 s is
 * reported as missed. Halt stops the sound within one render quantum (128 frames).
 *
 * Transmitting needs running audio and a confirmed band; otherwise the request is refused.
 * The scheduler plays through the output only while it transmits.
 */

import type { Mode } from '../clock/slots';
import { LATE_S } from '../qso/sequencer';

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
  | { type: 'started'; slotStartMs: number; startUtcMs: number; lateS: number }
  | { type: 'ended'; slotStartMs: number; complete: boolean }
  | { type: 'missed'; slotStartMs: number; reason: 'late' | 'encode' }
  | { type: 'refused'; slotStartMs: number; reason: string };

/** Earliest start after now, s: room for the audio thread to pick the node up. */
const MIN_LEAD_S = 0.02;

export class TxScheduler {
  private readonly audio: () => TxAudio | null;
  private readonly encoder: Encoder;
  private readonly gate: () => string | null;
  private readonly report: (r: TxReport) => void;
  private readonly timer: (fn: () => void, ms: number) => unknown;
  private readonly clear: (h: unknown) => void;
  /** Bumped by cancel and halt so a synthesis still running is dropped when it finishes. */
  private generation = 0;
  private playing: { slotStartMs: number; handle: Playing; started: boolean; startTimer: unknown } | null = null;

  constructor(opts: {
    audio: () => TxAudio | null;
    encoder: Encoder;
    /** Why transmitting is not allowed now (audio stopped, band unconfirmed), or null. */
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

  /** True while a transmission is scheduled or playing. */
  get busy(): boolean {
    return this.playing !== null;
  }

  async schedule(req: TxRequest): Promise<void> {
    const gen = ++this.generation;
    this.stopPending();
    const why = this.gate();
    const audio = this.audio();
    if (why || !audio) {
      this.report({ type: 'refused', slotStartMs: req.slotStartMs, reason: why ?? 'Audio is not running.' });
      return;
    }
    let samples: Float32Array;
    try {
      samples = await this.encoder.synthesize(req.text, req.mode, req.f0Hz, audio.sampleRate);
    } catch {
      if (gen === this.generation) this.report({ type: 'missed', slotStartMs: req.slotStartMs, reason: 'encode' });
      return;
    }
    if (gen !== this.generation) return;
    // Checked again: audio may have stopped while the message was synthesised.
    const now = this.audio();
    const target = now?.toContextTime(req.slotStartMs + req.startOffsetS * 1000) ?? null;
    if (!now || target === null || this.gate()) {
      this.report({ type: 'refused', slotStartMs: req.slotStartMs, reason: this.gate() ?? 'Audio is not running.' });
      return;
    }
    const earliest = now.currentTime + MIN_LEAD_S;
    const when = Math.max(target, earliest);
    const lateS = req.startOffsetS - 0.5 + (when - target);
    if (lateS > LATE_S[req.mode] + 1e-3) {
      this.report({ type: 'missed', slotStartMs: req.slotStartMs, reason: 'late' });
      return;
    }
    const handle = now.play(samples, when, req.level);
    const entry = { slotStartMs: req.slotStartMs, handle, started: false, startTimer: null as unknown };
    this.playing = entry;
    const startUtcMs = now.toUtcMs(when) ?? req.slotStartMs + (req.startOffsetS + (when - target)) * 1000;
    entry.startTimer = this.timer(() => {
      if (this.playing !== entry) return;
      entry.started = true;
      this.report({ type: 'started', slotStartMs: req.slotStartMs, startUtcMs, lateS: Math.max(0, lateS) });
    }, Math.max(0, (when - now.currentTime) * 1000));
    handle.onended = () => {
      if (this.playing !== entry) return;
      this.playing = null;
      this.clear(entry.startTimer);
      if (!entry.started) this.report({ type: 'started', slotStartMs: req.slotStartMs, startUtcMs, lateS: Math.max(0, lateS) });
      this.report({ type: 'ended', slotStartMs: req.slotStartMs, complete: true });
    };
  }

  /** Withdraws a transmission that has not started. One already on air plays to its end. */
  cancel() {
    this.generation++;
    this.stopPending();
  }

  /** Stops everything at once, on air or not. */
  halt() {
    this.generation++;
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    this.clear(p.startTimer);
    p.handle.onended = null;
    p.handle.stop();
    if (p.started) this.report({ type: 'ended', slotStartMs: p.slotStartMs, complete: false });
    else this.report({ type: 'missed', slotStartMs: p.slotStartMs, reason: 'late' });
  }

  private stopPending() {
    const p = this.playing;
    if (!p || p.started) return;
    this.playing = null;
    this.clear(p.startTimer);
    p.handle.onended = null;
    p.handle.stop();
  }
}
