/**
 * Streaming resampler from any input rate to a fixed output rate (12000 Hz for the decoders).
 *
 * A Kaiser-windowed sinc low-pass is sampled at 256 fractional phases per input sample. Each
 * output sample takes the two phase rows around its exact position and interpolates between
 * them linearly. Integer ratios (48000 to 12000) always land on phase 0, so they use exact
 * coefficients. The kernel is symmetric and centred on the output position, so output sample n
 * represents the input signal at input position n × inputRate / outputRate exactly: there is no
 * group delay to correct.
 *
 * For input rates at or above twice the passband: passband to 4500 Hz, stopband from 6000 Hz
 * (the output Nyquist frequency) with a 90 dB design target. Lower input rates scale both edges
 * to the input Nyquist frequency.
 */

export const DECODER_RATE = 12000;

/** Phase rows per input sample. Interpolation error at 256 phases is below −100 dB. */
const PHASES = 256;
/** Stopband attenuation the Kaiser window is designed for, dB. */
const ATTENUATION_DB = 90;

export interface ResamplerDesign {
  /** Input rate, Hz. */
  inputRate: number;
  /** Output rate, Hz. */
  outputRate: number;
  /** Passband edge, Hz. */
  passHz: number;
  /** Stopband edge, Hz. */
  stopHz: number;
  /** Kernel half-length, input samples. */
  half: number;
  /** Kaiser β. */
  beta: number;
}

/** Modified Bessel function of the first kind, order 0, by its power series. */
export function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 64; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/** Filter parameters for a conversion from `inputRate` to `outputRate`. */
export function design(inputRate: number, outputRate = DECODER_RATE): ResamplerDesign {
  if (!(inputRate > 0) || !(outputRate > 0)) throw new RangeError('Sample rates must be positive.');
  const nyquist = Math.min(inputRate, outputRate) / 2;
  const stopHz = nyquist;
  const passHz = nyquist * 0.75;
  const transition = stopHz - passHz;
  // Kaiser's estimate of the length for a given attenuation and transition width, expressed in
  // seconds so it holds for any input rate.
  const seconds = (ATTENUATION_DB - 7.95) / (2.285 * 2 * Math.PI * transition);
  const half = Math.max(2, Math.ceil((seconds * inputRate) / 2));
  const beta = 0.1102 * (ATTENUATION_DB - 8.7);
  return { inputRate, outputRate, passHz, stopHz, half, beta };
}

/**
 * Phase table: row p (0..PHASES) holds the 2 × half taps for an output position p / PHASES of an
 * input sample after input index i, applied to input indices i − half + 1 … i + half. Every row
 * sums to 1, so DC gain is exact at every phase.
 */
export function phaseTable(d: ResamplerDesign): Float32Array {
  const taps = 2 * d.half;
  const table = new Float32Array((PHASES + 1) * taps);
  const fc = (d.passHz + d.stopHz) / 2 / d.inputRate; // cutoff, cycles per input sample
  const i0b = besselI0(d.beta);
  const row = new Float64Array(taps);
  for (let p = 0; p <= PHASES; p++) {
    const frac = p / PHASES;
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const t = k - d.half + 1 - frac; // distance from the output position, input samples
      const x = 2 * fc * t;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const r = t / d.half;
      const w = Math.abs(r) >= 1 ? 0 : besselI0(d.beta * Math.sqrt(1 - r * r)) / i0b;
      row[k] = 2 * fc * sinc * w;
      sum += row[k];
    }
    for (let k = 0; k < taps; k++) table[p * taps + k] = row[k] / sum;
  }
  return table;
}

/**
 * Resamples a stream pushed in blocks of any size. Holds only the input history the kernel needs.
 */
export class Resampler {
  readonly design: ResamplerDesign;
  private readonly table: Float32Array;
  private readonly taps: number;
  /** Input history; buf[0] is input index `bufStart`. */
  private buf: Float32Array;
  private bufStart: number;
  private bufLen = 0;
  /** Input samples received. */
  private inCount = 0;
  /** Output samples produced. */
  private outCount = 0;

  constructor(inputRate: number, outputRate = DECODER_RATE) {
    this.design = design(inputRate, outputRate);
    this.table = phaseTable(this.design);
    this.taps = 2 * this.design.half;
    this.buf = new Float32Array(this.taps * 2 + 4096);
    // The stream is preceded by silence, so the first outputs need no special case.
    this.bufStart = -(this.design.half - 1);
    this.bufLen = this.design.half - 1;
  }

  /** Output samples produced so far; the index of the next output sample. */
  get produced(): number {
    return this.outCount;
  }

  /** Input samples consumed so far. */
  get consumed(): number {
    return this.inCount;
  }

  /** Input position, in input samples from the first input sample, that output sample n represents. */
  inputPosition(n: number): number {
    return (n * this.design.inputRate) / this.design.outputRate;
  }

  /** Adds input samples and returns the output samples that became computable. */
  process(input: Float32Array): Float32Array {
    this.append(input);
    const h = this.design.half;
    const last = this.inCount - 1; // newest input index available
    // Output n needs input up to floor(pos_n) + h.
    const maxPos = last - h;
    if (maxPos < 0) return new Float32Array(0);
    const firstN = this.outCount;
    const { inputRate, outputRate } = this.design;
    // Output n is computable while floor(n × inputRate / outputRate) <= maxPos.
    const bound = Math.max(0, Math.ceil(((maxPos + 1) * outputRate) / inputRate) - firstN);
    const out = new Float32Array(bound);
    const taps = this.taps;
    const table = this.table;
    const buf = this.buf;
    let count = 0;
    for (; count < bound; count++) {
      const n = firstN + count;
      // n × inputRate is an exact integer in double precision for any practical run length.
      const pos = (n * inputRate) / outputRate;
      const ipos = Math.floor(pos);
      if (ipos > maxPos) break;
      const phase = (pos - ipos) * PHASES;
      const p = Math.floor(phase);
      const alpha = phase - p;
      const base = ipos - h + 1 - this.bufStart;
      const r0 = p * taps;
      let y0 = 0;
      for (let k = 0; k < taps; k++) y0 += buf[base + k] * table[r0 + k];
      if (alpha > 1e-9) {
        const r1 = r0 + taps;
        let y1 = 0;
        for (let k = 0; k < taps; k++) y1 += buf[base + k] * table[r1 + k];
        y0 += (y1 - y0) * alpha;
      }
      out[count] = y0;
    }
    this.outCount += count;
    this.trim();
    return count === bound ? out : out.slice(0, count);
  }

  private append(input: Float32Array) {
    const need = this.bufLen + input.length;
    if (need > this.buf.length) {
      const grown = new Float32Array(Math.max(need, this.buf.length * 2));
      grown.set(this.buf.subarray(0, this.bufLen));
      this.buf = grown;
    }
    this.buf.set(input, this.bufLen);
    this.bufLen += input.length;
    this.inCount += input.length;
  }

  /** Drops input older than the next output sample's kernel. */
  private trim() {
    const nextPos = (this.outCount * this.design.inputRate) / this.design.outputRate;
    const keepFrom = Math.floor(nextPos) - this.design.half + 1;
    const drop = keepFrom - this.bufStart;
    if (drop <= 0 || drop < 1024) return;
    this.buf.copyWithin(0, drop, this.bufLen);
    this.bufLen -= drop;
    this.bufStart += drop;
  }
}
