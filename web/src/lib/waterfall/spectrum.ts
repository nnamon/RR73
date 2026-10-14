/**
 * Display spectrum for the waterfall, per mode (a view):
 *
 * - FT8 and FT4: 2048-point FFT of 12 kHz audio with a Hann window, so bins are 5.86 Hz wide and
 *   a window spans 171 ms, about one FT8 symbol (160 ms); 0 to 3000 Hz over 45 s.
 * - WSPR: 8192-point FFT, 1.46 Hz bins (one tone spacing) and a 683 ms window (one symbol);
 *   1400 to 1600 Hz over 240 s, two slots. A WSPR signal is 6 Hz wide (ADR 0005).
 *
 * Levels are dB relative to full scale: a full-scale sine centred on a bin reads 0 dB.
 */

import { Fft } from './fft';
import type { Mode } from '../clock/slots';

export const DISPLAY_RATE = 12000;

/** What the waterfall shows in a mode. */
export interface View {
  /** FFT length, samples at 12 kHz. */
  fft: number;
  /** Lowest and highest frequency across the width, Hz. */
  minHz: number;
  maxHz: number;
  /** Time from the top row to the bottom row, s. */
  visibleS: number;
}

export const FT_VIEW: View = { fft: 2048, minHz: 0, maxHz: 3000, visibleS: 45 };
export const WSPR_VIEW: View = { fft: 8192, minHz: 1400, maxHz: 1600, visibleS: 240 };

export function viewOf(mode: Mode): View {
  return mode === 'WSPR' ? WSPR_VIEW : FT_VIEW;
}

/** Bin width, Hz. */
export function binHz(v: View): number {
  return DISPLAY_RATE / v.fft;
}

/** The FFT bins a view keeps: from `first` (the bin at or below minHz) for `count` bins, up to and including maxHz. */
export function binsOf(v: View): { first: number; count: number } {
  const b = binHz(v);
  const first = Math.floor(v.minHz / b);
  return { first, count: Math.ceil(v.maxHz / b) - first + 1 };
}

export const DISPLAY_FFT = FT_VIEW.fft;
/** Bin width in FT8 and FT4, Hz. */
export const BIN_HZ = binHz(FT_VIEW);
/** Highest frequency shown in FT8 and FT4, Hz. */
export const MAX_HZ = FT_VIEW.maxHz;
/** Bins from 0 Hz up to and including MAX_HZ. */
export const DISPLAY_BINS = Math.ceil(MAX_HZ / BIN_HZ) + 1;

export class DisplaySpectrum {
  readonly view: View;
  /** Bins kept, from `first`. */
  readonly bins: number;
  private readonly first: number;
  private readonly fft: Fft;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly scale: number;

  constructor(view: View = FT_VIEW) {
    this.view = view;
    const n = view.fft;
    const { first, count } = binsOf(view);
    this.first = first;
    this.bins = count;
    this.fft = new Fft(n);
    this.window = new Float64Array(n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      sum += this.window[i];
    }
    // A sine of amplitude A gives a bin magnitude of A × sum / 2.
    this.scale = 2 / sum;
  }

  /** Power of the view's bins for the newest `view.fft` samples, dB. */
  compute(frame: Float32Array, out = new Float32Array(this.bins)): Float32Array {
    const n = this.view.fft;
    if (frame.length !== n) throw new RangeError(`A frame is ${n} samples.`);
    for (let i = 0; i < n; i++) {
      this.re[i] = frame[i] * this.window[i];
      this.im[i] = 0;
    }
    this.fft.transform(this.re, this.im);
    for (let k = 0; k < this.bins; k++) {
      const j = this.first + k;
      const m = Math.hypot(this.re[j], this.im[j]) * this.scale;
      out[k] = m > 0 ? 20 * Math.log10(m) : -Infinity;
    }
    return out;
  }
}
