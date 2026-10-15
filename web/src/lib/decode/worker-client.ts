/**
 * The app's decoder: a module worker running rr73-wasm. Slots are decoded one at a time in
 * the worker, so the main thread never waits. At most 2 slots wait for the decoder; a third
 * is refused (DecoderBusyError) so a slow phone falls behind by whole slots and never builds
 * a queue.
 */

import { WSPR_PRESET, type DeepStages, type FromDecoder, type ToDecoder, type DecoderFailure, type Packed } from './protocol';
import type { WsprDecode } from '../wspr/spots';
import type { Mode } from '../clock/slots';
import type { Decode, DecoderClient, DecoderStatus, SlotAudio } from './types';

export class DecoderBusyError extends Error {
  override name = 'DecoderBusyError';
}

export class DecoderUnavailableError extends Error {
  override name = 'DecoderUnavailableError';
}

/** The parts of a Worker the client uses. */
export interface WorkerLike {
  postMessage(m: ToDecoder, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<FromDecoder>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

interface Pending {
  resolve: (d: Decode[]) => void;
  /** Receives the later stages' decodes of an FT8 slot. */
  more?: (d: Decode[]) => void;
  reject: (e: Error) => void;
  /** Set for a WSPR slot. */
  wspr?: (r: { decodes: WsprDecode[]; ms: number }) => void;
}

interface Request<T> {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}

/**
 * The decoder preset operators get. `subtract-3-osd2` decodes up to 3 passes, subtracting each
 * decoded signal before the next (docs/experiments/0001-subtraction.md), and retries candidates
 * that belief propagation fails with ordered-statistics decoding of order 2
 * (docs/experiments/0002-osd.md has the measurements). CI gates this preset against
 * bench/subtract-3-osd2.json.
 */
export const PRESET = 'subtract-3-osd2';

/**
 * Later stages for FT8 slots, after PRESET. Each decodes what the stages before it left: the
 * first on a grid of 4 frames per symbol and 4 bins per tone spacing, the second on 8 frames
 * per symbol with 400 candidates from a 2 dB sync threshold and OSD over all 91 information
 * bits. Both leave frames that overlap digital silence out of the sync score and accept OSD
 * decodes from -23 dB, 1 dB above the preset, as they try more candidates. Their a priori
 * decoding stays near the QSO partner's frequency, which keeps its cost to 4%
 * (crates/rr73-decode/src/ap.rs). CI gates them
 * against bench/subtract-3-osd2-deep.json; docs/decisions/0007-deeper-ft8-stages.md has the
 * measurements and the budget.
 */
export const DEEP: DeepStages = {
  plan: [
    'subtract-3-osd2 spectrogram.time_osr=4 spectrogram.freq_osr=4 spectrogram.window_symbols=2 search.skip_silent_frames=true validate.osd_min_snr_db=-23 ap.my_anywhere=false',
    'subtract-3-osd2 spectrogram.time_osr=8 spectrogram.freq_osr=4 spectrogram.window_symbols=2 search.skip_silent_frames=true validate.osd_min_snr_db=-23 ldpc.osd_window=91 search.max_candidates=400 search.min_score_db=2 ap.my_anywhere=false',
  ].join('; '),
  budgetMs: 2000,
};

export class WorkerDecoder implements DecoderClient {
  private worker: WorkerLike | null = null;
  private readonly pending = new Map<number, Pending>();
  /** Encoder requests (pack, synthesize): not limited, they are small and come one per slot. */
  private readonly requests = new Map<number, Request<Packed> | Request<Float32Array>>();
  private nextId = 1;
  private statusValue: DecoderStatus = { state: 'idle' };
  private readonly listeners = new Set<(s: DecoderStatus) => void>();
  private readonly create: () => WorkerLike;
  private readonly preset: string;
  private readonly maxPending: number;
  private readonly deep: DeepStages | null;
  /** Slots whose later stages are still running, by id. */
  private readonly more = new Map<number, (d: Decode[]) => void>();

  constructor(
    create: () => WorkerLike = () => new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
    preset = PRESET,
    maxPending = 2,
    deep: DeepStages | null = DEEP,
  ) {
    this.create = create;
    this.preset = preset;
    this.maxPending = maxPending;
    this.deep = deep;
  }

  get available(): boolean {
    return this.statusValue.state !== 'failed';
  }

  get status(): DecoderStatus {
    return this.statusValue;
  }

  onStatus(fn: (s: DecoderStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Starts the worker and loads the module. Safe to call more than once. */
  load() {
    if (this.worker || this.statusValue.state === 'failed') return;
    this.setStatus({ state: 'loading' });
    let w: WorkerLike;
    try {
      w = this.create();
    } catch (e) {
      this.fail('worker', String(e));
      return;
    }
    this.worker = w;
    w.onmessage = (e) => this.onMessage(e.data);
    w.onerror = (e) => {
      e.preventDefault?.();
      this.fail(this.statusValue.state === 'ready' ? 'crashed' : 'worker', e.message || 'worker error');
    };
    w.postMessage({ type: 'load' });
  }

  /**
   * Decodes one slot. The samples are transferred to the worker: pass a copy. With `more`, an
   * FT8 slot also runs the later stages, and `more` receives what each finds after the
   * returned decodes.
   */
  decodeSlot(slot: SlotAudio, more?: (d: Decode[]) => void): Promise<Decode[]> {
    if (this.statusValue.state === 'failed') return Promise.reject(new DecoderUnavailableError(this.statusValue.detail));
    this.load();
    if (!this.worker) return Promise.reject(new DecoderUnavailableError('no worker'));
    if (this.pending.size >= this.maxPending) return Promise.reject(new DecoderBusyError(`${this.pending.size} slots waiting`));
    const id = this.nextId++;
    const deep = more && slot.mode === 'FT8' && this.deep ? this.deep : undefined;
    const done = new Promise<Decode[]>((resolve, reject) => this.pending.set(id, { resolve, reject, more: deep && more }));
    this.worker.postMessage({ type: 'decode', id, mode: slot.mode, preset: this.preset, samples: slot.samples, ...(deep ? { deep } : {}), ...(slot.qso ? { qso: slot.qso } : {}) }, [slot.samples.buffer]);
    return done;
  }

  /** Decodes one WSPR slot with the `wspr` preset. The samples are transferred to the worker: pass a copy. */
  decodeWspr(samples: Float32Array): Promise<{ decodes: WsprDecode[]; ms: number }> {
    if (this.statusValue.state === 'failed') return Promise.reject(new DecoderUnavailableError(this.statusValue.detail));
    this.load();
    if (!this.worker) return Promise.reject(new DecoderUnavailableError('no worker'));
    if (this.pending.size >= this.maxPending) return Promise.reject(new DecoderBusyError(`${this.pending.size} slots waiting`));
    const id = this.nextId++;
    const done = new Promise<{ decodes: WsprDecode[]; ms: number }>((resolve, reject) => this.pending.set(id, { resolve: () => undefined, reject, wspr: resolve }));
    this.worker.postMessage({ type: 'decodeWspr', id, preset: WSPR_PRESET, samples }, [samples.buffer]);
    return done;
  }

  /** Checks text for transmission: canonical form and type, or why it cannot be sent. */
  pack(text: string, mode: Mode): Promise<Packed> {
    return this.request<Packed>({ type: 'pack', id: 0, text, mode });
  }

  /** Synthesises a transmission at `sampleRate`, peak 1. */
  synthesize(text: string, mode: Mode, f0Hz: number, sampleRate: number): Promise<Float32Array> {
    return this.request<Float32Array>({ type: 'synth', id: 0, text, mode, f0Hz, sampleRate });
  }

  private request<T>(m: Extract<ToDecoder, { type: 'pack' | 'synth' }>): Promise<T> {
    if (this.statusValue.state === 'failed') return Promise.reject(new DecoderUnavailableError(this.statusValue.detail));
    this.load();
    if (!this.worker) return Promise.reject(new DecoderUnavailableError('no worker'));
    const id = this.nextId++;
    const done = new Promise<T>((resolve, reject) => this.requests.set(id, { resolve, reject } as Request<Packed> | Request<Float32Array>));
    this.worker.postMessage({ ...m, id });
    return done;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new DecoderUnavailableError('disposed'));
    for (const r of this.requests.values()) r.reject(new DecoderUnavailableError('disposed'));
    this.pending.clear();
    this.requests.clear();
    this.more.clear();
  }

  private onMessage(m: FromDecoder) {
    if (m.type === 'ready') this.setStatus({ state: 'ready', version: m.version, loadMs: m.loadMs });
    else if (m.type === 'failed') this.fail(m.reason, m.detail);
    else if (m.type === 'packed' || m.type === 'synthesized' || (m.type === 'error' && this.requests.has(m.id))) {
      const r = this.requests.get(m.id);
      if (!r) return;
      this.requests.delete(m.id);
      if (m.type === 'packed') (r as Request<Packed>).resolve(m.packed);
      else if (m.type === 'synthesized') (r as Request<Float32Array>).resolve(m.samples);
      else r.reject(new Error(m.detail));
    } else if (m.type === 'decodedMore') {
      const more = this.more.get(m.id);
      if (m.done) this.more.delete(m.id);
      if (more && m.decodes.length) more(m.decodes);
    } else {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.type === 'decoded' && p.more) this.more.set(m.id, p.more);
      if (m.type === 'decoded') p.resolve(m.decodes);
      else if (m.type === 'decodedWspr') p.wspr?.({ decodes: m.decodes, ms: m.ms });
      else p.reject(new Error(m.detail));
    }
  }

  private fail(reason: DecoderFailure, detail: string) {
    this.worker?.terminate();
    this.worker = null;
    this.setStatus({ state: 'failed', reason, detail });
    for (const p of this.pending.values()) p.reject(new DecoderUnavailableError(detail));
    for (const r of this.requests.values()) r.reject(new DecoderUnavailableError(detail));
    this.pending.clear();
    this.requests.clear();
    this.more.clear();
  }

  private setStatus(s: DecoderStatus) {
    this.statusValue = s;
    for (const l of this.listeners) l(s);
  }
}

/** The decoder the app uses: the WebAssembly worker where workers exist. */
export function createDecoder(): DecoderClient {
  return new WorkerDecoder();
}
