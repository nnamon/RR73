/**
 * Display spectrum for the waterfall: 2048-point FFT of 12 kHz audio with a Hann window, so bins
 * are 5.86 Hz wide and a window spans 171 ms, about one FT8 symbol (160 ms). Only 0 to 3000 Hz
 * is kept. Levels are dB relative to full scale: a full-scale sine centred on a bin reads 0 dB.
 */

import { Fft } from './fft';

export const DISPLAY_RATE = 12000;
export const DISPLAY_FFT = 2048;
/** Bin width, Hz. */
export const BIN_HZ = DISPLAY_RATE / DISPLAY_FFT;
/** Highest frequency shown, Hz. */
export const MAX_HZ = 3000;
/** Bins from 0 Hz up to and including MAX_HZ. */
export const DISPLAY_BINS = Math.ceil(MAX_HZ / BIN_HZ) + 1;

export class DisplaySpectrum {
  private readonly fft = new Fft(DISPLAY_FFT);
  private readonly window = new Float64Array(DISPLAY_FFT);
  private readonly re = new Float64Array(DISPLAY_FFT);
  private readonly im = new Float64Array(DISPLAY_FFT);
  private readonly scale: number;

  constructor() {
    let sum = 0;
    for (let i = 0; i < DISPLAY_FFT; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / DISPLAY_FFT);
      sum += this.window[i];
    }
    // A sine of amplitude A gives a bin magnitude of A × sum / 2.
    this.scale = 2 / sum;
  }

  /** Power of bins 0..DISPLAY_BINS − 1 for the newest DISPLAY_FFT samples, dB. */
  compute(frame: Float32Array, out = new Float32Array(DISPLAY_BINS)): Float32Array {
    if (frame.length !== DISPLAY_FFT) throw new RangeError(`A frame is ${DISPLAY_FFT} samples.`);
    for (let i = 0; i < DISPLAY_FFT; i++) {
      this.re[i] = frame[i] * this.window[i];
      this.im[i] = 0;
    }
    this.fft.transform(this.re, this.im);
    for (let k = 0; k < DISPLAY_BINS; k++) {
      const m = Math.hypot(this.re[k], this.im[k]) * this.scale;
      out[k] = m > 0 ? 20 * Math.log10(m) : -Infinity;
    }
    return out;
  }
}
