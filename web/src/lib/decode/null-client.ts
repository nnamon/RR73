import type { Decode, DecoderClient } from './types';

/**
 * Decoder that finds nothing. Used until the WebAssembly decoder from crates/rr73-wasm
 * (built into src/wasm/pkg/) is wired in behind the same interface.
 */
export class NullDecoder implements DecoderClient {
  readonly available = false;

  async decodeSlot(): Promise<Decode[]> {
    return [];
  }

  dispose() {}
}

/** The decoder the app uses. */
export function createDecoder(): DecoderClient {
  return new NullDecoder();
}
