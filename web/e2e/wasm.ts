// The rr73-wasm package in Node, for e2e fixtures and for decoding what the app transmitted.
// Returns null when the package has not been built (src/wasm/pkg is git-ignored).
import { existsSync, readFileSync } from 'node:fs';

export interface Wasm {
  decode_slot(samples: Float32Array, mode: string, preset: string): string;
  synthesize(text: string, mode: string, f0Hz: number, sampleRate: number): Float32Array;
  pack_message(text: string, mode: string): string;
}

let cached: Promise<Wasm | null> | null = null;

export function loadWasm(): Promise<Wasm | null> {
  cached ??= (async () => {
    const js = new URL('../src/wasm/pkg/rr73_wasm.js', import.meta.url);
    const bin = new URL('../src/wasm/pkg/rr73_wasm_bg.wasm', import.meta.url);
    if (!existsSync(js) || !existsSync(bin)) return null;
    const mod = (await import(js.href)) as Wasm & { initSync(o: { module: Uint8Array }): unknown };
    mod.initSync({ module: readFileSync(bin) });
    return mod;
  })();
  return cached;
}
