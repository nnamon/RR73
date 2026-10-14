/**
 * The decoder worker's logic, apart from the worker global so it can be tested: loads the
 * WebAssembly module once, then decodes each slot it is sent, in order.
 *
 * A slot sent with later stages (`deep`) is decoded with the preset first and those decodes
 * are posted at once. The later stages then run in slices of at most SLICE_MS, yielding
 * between slices so encoder requests are answered within a slice. They stop when they finish,
 * when `deep.budgetMs` has passed since the slot's decoding started, or when the next slot
 * arrives.
 */

import { parseDecodes, readDecodes, type DeepStages, type FromDecoder, type Packed, type ToDecoder } from './protocol';
import { parseWsprDecodes } from '../wspr/spots';

/** The parts of the wasm-pack module (crates/rr73-wasm) the worker uses. */
export interface WasmModule {
  /** Fetches and instantiates the .wasm file. */
  default: (input?: unknown) => Promise<unknown>;
  decode_slot: (samples: Float32Array, mode: string, preset: string) => string;
  pack_message: (text: string, mode: string) => string;
  synthesize: (text: string, mode: string, f0Hz: number, sampleRate: number) => Float32Array;
  decode_wspr: (samples: Float32Array, preset: string) => string;
  pack_wspr: (text: string) => string;
  synthesize_wspr: (text: string, freqHz: number, sampleRate: number) => Float32Array;
  version: () => string;
  /** A slot decoded stage by stage (crates/rr73-wasm `DecoderSession`). */
  DecoderSession?: new (samples: Float32Array, mode: string, plan: string) => WasmSession;
}

/** The parts of rr73-wasm's DecoderSession the worker uses. */
export interface WasmSession {
  /** Runs the current stage to its end: its new decodes as JSON, or undefined when done. */
  next_stage(): string | undefined;
  /** One bounded unit of work: JSON `{ decodes, stage, stage_done, done }`. */
  step(): string;
  readonly done: boolean;
  /** Gives the decoder context back to the worker. */
  free(): void;
}

export type Loader = () => Promise<WasmModule>;

/** Longest run of later-stage work between yields, ms. */
export const SLICE_MS = 40;

/** Later stages in progress for one slot. */
interface DeepJob {
  id: number;
  session: WasmSession | null;
  t0: number;
  budgetMs: number;
  /** Decodes found since the last message. */
  found: ReturnType<typeof readDecodes>;
}

function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export class DecoderCore {
  private module: Promise<WasmModule | null> | null = null;
  private readonly loader: Loader | null;
  private readonly post: (m: FromDecoder, transfer?: Transferable[]) => void;
  private readonly now: () => number;
  private readonly pause: () => Promise<void>;
  private deep: DeepJob | null = null;

  /**
   * `loader` is null when the build has no decoder module. `pause` yields to the worker's
   * message loop between slices of later-stage work.
   */
  constructor(
    loader: Loader | null,
    post: (m: FromDecoder, transfer?: Transferable[]) => void,
    now: () => number = () => performance.now(),
    pause: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0)),
  ) {
    this.loader = loader;
    this.post = post;
    this.now = now;
    this.pause = pause;
  }

  async handle(m: ToDecoder): Promise<void> {
    if (m.type === 'load') {
      await this.load();
      return;
    }
    const mod = await this.load();
    if (!mod) {
      this.post({ type: 'error', id: m.id, detail: 'The decoder is not available.' });
      return;
    }
    // The next slot ends the later stages of the one before, and frees its session first so
    // the decoder context (callsign hashes) is back with the worker.
    if (m.type === 'decode' || m.type === 'decodeWspr') this.stopDeep();
    const t0 = this.now();
    try {
      if (m.type === 'decode' && m.deep && mod.DecoderSession) {
        this.decodeDeep(mod.DecoderSession, m, m.deep, t0);
      } else if (m.type === 'decode') {
        const json = mod.decode_slot(m.samples, m.mode, m.preset);
        this.post({ type: 'decoded', id: m.id, decodes: parseDecodes(json), ms: this.now() - t0 });
      } else if (m.type === 'decodeWspr') {
        const json = mod.decode_wspr(m.samples, m.preset);
        this.post({ type: 'decodedWspr', id: m.id, decodes: parseWsprDecodes(json), ms: this.now() - t0 });
      } else if (m.type === 'pack') {
        this.post({ type: 'packed', id: m.id, packed: m.mode === 'WSPR' ? readWsprPacked(mod.pack_wspr(m.text), m.text) : readPacked(mod.pack_message(m.text, m.mode), m.text) });
      } else {
        const samples = m.mode === 'WSPR' ? mod.synthesize_wspr(m.text, m.f0Hz, m.sampleRate) : mod.synthesize(m.text, m.mode, m.f0Hz, m.sampleRate);
        this.post({ type: 'synthesized', id: m.id, samples, ms: this.now() - t0 }, [samples.buffer]);
      }
    } catch (e) {
      this.post({ type: 'error', id: m.id, detail: describe(e) });
    }
  }

  /** Decodes with the preset, posts its decodes, then starts the later stages. */
  private decodeDeep(Session: NonNullable<WasmModule['DecoderSession']>, m: Extract<ToDecoder, { type: 'decode' }>, deep: DeepStages, t0: number) {
    const session = new Session(m.samples, m.mode, [m.preset, deep.plan].join('; '));
    let first: string | undefined;
    try {
      first = session.next_stage();
    } catch (e) {
      session.free();
      throw e;
    }
    this.post({ type: 'decoded', id: m.id, decodes: parseDecodes(first ?? '[]'), ms: this.now() - t0 });
    const job: DeepJob = { id: m.id, session, t0, budgetMs: deep.budgetMs, found: [] };
    this.deep = job;
    void this.runDeep(job);
  }

  /** Steps the later stages in slices until they finish, run out of time or are stopped. */
  private async runDeep(job: DeepJob) {
    for (;;) {
      const session = job.session;
      if (!session) return;
      if (session.done || this.now() - job.t0 >= job.budgetMs) break;
      const end = Math.min(this.now() + SLICE_MS, job.t0 + job.budgetMs);
      try {
        while (!session.done && this.now() < end) {
          const out = JSON.parse(session.step()) as { decodes?: unknown; stage_done?: boolean };
          job.found.push(...readDecodes(out.decodes));
          if (out.stage_done && job.found.length) this.postMore(job, false);
        }
      } catch {
        break;
      }
      await this.pause();
    }
    this.finishDeep(job);
  }

  /** Ends the later stages of the slot in progress, if any. */
  private stopDeep() {
    if (this.deep) this.finishDeep(this.deep);
  }

  private finishDeep(job: DeepJob) {
    if (!job.session) return;
    job.session.free();
    job.session = null;
    if (this.deep === job) this.deep = null;
    this.postMore(job, true);
  }

  private postMore(job: DeepJob, done: boolean) {
    this.post({ type: 'decodedMore', id: job.id, decodes: job.found, ms: this.now() - job.t0, done });
    job.found = [];
  }

  /** Loads the module once; later calls share the first load. */
  load(): Promise<WasmModule | null> {
    this.module ??= this.start();
    return this.module;
  }

  private async start(): Promise<WasmModule | null> {
    if (!this.loader) {
      this.post({ type: 'failed', reason: 'missing', detail: 'The build has no decoder module (src/wasm/pkg).' });
      return null;
    }
    const t0 = this.now();
    try {
      const mod = await this.loader();
      await mod.default();
      this.post({ type: 'ready', version: mod.version(), loadMs: this.now() - t0 });
      return mod;
    } catch (e) {
      this.post({ type: 'failed', reason: 'load', detail: describe(e) });
      return null;
    }
  }
}

function readPacked(json: string, input: string): Packed {
  try {
    const r = JSON.parse(json) as Partial<Packed>;
    return { ok: r.ok === true, text: typeof r.text === 'string' ? r.text : input, i3n3: typeof r.i3n3 === 'string' ? r.i3n3 : '', error: typeof r.error === 'string' ? r.error : null };
  } catch {
    return { ok: false, text: input, i3n3: '', error: 'The encoder gave no answer.' };
  }
}

/** pack_wspr's answer: { ok, text, message_type, error }. */
function readWsprPacked(json: string, input: string): Packed {
  try {
    const r = JSON.parse(json) as { ok?: unknown; text?: unknown; message_type?: unknown; error?: unknown };
    return { ok: r.ok === true, text: typeof r.text === 'string' ? r.text : input, i3n3: typeof r.message_type === 'number' && r.message_type > 0 ? String(r.message_type) : '', error: typeof r.error === 'string' ? r.error : null };
  } catch {
    return { ok: false, text: input, i3n3: '', error: 'The encoder gave no answer.' };
  }
}
