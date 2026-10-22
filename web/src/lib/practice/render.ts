// The practice band's audio at 12 kHz: white noise, and each slot's transmissions mixed at their
// SNR, start time, fading and drift, with what the band adds of its own: a noise floor that rises
// and falls, static crashes and the odd carrier. SNR follows the WSJT-X convention used by
// rr73-chansim: signal power against noise power in 2500 Hz.
//
// Multipath follows the idea of the Watterson model: two paths, the second delayed by 0.5 to
// 3 ms, each with a complex gain whose spectrum is a Gaussian of the path's Doppler spread. Each
// gain is a sum of 8 complex sinusoids at frequencies drawn from that Gaussian, so it runs on
// in phase from one slot to the next. The gains and the drift act on the signal's analytic form;
// its quadrature part is the signal delayed by a quarter period of its centre frequency, which
// holds within the 50 Hz of an FT8 signal and the 83 Hz of an FT4 one.

import { SLOT_RATE, SLOT_SAMPLES, type FtMode as Mode } from '../clock/slots';
import { Rng } from './calls';
import type { Fading, SimSignal } from './sim';

/** RMS of the noise, the channel simulator's reference level: about −34 dBFS. */
export const NOISE_RMS = 0.02;

/** Transmissions start 0.5 s into the slot, plus their DT. */
const START_S = 0.5;
/** Gains change slowly: they are worked out every 10 ms and run linearly in between. */
const STEP = 120;
/** Sinusoids in each path's gain. */
const TERMS = 8;
/** Lowest tone to the middle of the signal, Hz: 3.5 tones of 6.25 Hz in FT8, 1.5 of 20.83 Hz in FT4. */
const CENTRE_HZ: Record<Mode, number> = { FT8: 21.875, FT4: 31.25 };

/** What the band adds to a slot besides the transmissions. */
export interface SlotConditions {
  /** Slot start, s after 00:00 UTC: fading and carriers run on in phase from slot to slot. */
  t0S: number;
  /** Noise over the band's own floor at the slot start and at its end, dB. Signal SNRs count it. */
  riseDb: readonly [number, number];
  /** Seed of the added noise. */
  noiseSeed: number;
  /** Static crashes: start (s into the slot), length (s) and peak over the noise floor (dB). */
  crashes: readonly { atS: number; durS: number; peakDb: number }[];
  /** Unmodulated carriers through the whole slot, SNR in 2500 Hz. */
  carriers: readonly { freqHz: number; snrDb: number }[];
}

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

/** A path's gain: the sum of TERMS complex sinusoids, mean power `power`. */
class PathGain {
  private readonly hz: Float64Array;
  private readonly phase: Float64Array;
  private readonly scale: number;

  constructor(rng: Rng, spreadHz: number, power: number) {
    this.hz = new Float64Array(TERMS);
    this.phase = new Float64Array(TERMS);
    // Watterson's spread is twice the standard deviation of the Doppler spectrum.
    const sd = spreadHz / 2;
    for (let n = 0; n < TERMS; n++) {
      const g = Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
      this.hz[n] = g * sd;
      this.phase[n] = 2 * Math.PI * rng.next();
    }
    this.scale = Math.sqrt(power / TERMS);
  }

  /** The gain at `tS` (s after 00:00 UTC), written to `out` as [re, im]. */
  at(tS: number, out: Float64Array) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < TERMS; n++) {
      const a = 2 * Math.PI * ((this.hz[n] * tS) % 1) + this.phase[n];
      re += Math.cos(a);
      im += Math.sin(a);
    }
    out[0] = re * this.scale;
    out[1] = im * this.scale;
  }
}

/** One transmission's samples from the synthesiser (12 kHz, peak 1) with how it is to be heard. */
export interface Part {
  samples: Float32Array;
  signal: Pick<SimSignal, 'snrDb' | 'dtS' | 'fading'> & Partial<Pick<SimSignal, 'freqHz' | 'driftHzPerS' | 'multipath'>>;
}

/** Mean power of the noise floor over a slot, relative to the band's own, as a gain on RMS. */
function floorGain(c: SlotConditions | null): number {
  if (!c) return 1;
  return 10 ** ((c.riseDb[0] + c.riseDb[1]) / 2 / 20);
}

/**
 * Where a slot's buffer starts, s from the slot start: 0, or earlier when a transmission starts
 * before the slot, as from a station whose clock is fast.
 */
export function mixStartS(parts: readonly Pick<Part, 'signal'>[]): number {
  let start = 0;
  for (const { signal } of parts) start = Math.min(start, START_S + signal.dtS);
  return Math.round(start * SLOT_RATE) / SLOT_RATE;
}

/**
 * A slot of transmissions at 12 kHz, sample 0 at mixStartS(parts), with the noise the band adds
 * (`conditions`) but without the band's own noise, which loops underneath. A transmission that
 * starts late runs past the slot end: the buffer is as long as the latest one needs.
 */
export function mixSlot(mode: Mode, parts: readonly Part[], sigma = NOISE_RMS, conditions: SlotConditions | null = null): Float32Array {
  const floor = sigma * floorGain(conditions);
  const lead = Math.round(-mixStartS(parts) * SLOT_RATE);
  let n = lead + SLOT_SAMPLES[mode];
  for (const { samples, signal } of parts) n = Math.max(n, lead + Math.round((START_S + signal.dtS) * SLOT_RATE) + samples.length);
  const out = new Float32Array(n);
  for (const part of parts) {
    const { signal } = part;
    const amp = amplitudeFor(signal.snrDb, floor);
    const at = lead + Math.round((START_S + signal.dtS) * SLOT_RATE);
    if (signal.multipath || signal.driftHzPerS) mixRotated(out, part, amp, at, mode, (conditions?.t0S ?? 0) - lead / SLOT_RATE, lead);
    else mixPlain(out, part, amp, at, lead);
  }
  if (conditions) addConditions(out.subarray(lead), mode, sigma, conditions);
  return out;
}

function mixPlain(out: Float32Array, { samples, signal }: Part, amp: number, at: number, lead: number) {
  const from = Math.max(0, -at);
  const to = Math.min(samples.length, out.length - at);
  const f = signal.fading;
  let g = 1;
  for (let i = from; i < to; i++) {
    if (f && (i - from) % STEP === 0) g = fadeGain(f, (at - lead + i) / SLOT_RATE);
    out[at + i] += amp * g * samples[i];
  }
}

/**
 * A signal through two fading paths, drifting in frequency, or both: the real part of
 * gain × (x + j·x̂), with x̂ the quadrature part.
 */
function mixRotated(out: Float32Array, { samples: x, signal }: Part, amp: number, at: number, mode: Mode, t0S: number, lead: number) {
  const from = Math.max(0, -at);
  const to = Math.min(x.length, out.length - at);
  const fc = (signal.freqHz ?? 1500) + CENTRE_HZ[mode];
  // A quarter period of the centre frequency, in samples, read with linear interpolation.
  const q = SLOT_RATE / (4 * fc);
  const qi = Math.floor(q);
  const qf = q - qi;
  const quad = (i: number) => {
    const a = i - qi;
    const v0 = a >= 0 && a < x.length ? x[a] : 0;
    const v1 = a - 1 >= 0 && a - 1 < x.length ? x[a - 1] : 0;
    return v0 + (v1 - v0) * qf;
  };
  const mp = signal.multipath ?? null;
  const rng = new Rng(mp?.seed ?? 1);
  const p1 = mp ? new PathGain(rng, mp.spreadHz, 0.5) : null;
  const p2 = mp ? new PathGain(rng, mp.spreadHz, 0.5) : null;
  const d = mp ? Math.round((mp.delayMs / 1000) * SLOT_RATE) : 0;
  const drift = signal.driftHzPerS ?? 0;
  const f = signal.fading;
  const a1 = new Float64Array(2);
  const b1 = new Float64Array(2);
  const a2 = new Float64Array(2);
  const b2 = new Float64Array(2);
  const gain = (tS: number, p: PathGain | null, o: Float64Array) => {
    if (p) p.at(tS, o);
    else {
      o[0] = 1;
      o[1] = 0;
    }
  };
  // The drift's phase: the frequency is the signal's own at its start and moves `drift` Hz/s.
  let rotRe = 1;
  let rotIm = 0;
  let g = 1;
  for (let i0 = from; i0 < to; i0 += STEP) {
    const tA = t0S + (at + i0) / SLOT_RATE;
    const tB = tA + STEP / SLOT_RATE;
    gain(tA, p1, a1);
    gain(tB, p1, b1);
    gain(tA, p2, a2);
    gain(tB, p2, b2);
    if (f) g = fadeGain(f, (at - lead + i0) / SLOT_RATE);
    // Phase step per sample at this block's frequency offset.
    const w = (2 * Math.PI * drift * ((i0 - from + STEP / 2) / SLOT_RATE)) / SLOT_RATE;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const end = Math.min(to, i0 + STEP);
    for (let i = i0; i < end; i++) {
      const u = (i - i0) / STEP;
      const g1r = a1[0] + (b1[0] - a1[0]) * u;
      const g1i = a1[1] + (b1[1] - a1[1]) * u;
      let re = g1r * x[i] - g1i * quad(i);
      let im = g1r * quad(i) + g1i * x[i];
      if (p2) {
        const j = i - d;
        const xd = j >= 0 ? x[j] : 0;
        const qd = quad(j);
        const g2r = a2[0] + (b2[0] - a2[0]) * u;
        const g2i = a2[1] + (b2[1] - a2[1]) * u;
        re += g2r * xd - g2i * qd;
        im += g2r * qd + g2i * xd;
      }
      out[at + i] += amp * g * (rotRe * re - rotIm * im);
      const r = rotRe * cw - rotIm * sw;
      rotIm = rotRe * sw + rotIm * cw;
      rotRe = r;
    }
    // Keeps the phasor on the unit circle against rounding.
    const m = Math.hypot(rotRe, rotIm);
    rotRe /= m;
    rotIm /= m;
  }
}

/** The added noise, crashes and carriers. */
function addConditions(out: Float32Array, mode: Mode, sigma: number, c: SlotConditions) {
  const n = SLOT_SAMPLES[mode];
  // Added noise: the floor rises from riseDb[0] to riseDb[1] over the slot.
  const extra = (db: number) => sigma * Math.sqrt(Math.max(0, 10 ** (db / 10) - 1));
  const e0 = extra(c.riseDb[0]);
  const e1 = extra(c.riseDb[1]);
  if (e0 > 0 || e1 > 0) {
    const hiss = noise(n, 1, c.noiseSeed);
    for (let i = 0; i < n; i++) out[i] += hiss[i] * (e0 + ((e1 - e0) * i) / n);
  }
  const rng = new Rng(c.noiseSeed ^ 0x5bd1e995);
  for (const k of c.crashes) {
    // A burst of broadband noise that rises in 2 ms and dies away over its length.
    const start = Math.round(k.atS * SLOT_RATE);
    const len = Math.max(1, Math.round(k.durS * SLOT_RATE));
    const peak = sigma * 10 ** (k.peakDb / 20);
    for (let i = 0; i < len && start + i < n; i++) {
      const env = Math.min(1, i / 24) * Math.exp((-4 * i) / len);
      const r = Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
      out[start + i] += peak * env * r;
    }
  }
  for (const k of c.carriers) {
    // A carrier's power A²/2 against the noise in 2500 Hz, as for the signals.
    const amp = amplitudeFor(k.snrDb, sigma * floorGain(c));
    const phase0 = 2 * Math.PI * ((k.freqHz * c.t0S) % 1);
    const w = (2 * Math.PI * k.freqHz) / SLOT_RATE;
    for (let i = 0; i < n; i++) out[i] += amp * Math.cos(phase0 + w * i);
  }
}

