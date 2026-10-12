import type { Decode, DecoderClient, DecoderStatus } from './types';

/**
 * Decoder that finds nothing, for tests and for builds or phones where the WebAssembly decoder
 * cannot load. Its status says why, so the app can explain it.
 */
export class NullDecoder implements DecoderClient {
  readonly available = false;
  readonly status: DecoderStatus;

  constructor(status: DecoderStatus = { state: 'failed', reason: 'missing', detail: 'null decoder' }) {
    this.status = status;
  }

  onStatus(): () => void {
    return () => undefined;
  }

  load() {}

  async decodeSlot(): Promise<Decode[]> {
    return [];
  }

  dispose() {}
}
