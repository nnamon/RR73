import { describe, expect, it } from 'vitest';
import { Fft } from './fft';
import { prng } from '../testing/signal';

function dft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  const or = new Float64Array(n);
  const oi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      or[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a);
      oi[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a);
    }
  }
  return [or, oi];
}

describe('Fft', () => {
  for (const n of [2, 8, 64, 256]) {
    it(`matches a direct DFT at size ${n}`, () => {
      const r = prng(n);
      const re = Float64Array.from({ length: n }, () => r() - 0.5);
      const im = Float64Array.from({ length: n }, () => r() - 0.5);
      const [er, ei] = dft(re, im);
      new Fft(n).transform(re, im);
      for (let k = 0; k < n; k++) {
        expect(re[k]).toBeCloseTo(er[k], 9);
        expect(im[k]).toBeCloseTo(ei[k], 9);
      }
    });
  }

  it('rejects sizes that are not powers of 2', () => {
    expect(() => new Fft(1000)).toThrow(RangeError);
    expect(() => new Fft(1)).toThrow(RangeError);
  });
});
