import type { Mode } from '../clock/slots';

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

export interface DecoderClient {
  /** False for the null decoder: the app says no decoder is built in. */
  readonly available: boolean;
  /** Decodes one slot. The samples may be transferred to a worker; callers keep a copy if needed. */
  decodeSlot(slot: SlotAudio): Promise<Decode[]>;
  dispose(): void;
}
