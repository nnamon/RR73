/**
 * Messages between the app and the decoder worker. Slot audio goes to the worker as a
 * transferred copy (ADR 0004); decodes come back as plain objects.
 */

import type { Mode } from '../clock/slots';
import type { Decode } from './types';

/** Why the decoder is not available. */
export type DecoderFailure = 'missing' | 'load' | 'worker' | 'crashed';

/** pack_message's answer for the Tx editor. */
export interface Packed {
  ok: boolean;
  /** Canonical text when ok; the input otherwise. */
  text: string;
  /** Message type, such as "1.0". */
  i3n3: string;
  error: string | null;
}

export type ToDecoder =
  | { type: 'load' }
  | { type: 'decode'; id: number; mode: Mode; preset: string; samples: Float32Array }
  | { type: 'pack'; id: number; text: string; mode: Mode }
  | { type: 'synth'; id: number; text: string; mode: Mode; f0Hz: number; sampleRate: number };

export type FromDecoder =
  | { type: 'ready'; version: string; loadMs: number }
  | { type: 'failed'; reason: DecoderFailure; detail: string }
  | { type: 'decoded'; id: number; decodes: Decode[]; ms: number }
  | { type: 'packed'; id: number; packed: Packed }
  | { type: 'synthesized'; id: number; samples: Float32Array; ms: number }
  | { type: 'error'; id: number; detail: string };

/**
 * Reads the decoder's JSON output: an array of { text, freq_hz, dt_s, snr_db }. Entries with a
 * missing or non-finite field are dropped; anything that is not an array gives none.
 */
export function parseDecodes(json: string): Decode[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Decode[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const { text, freq_hz, dt_s, snr_db } = r;
    if (typeof text !== 'string' || !text.trim()) continue;
    if (![freq_hz, dt_s, snr_db].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    out.push({ text: text.trim(), freq_hz: freq_hz as number, dt_s: dt_s as number, snr_db: snr_db as number });
  }
  return out;
}
