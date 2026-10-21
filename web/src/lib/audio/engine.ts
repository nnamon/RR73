/**
 * Capture engine: the one AudioContext, the microphone, the capture worklet, the clock mapping
 * and the output device the context plays to. Browsers allow audio only after a tap, so start()
 * and resume() must be called from one.
 *
 * Interruptions stop capture and wait for a tap: the context leaving "running" (a phone call
 * on iOS shows as "interrupted"), the input track ending or going mute, and the page being
 * hidden where the browser stops capture in the background (iOS). Desktop Chromium keeps the
 * microphone and the context running in a hidden page, so there capture carries on, and only the
 * browser's own stops end it (lib/app/platform.ts). The engine reports the UTC time of the last
 * audio it received.
 */

import workletUrl from './capture.worklet.ts?worker&url';
import { AudioClockMapper, plausibleTimestamp } from '../clock/mapping';
import { TimingLog, type ClockSource } from '../clock/timing';
import { FLOOR_DB } from './level';
import { CAPTURE_PROCESSOR, type CaptureChunkMessage, type CaptureMessage } from './messages';
import { RateMeter, type CaptureReport } from './report';
import { setAudioSession } from './session';
import { microphoneInput, type InputSource, type OpenedInput, type StartError } from './input';
import { applySink, type OutputError, type OutputState, type SinkContext } from './sink';
import { capturesHidden } from '../app/platform';
import { utcNow } from '../clock/utc';

export type { InputSource, StartError } from './input';
export type { OutputState } from './sink';

export type AudioStatus = 'off' | 'starting' | 'running' | 'stopped' | 'failed';

/** Why capture stopped. */
/** How long a start waits for the context to run before it shows as suspended, ms. */
export const RESUME_WAIT_MS = 1000;

export type StopReason = 'interrupted' | 'suspended' | 'input-ended' | 'input-muted' | 'hidden';

export interface EngineState {
  status: AudioStatus;
  reason: StopReason | null;
  /** UTC of the last audio received before a stop, ms. */
  stoppedAtUtcMs: number | null;
  error: StartError | null;
}

export interface Chunk {
  /** Mono samples at 12000 Hz. */
  samples: Float32Array;
  /** Running index of samples[0], samples at 12 kHz. */
  index: number;
  /** Audio-clock time of samples[0], s. */
  contextTime: number;
  /** UTC time of samples[0], ms. */
  utcMs: number;
  peakDb: number;
  rmsDb: number;
}

export interface EngineDeps {
  createContext(): AudioContext;
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  /** Loads the worklet into the context (once) and creates the capture node. */
  createNode(ctx: AudioContext): Promise<AudioWorkletNode>;
  doc: Document;
  dateNow(): number;
  perfNow(): number;
  secure(): boolean;
  setSession(): string | null;
  /** True where capture keeps running while the page is hidden; false or absent, hiding stops it. */
  capturesHidden?(): boolean;
}

const loaded = new WeakSet<BaseAudioContext>();

/** Implausible output timestamps in a row, about 0.2 s of chunks, before the engine stops using them. */
const IMPLAUSIBLE_RUN = 5;

/**
 * Observations the mapping needs after a start or resume before chunks are stamped, about 0.2 s.
 * Chunks wait and are stamped once it settles, so one skewed first reading never reaches a slot.
 */
const SETTLE = 5;
/** Chunks held while the mapping settles: 1.4 s. */
const HOLD_MAX = 32;

export function browserDeps(): EngineDeps {
  return {
    createContext: () => new AudioContext({ latencyHint: 'interactive' }),
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    async createNode(ctx) {
      if (!loaded.has(ctx)) {
        await ctx.audioWorklet.addModule(workletUrl);
        loaded.add(ctx);
      }
      return new AudioWorkletNode(ctx, CAPTURE_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0, channelCountMode: 'max' });
    },
    doc: document,
    dateNow: () => utcNow(),
    perfNow: () => performance.now(),
    secure: () => typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia,
    setSession: () => setAudioSession('play-and-record'),
    capturesHidden: () => capturesHidden(typeof navigator === 'undefined' ? undefined : navigator),
  };
}

function startError(e: unknown): StartError {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'unknown';
}

export class CaptureEngine {
  readonly mapper = new AudioClockMapper();
  private readonly deps: EngineDeps;
  private ctx: AudioContext | null = null;
  /** Where audio comes from: the microphone unless the practice band replaces it. */
  private input: InputSource;
  private opened: OpenedInput | null = null;
  private node: AudioWorkletNode | null = null;
  private deviceId: string | null = null;
  private lastUtcMs: number | null = null;
  private readonly rate = new RateMeter();
  private report: CaptureReport | null = null;
  private stateValue: EngineState = { status: 'off', reason: null, stoppedAtUtcMs: null, error: null };
  private readonly chunkListeners = new Set<(c: Chunk) => void>();
  private readonly stateListeners = new Set<(s: EngineState) => void>();
  private readonly reportListeners = new Set<(r: CaptureReport) => void>();
  /** The mapper holds observations from currentTime, without output timestamps. */
  private fallbackClock = false;
  /** Output timestamps in a row that disagree with currentTime. */
  private implausible = 0;
  /** The browser's output timestamps are wrong: the mapper uses currentTime until the next start or resume. */
  private distrustTimestamps = false;
  /** Chunks waiting for the mapping to settle. */
  private held: CaptureChunkMessage[] = [];
  /** The mapping settled since the last start or resume. */
  private settled = false;
  /** Clock readings, capture lags and the mapping around stops and resumes. */
  readonly timing = new TimingLog();
  /** The output device chosen, and why it does not play if it does not. */
  private outputValue: OutputState = { sinkId: null, error: null };
  private readonly outputListeners = new Set<(o: OutputState) => void>();
  /** Output switches in progress: the context's state changes during them are the switch's own. */
  private switching = 0;
  /** The last output switch, which a start waits for before it resumes the context. */
  private sinkSwitch: Promise<void> | null = null;

  constructor(deps: EngineDeps = browserDeps(), input: InputSource | null = null) {
    this.deps = deps;
    this.input = input ?? microphoneInput(deps);
    deps.doc.addEventListener('visibilitychange', () => {
      if (deps.doc.visibilityState === 'hidden' && !deps.capturesHidden?.()) this.interrupt('hidden');
    });
  }

  get state(): EngineState {
    return this.stateValue;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get captureReport(): CaptureReport | null {
    return this.report;
  }

  /** What the mapping is built from now; null without a mapping. */
  get clockSource(): ClockSource | null {
    return this.mapper.ready ? (this.fallbackClock ? 'current-time' : 'output') : null;
  }

  /** UTC the mapping gives the audio clock now minus utcNow(), ms; null without a mapping. */
  mappingOffsetMs(): number | null {
    if (!this.ctx || !this.mapper.ready) return null;
    return this.mapper.toUtcMs(this.ctx.currentTime) - this.deps.dateNow();
  }

  onChunk(fn: (c: Chunk) => void): () => void {
    this.chunkListeners.add(fn);
    return () => this.chunkListeners.delete(fn);
  }

  onState(fn: (s: EngineState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  onReport(fn: (r: CaptureReport) => void): () => void {
    this.reportListeners.add(fn);
    return () => this.reportListeners.delete(fn);
  }

  /** The output device chosen, and why it does not play if it does not. */
  get output(): OutputState {
    return this.outputValue;
  }

  onOutput(fn: (o: OutputState) => void): () => void {
    this.outputListeners.add(fn);
    return () => this.outputListeners.delete(fn);
  }

  /**
   * Sends everything the context plays to `sinkId`, or to the system default for null. Before the
   * context exists the choice waits and applies when it is created. A device that is missing
   * leaves output on the system default and reports `missing`; calling again with it after a
   * device change tries again. Capture keeps running through the switch.
   */
  useOutput(sinkId: string | null): Promise<OutputState> {
    this.outputValue = { sinkId, error: null };
    if (!this.ctx) {
      this.emitOutput();
      return Promise.resolve(this.outputValue);
    }
    return this.switchOutput(this.ctx, sinkId);
  }

  private switchOutput(ctx: AudioContext, sinkId: string | null): Promise<OutputState> {
    const run = async () => {
      let error: OutputError | null = 'failed';
      this.switching++;
      try {
        error = await applySink(ctx as unknown as SinkContext, sinkId);
        if (this.stateValue.status === 'running' && ctx.state !== 'running') await ctx.resume().catch(() => undefined);
      } finally {
        this.switching--;
      }
      // A later choice replaced this one while it ran, and its own switch reports.
      if (this.outputValue.sinkId !== sinkId) return;
      if (this.stateValue.status === 'running') {
        if (ctx.state !== 'running') this.interrupt('suspended');
        // Each device has its own output latency, so the clock mapping starts over.
        else if (error === null) {
          this.resetClock();
          this.rate.reset();
        }
      }
      this.outputValue = { sinkId, error };
      this.emitOutput();
    };
    // One switch at a time, in the order chosen.
    const next = (this.sinkSwitch ?? Promise.resolve()).then(run, run);
    this.sinkSwitch = next;
    return next.then(() => this.outputValue);
  }

  /**
   * Creates the context if needed and resumes it. Call from a tap. Used by Tune, which plays
   * without the microphone. A new context switches to the chosen output at once.
   */
  ensureContext(): AudioContext {
    this.deps.setSession();
    if (!this.ctx) {
      this.ctx = this.deps.createContext();
      this.ctx.onstatechange = () => this.onContextState();
      if (this.outputValue.sinkId !== null) void this.switchOutput(this.ctx, this.outputValue.sinkId);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  /** Starts capture from the given input, or the system default. Call from a tap. */
  async start(deviceId: string | null = null): Promise<EngineState> {
    if (this.stateValue.status === 'starting' || this.stateValue.status === 'running') return this.stateValue;
    return this.begin(deviceId);
  }

  private async begin(deviceId: string | null): Promise<EngineState> {
    const unavailable = this.input.unavailable();
    if (unavailable) return this.fail(unavailable);
    this.deviceId = deviceId;
    this.closeInput();
    // Context first, inside the tap: Safari allows resume() only during a user gesture.
    const ctx = this.ensureContext();
    this.set({ status: 'starting', reason: null, stoppedAtUtcMs: null, error: null });
    try {
      await this.openInput(ctx);
    } catch (e) {
      this.closeInput();
      return this.fail(e instanceof WorkletError ? 'worklet' : startError(e));
    }
    // An output switch suspends the context for a moment; let it finish before the check below.
    if (this.sinkSwitch) await this.sinkSwitch;
    try {
      // Chrome leaves resume() pending, neither resolving nor rejecting, until a tap when the
      // page may not play audio yet: a start that did not come from a tap, such as a web SDR
      // turned on before the page reloaded. Waiting RESUME_WAIT_MS at most, it shows as
      // suspended, and the audio banner offers a tap that resumes it.
      if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, RESUME_WAIT_MS))]);
    } catch {
      // A context that will not run shows as a stop below.
    }
    this.resetClock();
    this.rate.reset();
    this.lastUtcMs = null;
    if (ctx.state !== 'running') {
      this.set({ status: 'stopped', reason: 'suspended', stoppedAtUtcMs: this.deps.dateNow(), error: null });
      return this.stateValue;
    }
    this.set({ status: 'running', reason: null, stoppedAtUtcMs: null, error: null });
    return this.stateValue;
  }

  /** Resumes after an interruption. Call from a tap. Opens the input again if it ended. */
  async resume(): Promise<EngineState> {
    const usable = this.opened?.usable() ?? false;
    if (!usable) return this.begin(this.deviceId);
    const ctx = this.ensureContext();
    this.set({ status: 'starting', reason: null, stoppedAtUtcMs: null, error: null });
    try {
      await ctx.resume();
    } catch {
      // Checked below.
    }
    this.resetClock();
    this.rate.reset();
    if (ctx.state !== 'running') {
      this.set({ status: 'stopped', reason: 'suspended', stoppedAtUtcMs: this.deps.dateNow(), error: null });
      return this.stateValue;
    }
    this.set({ status: 'running', reason: null, stoppedAtUtcMs: null, error: null });
    return this.stateValue;
  }

  /**
   * Switches the input source: null for the microphone. Capture from the old source ends at once
   * and the status goes to off; start() opens the new one.
   */
  useSource(input: InputSource | null) {
    this.input = input ?? microphoneInput(this.deps);
    const was = this.stateValue.status;
    this.closeInput();
    if (was === 'running' || was === 'starting' || was === 'stopped') {
      this.resetClock();
      this.rate.reset();
      this.set({ status: 'off', reason: null, stoppedAtUtcMs: null, error: null });
    }
  }

  /** Switches to another input. Call from a tap. */
  async useInput(deviceId: string | null): Promise<EngineState> {
    this.deviceId = deviceId;
    if (this.stateValue.status === 'off' || this.stateValue.status === 'failed') return this.stateValue;
    return this.begin(deviceId);
  }

  /** Stops capture after an interruption and records when the audio ended. */
  interrupt(reason: StopReason) {
    if (this.stateValue.status !== 'running' && this.stateValue.status !== 'starting') return;
    const at = this.lastUtcMs ?? this.deps.dateNow();
    this.timing.stopped(at, this.mappingOffsetMs());
    this.mapper.reset();
    this.rate.reset();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
    this.set({ status: 'stopped', reason, stoppedAtUtcMs: at, error: null });
  }

  private async openInput(ctx: AudioContext) {
    this.opened = await this.input.open(ctx, this.deviceId, { ended: () => this.interrupt('input-ended'), muted: () => this.interrupt('input-muted'), offset: (s) => (this.mapper.inputOffsetS = s) });
    let node: AudioWorkletNode;
    try {
      node = await this.deps.createNode(ctx);
    } catch {
      throw new WorkletError();
    }
    this.node = node;
    node.port.onmessage = (e: MessageEvent<CaptureMessage>) => this.onMessage(e.data);
    this.opened.node.connect(node);
    this.report = this.opened.report;
    this.emitReport();
  }

  private closeInput() {
    this.opened?.close();
    this.opened = null;
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
  }

  private onContextState() {
    const ctx = this.ctx;
    if (!ctx || this.stateValue.status !== 'running' || this.switching > 0) return;
    if (ctx.state === 'running') return;
    this.interrupt((ctx.state as string) === 'interrupted' ? 'interrupted' : 'suspended');
  }

  private onMessage(m: CaptureMessage) {
    if (m.type === 'format') {
      if (this.report) {
        this.report = { ...this.report, arrivingChannels: m.channels, channelUsed: m.channelUsed, contextRate: m.sampleRate };
        this.emitReport();
      }
      return;
    }
    if (this.stateValue.status !== 'running' || !this.ctx) return;
    const ctx = this.ctx;
    this.observeClock(ctx);
    this.timing.lag(ctx.currentTime - (m.contextTime + m.samples.length / 12000));
    this.timing.gaps = m.gaps ?? 0;
    this.timing.gapS = (m.gapFrames ?? 0) / ctx.sampleRate;
    // A mapping that started over (start, resume, a change of clock source) holds chunks until it settles.
    if (this.mapper.count < SETTLE) {
      this.held.push(m);
      if (this.held.length > HOLD_MAX) this.held.shift();
      return;
    }
    if (!this.settled) {
      this.settled = true;
      this.timing.settled(this.deps.dateNow(), this.mappingOffsetMs()!);
    }
    const ready = this.held.length ? [...this.held, m] : [m];
    this.held = [];
    for (const c of ready) this.emitChunk(ctx, c);
  }

  private emitChunk(ctx: AudioContext, m: CaptureChunkMessage) {
    const utcMs = this.mapper.captureUtcMs(m.contextTime);
    this.lastUtcMs = utcMs + (m.samples.length / 12000) * 1000;
    this.rate.add(this.deps.perfNow(), m.contextTime);
    const measured = this.rate.rate(ctx.sampleRate);
    if (this.report && measured !== null && (this.report.measuredRate === null || Math.abs(measured - this.report.measuredRate) >= 1)) {
      this.report = { ...this.report, measuredRate: measured };
      this.emitReport();
    }
    const chunk: Chunk = { samples: m.samples, index: m.index, contextTime: m.contextTime, utcMs, peakDb: m.peakDb ?? FLOOR_DB, rmsDb: m.rmsDb ?? FLOOR_DB };
    for (const l of this.chunkListeners) l(chunk);
  }

  private resetClock() {
    this.mapper.reset();
    this.fallbackClock = false;
    this.implausible = 0;
    this.distrustTimestamps = false;
    this.held = [];
    this.settled = false;
    this.timing.restart();
  }

  private observeClock(ctx: AudioContext) {
    const perfNow = this.deps.perfNow();
    const dateNow = this.deps.dateNow();
    const raw = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    const currentTime = ctx.currentTime;
    this.timing.reading({ contextTime: raw?.contextTime ?? 0, performanceTime: raw?.performanceTime ?? 0, perfNow, dateNow, currentTime });
    const ts = raw && (raw.performanceTime ?? 0) > 0 && (raw.contextTime ?? 0) > 0 ? { contextTime: raw.contextTime!, performanceTime: raw.performanceTime! } : null;
    if (!this.distrustTimestamps) {
      if (ts && plausibleTimestamp(ts, currentTime, perfNow)) {
        // Output timestamps differ from the fallback by the output latency: start over on them.
        if (this.fallbackClock) this.mapper.reset();
        this.fallbackClock = false;
        this.implausible = 0;
        this.mapper.observe(ts, perfNow, dateNow);
        return;
      }
      // A few bad timestamps are skipped. A run of them means the browser's are wrong (Playwright's
      // WebKit on Linux): drop the observations made from them and use currentTime. Timestamps that
      // stop coming count too: a mapping left on old ones drifts with the audio clock.
      if (ts || (this.mapper.ready && !this.fallbackClock)) {
        if (++this.implausible < IMPLAUSIBLE_RUN) return;
        if (ts) this.distrustTimestamps = true;
        else this.implausible = 0;
        if (!this.fallbackClock) this.mapper.reset();
      }
    }
    // Until output timestamps arrive, or where the browser has none or wrong ones, pair currentTime
    // with now: off by the output latency.
    this.fallbackClock = true;
    this.mapper.observe({ contextTime: currentTime, performanceTime: perfNow }, perfNow, dateNow);
  }

  private fail(error: StartError): EngineState {
    this.set({ status: 'failed', reason: null, stoppedAtUtcMs: null, error });
    return this.stateValue;
  }

  private set(s: EngineState) {
    this.stateValue = s;
    for (const l of this.stateListeners) l(s);
  }

  private emitReport() {
    if (!this.report) return;
    for (const l of this.reportListeners) l(this.report);
  }

  private emitOutput() {
    for (const l of this.outputListeners) l(this.outputValue);
  }
}

class WorkletError extends Error {
  override name = 'WorkletError';
}
