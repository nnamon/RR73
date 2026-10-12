/**
 * The app's decoder: a module worker running rr73-wasm. Slots are decoded one at a time in
 * the worker, so the main thread never waits. At most 2 slots wait for the decoder; a third
 * is refused (DecoderBusyError) so a slow phone falls behind by whole slots and never builds
 * a queue.
 */

import type { FromDecoder, ToDecoder, DecoderFailure } from './protocol';
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
  reject: (e: Error) => void;
}

/**
 * The decoder preset operators get. `subtract-3` decodes up to 3 passes, subtracting each decoded
 * signal before the next; docs/experiments/0001-subtraction.md has the measurements, and CI gates
 * this preset against bench/subtract-3.json.
 */
export const PRESET = 'subtract-3';

export class WorkerDecoder implements DecoderClient {
  private worker: WorkerLike | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private statusValue: DecoderStatus = { state: 'idle' };
  private readonly listeners = new Set<(s: DecoderStatus) => void>();
  private readonly create: () => WorkerLike;
  private readonly preset: string;
  private readonly maxPending: number;

  constructor(
    create: () => WorkerLike = () => new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
    preset = PRESET,
    maxPending = 2,
  ) {
    this.create = create;
    this.preset = preset;
    this.maxPending = maxPending;
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

  /** Decodes one slot. The samples are transferred to the worker: pass a copy. */
  decodeSlot(slot: SlotAudio): Promise<Decode[]> {
    if (this.statusValue.state === 'failed') return Promise.reject(new DecoderUnavailableError(this.statusValue.detail));
    this.load();
    if (!this.worker) return Promise.reject(new DecoderUnavailableError('no worker'));
    if (this.pending.size >= this.maxPending) return Promise.reject(new DecoderBusyError(`${this.pending.size} slots waiting`));
    const id = this.nextId++;
    const done = new Promise<Decode[]>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.worker.postMessage({ type: 'decode', id, mode: slot.mode, preset: this.preset, samples: slot.samples }, [slot.samples.buffer]);
    return done;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new DecoderUnavailableError('disposed'));
    this.pending.clear();
  }

  private onMessage(m: FromDecoder) {
    if (m.type === 'ready') this.setStatus({ state: 'ready', version: m.version, loadMs: m.loadMs });
    else if (m.type === 'failed') this.fail(m.reason, m.detail);
    else {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.type === 'decoded') p.resolve(m.decodes);
      else p.reject(new Error(m.detail));
    }
  }

  private fail(reason: DecoderFailure, detail: string) {
    this.worker?.terminate();
    this.worker = null;
    this.setStatus({ state: 'failed', reason, detail });
    for (const p of this.pending.values()) p.reject(new DecoderUnavailableError(detail));
    this.pending.clear();
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
