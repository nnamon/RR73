import type { Mode } from '../clock/slots';
import type { DecoderFailure, Packed } from './protocol';

/** One message recovered from a slot. Field names match the corpus JSON and rr73-decode. */
export interface Decode {
  /** Message text exactly as transmitted. */
  text: string;
  /** Frequency of the lowest tone, Hz. */
  freq_hz: number;
  /** Time offset from the nominal start (slot start + 0.5 s), s. */
  dt_s: number;
  /** SNR in 2500 Hz, dB. */
  snr_db: number;
}

/** One slot of audio for a decoder. */
export interface SlotAudio {
  mode: Mode;
  /** Slot start, UTC ms. */
  startUtcMs: number;
  /** Exactly one slot at 12000 Hz. */
  samples: Float32Array;
}

/** Where the decoder stands. */
export type DecoderStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; version: string; loadMs: number }
  | { state: 'failed'; reason: DecoderFailure; detail: string };

export interface DecoderClient {
  /** False once the decoder has failed, and always for the null decoder. */
  readonly available: boolean;
  readonly status: DecoderStatus;
  onStatus(fn: (s: DecoderStatus) => void): () => void;
  /** Starts loading the decoder. Safe to call more than once. */
  load(): void;
  /** Decodes one slot. The samples may be transferred to a worker; callers keep a copy if needed. */
  decodeSlot(slot: SlotAudio): Promise<Decode[]>;
  /** Checks text for transmission. */
  pack(text: string, mode: Mode): Promise<Packed>;
  /** Synthesises a transmission at `sampleRate`, peak 1. */
  synthesize(text: string, mode: Mode, f0Hz: number, sampleRate: number): Promise<Float32Array>;
  dispose(): void;
}
