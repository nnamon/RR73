/**
 * Messages between the app, the keyboard worker and the stream worklet.
 *
 * Receive: the app posts each 12 kHz capture chunk to the worker and gets back the modem's
 * events. Transmit: the app links the worker to a stream worklet node with a MessageChannel; the
 * worker renders blocks straight to the worklet, ahead of the audio thread, so a busy main
 * thread cannot open a gap in the keying. The app hands the worker text a little at a time
 * (lib/keyboard/session.ts) and the worklet tells the app when the audio has played out.
 */

import type { KeyboardMode } from '../clock/slots';
import type { RttySettings } from '../rtty/settings';
import type { CharTables, ModemEvent } from './modem';

export type ToKeyboard =
  | { type: 'load' }
  | { type: 'configure'; mode: KeyboardMode; rtty: RttySettings }
  | { type: 'push'; samples: Float32Array }
  | { type: 'flush' }
  | { type: 'tune'; hz: number }
  | { type: 'find'; hz: number; rangeHz: number }
  | { type: 'afc'; on: boolean }
  | { type: 'reset' }
  /** Starts a transmitter at `sampleRate` on the receiver's pair, rendering to the worklet through `port`. */
  | { type: 'txStart'; sampleRate: number; level: number; port: MessagePort }
  | { type: 'txText'; text: string }
  | { type: 'txFinish' }
  /** Halt: the transmitter is dropped and nothing more is rendered. */
  | { type: 'txStop' }
  | { type: 'encode'; id: number; text: string; hz: number };

export type FromKeyboard =
  | { type: 'ready'; version: string }
  | { type: 'failed'; detail: string }
  | { type: 'tables'; tables: CharTables }
  | { type: 'events'; events: ModemEvent[] }
  /** After each rendered block: audio still queued in the transmitter (s), characters skipped, and whether it has ended. */
  | { type: 'tx'; queuedS: number; skipped: number; done: boolean }
  | { type: 'encoded'; id: number; samples: Float32Array | null };

/** Worker to worklet. */
export type ToStream = { type: 'block'; samples: Float32Array } | { type: 'end' };
/** Worklet to worker: frames taken from blocks so far. */
export type StreamNeed = { type: 'need'; takenFrames: number };

/** App to worklet. */
export type ToStreamNode = { type: 'link'; port: MessagePort } | { type: 'stop' } | { type: 'record'; on: boolean };
/** Worklet to app. */
export type FromStreamNode =
  | { type: 'started' }
  /** The last block has played. Frames of silence played between blocks while the stream ran (underruns), and frames played. */
  | { type: 'drained'; underrunFrames: number; playedFrames: number }
  | { type: 'stats'; underrunFrames: number; playedFrames: number; bufferedFrames: number }
  | { type: 'recording'; samples: Float32Array };

export const STREAM_PROCESSOR = 'rr73-stream';
/** Rendered block length, s. */
export const BLOCK_S = 0.1;
/** Audio the worker keeps rendered ahead of the audio thread, s. */
export const AHEAD_S = 0.3;
