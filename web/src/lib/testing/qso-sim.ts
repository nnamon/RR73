// A test bench for the sequencer: plays the audio layer (scheduled transmissions start and
// end on time) and the decoder (decodes for a slot arrive 0.1 s after it ends). Used by
// sequencer.test.ts; not part of the app.

import { SLOT_MS, type Mode } from '../clock/slots';
import type { Decode } from '../decode/types';
import { initialState, reduce, type SeqConfig, type SeqEffect, type SeqEvent, type SeqState } from '../qso/sequencer';
import type { TxNum } from '../qso/messages';

/** 13:14:00 UTC on 13 October 2026: an even FT8 slot. */
export const T0 = Date.UTC(2026, 9, 13, 13, 14, 0);

export function config(over: Partial<SeqConfig> = {}): SeqConfig {
  return {
    myCall: '9V1NE',
    myGrid: 'OJ11',
    mode: 'FT8',
    band: '20m',
    dialHz: 14074000,
    txHz: 1500,
    ack: 'RR73',
    maxRetries: 3,
    order: 'first',
    workDupes: false,
    watchdogMs: 6 * 60_000,
    cqParity: 'even',
    cqModifier: null,
    preset: 'subtract-3',
    ...over,
  };
}

export interface Transmission {
  slot: number;
  tx: TxNum;
  text: string;
  offsetS: number;
}

export function decode(text: string, snr_db = -10, freq_hz = 1200, dt_s = 0.1): Decode {
  return { text, snr_db, freq_hz, dt_s };
}

export class Sim {
  st: SeqState;
  effects: SeqEffect[] = [];
  sent: Transmission[] = [];
  pending: { tx: TxNum; text: string; slotStartMs: number; startOffsetS: number } | null = null;
  readonly mode: Mode;

  constructor(over: Partial<SeqConfig> = {}, confirmed = true) {
    this.st = initialState(config(over));
    this.mode = this.st.config.mode;
    if (confirmed) this.send({ type: 'bandConfirmed', band: '20m', dialHz: this.st.config.dialHz, mode: this.mode, nowMs: T0 - 60_000 });
    this.effects = [];
  }

  get len() {
    return SLOT_MS[this.mode];
  }

  /** Start of slot i, counted from T0. */
  at(i: number, s = 0): number {
    return T0 + i * this.len + s * 1000;
  }

  send(e: SeqEvent): SeqEffect[] {
    const r = reduce(this.st, e);
    this.st = r.state;
    this.effects.push(...r.effects);
    for (const f of r.effects) {
      if (f.type === 'scheduleTx') this.pending = { tx: f.tx, text: f.text, slotStartMs: f.slotStartMs, startOffsetS: f.startOffsetS };
      if (f.type === 'cancelTx') this.pending = null;
    }
    return r.effects;
  }

  /** Plays our scheduled transmission in slot i, if there is one, to the end (or halted at haltAtS). */
  play(i: number, haltAtS?: number) {
    const p = this.pending;
    if (!p || p.slotStartMs !== this.at(i)) return;
    this.pending = null;
    this.send({ type: 'txStarted', slotStartMs: p.slotStartMs, text: p.text, nowMs: p.slotStartMs + p.startOffsetS * 1000 });
    this.sent.push({ slot: i, tx: p.tx, text: p.text, offsetS: p.startOffsetS });
    if (haltAtS !== undefined) {
      this.send({ type: 'halt', nowMs: this.at(i, haltAtS) });
      this.send({ type: 'txEnded', slotStartMs: p.slotStartMs, text: p.text, complete: false, nowMs: this.at(i, haltAtS) });
      return;
    }
    const dur = this.mode === 'FT8' ? 12.64 : 5.04;
    this.send({ type: 'txEnded', slotStartMs: p.slotStartMs, text: p.text, complete: true, nowMs: p.slotStartMs + (p.startOffsetS + dur) * 1000 });
  }

  /** The decodes of slot i arrive `delayS` after it ends. */
  hear(i: number, decodes: (string | Decode)[], delayS = 0.1, pass: 'early' | 'final' = 'final') {
    return this.send({
      type: 'slotDecoded',
      slotStartMs: this.at(i),
      pass,
      decodes: decodes.map((d) => (typeof d === 'string' ? decode(d) : d)),
      nowMs: this.at(i + 1, delayS),
    });
  }

  /** Operator double-taps a decode heard in slot i, `afterS` into the slot after it. */
  call(i: number, d: string | Decode, afterS = 0.3) {
    return this.send({ type: 'callStation', decode: typeof d === 'string' ? decode(d) : d, slotStartMs: this.at(i), nowMs: this.at(i + 1, afterS) });
  }

  /** Runs slots from..to: plays ours, hears theirs from the script. */
  run(from: number, to: number, heard: Record<number, (string | Decode)[]> = {}) {
    for (let i = from; i <= to; i++) {
      this.play(i);
      this.hear(i, heard[i] ?? []);
    }
  }

  logged() {
    return this.effects.flatMap((f) => (f.type === 'logQso' ? [f.record] : []));
  }

  notices() {
    return this.effects.flatMap((f) => (f.type === 'notice' ? [f] : []));
  }
}
