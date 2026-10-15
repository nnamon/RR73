// The rr73-wasm package in Node, for e2e fixtures and for decoding what the app transmitted.
// Returns null when the package has not been built (src/wasm/pkg is git-ignored).
import { existsSync, readFileSync } from 'node:fs';
// Node's URL under another name: in vitest's jsdom environment Vite rewrites `new URL(path,
// import.meta.url)` to an http: asset address.
import { URL as FileUrl } from 'node:url';

export interface Wasm {
  decode_slot(samples: Float32Array, mode: string, preset: string): string;
  synthesize(text: string, mode: string, f0Hz: number, sampleRate: number): Float32Array;
  pack_message(text: string, mode: string): string;
  /** RTTY's streaming receiver (crates/rr73-wasm/src/rtty.rs), for decoding what the app sent. */
  RttyReceiver: new (json: string) => { push(samples: Float32Array): string; flush(): string; free(): void };
  rtty_encode(text: string, json: string): Float32Array;
  /** Rig control (crates/rr73-wasm/src/cat.rs): a CI-V request as JSON to the bytes for the radio at `radio`. */
  cat_encode(requestJson: string, radio: number): Uint8Array;
  cat_answers(requestJson: string, eventJson: string): boolean;
  CatParser: new (radio: number) => { push(bytes: Uint8Array): string; reset(): void; readonly radio_address: number; free(): void };
}

let cached: Promise<Wasm | null> | null = null;

export function loadWasm(): Promise<Wasm | null> {
  cached ??= (async () => {
    const js = new FileUrl('../src/wasm/pkg/rr73_wasm.js', import.meta.url);
    const bin = new FileUrl('../src/wasm/pkg/rr73_wasm_bg.wasm', import.meta.url);
    if (!existsSync(js) || !existsSync(bin)) return null;
    const mod = (await import(js.href)) as Wasm & { initSync(o: { module: Uint8Array }): unknown };
    mod.initSync({ module: readFileSync(bin) });
    return mod;
  })();
  return cached;
}
