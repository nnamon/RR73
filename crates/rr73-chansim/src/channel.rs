//! Channel impairments: white Gaussian noise, Watterson two-path fading and linear drift.
//!
//! Fading and drift act on the analytic signal, so they apply to a real passband waveform
//! at any audio frequency.

use rand::Rng;
use rand_distr::StandardNormal;
use rr73_dsp::fft::{self, Complex32};
use rr73_dsp::{FftPlans, analytic};
use serde::{Deserialize, Serialize};

/// Sample rate of rendered audio, in Hz.
pub const SAMPLE_RATE: f64 = 12_000.0;

/// Watterson HF channel: two independent Rayleigh-fading paths of equal average power, the
/// second delayed. Each path's complex gain has a Gaussian Doppler spectrum.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Watterson {
    /// Doppler spread, in Hz: twice the standard deviation of each path's Gaussian Doppler
    /// spectrum (the ITU-R F.1487 definition).
    pub doppler_spread_hz: f64,
    /// Delay of the second path, in milliseconds. Rounded to whole samples at 12 kHz.
    pub delay_ms: f64,
}

impl Watterson {
    /// ITU-R F.1487 mid-latitude moderate conditions: 0.5 Hz spread, 1 ms delay.
    pub const MODERATE: Watterson = Watterson {
        doppler_spread_hz: 0.5,
        delay_ms: 1.0,
    };
    /// ITU-R F.1487 mid-latitude disturbed conditions: 1 Hz spread, 2 ms delay.
    pub const DISTURBED: Watterson = Watterson {
        doppler_spread_hz: 1.0,
        delay_ms: 2.0,
    };
}

/// Adds white Gaussian noise of standard deviation `sigma` to `audio`.
pub fn add_awgn<R: Rng>(audio: &mut [f32], sigma: f64, rng: &mut R) {
    for x in audio.iter_mut() {
        let n: f64 = rng.sample(StandardNormal);
        *x += (n * sigma) as f32;
    }
}

/// A complex Gaussian process of `len` samples at 12 kHz whose power spectrum is Gaussian
/// with standard deviation `sigma_hz`, scaled so its expected power is `power`. A zero
/// `sigma_hz` gives a constant complex gain (flat Rayleigh fading).
pub fn doppler_process<R: Rng>(
    len: usize,
    sigma_hz: f64,
    power: f64,
    rng: &mut R,
    plans: &mut FftPlans,
) -> Vec<Complex32> {
    if len == 0 {
        return Vec::new();
    }
    let df = SAMPLE_RATE / len as f64;
    let mut weights = vec![0.0f64; len];
    for (k, w) in weights.iter_mut().enumerate() {
        let f = if k <= len / 2 {
            k as f64
        } else {
            k as f64 - len as f64
        } * df;
        *w = if sigma_hz > 0.0 {
            (-0.5 * (f / sigma_hz).powi(2)).exp()
        } else if k == 0 {
            1.0
        } else {
            0.0
        };
    }
    let total: f64 = weights.iter().sum();
    let norm = if total > 0.0 { (power / total).sqrt() } else { 0.0 };
    let half = std::f64::consts::FRAC_1_SQRT_2;
    let mut buf: Vec<Complex32> = weights
        .iter()
        .map(|&w| {
            if w < 1e-12 {
                return Complex32::new(0.0, 0.0);
            }
            let re: f64 = rng.sample(StandardNormal);
            let im: f64 = rng.sample(StandardNormal);
            let a = w.sqrt() * norm * half;
            Complex32::new((re * a) as f32, (im * a) as f32)
        })
        .collect();
    let mut scratch = Vec::new();
    fft::process(plans.inverse(len).as_ref(), &mut buf, &mut scratch);
    buf
}

/// Applies drift and fading to a real waveform and returns the real result. Drift is a
/// linear frequency ramp of `drift_hz_per_s`, zero at the middle of the waveform, so the
/// mean frequency is unchanged. With fading the output is `delay` samples longer.
pub fn apply<R: Rng>(
    waveform: &[f32],
    drift_hz_per_s: f64,
    fading: Option<Watterson>,
    rng: &mut R,
    plans: &mut FftPlans,
) -> Vec<f32> {
    if drift_hz_per_s == 0.0 && fading.is_none() {
        return waveform.to_vec();
    }
    let mut a = analytic::analytic_signal(waveform, plans);
    if drift_hz_per_s != 0.0 {
        let mid = a.len() as f64 / 2.0;
        for (i, c) in a.iter_mut().enumerate() {
            let t = (i as f64 - mid) / SAMPLE_RATE;
            let phase = std::f64::consts::PI * drift_hz_per_s * t * t;
            *c *= Complex32::new(phase.cos() as f32, phase.sin() as f32);
        }
    }
    let Some(w) = fading else {
        return a.iter().map(|c| c.re).collect();
    };
    let delay = (w.delay_ms.max(0.0) * SAMPLE_RATE / 1000.0).round() as usize;
    let len = a.len() + delay;
    let sigma = 0.5 * w.doppler_spread_hz.max(0.0);
    let g1 = doppler_process(len, sigma, 0.5, rng, plans);
    let g2 = doppler_process(len, sigma, 0.5, rng, plans);
    (0..len)
        .map(|i| {
            let direct = a.get(i).copied().unwrap_or_default() * g1[i];
            let late = i
                .checked_sub(delay)
                .and_then(|j| a.get(j))
                .copied()
                .unwrap_or_default()
                * g2[i];
            (direct + late).re
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    fn tone(freq: f64, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| (2.0 * std::f64::consts::PI * freq * i as f64 / SAMPLE_RATE).sin() as f32)
            .collect()
    }

    #[test]
    fn awgn_has_the_requested_variance() {
        let mut rng = ChaCha8Rng::seed_from_u64(1);
        let mut x = vec![0.0f32; 200_000];
        add_awgn(&mut x, 0.02, &mut rng);
        let mean = x.iter().map(|&v| f64::from(v)).sum::<f64>() / x.len() as f64;
        let var = x.iter().map(|&v| (f64::from(v) - mean).powi(2)).sum::<f64>() / x.len() as f64;
        assert!(mean.abs() < 2e-4, "{mean}");
        assert!((var.sqrt() - 0.02).abs() < 2e-4, "{}", var.sqrt());
    }

    #[test]
    fn doppler_process_has_expected_power_and_correlation() {
        let mut plans = FftPlans::new();
        // 4 Hz spread over 2 s: the spectrum spans many FFT bins.
        let sigma = 2.0;
        let len = 24_000;
        let lag = (SAMPLE_RATE / (2.0 * std::f64::consts::PI * sigma)) as usize;
        let (mut power, mut corr) = (0.0, 0.0);
        let trials = 60;
        for seed in 0..trials {
            let mut rng = ChaCha8Rng::seed_from_u64(seed);
            let g = doppler_process(len, sigma, 0.5, &mut rng, &mut plans);
            let p: f64 = g.iter().map(|c| f64::from(c.norm_sqr())).sum::<f64>() / len as f64;
            let r: f64 = (0..len - lag)
                .map(|i| f64::from((g[i] * g[i + lag].conj()).re))
                .sum::<f64>()
                / (len - lag) as f64;
            power += p;
            corr += r;
        }
        power /= trials as f64;
        corr /= trials as f64;
        assert!((power - 0.5).abs() < 0.08, "power {power}");
        // Gaussian spectrum: autocorrelation exp(-2 pi^2 sigma^2 tau^2) = exp(-0.5) at this lag.
        assert!(
            (corr / power - (-0.5f64).exp()).abs() < 0.12,
            "corr {}",
            corr / power
        );
    }

    #[test]
    fn zero_spread_gives_a_constant_gain() {
        let mut rng = ChaCha8Rng::seed_from_u64(3);
        let g = doppler_process(1000, 0.0, 0.5, &mut rng, &mut FftPlans::new());
        assert!(g.iter().all(|c| (c - g[0]).norm() < 1e-6));
        assert!(doppler_process(0, 1.0, 0.5, &mut rng, &mut FftPlans::new()).is_empty());
    }

    #[test]
    fn drift_moves_the_frequency_linearly_around_the_middle() {
        let len = 120_000; // 10 s
        let x = tone(1000.0, len);
        let mut rng = ChaCha8Rng::seed_from_u64(0);
        let y = apply(&x, 2.0, None, &mut rng, &mut FftPlans::new());
        // Count zero crossings in 1 s windows at 1-2 s and 8-9 s: -7 Hz and +7 Hz.
        let freq = |from: usize| {
            let w = &y[from..from + 12_000];
            w.windows(2).filter(|p| p[0] < 0.0 && p[1] >= 0.0).count() as f64
        };
        let early = freq(12_000);
        let late = freq(96_000);
        assert!((early - 993.0).abs() <= 2.0, "{early}");
        assert!((late - 1007.0).abs() <= 2.0, "{late}");
    }

    #[test]
    fn fading_preserves_average_power_and_extends_by_the_delay() {
        let len = 24_000;
        let x = tone(1500.0, len);
        let mut plans = FftPlans::new();
        let mut total = 0.0;
        let trials = 40;
        for seed in 0..trials {
            let mut rng = ChaCha8Rng::seed_from_u64(seed);
            let y = apply(&x, 0.0, Some(Watterson::DISTURBED), &mut rng, &mut plans);
            assert_eq!(y.len(), len + 24);
            total += y.iter().map(|&v| f64::from(v) * f64::from(v)).sum::<f64>() / len as f64;
        }
        let mean = total / trials as f64;
        assert!((mean - 0.5).abs() < 0.1, "mean power {mean}");
    }

    #[test]
    fn no_impairment_returns_the_input() {
        let x = tone(800.0, 100);
        let mut rng = ChaCha8Rng::seed_from_u64(0);
        assert_eq!(apply(&x, 0.0, None, &mut rng, &mut FftPlans::new()), x);
    }
}
