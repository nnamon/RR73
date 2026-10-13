import type { Decode, DecoderClient, DecoderStatus } from './types';
import type { Packed } from './protocol';

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

  async pack(text: string): Promise<Packed> {
    return { ok: false, text, i3n3: '', error: 'The encoder is not available.' };
  }

  async synthesize(): Promise<Float32Array> {
    throw new Error('The encoder is not available.');
  }

  dispose() {}
}
