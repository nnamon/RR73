//! Downconversion of a 120 s slot to complex baseband at 375 Hz, and the symbol-length
//! spectrogram the candidate search reads.
//!
//! One FFT of the whole slot (1 440 000 points, 1/120 Hz bins) is cut to the 375 Hz around
//! 1500 Hz, tapered with a raised cosine from 150 to 187.5 Hz off centre, and transformed
//! back with 45 000 points. Sample `n` of the result is the analytic signal at `n / 375` s,
//! shifted down by 1500 Hz. A WSPR symbol is then 256 samples and a tone spacing is one
//! cycle per symbol.

use rr73_dsp::FftPlans;
use rr73_dsp::fft::{self, Complex32};

/// Baseband sample rate, in Hz.
pub const RATE_HZ: f64 = 375.0;

/// Baseband samples per WSPR symbol.
pub const SYMBOL_SAMPLES: usize = 256;

/// Baseband samples in one 120 s slot.
pub const SLOT_SAMPLES: usize = 45_000;

/// Audio samples (12 kHz) per baseband sample.
pub const DECIMATION: usize = 32;

/// Audio frequency that baseband 0 Hz stands for, in Hz.
pub const CENTRE_HZ: f64 = 1500.0;

/// Offset from the centre where the passband taper starts, in Hz.
pub const PASSBAND_HZ: f64 = 150.0;

const AUDIO_SAMPLES: usize = SLOT_SAMPLES * DECIMATION;

/// Reusable buffers and plans for downconversion.
#[derive(Default)]
pub struct Downconverter {
    wide: Vec<Complex32>,
    scratch: Vec<Complex32>,
    taper: Vec<f32>,
}

impl std::fmt::Debug for Downconverter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Downconverter")
    }
}

impl Downconverter {
    /// Writes the baseband of `samples` (12 kHz, sample 0 at the slot start) into `out`
    /// (45 000 samples). Audio past 120 s is ignored, missing audio reads as silence and
    /// non-finite samples as zero.
    pub fn run(&mut self, samples: &[f32], plans: &mut FftPlans, out: &mut Vec<Complex32>) {
        let n = AUDIO_SAMPLES;
        self.wide.clear();
        self.wide.extend(
            samples
                .iter()
                .take(n)
                .map(|&x| Complex32::new(if x.is_finite() { x.clamp(-1e6, 1e6) } else { 0.0 }, 0.0)),
        );
        self.wide.resize(n, Complex32::new(0.0, 0.0));
        let fwd = plans.forward(n);
        fft::process(fwd.as_ref(), &mut self.wide, &mut self.scratch);

        if self.taper.len() != SLOT_SAMPLES {
            self.taper = (0..SLOT_SAMPLES)
                .map(|j| {
                    let f = (offset_bin(j) as f64 * RATE_HZ / SLOT_SAMPLES as f64).abs();
                    let edge = RATE_HZ / 2.0;
                    if f <= PASSBAND_HZ {
                        1.0
                    } else {
                        let x = (f - PASSBAND_HZ) / (edge - PASSBAND_HZ);
                        (0.5 * (1.0 + (std::f64::consts::PI * x).cos())) as f32
                    }
                })
                .collect();
        }
        let centre = (CENTRE_HZ * n as f64 / 12_000.0).round() as i64;
        let scale = 1.0 / n as f32;
        out.clear();
        out.extend((0..SLOT_SAMPLES).map(|j| {
            let src = (centre + offset_bin(j)) as usize;
            self.wide[src] * (self.taper[j] * scale)
        }));
        let inv = plans.inverse(SLOT_SAMPLES);
        fft::process(inv.as_ref(), out, &mut self.scratch);
    }
}

/// Signed frequency bin of FFT index `j` in a 45 000-point transform.
fn offset_bin(j: usize) -> i64 {
    if j < SLOT_SAMPLES / 2 {
        j as i64
    } else {
        j as i64 - SLOT_SAMPLES as i64
    }
}

/// Spectrogram hop, in baseband samples (a quarter symbol).
pub const HOP: usize = 64;

/// FFT length of the spectrogram: one symbol of signal zero-padded to two, so bins are half a
/// tone spacing (0.732 Hz) apart.
pub const SPEC_FFT: usize = 512;

/// Bins kept on each side of the centre (150 x 0.732 Hz, about 110 Hz).
pub const SPEC_HALF_BINS: i32 = 150;

/// Bin spacing of the spectrogram, in Hz.
pub const SPEC_BIN_HZ: f64 = RATE_HZ / SPEC_FFT as f64;

/// Power over time and frequency, normalised per bin to a noise mean of 1.
#[derive(Clone, Debug, Default)]
pub struct SymbolSpectrogram {
    /// Frames, each `2 * SPEC_HALF_BINS + 1` bins from -110 to +110 Hz.
    pub power: Vec<f32>,
    /// Number of frames; frame `t` starts at baseband sample `t * HOP`.
    pub frames: usize,
}

impl SymbolSpectrogram {
    /// Bins per frame.
    pub const BINS: usize = (2 * SPEC_HALF_BINS + 1) as usize;

    /// Computes the spectrogram of `bb` with a rectangular one-symbol window.
    pub fn compute(
        &mut self,
        bb: &[Complex32],
        plans: &mut FftPlans,
        buf: &mut Vec<Complex32>,
        scratch: &mut Vec<Complex32>,
    ) {
        self.frames = if bb.len() >= SYMBOL_SAMPLES {
            (bb.len() - SYMBOL_SAMPLES) / HOP + 1
        } else {
            0
        };
        self.power.clear();
        self.power.resize(self.frames * Self::BINS, 0.0);
        let plan = plans.forward(SPEC_FFT);
        for t in 0..self.frames {
            buf.clear();
            buf.extend_from_slice(&bb[t * HOP..t * HOP + SYMBOL_SAMPLES]);
            buf.resize(SPEC_FFT, Complex32::new(0.0, 0.0));
            fft::process(plan.as_ref(), buf, scratch);
            let row = &mut self.power[t * Self::BINS..(t + 1) * Self::BINS];
            for (k, p) in row.iter_mut().enumerate() {
                let b = k as i32 - SPEC_HALF_BINS;
                let idx = b.rem_euclid(SPEC_FFT as i32) as usize;
                *p = buf[idx].norm_sqr();
            }
        }
        // Per-bin noise level from the median over time: robust to the signals present.
        let mut column: Vec<f32> = Vec::with_capacity(self.frames);
        for k in 0..Self::BINS {
            column.clear();
            column.extend((0..self.frames).map(|t| self.power[t * Self::BINS + k]));
            if column.is_empty() {
                continue;
            }
            let mid = column.len() / 2;
            column.select_nth_unstable_by(mid, f32::total_cmp);
            let median = column[mid];
            // The median of an exponential variable is ln 2 times its mean.
            let mean = median / std::f32::consts::LN_2;
            let inv = if mean > 0.0 && mean.is_finite() {
                1.0 / mean
            } else {
                0.0
            };
            for t in 0..self.frames {
                self.power[t * Self::BINS + k] *= inv;
            }
        }
    }

    /// Power in frame `t` at signed bin `b` (0.732 Hz units from the centre); 0 outside.
    #[inline]
    pub fn get(&self, t: i64, b: i32) -> f32 {
        if t < 0 || t as usize >= self.frames || b.abs() > SPEC_HALF_BINS {
            return 0.0;
        }
        self.power[t as usize * Self::BINS + (b + SPEC_HALF_BINS) as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tone_lands_at_its_offset_and_time() {
        // 1510 Hz from 10 s to 20 s at amplitude 0.5: baseband +10 Hz, magnitude 0.25.
        let mut audio = vec![0.0f32; 1_440_000];
        for (k, x) in audio.iter_mut().enumerate().take(240_000).skip(120_000) {
            *x = 0.5 * (std::f64::consts::TAU * 1510.0 * k as f64 / 12_000.0).cos() as f32;
        }
        let mut plans = FftPlans::new();
        let mut bb = Vec::new();
        Downconverter::default().run(&audio, &mut plans, &mut bb);
        assert_eq!(bb.len(), SLOT_SAMPLES);
        let mid = 15 * 375;
        assert!((bb[mid].norm() - 0.25).abs() < 0.005, "{}", bb[mid].norm());
        // Phase advances by 10 Hz.
        let step = (bb[mid + 1] * bb[mid].conj()).arg() as f64;
        assert!((step - std::f64::consts::TAU * 10.0 / RATE_HZ).abs() < 1e-3);
        assert!(bb[5 * 375].norm() < 0.002);
        assert!(bb[25 * 375].norm() < 0.002);
    }

    #[test]
    fn short_and_hostile_input_is_accepted() {
        let mut plans = FftPlans::new();
        let mut bb = Vec::new();
        let mut d = Downconverter::default();
        for input in [vec![], vec![f32::NAN; 1000], vec![1e30; 2_000_000]] {
            d.run(&input, &mut plans, &mut bb);
            assert_eq!(bb.len(), SLOT_SAMPLES);
            assert!(bb.iter().all(|c| c.re.is_finite() && c.im.is_finite()));
        }
    }
}
