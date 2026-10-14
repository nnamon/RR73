/**
 * RTTY's modem for the keyboard worker: rr73-wasm's RttyReceiver and RttyTransmitter
 * (crates/rr73-wasm/src/rtty.rs) behind the KeyboardModem interface.
 */

import type { KeyboardModem, ModemEvent, ModemTx } from '../keyboard/modem';
import { decoderConfig, txConfig, type RttySettings } from './settings';

/** The parts of rr73-wasm's RTTY exports the worker uses. */
export interface RttyWasm {
  RttyReceiver: new (json: string) => WasmReceiver;
  RttyTransmitter: new (json: string) => WasmTransmitter;
  rtty_encode: (text: string, json: string) => Float32Array;
  rtty_unsendable: (text: string, figures: string) => string;
  rtty_other_case: (text: string, figures: string) => string;
}

export interface WasmReceiver {
  push(samples: Float32Array): string;
  flush(): string;
  tune(markHz: number): void;
  find(nearHz: number, rangeHz: number): void;
  set_afc_tracking(on: boolean): void;
  reset(): void;
  readonly mark_hz: number;
  readonly space_hz: number;
  free(): void;
}

export interface WasmTransmitter {
  push_text(text: string): number;
  render(maxSamples: number): Float32Array;
  finish(): void;
  readonly is_done: boolean;
  readonly queued_s: number;
  free(): void;
}

/** One event as rr73-wasm's RttyReceiver writes it. */
type RawEvent =
  | { type: 'char'; ch: string; snr_db: number; quality: number; framing_error: boolean }
  | { type: 'signal'; snr_db: number; squelch_open: boolean }
  | { type: 'afc'; mark_hz: number; space_hz: number }
  | { type: 'tone_shift'; shift_hz: number }
  | { type: 'case' };

/** The receiver's JSON events as ModemEvents; `case` events carry nothing the app shows. */
export function readEvents(json: string): ModemEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: ModemEvent[] = [];
  for (const e of raw as RawEvent[]) {
    if (e.type === 'char') out.push({ type: 'char', ch: e.ch, snrDb: e.snr_db, quality: e.quality, framingError: e.framing_error });
    else if (e.type === 'signal') out.push({ type: 'signal', snrDb: e.snr_db, squelchOpen: e.squelch_open });
    else if (e.type === 'afc') out.push({ type: 'tones', hz: [e.mark_hz, e.space_hz] });
    else if (e.type === 'tone_shift') out.push({ type: 'shift', hz: e.shift_hz });
  }
  return out;
}

export class RttyModem implements KeyboardModem {
  readonly mode = 'RTTY' as const;
  readonly upperCaseOnly = true;
  private readonly rx: WasmReceiver;

  constructor(
    private readonly wasm: RttyWasm,
    private readonly settings: RttySettings,
  ) {
    this.rx = new wasm.RttyReceiver(JSON.stringify(decoderConfig(settings)));
  }

  unsendable(text: string): string {
    return this.wasm.rtty_unsendable(text, this.settings.figures);
  }

  otherCase(text: string): string {
    return this.wasm.rtty_other_case(text, this.settings.figures);
  }

  push(samples: Float32Array): ModemEvent[] {
    return readEvents(this.rx.push(samples));
  }

  flush(): ModemEvent[] {
    return readEvents(this.rx.flush());
  }

  tune(hz: number) {
    this.rx.tune(hz);
  }

  find(hz: number, rangeHz: number) {
    this.rx.find(hz, rangeHz);
  }

  setAfc(on: boolean) {
    this.rx.set_afc_tracking(on);
  }

  reset() {
    this.rx.reset();
  }

  /** The transmitter on the receiver's pair now: Tx uses the Rx pair. */
  transmitter(sampleRate: number, level: number): ModemTx {
    const tx = new this.wasm.RttyTransmitter(JSON.stringify(txConfig(this.settings, sampleRate, level, Math.round(this.rx.mark_hz))));
    return {
      pushText: (text) => tx.push_text(text),
      render: (n) => tx.render(n),
      finish: () => tx.finish(),
      get queuedS() {
        return tx.queued_s;
      },
      get done() {
        return tx.is_done;
      },
      free: () => tx.free(),
    };
  }

  encode(text: string, hz: number): Float32Array {
    return this.wasm.rtty_encode(text, JSON.stringify(txConfig(this.settings, 12000, 1, hz)));
  }

  free() {
    this.rx.free();
  }
}
