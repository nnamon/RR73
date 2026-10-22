// The practice band's audio: SNR calibration, timing and fading, and slots the decoder reads back.
import { describe, expect, it } from 'vitest';
import { loadWasm } from '../../../e2e/wasm';
import { SLOT_RATE } from '../clock/slots';
import { NOISE_RMS, amplitudeFor, fadeGain, mixSlot, mixStartS, noise, type SlotConditions } from './render';

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
    // A transmission that starts before the slot starts the buffer, whole.
    const parts = [{ samples: ones, signal: { snrDb: 0, dtS: -0.55, fading: null } }];
    expect(mixStartS(parts)).toBeCloseTo(-0.05, 6);
    const early = mixSlot('FT4', parts);
    expect(early.findIndex((v) => v !== 0)).toBe(0);
    expect(early.filter((v) => v !== 0)).toHaveLength(1000);
    expect(early.length).toBe(0.05 * SLOT_RATE + 7.5 * SLOT_RATE);
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

  it('runs a late transmission past the slot end', () => {
    const ones = new Float32Array(12_000 * 13).fill(1);
    const out = mixSlot('FT8', [{ samples: ones, signal: { snrDb: 0, dtS: 3, fading: null } }]);
    expect(out.length).toBe(Math.round(3.5 * SLOT_RATE) + ones.length);
  });

  it('drifts a tone by its rate', () => {
    // A 1000 Hz tone for 12 s drifting +0.5 Hz/s ends 6 Hz higher; zero crossings count the frequency.
    const n = 12 * SLOT_RATE;
    const tone = Float32Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 1000 * i) / SLOT_RATE));
    const out = mixSlot('FT8', [{ samples: tone, signal: { snrDb: 0, dtS: -0.5, fading: null, freqHz: 1000 - 21.875, driftHzPerS: 0.5 } }]);
    const hz = (from: number, len: number) => {
      let z = 0;
      for (let i = from + 1; i < from + len; i++) if (out[i - 1] < 0 !== out[i] < 0) z++;
      return z / 2 / (len / SLOT_RATE);
    };
    expect(hz(0, SLOT_RATE)).toBeCloseTo(1000.25, 0);
    expect(hz(11 * SLOT_RATE, SLOT_RATE)).toBeCloseTo(1005.75, 0);
    // The level holds as the frequency moves.
    const a = amplitudeFor(0);
    const peak = (from: number) => Math.max(...out.subarray(from, from + 600).map(Math.abs));
    expect(peak(SLOT_RATE) / a).toBeGreaterThan(0.9);
    expect(peak(11 * SLOT_RATE) / a).toBeGreaterThan(0.9);
    expect(peak(11 * SLOT_RATE) / a).toBeLessThan(1.1);
  });

  it('fades a signal through two paths with the mean power of one, and runs on in phase from slot to slot', () => {
    const n = 12 * SLOT_RATE;
    const tone = Float32Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 1500 * i) / SLOT_RATE));
    const multipath = { spreadHz: 1, delayMs: 2, seed: 9 };
    const at = (t0S: number) => mixSlot('FT8', [{ samples: tone, signal: { snrDb: 0, dtS: -0.5, fading: null, freqHz: 1478, multipath } }], NOISE_RMS, { t0S, riseDb: [0, 0], noiseSeed: 1, crashes: [], carriers: [] });
    let power = 0;
    let lo = Infinity;
    let hi = 0;
    for (let k = 0; k < 20; k++) {
      const out = at(1000 + 15 * k);
      for (let b = 0; b < 120; b++) {
        const w = out.subarray(b * 1200, b * 1200 + 1200);
        const p = w.reduce((x, v) => x + v * v, 0) / w.length;
        power += p / 2400;
        lo = Math.min(lo, p);
        hi = Math.max(hi, p);
      }
    }
    const one = amplitudeFor(0) ** 2 / 2;
    expect(10 * Math.log10(power / one)).toBeGreaterThan(-2.5);
    expect(10 * Math.log10(power / one)).toBeLessThan(2.5);
    // Fades of 10 dB and more.
    expect(10 * Math.log10(hi / lo)).toBeGreaterThan(10);
    // The same seed and time give the same gain.
    expect(at(1000)).toEqual(at(1000));
    expect(at(1000)).not.toEqual(at(1015));
  });

  it('adds the risen noise floor, crashes and a carrier', () => {
    const quiet: SlotConditions = { t0S: 0, riseDb: [3, 3], noiseSeed: 5, crashes: [], carriers: [] };
    const risen = mixSlot('FT8', [], NOISE_RMS, quiet);
    expect(rms(risen) / (NOISE_RMS * Math.sqrt(10 ** 0.3 - 1))).toBeCloseTo(1, 1);
    const crash = mixSlot('FT8', [], NOISE_RMS, { ...quiet, riseDb: [0, 0], crashes: [{ atS: 2, durS: 0.1, peakDb: 20 }] });
    const burst = crash.subarray(2 * SLOT_RATE, 2.1 * SLOT_RATE);
    expect(rms(burst)).toBeGreaterThan(2 * NOISE_RMS);
    expect(crash.subarray(0, 2 * SLOT_RATE).every((v) => v === 0)).toBe(true);
    // A carrier runs on in phase into the next slot.
    const carrier = { freqHz: 1234.5, snrDb: 0 };
    const a = mixSlot('FT8', [], NOISE_RMS, { ...quiet, riseDb: [0, 0], carriers: [carrier], t0S: 30 });
    const b = mixSlot('FT8', [], NOISE_RMS, { ...quiet, riseDb: [0, 0], carriers: [carrier], t0S: 45 });
    const w = (2 * Math.PI * 1234.5) / SLOT_RATE;
    const next = amplitudeFor(0) * Math.cos(Math.acos(a[a.length - 1] / amplitudeFor(0)) + w);
    expect(Math.abs(Math.abs(b[0]) - Math.abs(next))).toBeLessThan(0.01 * amplitudeFor(0));
    expect(Math.max(...a.subarray(0, 1000))).toBeCloseTo(amplitudeFor(0), 3);
  });

  it('gives drifting, fading, early and late signals the decoder reads', async () => {
    const wasm = await loadWasm();
    if (!wasm) return;
    const sent = [
      { text: 'CQ JA1KXM PM95', freqHz: 700, dtS: -1.5, snrDb: -8, fading: null },
      { text: 'CQ VK3ABC QF22', freqHz: 1100, dtS: 1.5, snrDb: -8, fading: null },
      { text: 'CQ K1ABC FN42', freqHz: 1500, dtS: 0.2, snrDb: -10, fading: null, driftHzPerS: 0.2 },
      { text: 'CQ DL5XYZ JO62', freqHz: 1900, dtS: 0.3, snrDb: -8, fading: null, multipath: { spreadHz: 0.3, delayMs: 1, seed: 3 } },
      { text: 'CQ F/G4XYZ', freqHz: 2300, dtS: 0.1, snrDb: -8, fading: null },
    ];
    const parts = sent.map((s) => ({ samples: wasm.synthesize(s.text, 'FT8', s.freqHz, SLOT_RATE), signal: s }));
    const all = mixSlot('FT8', parts, NOISE_RMS, { t0S: 600, riseDb: [1, 1], noiseSeed: 2, crashes: [{ atS: 5, durS: 0.05, peakDb: 15 }], carriers: [{ freqHz: 2600, snrDb: 5 }] });
    // The decoder hears the slot from its start.
    const lead = Math.round(-mixStartS(parts) * SLOT_RATE);
    const slot = all.slice(lead, lead + 15 * SLOT_RATE);
    const hiss = noise(slot.length, NOISE_RMS, 11);
    for (let i = 0; i < slot.length; i++) slot[i] += hiss[i];
    const decodes = JSON.parse(wasm.decode_slot(slot, 'FT8', 'subtract-3-osd2')) as { text: string; freq_hz: number; dt_s: number; snr_db: number }[];
    for (const s of sent) {
      const d = decodes.find((x) => x.text === s.text);
      expect(d, `${s.text} in ${JSON.stringify(decodes.map((x) => x.text))}`).toBeDefined();
      expect(Math.abs(d!.dt_s - s.dtS), s.text).toBeLessThanOrEqual(0.15);
    }
  });
});

