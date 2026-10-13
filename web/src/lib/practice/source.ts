/**
 * The practice band as a capture input. Noise loops without a break; each slot's transmissions
 * are rendered about a second before the slot starts and scheduled on the audio clock at the
 * slot's UTC start. The node goes to the capture worklet only, so the band is never heard
 * through the speaker and needs no microphone.
 */

import type { InputSource, OpenedInput } from '../audio/input';
import type { CaptureReport } from '../audio/report';
import { SLOT_MS, SLOT_RATE, nextSlotStart, slotStart, type Mode } from '../clock/slots';
import { NOISE_RMS, mixSlot, noise, type Part } from './render';
import type { SimSignal } from './sim';

export interface SlotFeed {
  mode(): Mode;
  /** The transmissions of the slot starting at `slotStartMs`, UTC ms. Called once per slot, in order. */
  signals(slotStartMs: number): SimSignal[];
  /** A transmission at 12 kHz, peak 1. */
  synth(text: string, mode: Mode, f0Hz: number): Promise<Float32Array>;
}

/** The noise loop: 9.7 s, so its repeats never line up with the slots. */
const NOISE_S = 9.7;
/** A slot is rendered this long before it starts, ms. Later than the operator's start in the slot before. */
const LEAD_MS: Record<Mode, number> = { FT8: 1500, FT4: 1000 };
const TICK_MS = 200;

export function practiceReport(contextRate: number, audioSession: string | null): CaptureReport {
  return {
    inputLabel: 'Practice band',
    deviceId: null,
    contextRate,
    trackRate: SLOT_RATE,
    trackChannels: 1,
    arrivingChannels: null,
    channelUsed: null,
    measuredRate: null,
    echoCancellation: null,
    noiseSuppression: null,
    autoGainControl: null,
    audioSession,
  };
}

export class PracticeInput implements InputSource {
  private readonly feed: SlotFeed;
  private readonly now: () => number;
  private readonly session: () => string | null;

  constructor(feed: SlotFeed, now: () => number = () => Date.now(), session: () => string | null = () => null) {
    this.feed = feed;
    this.now = now;
    this.session = session;
  }

  unavailable() {
    return null;
  }

  async open(ctx: AudioContext): Promise<OpenedInput> {
    const out = ctx.createGain();
    const loop = ctx.createBufferSource();
    const n = Math.round(NOISE_S * SLOT_RATE);
    loop.buffer = bufferOf(ctx, noise(n, NOISE_RMS, 0x7273));
    loop.loop = true;
    loop.connect(out);
    loop.start();
    const runner = new SlotRunner(ctx, out, this.feed, this.now);
    runner.start();
    return {
      node: out,
      report: practiceReport(ctx.sampleRate, this.session()),
      usable: () => true,
      close() {
        runner.stop();
        try {
          loop.stop();
        } catch {
          // Not started.
        }
        loop.disconnect();
        out.disconnect();
      },
    };
  }
}

function bufferOf(ctx: BaseAudioContext, samples: Float32Array): AudioBuffer {
  // A 12 kHz buffer: the context resamples it to its own rate, and the worklet back to 12 kHz.
  const b = ctx.createBuffer(1, samples.length, SLOT_RATE);
  b.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  return b;
}

/** Renders and schedules each slot ahead of time while the context runs. */
export class SlotRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly done = new Set<number>();
  private readonly playing = new Set<AudioBufferSourceNode>();
  private mode: Mode | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly feed: SlotFeed,
    private readonly now: () => number,
  ) {}

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const p of this.playing) {
      try {
        p.stop();
      } catch {
        // Not started.
      }
      p.disconnect();
    }
    this.playing.clear();
  }

  /** Renders the current slot at the first tick (its rest plays), then each next slot LEAD_MS before it starts. */
  tick() {
    if (this.ctx.state !== 'running') return;
    const mode = this.feed.mode();
    if (mode !== this.mode) {
      this.mode = mode;
      this.done.clear();
      void this.prepare(slotStart(this.now(), mode), mode);
    }
    const next = nextSlotStart(this.now(), mode);
    if (this.now() >= next - LEAD_MS[mode] && !this.done.has(next)) void this.prepare(next, mode);
  }

  private async prepare(startMs: number, mode: Mode) {
    this.done.add(startMs);
    for (const s of this.done) if (s < startMs - 4 * SLOT_MS[mode]) this.done.delete(s);
    const signals = this.feed.signals(startMs);
    const parts: Part[] = [];
    await Promise.all(
      signals.map(async (signal) => {
        try {
          parts.push({ samples: await this.feed.synth(signal.text, mode, signal.freqHz), signal });
        } catch {
          // A message that does not encode is left out of the slot.
        }
      }),
    );
    if (!this.timer || this.ctx.state !== 'running') return;
    this.schedule(startMs, mixSlot(mode, parts));
  }

  private schedule(startMs: number, samples: Float32Array) {
    const src = this.ctx.createBufferSource();
    src.buffer = bufferOf(this.ctx, samples);
    src.connect(this.out);
    const t = this.ctx.currentTime;
    const when = t + (startMs - this.now()) / 1000;
    const late = Math.max(0, t - when);
    if (late >= samples.length / SLOT_RATE) return;
    src.start(Math.max(t, when), late);
    this.playing.add(src);
    src.onended = () => {
      src.disconnect();
      this.playing.delete(src);
    };
  }
}
