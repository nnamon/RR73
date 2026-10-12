/**
 * The decoder worker's logic, apart from the worker global so it can be tested: loads the
 * WebAssembly module once, then decodes each slot it is sent, in order.
 */

import { parseDecodes, type FromDecoder, type Packed, type ToDecoder } from './protocol';

/** The parts of the wasm-pack module (crates/rr73-wasm) the worker uses. */
export interface WasmModule {
  /** Fetches and instantiates the .wasm file. */
  default: (input?: unknown) => Promise<unknown>;
  decode_slot: (samples: Float32Array, mode: string, preset: string) => string;
  pack_message: (text: string, mode: string) => string;
  synthesize: (text: string, mode: string, f0Hz: number, sampleRate: number) => Float32Array;
  version: () => string;
}

export type Loader = () => Promise<WasmModule>;

function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export class DecoderCore {
  private module: Promise<WasmModule | null> | null = null;
  private readonly loader: Loader | null;
  private readonly post: (m: FromDecoder, transfer?: Transferable[]) => void;
  private readonly now: () => number;

  /** `loader` is null when the build has no decoder module. */
  constructor(loader: Loader | null, post: (m: FromDecoder, transfer?: Transferable[]) => void, now: () => number = () => performance.now()) {
    this.loader = loader;
    this.post = post;
    this.now = now;
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
    const t0 = this.now();
    try {
      if (m.type === 'decode') {
        const json = mod.decode_slot(m.samples, m.mode, m.preset);
        this.post({ type: 'decoded', id: m.id, decodes: parseDecodes(json), ms: this.now() - t0 });
      } else if (m.type === 'pack') {
        this.post({ type: 'packed', id: m.id, packed: readPacked(mod.pack_message(m.text, m.mode), m.text) });
      } else {
        const samples = mod.synthesize(m.text, m.mode, m.f0Hz, m.sampleRate);
        this.post({ type: 'synthesized', id: m.id, samples, ms: this.now() - t0 }, [samples.buffer]);
      }
    } catch (e) {
      this.post({ type: 'error', id: m.id, detail: describe(e) });
    }
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
