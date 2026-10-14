/**
 * The app's side of the keyboard worker and the stream worklet. One worker for the app's life;
 * one stream node per transmission, through a gain to the output. stop() ramps the gain to 0
 * over one render quantum and disconnects the node, so Halt silences the output at once.
 */

import workletUrl from './stream.worklet.ts?worker&url';
import type { KeyboardMode } from '../clock/slots';
import type { RttySettings } from '../rtty/settings';
import type { CharTables, ModemEvent } from './modem';
import { STREAM_PROCESSOR, type FromKeyboard, type FromStreamNode, type ToKeyboard, type ToStreamNode } from './protocol';

export type KeyboardStatus = { state: 'idle' | 'loading' } | { state: 'ready'; version: string } | { state: 'failed'; detail: string };

export interface TxReport {
  queuedS: number;
  skipped: number;
  done: boolean;
}

/** A transmission's output, from the app's side. */
export interface TxStream {
  text(t: string): void;
  finish(): void;
  /** Halt: silent within one render quantum. */
  stop(): void;
}

export interface TxCallbacks {
  /** The first sample is playing. */
  started(): void;
  /** The last sample has played, or the stream stopped. Underruns are frames of silence between blocks. */
  drained(underrunFrames: number, playedFrames: number): void;
  /** What the node output, from start to end, in the review build when recording was asked for. */
  recording?(samples: Float32Array): void;
}

export interface KeyboardClientDeps {
  createWorker(): Worker;
}

const loaded = new WeakSet<BaseAudioContext>();
const QUANTUM = 128;

export class KeyboardClient {
  private worker: Worker | null = null;
  status: KeyboardStatus = { state: 'idle' };
  private readonly listeners = {
    events: new Set<(e: ModemEvent[]) => void>(),
    tables: new Set<(t: CharTables) => void>(),
    tx: new Set<(r: TxReport) => void>(),
    status: new Set<(s: KeyboardStatus) => void>(),
  };
  private encodes = new Map<number, (s: Float32Array | null) => void>();
  private nextId = 1;

  constructor(private readonly deps: KeyboardClientDeps = { createWorker: () => new Worker(new URL('./keyboard.worker.ts', import.meta.url), { type: 'module' }) }) {}

  private post(m: ToKeyboard, transfer: Transferable[] = []) {
    if (!this.worker) {
      try {
        this.worker = this.deps.createWorker();
      } catch (e) {
        this.setStatus({ state: 'failed', detail: e instanceof Error ? e.message : String(e) });
        return;
      }
      this.worker.onmessage = (e: MessageEvent<FromKeyboard>) => this.receive(e.data);
      this.worker.onerror = () => this.setStatus({ state: 'failed', detail: 'The keyboard worker stopped.' });
      this.setStatus({ state: 'loading' });
      this.worker.postMessage({ type: 'load' } satisfies ToKeyboard);
    }
    this.worker.postMessage(m, transfer);
  }

  private setStatus(s: KeyboardStatus) {
    this.status = s;
    for (const l of this.listeners.status) l(s);
  }

  private receive(m: FromKeyboard) {
    if (m.type === 'ready') this.setStatus({ state: 'ready', version: m.version });
    else if (m.type === 'failed') this.setStatus({ state: 'failed', detail: m.detail });
    else if (m.type === 'events') for (const l of this.listeners.events) l(m.events);
    else if (m.type === 'tables') for (const l of this.listeners.tables) l(m.tables);
    else if (m.type === 'tx') for (const l of this.listeners.tx) l({ queuedS: m.queuedS, skipped: m.skipped, done: m.done });
    else if (m.type === 'encoded') {
      this.encodes.get(m.id)?.(m.samples);
      this.encodes.delete(m.id);
    }
  }

  onEvents(fn: (e: ModemEvent[]) => void): () => void {
    this.listeners.events.add(fn);
    return () => this.listeners.events.delete(fn);
  }

  onTables(fn: (t: CharTables) => void): () => void {
    this.listeners.tables.add(fn);
    return () => this.listeners.tables.delete(fn);
  }

  onTx(fn: (r: TxReport) => void): () => void {
    this.listeners.tx.add(fn);
    return () => this.listeners.tx.delete(fn);
  }

  onStatus(fn: (s: KeyboardStatus) => void): () => void {
    this.listeners.status.add(fn);
    return () => this.listeners.status.delete(fn);
  }

  configure(mode: KeyboardMode, rtty: RttySettings) {
    this.post({ type: 'configure', mode, rtty: plainCopy(rtty) });
  }

  push(samples: Float32Array) {
    const copy = samples.slice();
    this.post({ type: 'push', samples: copy }, [copy.buffer]);
  }

  flush() {
    this.post({ type: 'flush' });
  }

  tune(hz: number) {
    this.post({ type: 'tune', hz });
  }

  find(hz: number, rangeHz: number) {
    this.post({ type: 'find', hz, rangeHz });
  }

  afc(on: boolean) {
    this.post({ type: 'afc', on });
  }

  reset() {
    this.post({ type: 'reset' });
  }

  /** One transmission rendered at 12 kHz with the modem's settings, peak 1; null without a modem. */
  encode(text: string, hz: number): Promise<Float32Array | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.encodes.set(id, resolve);
      this.post({ type: 'encode', id, text, hz });
    });
  }

  /** Starts a transmission on `ctx` at `level` (0 to 1). Rejects when the worklet cannot load. */
  async startTx(ctx: AudioContext, level: number, cb: TxCallbacks, record = false): Promise<TxStream> {
    if (!loaded.has(ctx)) {
      await ctx.audioWorklet.addModule(workletUrl);
      loaded.add(ctx);
    }
    const node = new AudioWorkletNode(ctx, STREAM_PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    const gain = ctx.createGain();
    gain.gain.value = 1;
    node.connect(gain).connect(ctx.destination);
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      setTimeout(() => {
        node.disconnect();
        gain.disconnect();
      }, 50);
    };
    node.port.onmessage = (e: MessageEvent<FromStreamNode>) => {
      const m = e.data;
      if (m.type === 'started') cb.started();
      else if (m.type === 'recording') cb.recording?.(m.samples);
      else if (m.type === 'drained') {
        close();
        cb.drained(m.underrunFrames, m.playedFrames);
      }
    };
    const channel = new MessageChannel();
    if (record) node.port.postMessage({ type: 'record', on: true } satisfies ToStreamNode);
    node.port.postMessage({ type: 'link', port: channel.port1 } satisfies ToStreamNode, [channel.port1]);
    this.post({ type: 'txStart', sampleRate: ctx.sampleRate, level, port: channel.port2 }, [channel.port2]);
    return {
      text: (t) => this.post({ type: 'txText', text: t }),
      finish: () => this.post({ type: 'txFinish' }),
      stop: () => {
        const now = ctx.currentTime;
        try {
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + QUANTUM / ctx.sampleRate);
        } catch {
          // The context has closed.
        }
        node.port.postMessage({ type: 'stop' } satisfies ToStreamNode);
        this.post({ type: 'txStop' });
        close();
      },
    };
  }
}

/** A plain copy of settings for postMessage: reactive proxies cannot be cloned. */
function plainCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
