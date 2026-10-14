// The practice band's audio: SNR calibration, timing and fading, and slots the decoder reads back.
import { describe, expect, it } from 'vitest';
import { loadWasm } from '../../../e2e/wasm';
import { SLOT_RATE } from '../clock/slots';
import { NOISE_RMS, amplitudeFor, fadeGain, mixSlot, noise } from './render';

const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

describe('practice band audio', () => {
  it('scales a signal to its SNR in 2500 Hz', () => {
    for (const snr of [-24, -10, 0, 5]) {
      const a = amplitudeFor(snr);
      expect(10 * Math.log10(a ** 2 / 2 / (NOISE_RMS ** 2 * (2500 / 6000)))).toBeCloseTo(snr, 6);
    }
  });

  it('makes seeded noise at the reference level', () => {
    const n = noise(120_000, NOISE_RMS, 7);
    expect(rms(n) / NOISE_RMS).toBeGreaterThan(0.98);
    expect(rms(n) / NOISE_RMS).toBeLessThan(1.02);
    expect(noise(1000, NOISE_RMS, 7)).toEqual(n.subarray(0, 1000));
  });

  it('starts each transmission 0.5 s plus its DT into the slot', () => {
    const ones = new Float32Array(1000).fill(1);
    const out = mixSlot('FT8', [{ samples: ones, signal: { snrDb: 0, dtS: 0.1, fading: null } }]);
    expect(out.length).toBe(15 * SLOT_RATE);
    expect(out.findIndex((v) => v !== 0)).toBe(0.6 * SLOT_RATE);
    expect(out[0.6 * SLOT_RATE]).toBeCloseTo(amplitudeFor(0), 6);
    // A DT before the slot start cuts the head off.
    const early = mixSlot('FT4', [{ samples: ones, signal: { snrDb: 0, dtS: -0.55, fading: null } }]);
    expect(early.findIndex((v) => v !== 0)).toBe(0);
    expect(early.filter((v) => v !== 0)).toHaveLength(1000 - 0.05 * SLOT_RATE);
  });

  it('fades a signal by its depth, peak to peak', () => {
    const f = { periodS: 4, depthDb: 12, phase: 0 };
    const gains = Array.from({ length: 400 }, (_, i) => fadeGain(f, i / 100));
    expect(20 * Math.log10(Math.max(...gains) / Math.min(...gains))).toBeCloseTo(12, 1);
  });

  it('gives slots the decoder reads at their SNR, frequency and DT', async () => {
    const wasm = await loadWasm();
    expect(wasm, 'the wasm package in src/wasm/pkg').not.toBeNull();
    if (!wasm) return;
    const sent = [
      { text: 'CQ JA1KXM PM95', freqHz: 800, dtS: 0.1, snrDb: -15, fading: null },
      { text: '9V1NE K1ABC FN42', freqHz: 1400, dtS: 0.3, snrDb: -5, fading: { periodS: 6, depthDb: 8, phase: 1 } },
      { text: 'DL5XYZ VK3ABC R-07', freqHz: 2100, dtS: -0.1, snrDb: 3, fading: null },
    ];
    const slot = mixSlot('FT8', sent.map((s) => ({ samples: wasm.synthesize(s.text, 'FT8', s.freqHz, SLOT_RATE), signal: s })));
    const hiss = noise(slot.length, NOISE_RMS, 11);
    for (let i = 0; i < slot.length; i++) slot[i] += hiss[i];
    const decodes = JSON.parse(wasm.decode_slot(slot, 'FT8', 'subtract-3-osd2')) as { text: string; freq_hz: number; dt_s: number; snr_db: number }[];
    for (const s of sent) {
      const d = decodes.find((x) => x.text === s.text);
      expect(d, s.text).toBeDefined();
      expect(Math.abs(d!.freq_hz - s.freqHz)).toBeLessThanOrEqual(3);
      expect(Math.abs(d!.dt_s - s.dtS)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(d!.snr_db - s.snrDb)).toBeLessThanOrEqual(s.fading ? 5 : 3);
    }
    expect(decodes).toHaveLength(3);
  });
});
