// Decoder worker: runs the rr73-wasm decoder off the main thread, one slot at a time. The
// module is optional at build time (src/wasm/pkg is built by wasm-pack and git-ignored); a
// build without it reports the decoder as missing and receive carries on.

import { DecoderCore, type WasmModule } from './core';
import type { FromDecoder, ToDecoder } from './protocol';

const modules = import.meta.glob<WasmModule>('../../wasm/pkg/rr73_wasm.js');
const loader = Object.values(modules)[0] ?? null;

const scope = self as unknown as {
  postMessage(m: FromDecoder): void;
  onmessage: ((e: MessageEvent<ToDecoder>) => void) | null;
};

const core = new DecoderCore(loader, (m) => scope.postMessage(m));

scope.onmessage = (e) => {
  void core.handle(e.data);
};
