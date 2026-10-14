//! Channels for continuous keyboard-mode signals such as RTTY: white noise with the SNR in
//! 3000 Hz, Watterson fading at the CCIR 520 settings, and frequency offset and drift.
//!
//! The noise is the scenes' reference noise ([`crate::NOISE_RMS`], white over 0 to 6000 Hz),
//! so a signal at `snr_db` has power `10^(snr_db / 10) * NOISE_RMS^2 * 3000 / 6000`. The
//! signal's power is its mean square over the whole waveform passed in; with fading, the SNR
//! is the average over the fading process.

use std::f64::consts::TAU;

use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use rr73_dsp::{Complex32, FftPlans, analytic};
use serde::{Deserialize, Serialize};

use crate::channel::{self, SAMPLE_RATE, Watterson};
use crate::scene::{NOISE_RMS, PEAK_LIMIT};

/// Bandwidth the SNR of continuous signals refers to, in Hz.
pub const SNR_BANDWIDTH_HZ: f64 = 3000.0;

/// CCIR 520 good conditions: 0.1 Hz Doppler spread, 0.5 ms delay.
pub const CCIR_GOOD: Watterson = Watterson {
    doppler_spread_hz: 0.1,
    delay_ms: 0.5,
};

/// CCIR 520 moderate conditions: 0.5 Hz Doppler spread, 1 ms delay.
pub const CCIR_MODERATE: Watterson = Watterson {
    doppler_spread_hz: 0.5,
    delay_ms: 1.0,
};

/// CCIR 520 poor conditions: 1 Hz Doppler spread, 2 ms delay.
pub const CCIR_POOR: Watterson = Watterson {
    doppler_spread_hz: 1.0,
    delay_ms: 2.0,
};

/// A channel for one continuous transmission.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ContinuousChannel {
    /// SNR in 3000 Hz, in dB.
    pub snr_db: f64,
    /// Watterson fading, or `None` for a steady path.
    pub fading: Option<Watterson>,
    /// Frequency offset at the start of the transmission, in Hz.
    pub offset_hz: f64,
    /// Linear drift from the start of the transmission, in Hz per second.
    pub drift_hz_per_s: f64,
    /// Noise before the transmission, in seconds.
    pub lead_s: f64,
    /// Noise after the transmission, in seconds.
    pub tail_s: f64,
    /// Add the reference noise. Without it the signal keeps the level its SNR gives.
    pub noise: bool,
}

impl Default for ContinuousChannel {
    fn default() -> Self {
        Self {
            snr_db: 0.0,
            fading: None,
            offset_hz: 0.0,
            drift_hz_per_s: 0.0,
            lead_s: 0.0,
            tail_s: 0.0,
            noise: true,
        }
    }
}

/// Puts `signal` (12 kHz) through `channel`. The output holds the lead, the signal (longer by
/// the fading delay), and the tail. Deterministic for a given seed.
pub fn render_continuous(signal: &[f32], channel: &ContinuousChannel, seed: u64) -> Vec<f32> {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut plans = FftPlans::new();
    let power = signal.iter().map(|&x| f64::from(x).powi(2)).sum::<f64>() / signal.len().max(1) as f64;
    let target =
        10f64.powf(channel.snr_db / 10.0) * NOISE_RMS * NOISE_RMS * SNR_BANDWIDTH_HZ / (SAMPLE_RATE / 2.0);
    let gain = if power > 0.0 { (target / power).sqrt() } else { 0.0 };
    let mut x: Vec<f32> = signal.iter().map(|&v| (f64::from(v) * gain) as f32).collect();
    if channel.offset_hz != 0.0 || channel.drift_hz_per_s != 0.0 {
        let a = analytic::analytic_signal(&x, &mut plans);
        x = a
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let t = i as f64 / SAMPLE_RATE;
                let phase =
                    (TAU * (channel.offset_hz * t + 0.5 * channel.drift_hz_per_s * t * t)).rem_euclid(TAU);
                (c * Complex32::new(phase.cos() as f32, phase.sin() as f32)).re
            })
            .collect();
    }
    if channel.fading.is_some() {
        x = channel::apply(&x, 0.0, channel.fading, &mut rng, &mut plans);
    }
    let lead = (channel.lead_s.max(0.0) * SAMPLE_RATE).round() as usize;
    let tail = (channel.tail_s.max(0.0) * SAMPLE_RATE).round() as usize;
    let mut out = vec![0.0f32; lead + x.len() + tail];
    out[lead..lead + x.len()].copy_from_slice(&x);
    if channel.noise {
        channel::add_awgn(&mut out, NOISE_RMS, &mut rng);
    }
    let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    if peak > PEAK_LIMIT {
        let k = PEAK_LIMIT / peak;
        for v in &mut out {
            *v *= k;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: f64, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| (TAU * freq * i as f64 / SAMPLE_RATE).sin() as f32)
            .collect()
    }

    #[test]
    fn snr_refers_to_3000_hz() {
        let x = tone(1500.0, 120_000);
        let quiet = ContinuousChannel {
            snr_db: -6.0,
            noise: false,
            lead_s: 0.5,
            ..ContinuousChannel::default()
        };
        let y = render_continuous(&x, &quiet, 1);
        assert_eq!(y.len(), 126_000);
        assert!(y[..6000].iter().all(|&v| v == 0.0));
        let p = y[6000..].iter().map(|&v| f64::from(v).powi(2)).sum::<f64>() / 120_000.0;
        let n3k = NOISE_RMS * NOISE_RMS * 0.5;
        assert!((10.0 * (p / n3k).log10() + 6.0).abs() < 0.01);
        let noisy = render_continuous(&x, &ContinuousChannel { noise: true, ..quiet }, 1);
        let lead_power = noisy[..6000].iter().map(|&v| f64::from(v).powi(2)).sum::<f64>() / 6000.0;
        assert!((lead_power.sqrt() / NOISE_RMS - 1.0).abs() < 0.03);
    }

    #[test]
    fn offset_and_drift_move_the_tone() {
        let x = tone(1000.0, 120_000);
        let ch = ContinuousChannel {
            snr_db: 20.0,
            noise: false,
            offset_hz: 50.0,
            drift_hz_per_s: 2.0,
            ..ContinuousChannel::default()
        };
        let y = render_continuous(&x, &ch, 0);
        let crossings = |from: usize| {
            y[from..from + 12_000]
                .windows(2)
                .filter(|p| p[0] < 0.0 && p[1] >= 0.0)
                .count() as f64
        };
        // 1050 Hz plus 2 Hz/s: 1051 Hz mean over 0 to 1 s, 1067 Hz over 8 to 9 s.
        assert!((crossings(0) - 1051.0).abs() <= 2.0, "{}", crossings(0));
        assert!((crossings(96_000) - 1067.0).abs() <= 2.0, "{}", crossings(96_000));
    }

    #[test]
    fn fading_keeps_the_average_snr() {
        let x = tone(1500.0, 24_000);
        let mut total = 0.0;
        for seed in 0..30 {
            let ch = ContinuousChannel {
                snr_db: 0.0,
                noise: false,
                fading: Some(CCIR_POOR),
                ..ContinuousChannel::default()
            };
            let y = render_continuous(&x, &ch, seed);
            total += y.iter().map(|&v| f64::from(v).powi(2)).sum::<f64>() / 24_000.0;
        }
        let mean = total / 30.0 / (NOISE_RMS * NOISE_RMS * 0.5);
        assert!((mean - 1.0).abs() < 0.2, "{mean}");
    }
}
