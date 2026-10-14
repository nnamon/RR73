// The practice band's audio at 12 kHz: white noise, and each slot's transmissions mixed at their
// SNR, start time and fading. SNR follows the WSJT-X convention used by rr73-chansim: signal
// power against noise power in 2500 Hz.

import { SLOT_RATE, SLOT_SAMPLES, type FtMode as Mode } from '../clock/slots';
import { Rng } from './calls';
import type { Fading, SimSignal } from './sim';

/** RMS of the noise, the channel simulator's reference level: about −34 dBFS. */
export const NOISE_RMS = 0.02;

/** Transmissions start 0.5 s into the slot, plus their DT. */
const START_S = 0.5;

/** Peak amplitude of a GFSK signal (peak 1 from the synthesiser) at `snrDb` over noise of RMS `sigma`. */
export function amplitudeFor(snrDb: number, sigma = NOISE_RMS): number {
  // Signal power A²/2 against noise power σ² × 2500 / 6000.
  return Math.sqrt(2 * 10 ** (snrDb / 10) * sigma ** 2 * (2500 / (SLOT_RATE / 2)));
}

/** Gain of a fading signal `tS` seconds into the slot: 1 at the middle of its swing. */
export function fadeGain(f: Fading, tS: number): number {
  const db = (f.depthDb / 2) * Math.sin((2 * Math.PI * tS) / f.periodS + f.phase);
  return 10 ** (db / 20);
}

/** Gaussian white noise, RMS `sigma`, from a seeded source (Box-Muller). */
export function noise(n: number, sigma: number, seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const r = Math.sqrt(-2 * Math.log(1 - rng.next()));
    const t = 2 * Math.PI * rng.next();
    out[i] = sigma * r * Math.cos(t);
    if (i + 1 < n) out[i + 1] = sigma * r * Math.sin(t);
  }
  return out;
}

/** One transmission's samples from the synthesiser (12 kHz, peak 1) with how it is to be heard. */
export interface Part {
  samples: Float32Array;
  signal: Pick<SimSignal, 'snrDb' | 'dtS' | 'fading'>;
}

/** A slot of transmissions at 12 kHz, sample 0 at the slot start, without noise. */
export function mixSlot(mode: Mode, parts: readonly Part[], sigma = NOISE_RMS): Float32Array {
  const out = new Float32Array(SLOT_SAMPLES[mode]);
  for (const { samples, signal } of parts) {
    const amp = amplitudeFor(signal.snrDb, sigma);
    const at = Math.round((START_S + signal.dtS) * SLOT_RATE);
    const from = Math.max(0, -at);
    const to = Math.min(samples.length, out.length - at);
    const f = signal.fading;
    let g = 1;
    for (let i = from; i < to; i++) {
      // Fading changes slowly: its gain is worked out every 10 ms.
      if (f && (i - from) % 120 === 0) g = fadeGain(f, (at + i) / SLOT_RATE);
      out[at + i] += amp * g * samples[i];
    }
  }
  return out;
}
