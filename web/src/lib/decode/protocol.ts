/**
 * Messages between the app and the decoder worker. Slot audio goes to the worker as a
 * transferred copy (ADR 0004); decodes come back as plain objects.
 */

import type { Mode } from '../clock/slots';
import type { Decode, QsoContext } from './types';
import type { WsprDecode } from '../wspr/spots';

/** Why the decoder is not available. */
export type DecoderFailure = 'missing' | 'load' | 'worker' | 'crashed';

/** pack_message's answer for the Tx editor, and pack_wspr's for the WSPR beacon. */
export interface Packed {
  ok: boolean;
  /** Canonical text when ok; the input otherwise. */
  text: string;
  /** Message type, such as "1.0"; for WSPR "1", "2" or "3". */
  i3n3: string;
  error: string | null;
}

/** The WSPR decoder preset operators get (docs/experiments/0004-wspr.md). CI gates it against bench/wspr.json. */
export const WSPR_PRESET = 'wspr';

/**
 * Later decoder stages for one slot: `plan` lists them as a DecoderSession plan (stages
 * separated by `;`). They run after the preset, on what it left, until they finish, `budgetMs`
 * has passed since the slot's decoding started, or the next slot arrives.
 */
export interface DeepStages {
  plan: string;
  budgetMs: number;
}

export type ToDecoder =
  | { type: 'load' }
  | { type: 'decode'; id: number; mode: Mode; preset: string; samples: Float32Array; deep?: DeepStages; qso?: QsoContext }
  | { type: 'decodeWspr'; id: number; preset: string; samples: Float32Array }
  | { type: 'pack'; id: number; text: string; mode: Mode }
  | { type: 'synth'; id: number; text: string; mode: Mode; f0Hz: number; sampleRate: number };

export type FromDecoder =
  | { type: 'ready'; version: string; loadMs: number }
  | { type: 'failed'; reason: DecoderFailure; detail: string }
  | { type: 'decoded'; id: number; decodes: Decode[]; ms: number }
  /** New decodes from the later stages of slot `id`; `done` on the last message for the slot. */
  | { type: 'decodedMore'; id: number; decodes: Decode[]; ms: number; done: boolean }
  | { type: 'decodedWspr'; id: number; decodes: WsprDecode[]; ms: number }
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
  return readDecodes(raw);
}

/** As parseDecodes, for a value already parsed from JSON. */
export function readDecodes(raw: unknown): Decode[] {
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
