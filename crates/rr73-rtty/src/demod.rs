//! Receive front end: complex mixer to the pair's centre, decimating low-pass filter, mark and
//! space matched filters, envelope detection and automatic threshold correction (ATC).
//!
//! The matched filters integrate one bit of the decimated signal at each tone. Their squared
//! envelopes feed per-tone level trackers: the level while the tone is on and the noise while
//! it is off. Each tone's envelope then becomes a Rician log-likelihood ratio (tone present
//! against noise alone), so a tone that fades contributes less and a tone that vanishes leaves
//! the decision to the other one. That is ATC for selective fading.

use std::f64::consts::{PI, TAU};

use rr73_dsp::{Complex32, Complex64};

use crate::SAMPLE_RATE;
use crate::config::RttyParams;

/// Decimation and filter layout for one rate and shift.
#[derive(Clone, Debug)]
pub(crate) struct Design {
    /// Decimation factor from 12 kHz.
    pub decim: usize,
    /// Decimated sample rate, in Hz.
    pub rate: f64,
    /// Decimated samples per bit.
    pub sps: f64,
    /// Low-pass taps at 12 kHz.
    pub taps: Vec<f32>,
    /// Group delay of the low-pass filter, in samples at 12 kHz.
    pub delay: f64,
}

/// Chooses the decimated rate (at least 16 samples per bit and 4 times the pair's half-width)
/// and a Blackman-windowed low-pass filter that keeps aliases out of the pair's band.
pub(crate) fn design(params: &RttyParams) -> Design {
    let edge = 0.5 * params.shift_hz + params.baud;
    let min_rate = (16.0 * params.baud).max(4.0 * edge);
    let decim = ((SAMPLE_RATE / min_rate).floor() as usize).max(1);
    let rate = SAMPLE_RATE / decim as f64;
    let transition = (rate - 2.0 * edge).max(0.25 * rate);
    let n = (((5.5 * SAMPLE_RATE / transition).ceil() as usize).clamp(31, 1023)) | 1;
    let cutoff = 0.5 * rate / SAMPLE_RATE;
    let mid = (n - 1) / 2;
    let mut taps: Vec<f64> = (0..n)
        .map(|i| {
            let sinc = if i == mid {
                2.0 * cutoff
            } else {
                let x = i as f64 - mid as f64;
                (TAU * cutoff * x).sin() / (PI * x)
            };
            let u = i as f64 / (n - 1) as f64;
            let w = 0.42 - 0.5 * (TAU * u).cos() + 0.08 * (2.0 * TAU * u).cos();
            sinc * w
        })
        .collect();
    let sum: f64 = taps.iter().sum();
    for t in &mut taps {
        *t /= sum;
    }
    Design {
        decim,
        rate,
        sps: rate / params.baud,
        taps: taps.iter().map(|&t| t as f32).collect(),
        delay: mid as f64,
    }
}

/// Mixer and decimating filter.
#[derive(Clone, Debug)]
pub(crate) struct Frontend {
    decim: usize,
    taps: Vec<f32>,
    buf: Vec<Complex32>,
    pos: usize,
    count: usize,
    phase: f64,
    inc: f64,
}

impl Frontend {
    pub fn new(design: &Design, center_hz: f64) -> Self {
        let n = design.taps.len();
        Self {
            decim: design.decim,
            taps: design.taps.clone(),
            buf: vec![Complex32::new(0.0, 0.0); 2 * n],
            pos: 0,
            count: 0,
            phase: 0.0,
            inc: TAU * center_hz / SAMPLE_RATE,
        }
    }

    /// Moves the mixer to `center_hz`, keeping its phase continuous.
    pub fn set_center(&mut self, center_hz: f64) {
        self.inc = TAU * center_hz / SAMPLE_RATE;
    }

    /// Takes one sample at 12 kHz; returns a decimated baseband sample every `decim` inputs.
    #[inline]
    pub fn push(&mut self, x: f32) -> Option<Complex32> {
        let (s, c) = self.phase.sin_cos();
        let v = Complex32::new(x * c as f32, -x * s as f32);
        let n = self.taps.len();
        self.buf[self.pos] = v;
        self.buf[self.pos + n] = v;
        self.pos = if self.pos + 1 == n { 0 } else { self.pos + 1 };
        self.phase = (self.phase + self.inc).rem_euclid(TAU);
        self.count += 1;
        if self.count < self.decim {
            return None;
        }
        self.count = 0;
        let window = &self.buf[self.pos..self.pos + n];
        let mut acc = Complex32::new(0.0, 0.0);
        for (t, w) in self.taps.iter().zip(window) {
            acc += w * *t;
        }
        Some(acc)
    }
}

/// Per-tone evidence for one decimated sample: the log-likelihood ratio of "tone present"
/// against noise alone, for the bit that ends at this sample.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Soft {
    pub mark: f32,
    pub space: f32,
    /// Mark plus space filter power, in squared filter-output units.
    pub power: f32,
}

impl Soft {
    /// Log-likelihood ratio of mark against space.
    pub fn llr(self) -> f32 {
        self.mark - self.space
    }
}

/// Natural log of the modified Bessel function I0, from the polynomial fits in Abramowitz and
/// Stegun 9.8.1 and 9.8.2 (relative error below 2e-7).
pub(crate) fn ln_i0(x: f64) -> f64 {
    let ax = x.abs();
    if ax < 3.75 {
        let t = (ax / 3.75).powi(2);
        (1.0 + t
            * (3.515_622_9
                + t * (3.089_942_4
                    + t * (1.206_749_2 + t * (0.265_973_2 + t * (0.036_076_8 + t * 0.004_581_3))))))
            .ln()
    } else {
        let t = 3.75 / ax;
        let p = 0.398_942_28
            + t * (0.013_285_92
                + t * (0.002_253_19
                    + t * (-0.001_575_65
                        + t * (0.009_162_81
                            + t * (-0.020_577_06
                                + t * (0.026_355_37 + t * (-0.016_476_33 + t * 0.003_923_77)))))));
        ax - 0.5 * ax.ln() + p.ln()
    }
}

/// Tracks one tone's level while on and its noise while off, in squared envelope units.
#[derive(Clone, Copy, Debug, Default)]
struct Levels {
    on: f64,
    off: f64,
}

impl Levels {
    /// Rician log-likelihood ratio for squared envelope `p`.
    fn llr(&self, p: f64) -> f32 {
        // Capping the tone's SNR at 50 dB keeps the ratios finite and soft on clean audio.
        let noise = self.off.max(1e-5 * self.on).max(1e-30);
        let a2 = (self.on - self.off).max(0.05 * noise);
        let x = 2.0 * (a2 * p).sqrt() / noise;
        (ln_i0(x) - a2 / noise).clamp(-1e6, 1e6) as f32
    }
}

/// Mark and space matched filters with ATC and the AFC discriminator.
#[derive(Clone, Debug)]
pub(crate) struct Demod {
    len: usize,
    ring_m: Vec<Complex64>,
    ring_s: Vec<Complex64>,
    pos: usize,
    sum_m: Complex64,
    sum_s: Complex64,
    prev_m: Complex64,
    prev_s: Complex64,
    phase_m: f64,
    inc_m: f64,
    afc: Complex64,
    mark: Levels,
    space: Levels,
    primed: bool,
    attack: f64,
    decay: f64,
    rate: f64,
    noise_gain: f64,
}

/// Mean power at a matched filter's output for white noise of unit variance at 12 kHz: the
/// energy of the combined response of the low-pass filter, the decimation and a filter of
/// `len` decimated samples at `offset_hz` from the centre.
fn noise_gain(design: &Design, len: usize, offset_hz: f64) -> f64 {
    let taps = &design.taps;
    let d = design.decim as i64;
    let n = taps.len() as i64;
    let psi = TAU * offset_hz / design.rate;
    let span = (len as i64 - 1) * d;
    (-(n - 1)..=span)
        .map(|m| {
            let mut acc = Complex64::new(0.0, 0.0);
            for j in 0..len as i64 {
                let t = j * d - m;
                if (0..n).contains(&t) {
                    let (s, c) = (psi * j as f64).sin_cos();
                    acc += Complex64::new(c, -s) * f64::from(taps[t as usize]);
                }
            }
            acc.norm_sqr()
        })
        .sum()
}

impl Demod {
    /// `atc_bits` is the time constant of the on levels, in bits; noise levels move 4 times
    /// slower. `filter_bits` is the matched filter length, in bits.
    pub fn new(design: &Design, params: &RttyParams, atc_bits: f64, filter_bits: f64) -> Self {
        let len = ((design.sps * filter_bits).round() as usize).max(2);
        let attack = 1.0 / (atc_bits * design.sps).max(1.0);
        Self {
            noise_gain: noise_gain(design, len, params.mark_offset_hz()),
            len,
            ring_m: vec![Complex64::new(0.0, 0.0); len],
            ring_s: vec![Complex64::new(0.0, 0.0); len],
            pos: 0,
            sum_m: Complex64::new(0.0, 0.0),
            sum_s: Complex64::new(0.0, 0.0),
            prev_m: Complex64::new(0.0, 0.0),
            prev_s: Complex64::new(0.0, 0.0),
            phase_m: 0.0,
            inc_m: TAU * params.mark_offset_hz() / design.rate,
            afc: Complex64::new(0.0, 0.0),
            mark: Levels::default(),
            space: Levels::default(),
            primed: false,
            attack,
            decay: 0.25 * attack,
            rate: design.rate,
        }
    }

    /// Takes one decimated baseband sample and returns the evidence for the bit ending here.
    #[inline]
    pub fn push(&mut self, y: Complex32) -> Soft {
        let y = Complex64::new(f64::from(y.re), f64::from(y.im));
        // The space tone sits at minus the mark offset, so its oscillator is the conjugate.
        let (s, c) = self.phase_m.sin_cos();
        let um = y * Complex64::new(c, -s);
        let us = y * Complex64::new(c, s);
        self.phase_m = (self.phase_m + self.inc_m).rem_euclid(TAU);
        self.sum_m += um - self.ring_m[self.pos];
        self.sum_s += us - self.ring_s[self.pos];
        self.ring_m[self.pos] = um;
        self.ring_s[self.pos] = us;
        self.pos = if self.pos + 1 == self.len { 0 } else { self.pos + 1 };
        let pm = self.sum_m.norm_sqr();
        let ps = self.sum_s.norm_sqr();
        // Rotation of the stronger filter's output between samples measures the frequency
        // error; weighting by power favours samples well inside a bit.
        if pm > ps {
            self.afc += self.sum_m * self.prev_m.conj();
        } else {
            self.afc += self.sum_s * self.prev_s.conj();
        }
        self.prev_m = self.sum_m;
        self.prev_s = self.sum_s;
        if !self.primed {
            let (hi, lo) = (pm.max(ps), pm.min(ps));
            self.mark = Levels { on: hi, off: lo };
            self.space = self.mark;
            self.primed = hi > 0.0;
        }
        if pm > ps {
            self.mark.on += self.attack * (pm - self.mark.on);
            self.space.off += self.decay * (ps - self.space.off);
        } else {
            self.space.on += self.attack * (ps - self.space.on);
            self.mark.off += self.decay * (pm - self.mark.off);
        }
        Soft {
            mark: self.mark.llr(pm),
            space: self.space.llr(ps),
            power: (pm + ps) as f32,
        }
    }

    /// Matched filter length, in decimated samples.
    pub fn len(&self) -> usize {
        self.len
    }

    /// Mean power at each matched filter's output for white noise of unit variance at 12 kHz.
    pub fn noise_gain(&self) -> f64 {
        self.noise_gain
    }

    /// The frequency error since the last call, in Hz (positive when the signal is above the
    /// filters), or `None` without signal.
    pub fn take_afc(&mut self) -> Option<f64> {
        let a = std::mem::replace(&mut self.afc, Complex64::new(0.0, 0.0));
        (a.norm_sqr() > 0.0).then(|| a.arg() * self.rate / TAU)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ln_i0_matches_the_series() {
        for &x in &[0.0, 0.5, 1.0, 3.0, 3.7499, 3.75, 5.0, 20.0, 200.0] {
            // Power series of I0, summed in log space for large x.
            let mut term = 1.0f64;
            let mut sum = 1.0f64;
            let mut k = 1.0;
            while k < 2000.0 {
                term *= (x / 2.0) * (x / 2.0) / (k * k);
                sum += term;
                if term < sum * 1e-17 {
                    break;
                }
                k += 1.0;
            }
            if x < 600.0 {
                assert!((ln_i0(x) - sum.ln()).abs() < 1e-6 * sum.ln().max(1.0), "{x}");
            }
        }
    }

    #[test]
    fn designs_meet_their_constraints() {
        for baud in crate::config::STANDARD_BAUD {
            for shift_hz in crate::config::STANDARD_SHIFTS_HZ {
                let p = RttyParams {
                    baud,
                    shift_hz,
                    ..RttyParams::default()
                };
                let d = design(&p);
                assert!(d.sps >= 16.0, "{baud} {shift_hz}");
                assert!(d.rate >= 4.0 * (0.5 * shift_hz + baud), "{baud} {shift_hz}");
                assert!(d.taps.len() % 2 == 1 && d.taps.len() <= 1023);
            }
        }
    }

    #[test]
    fn noise_gain_matches_measured_noise() {
        use rand::SeedableRng;
        use rand_distr::{Distribution, Normal};
        let p = RttyParams::default();
        let d = design(&p);
        let mut fe = Frontend::new(&d, 1500.0);
        let mut dm = Demod::new(&d, &p, 4.0, 1.0);
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(3);
        let normal = Normal::new(0.0, 1.0).expect("normal");
        let (mut sum, mut count) = (0.0, 0.0);
        for i in 0..240_000 {
            if let Some(y) = fe.push(normal.sample(&mut rng)) {
                let soft = dm.push(y);
                if i > 12_000 {
                    sum += f64::from(soft.power);
                    count += 2.0;
                }
            }
        }
        let ratio = sum / count / dm.noise_gain();
        assert!((ratio - 1.0).abs() < 0.05, "{ratio}");
    }

    #[test]
    fn mark_and_space_filters_separate_the_tones() {
        let p = RttyParams::default();
        let d = design(&p);
        for (tone, mark) in [(1585.0, true), (1415.0, false)] {
            let mut fe = Frontend::new(&d, 1500.0);
            let mut dm = Demod::new(&d, &p, 4.0, 1.0);
            let mut last = Soft::default();
            for i in 0..12_000 {
                let x = (TAU * tone * f64::from(i) / SAMPLE_RATE).sin() as f32;
                if let Some(y) = fe.push(x) {
                    last = dm.push(y);
                }
            }
            assert_eq!(last.llr() > 0.0, mark, "{tone}");
            let err = dm.take_afc().expect("afc");
            assert!(err.abs() < 0.5, "{tone} {err}");
        }
    }
}
