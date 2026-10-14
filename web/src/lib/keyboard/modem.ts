/**
 * One keyboard mode's modem, as the keyboard worker drives it (docs/design/rtty.md, "Keyboard
 * engine"). RTTY's is lib/rtty/modem.ts; PSK31, Olivia and the later keyboard modes bring their
 * own and keep the rest of lib/keyboard.
 */

import type { KeyboardMode } from '../clock/slots';

export type ModemEvent =
  /** A received character; quality is the bit confidence, 0 to 1. SNR in dB in 3000 Hz. */
  | { type: 'char'; ch: string; snrDb: number; quality: number; framingError: boolean }
  /** The signal at the receiver's frequency, every 0.51 s in RTTY. */
  | { type: 'signal'; snrDb: number; squelchOpen: boolean }
  /** The receiver's tones moved, Hz: RTTY's [mark, space]. */
  | { type: 'tones'; hz: number[] }
  /** A search found a signal of another kind: RTTY's shift, Hz. */
  | { type: 'shift'; hz: number };

/** The modem's character tables, for the main thread: computed by the modem once per setting. */
export interface CharTables {
  /** Characters the mode cannot send, each once. */
  unsendable: string;
  /** Pairs of a character and its other-case reading, "Q1W2…": RTTY's letters and figures. Empty for modes without cases. */
  otherCase: string;
}

/** One keyboard mode's modem, as the keyboard worker drives it. */
export interface KeyboardModem {
  readonly mode: KeyboardMode;
  /** True when the mode sends capitals only (RTTY). */
  readonly upperCaseOnly: boolean;
  /** The characters in `text` the mode cannot send, each once. */
  unsendable(text: string): string;
  /** `text` read in the other case; `text` itself for modes without cases. */
  otherCase(text: string): string;
  /** 12 kHz mono capture; returns the events it completed, oldest first. */
  push(samples: Float32Array): ModemEvent[];
  /** Characters still held for the receiver's output delay. */
  flush(): ModemEvent[];
  /** Moves the receiver to a signal at `hz` (RTTY: the mark tone). */
  tune(hz: number): void;
  /** Searches near `hz`, within `rangeHz`, and moves to the strongest signal. */
  find(hz: number, rangeHz: number): void;
  setAfc(on: boolean): void;
  /** Clears receive state after a transmission. */
  reset(): void;
  /** A transmitter at the output rate, Hz, with output level 0 to 1. */
  transmitter(sampleRate: number, level: number): ModemTx;
  /** One transmission at `hz` (RTTY: the mark tone) rendered at 12 kHz, peak 1, for the practice band. */
  encode(text: string, hz: number): Float32Array;
  free(): void;
}

export interface ModemTx {
  /** Queues text; returns the number of characters skipped. */
  pushText(text: string): number;
  /** Up to `n` samples; fewer only once the transmission has ended. */
  render(n: number): Float32Array;
  /** Sends the queue and the tail, then ends. */
  finish(): void;
  /** Audio still queued, s. */
  readonly queuedS: number;
  readonly done: boolean;
  free(): void;
}

/** Every printable ASCII character, for building CharTables. */
export const PRINTABLE = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

/** The tables of a modem: what it cannot send among printable ASCII, and each upper-case character's other-case reading where it differs. */
export function charTables(m: Pick<KeyboardModem, 'unsendable' | 'otherCase'>): CharTables {
  const upper = [...new Set(PRINTABLE.toUpperCase())].join('');
  const read = m.otherCase(upper);
  let pairs = '';
  for (let i = 0; i < upper.length; i++) if (read[i] !== undefined && read[i] !== upper[i]) pairs += upper[i] + read[i];
  return { unsendable: m.unsendable(upper.replace(/[a-z]/g, '')), otherCase: pairs };
}

/** Reads text in the other case from CharTables' pairs. */
export function otherCaseReader(t: CharTables): (text: string) => string {
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < t.otherCase.length; i += 2) map.set(t.otherCase[i], t.otherCase[i + 1]);
  return (text) => [...text.toUpperCase()].map((c) => map.get(c) ?? c).join('');
}
