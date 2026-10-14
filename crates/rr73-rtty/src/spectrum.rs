//! Averaged power spectrum of the input: finds mark-space pairs for the AFC and measures the
//! signal-to-noise ratio for the squelch.
//!
//! A 4096-point Hann-windowed FFT every 2048 samples (2.93 Hz bins, 0.17 s hops) feeds an
//! exponential average with a time constant of about 0.7 s. Powers are one-sided, scaled so
//! that a tone's bins sum to its power and white noise of variance s^2 reads s^2 / 6000 per Hz.

use std::f64::consts::TAU;
use std::sync::Arc;

use rr73_dsp::Complex32;
use rustfft::{Fft, FftPlanner};

use crate::SAMPLE_RATE;

/// FFT length, in samples at 12 kHz.
pub(crate) const FFT_LEN: usize = 4096;
/// Hop between spectra, in samples at 12 kHz.
pub(crate) const HOP: usize = 2048;
/// Weight of each new spectrum once the average is full.
const ALPHA: f64 = 0.25;
/// Median over mean of a bin's averaged noise power: chi-squared with about 14 degrees of
/// freedom after the exponential average.
const MEDIAN_TO_MEAN: f64 = 0.953;
/// Band whose median bin gives the noise floor, in Hz.
const NOISE_BAND_HZ: (f64, f64) = (200.0, 3000.0);
/// Bandwidth the SNR refers to, in Hz.
pub(crate) const SNR_BANDWIDTH_HZ: f64 = 3000.0;

/// Width of one bin, in Hz.
pub(crate) const BIN_HZ: f64 = SAMPLE_RATE / FFT_LEN as f64;

#[derive(Clone)]
pub(crate) struct Spectrum {
    ring: Vec<f32>,
    pos: usize,
    seen: usize,
    since: usize,
    window: Vec<f32>,
    scale: f64,
    plan: Arc<dyn Fft<f32>>,
    buf: Vec<Complex32>,
    scratch: Vec<Complex32>,
    power: Vec<f64>,
    prefix: Vec<f64>,
    sorted: Vec<f64>,
    frames: u32,
    noise: f64,
}

impl std::fmt::Debug for Spectrum {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Spectrum")
            .field("frames", &self.frames)
            .field("noise", &self.noise)
            .finish()
    }
}

impl Spectrum {
    pub fn new() -> Self {
        let plan = FftPlanner::new().plan_fft_forward(FFT_LEN);
        let window: Vec<f32> = (0..FFT_LEN)
            .map(|i| (0.5 - 0.5 * (TAU * i as f64 / FFT_LEN as f64).cos()) as f32)
            .collect();
        let wsum2: f64 = window.iter().map(|&w| f64::from(w) * f64::from(w)).sum();
        let scratch = vec![Complex32::new(0.0, 0.0); plan.get_inplace_scratch_len()];
        Self {
            ring: vec![0.0; FFT_LEN],
            pos: 0,
            seen: 0,
            since: 0,
            window,
            scale: 2.0 / (FFT_LEN as f64 * wsum2),
            plan,
            buf: vec![Complex32::new(0.0, 0.0); FFT_LEN],
            scratch,
            power: vec![0.0; FFT_LEN / 2 + 1],
            prefix: vec![0.0; FFT_LEN / 2 + 2],
            sorted: Vec::new(),
            frames: 0,
            noise: 0.0,
        }
    }

    pub fn reset(&mut self) {
        self.ring.fill(0.0);
        self.pos = 0;
        self.seen = 0;
        self.since = 0;
        self.power.fill(0.0);
        self.prefix.fill(0.0);
        self.frames = 0;
        self.noise = 0.0;
    }

    /// Spectra averaged so far.
    pub fn frames(&self) -> u32 {
        self.frames
    }

    /// Takes one sample; returns true when a new spectrum has been averaged in.
    #[inline]
    pub fn push(&mut self, x: f32) -> bool {
        self.ring[self.pos] = x;
        self.pos = (self.pos + 1) % FFT_LEN;
        self.seen = (self.seen + 1).min(FFT_LEN);
        self.since += 1;
        if self.since >= HOP && self.seen == FFT_LEN {
            self.since = 0;
            self.update();
            return true;
        }
        false
    }

    fn update(&mut self) {
        for (i, b) in self.buf.iter_mut().enumerate() {
            let v = self.ring[(self.pos + i) % FFT_LEN] * self.window[i];
            *b = Complex32::new(v, 0.0);
        }
        self.plan.process_with_scratch(&mut self.buf, &mut self.scratch);
        let alpha = (1.0 / (f64::from(self.frames) + 1.0)).max(ALPHA);
        for (p, c) in self.power.iter_mut().zip(&self.buf) {
            let v = f64::from(c.norm_sqr()) * self.scale;
            *p += alpha * (v - *p);
        }
        self.frames = self.frames.saturating_add(1);
        let mut acc = 0.0;
        self.prefix[0] = 0.0;
        for (k, &p) in self.power.iter().enumerate() {
            acc += p;
            self.prefix[k + 1] = acc;
        }
        let lo = (NOISE_BAND_HZ.0 / BIN_HZ) as usize;
        let hi = ((NOISE_BAND_HZ.1 / BIN_HZ) as usize).min(self.power.len() - 1);
        self.sorted.clear();
        self.sorted.extend_from_slice(&self.power[lo..=hi]);
        let mid = self.sorted.len() / 2;
        self.sorted.select_nth_unstable_by(mid, f64::total_cmp);
        self.noise = self.sorted[mid] / MEDIAN_TO_MEAN;
    }

    /// Mean noise power per bin.
    #[cfg(test)]
    pub fn noise_per_bin(&self) -> f64 {
        self.noise
    }

    /// Variance per sample at 12 kHz of white noise at the measured floor; 0 before the first
    /// spectrum.
    pub fn noise_variance(&self) -> f64 {
        self.noise / BIN_HZ * 0.5 * SAMPLE_RATE
    }

    /// Power in `lo_hz..=hi_hz` above the noise floor, and the number of bins summed.
    fn excess(&self, lo_hz: f64, hi_hz: f64) -> (f64, f64) {
        let last = self.power.len() - 1;
        let lo = ((lo_hz / BIN_HZ).ceil().max(0.0) as usize).min(last);
        let hi = ((hi_hz / BIN_HZ).floor().max(0.0) as usize).min(last);
        if hi < lo {
            return (0.0, 0.0);
        }
        let bins = (hi + 1 - lo) as f64;
        (self.prefix[hi + 1] - self.prefix[lo] - self.noise * bins, bins)
    }

    /// SNR of the pair at `mark_hz` and `space_hz`, in dB against the noise in 3000 Hz: the
    /// power within 1.5 baud of the tones above the noise floor. Floors at -40 dB.
    pub fn snr_db(&self, mark_hz: f64, space_hz: f64, baud: f64) -> f64 {
        if self.frames == 0 || self.noise <= 0.0 {
            return -40.0;
        }
        let (s, _) = self.excess(
            mark_hz.min(space_hz) - 1.5 * baud,
            mark_hz.max(space_hz) + 1.5 * baud,
        );
        let n3k = self.noise / BIN_HZ * SNR_BANDWIDTH_HZ;
        (10.0 * (s.max(0.0) / n3k).log10()).clamp(-40.0, 60.0)
    }

    /// The strongest pair whose centre lies within `range_hz` of `near_hz`, for each shift in
    /// `shifts_hz`: its centre and shift, in Hz. Both tones must stand 4 standard deviations
    /// above the noise. A shift other than `prefer_hz` wins only with a score 25 % higher.
    pub fn find_pair(
        &self,
        near_hz: f64,
        range_hz: f64,
        shifts_hz: &[f64],
        prefer_hz: f64,
        baud: f64,
    ) -> Option<(f64, f64)> {
        if self.frames == 0 || self.noise <= 0.0 {
            return None;
        }
        let half = (0.5 * baud).max(BIN_HZ);
        let mut best: Option<(f64, f64, f64)> = None;
        let mut preferred: Option<(f64, f64, f64)> = None;
        for &shift in shifts_hz {
            let mut c = near_hz - range_hz;
            let mut top: Option<(f64, f64, f64)> = None;
            while c <= near_hz + range_hz {
                let (lo, hi) = (c - 0.5 * shift, c + 0.5 * shift);
                if lo - half >= 50.0 && hi + half <= 0.49 * SAMPLE_RATE {
                    let (a, bins) = self.excess(lo - half, lo + half);
                    let (b, _) = self.excess(hi - half, hi + half);
                    // An average of about 7 independent spectra: each bin's noise has a
                    // standard deviation of about noise / sqrt(7).
                    let sigma = self.noise * (bins / 7.0).sqrt();
                    if a > 4.0 * sigma && b > 4.0 * sigma {
                        let score = (a * b).sqrt();
                        if top.is_none_or(|t| score > t.2) {
                            top = Some((c, shift, score));
                        }
                    }
                }
                c += 0.5 * BIN_HZ;
            }
            if let Some(t) = top {
                if (shift - prefer_hz).abs() < 0.5 {
                    preferred = Some(t);
                }
                if best.is_none_or(|b| t.2 > b.2) {
                    best = Some(t);
                }
            }
        }
        let (mut c, shift) = match (preferred, best) {
            (Some(p), Some(b)) if b.2 <= 1.25 * p.2 => (p.0, p.1),
            (_, Some(b)) => (b.0, b.1),
            _ => return None,
        };
        // Any centre that puts both tones inside their windows scores alike, so refine on the
        // power centroid of each tone.
        for _ in 0..3 {
            let lo = self.centroid(c - 0.5 * shift - half, c - 0.5 * shift + half);
            let hi = self.centroid(c + 0.5 * shift - half, c + 0.5 * shift + half);
            if let (Some(lo), Some(hi)) = (lo, hi) {
                c = 0.5 * (lo + hi);
            }
        }
        Some((c, shift))
    }

    /// Frequency centroid of the power above the noise floor in `lo_hz..=hi_hz`, in Hz.
    fn centroid(&self, lo_hz: f64, hi_hz: f64) -> Option<f64> {
        let last = self.power.len() - 1;
        let lo = ((lo_hz / BIN_HZ).ceil().max(0.0) as usize).min(last);
        let hi = ((hi_hz / BIN_HZ).floor().max(0.0) as usize).min(last);
        let (mut w, mut wf) = (0.0, 0.0);
        for k in lo..=hi {
            let e = (self.power[k] - self.noise).max(0.0);
            w += e;
            wf += e * k as f64 * BIN_HZ;
        }
        (w > 0.0).then(|| wf / w)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;
    use rand_distr::{Distribution, StandardNormal};

    fn noise(len: usize, sigma: f64, seed: u64) -> Vec<f64> {
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        (0..len)
            .map(|_| {
                let v: f64 = StandardNormal.sample(&mut rng);
                sigma * v
            })
            .collect()
    }

    #[test]
    fn noise_floor_and_snr_read_true() {
        let sigma = 0.02;
        for (snr_db, seed) in [(-10.0f64, 1u64), (0.0, 2), (10.0, 3)] {
            let mut sp = Spectrum::new();
            // Two steady tones sharing the power, as a keyed pair does on average.
            let p = 10f64.powf(snr_db / 10.0) * sigma * sigma * 0.5;
            let a = (p).sqrt();
            let n = noise(12_000 * 6, sigma, seed);
            for (i, v) in n.iter().enumerate() {
                let t = i as f64 / SAMPLE_RATE;
                let x = v + a * ((TAU * 1585.0 * t).sin() + (TAU * 1415.0 * t).sin());
                sp.push(x as f32);
            }
            let expected = sigma * sigma / 6000.0 * BIN_HZ;
            let ratio = sp.noise_per_bin() / expected;
            assert!((ratio - 1.0).abs() < 0.1, "noise ratio {ratio}");
            let snr = sp.snr_db(1585.0, 1415.0, 45.45);
            assert!((snr - snr_db).abs() < 1.0, "{snr_db}: {snr}");
            let found = sp.find_pair(1450.0, 200.0, &[170.0, 200.0, 425.0, 850.0], 170.0, 45.45);
            let (c, shift) = found.expect("pair");
            assert!((c - 1500.0).abs() <= 2.0 && shift == 170.0, "{c} {shift}");
        }
    }

    #[test]
    fn noise_alone_has_no_pair() {
        let mut sp = Spectrum::new();
        for v in noise(12_000 * 4, 0.02, 9) {
            sp.push(v as f32);
        }
        assert!(sp.find_pair(1500.0, 300.0, &[170.0], 170.0, 45.45).is_none());
        assert!(sp.snr_db(1585.0, 1415.0, 45.45) < -15.0);
    }
}
