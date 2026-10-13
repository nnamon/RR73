/**
 * The JSON sidecar for a slot recorded in the app, in the corpus format (docs/corpus.md,
 * "rr73-slot/1"). `capture` is an addition for app recordings: it records how much of the slot
 * carries audio, so the bench can skip or weight slots with holes.
 */

import { SLOT_RATE, type Mode } from '../clock/slots';
import { isoUtc } from '../clock/format';

export interface SlotSidecar {
  format: 'rr73-slot/1';
  mode: Mode;
  start_utc: string;
  sample_rate: number;
  dial_hz: number;
  source: {
    kind: 'kx2';
    /** The input device label the browser reported. */
    input: string;
    /** AudioContext rate the audio was captured at, Hz. */
    capture_rate_hz: number;
    /** App version that recorded the slot. */
    app: string;
  };
  timing: { reference: 'phone'; offset_s: number };
  noise_only: boolean;
  truth: null;
  reference: Record<string, never>;
  capture: {
    /** Samples that carry audio, out of sample_rate × slot length. */
    filled_samples: number;
    late_start: boolean;
    gap: boolean;
  };
}

export interface SidecarInput {
  mode: Mode;
  startUtcMs: number;
  dialHz: number;
  input: string;
  captureRateHz: number;
  appVersion: string;
  /** Receive calibration applied to captured audio, s (AudioClockMapper.inputOffsetS). */
  offsetS: number;
  filled: number;
  lateStart: boolean;
  gap: boolean;
}

export function sidecar(s: SidecarInput): SlotSidecar {
  return {
    format: 'rr73-slot/1',
    mode: s.mode,
    start_utc: isoUtc(s.startUtcMs),
    sample_rate: SLOT_RATE,
    dial_hz: s.dialHz,
    source: { kind: 'kx2', input: s.input, capture_rate_hz: s.captureRateHz, app: `rr73-web ${s.appVersion}` },
    timing: { reference: 'phone', offset_s: s.offsetS },
    noise_only: false,
    truth: null,
    reference: {},
    capture: { filled_samples: s.filled, late_start: s.lateStart, gap: s.gap },
  };
}
