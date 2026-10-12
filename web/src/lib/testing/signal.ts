// Signal helpers for unit tests: tone generation, single-bin spectra and a seeded PRNG.

/** Deterministic PRNG (mulberry32), uniform in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sine of `hz` at `rate`, `seconds` long, peak `amplitude`, starting at `phase` radians. */
export function tone(hz: number, rate: number, seconds: number, amplitude = 0.5, phase = 0): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate + phase);
  return out;
}

/**
 * Hann-windowed single-bin DFT of x[start .. start + length) at `hz`. Returns the peak amplitude
 * of a sine at that frequency and its phase at sample `start`.
 */
export function bin(x: Float32Array, rate: number, hz: number, start: number, length: number): { amplitude: number; phase: number } {
  let re = 0;
  let im = 0;
  let wsum = 0;
  for (let i = 0; i < length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / length);
    const a = (2 * Math.PI * hz * i) / rate;
    re += w * x[start + i] * Math.cos(a);
    im -= w * x[start + i] * Math.sin(a);
    wsum += w;
  }
  return { amplitude: (2 * Math.hypot(re, im)) / wsum, phase: Math.atan2(im, re) };
}

/** RMS of x[start .. start + length). */
export function rms(x: Float32Array, start = 0, length = x.length - start): number {
  let s = 0;
  for (let i = start; i < start + length; i++) s += x[i] * x[i];
  return Math.sqrt(s / length);
}

export const db = (ratio: number) => 20 * Math.log10(ratio);

/** Splits x into blocks of random sizes between 1 and `max`. */
export function blocks(x: Float32Array, max: number, seed = 1): Float32Array[] {
  const r = prng(seed);
  const out: Float32Array[] = [];
  for (let i = 0; i < x.length; ) {
    const n = Math.min(x.length - i, 1 + Math.floor(r() * max));
    out.push(x.subarray(i, i + n));
    i += n;
  }
  return out;
}

export function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
