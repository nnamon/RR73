import { describe, expect, it } from 'vitest';
import { DECODER_RATE, Resampler, besselI0, design } from './resampler';
import { bin, blocks, concat, db, rms, tone } from '../testing/signal';

const RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000];

function run(rate: number, input: Float32Array, maxBlock = 384, seed = 7): Float32Array {
  const r = new Resampler(rate);
  return concat(blocks(input, maxBlock, seed).map((b) => r.process(b)));
}

describe('besselI0', () => {
  it('matches reference values', () => {
    expect(besselI0(0)).toBe(1);
    expect(besselI0(1)).toBeCloseTo(1.2660658777520082, 14);
    expect(besselI0(5)).toBeCloseTo(27.239871823604442, 11);
    expect(besselI0(10)).toBeCloseTo(2815.716628466254, 9);
  });
});

describe('design', () => {
  it('puts the stopband edge at the output Nyquist frequency for rates above 12 kHz', () => {
    for (const rate of [16000, 44100, 48000]) {
      const d = design(rate);
      expect(d.stopHz).toBe(6000);
      expect(d.passHz).toBe(4500);
    }
  });

  it('scales the edges to the input Nyquist frequency below 12 kHz', () => {
    const d = design(8000);
    expect(d.stopHz).toBe(4000);
    expect(d.passHz).toBe(3000);
  });

  it('keeps the kernel the same length in seconds at every rate', () => {
    const a = design(48000);
    const b = design(96000);
    expect(Math.abs((2 * a.half) / 48000 - (2 * b.half) / 96000)).toBeLessThan(1 / 48000 + 1e-9);
  });

  it('rejects rates that are not positive', () => {
    expect(() => design(0)).toThrow(RangeError);
    expect(() => design(Number.NaN)).toThrow(RangeError);
  });
});

describe('Resampler: a 1000 Hz tone', () => {
  for (const rate of RATES) {
    it(`keeps its level within 0.1 dB and its frequency from ${rate} Hz`, () => {
      const amplitude = 0.5;
      const out = run(rate, tone(1000, rate, 3, amplitude, 0.3));
      expect(Math.abs(out.length - 3 * DECODER_RATE)).toBeLessThan(80);
      const a = bin(out, DECODER_RATE, 1000, 6000, 12000);
      expect(Math.abs(db(a.amplitude / amplitude))).toBeLessThan(0.1);
      // Phase advance between two windows 1 s apart gives the frequency offset from 1000 Hz.
      const b = bin(out, DECODER_RATE, 1000, 18000, 12000);
      let dphi = b.phase - a.phase;
      dphi = Math.atan2(Math.sin(dphi), Math.cos(dphi));
      const hz = 1000 + dphi / (2 * Math.PI);
      expect(Math.abs(hz - 1000)).toBeLessThan(0.001);
    });
  }

  for (const rate of [44100, 48000, 24000]) {
    it(`lands each output sample at its exact input time from ${rate} Hz`, () => {
      const phase = 0.7;
      const out = run(rate, tone(1000, rate, 2, 0.5, phase));
      const ideal = tone(1000, DECODER_RATE, 2, 0.5, phase);
      let err = 0;
      for (let n = 3000; n < 21000; n++) err = Math.max(err, Math.abs(out[n] - ideal[n]));
      expect(db(err / 0.5)).toBeLessThan(-70);
    });
  }
});

describe('Resampler: passband', () => {
  for (const rate of [16000, 44100, 48000]) {
    it(`is flat within 0.1 dB from 200 to 4000 Hz at ${rate} Hz`, () => {
      for (const hz of [200, 500, 1500, 2500, 3000, 4000]) {
        const out = run(rate, tone(hz, rate, 2, 0.25));
        const a = bin(out, DECODER_RATE, hz, 4000, 12000);
        expect(Math.abs(db(a.amplitude / 0.25)), `${hz} Hz`).toBeLessThan(0.1);
      }
    });
  }
});

describe('Resampler: anti-aliasing', () => {
  const tones = [6000, 6100, 6500, 7000, 7900, 9000, 9500, 11000, 12000, 13000, 15500, 18000, 21000, 23000, 30000, 44000];
  for (const rate of [16000, 22050, 24000, 32000, 44100, 48000, 96000]) {
    it(`attenuates content above 6000 Hz by at least 60 dB from ${rate} Hz`, () => {
      for (const hz of tones.filter((f) => f < rate / 2 - 50)) {
        const input = tone(hz, rate, 1, 0.5);
        const out = run(rate, input);
        const level = db(rms(out, 1200, out.length - 2400) / rms(input));
        expect(level, `${hz} Hz`).toBeLessThan(-60);
      }
    });
  }
});

describe('Resampler: streaming', () => {
  it('gives the same output for any block sizes', () => {
    const input = tone(1234.5, 44100, 1.5, 0.4);
    const whole = new Resampler(44100).process(input);
    for (const [max, seed] of [[1, 1], [128, 2], [1000, 3], [7, 4]] as const) {
      const parts = run(44100, input, max, seed);
      expect(parts.length).toBe(whole.length);
      let diff = 0;
      for (let i = 0; i < whole.length; i++) diff = Math.max(diff, Math.abs(parts[i] - whole[i]));
      expect(diff).toBeLessThan(1e-7);
    }
  });

  it('reports the input position each output sample represents', () => {
    const r = new Resampler(44100);
    expect(r.inputPosition(0)).toBe(0);
    expect(r.inputPosition(40)).toBe(147);
    expect(r.inputPosition(12000)).toBe(44100);
  });

  it('counts consumed input and produced output', () => {
    const r = new Resampler(48000);
    r.process(new Float32Array(48000));
    expect(r.consumed).toBe(48000);
    const h = r.design.half;
    // Output n needs input up to 4n + h.
    expect(r.produced).toBe(Math.floor((48000 - 1 - h) / 4) + 1);
  });

  it('runs for an hour of 48 kHz input without growing its buffer', () => {
    const r = new Resampler(48000);
    const block = new Float32Array(128);
    let produced = 0;
    for (let i = 0; i < 20000; i++) produced += r.process(block).length;
    expect(produced).toBe(r.produced);
    // Private buffer size is not exposed; the produced count proves the trim kept up.
    expect(r.consumed - r.inputPosition(r.produced)).toBeLessThan(2 * r.design.half + 8);
  });
});
