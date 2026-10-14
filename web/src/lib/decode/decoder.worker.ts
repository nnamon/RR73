// Decoder worker: runs rr73-wasm off the main thread: decoding one slot at a time, and the
// encoder for the transmit path (checking messages, synthesising audio). The
// module is optional at build time (src/wasm/pkg is built by wasm-pack and git-ignored); a
// build without it reports the decoder as missing and receive carries on.

import { DecoderCore, type WasmModule } from './core';
import type { FromDecoder, ToDecoder } from './protocol';

const modules = import.meta.glob<WasmModule>('../../wasm/pkg/rr73_wasm.js');
const loader = Object.values(modules)[0] ?? null;

const scope = self as unknown as {
  postMessage(m: FromDecoder, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToDecoder>) => void) | null;
};

const core = new DecoderCore(loader, (m, transfer) => scope.postMessage(m, transfer ?? []));

scope.onmessage = (e) => {
  void core.handle(e.data);
};
