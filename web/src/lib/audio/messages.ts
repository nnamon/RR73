import type { ChannelUse } from './channels';

/** Name the capture worklet registers. */
export const CAPTURE_PROCESSOR = 'rr73-capture';

/** Samples at 12 kHz per chunk posted by the worklet: 42.7 ms. */
export const CHUNK_SAMPLES = 512;

/** 12 kHz audio for the decoders and the waterfall, with the level of the raw input it came from. */
export interface CaptureChunkMessage {
  type: 'chunk';
  /** Mono samples at 12000 Hz. */
  samples: Float32Array;
  /** Running index of samples[0] since the worklet started, samples at 12 kHz. */
  index: number;
  /** Audio-clock (AudioContext) time of samples[0], s. */
  contextTime: number;
  /** Peak of the raw input channel in use since the previous chunk, dBFS. */
  peakDb: number;
  /** RMS of the raw input channel in use since the previous chunk, dBFS. */
  rmsDb: number;
}

/** What arrives at the worklet. Posted at start and whenever it changes. */
export interface CaptureFormatMessage {
  type: 'format';
  /** Channels arriving at the worklet. */
  channels: number;
  /** The channel the worklet uses. */
  channelUsed: ChannelUse;
  /** AudioContext rate the worklet runs at, Hz. */
  sampleRate: number;
}

export type CaptureMessage = CaptureChunkMessage | CaptureFormatMessage;
