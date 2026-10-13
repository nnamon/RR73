//! 4-FSK waveform synthesis.
//!
//! WSPR sends one of 4 tones per symbol, 1.4648 Hz apart, for 8192 samples at 12 kHz (0.683 s),
//! with continuous phase across symbol boundaries. The frequency given is the centre of the
//! signal, midway between tones 1 and 2, so tone `k` sits at `centre + (k - 1.5) × 1.4648 Hz`.
//! Drift is a linear frequency ramp, zero at the middle of the transmission, so the mean
//! frequency stays at the centre.
//!
//! The waveform rises and falls with a raised cosine over [`RAMP_S`] at each end to avoid key
//! clicks. The protocol does not specify a ramp; this one costs under 0.001 dB of signal.

use std::f64::consts::{PI, TAU};

use crate::{SAMPLE_RATE_HZ, SAMPLES_PER_SYMBOL, TONE_SPACING_HZ};

/// Length of the amplitude ramp at each end of a transmission, in seconds.
pub const RAMP_S: f64 = 0.02;

/// Synthesises phase-continuous 4-FSK for `symbols` (tones 0 to 3) with the signal centre at
/// `centre_hz`, a linear drift of `drift_hz_per_s` (Hz per second, zero at the middle), at
/// `sample_rate` Hz and peak `amplitude`.
///
/// Symbol `i` covers samples from `i × 8192 × rate / 12000` (rounded down), so every symbol is
/// exactly 0.683 s long on average at any rate; the length is `round(162 × 8192 × rate /
/// 12000)`. Returns an empty vector for empty `symbols` or a zero rate. Tone values are not
/// checked.
pub fn fsk(
    symbols: &[u8],
    centre_hz: f64,
    drift_hz_per_s: f64,
    sample_rate: u32,
    amplitude: f32,
) -> Vec<f32> {
    if symbols.is_empty() || sample_rate == 0 {
        return Vec::new();
    }
    let fs = f64::from(sample_rate);
    let count = symbols.len() as u64;
    // Symbol i starts at sample i * per_symbol_num / per_symbol_den.
    let num = SAMPLES_PER_SYMBOL as u64 * u64::from(sample_rate);
    let den = u64::from(SAMPLE_RATE_HZ);
    let len = ((count * num + den / 2) / den) as usize;
    let middle_s = len as f64 / fs / 2.0;
    let mut out = Vec::with_capacity(len);
    let mut phase = 0.0f64;
    for k in 0..len {
        out.push((f64::from(amplitude) * phase.sin()) as f32);
        let i = ((k as u64 * den) / num).min(count - 1) as usize;
        let t = k as f64 / fs;
        let f = centre_hz + (f64::from(symbols[i]) - 1.5) * TONE_SPACING_HZ + drift_hz_per_s * (t - middle_s);
        phase = (phase + TAU * f / fs).rem_euclid(TAU);
    }
    let ramp = ((RAMP_S * fs).round() as usize).min(len / 2);
    for i in 0..ramp {
        let env = ((1.0 - (PI * i as f64 / ramp as f64).cos()) / 2.0) as f32;
        out[i] *= env;
        let last = len - 1 - i;
        out[last] *= env;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Power of `x` at `freq` by correlation over `x`, normalised to a unit sine giving 0.25.
    fn tone_power(x: &[f32], freq: f64, fs: f64) -> f64 {
        let (mut re, mut im) = (0.0, 0.0);
        for (n, &v) in x.iter().enumerate() {
            let p = TAU * freq * n as f64 / fs;
            re += f64::from(v) * p.cos();
            im += f64::from(v) * p.sin();
        }
        (re * re + im * im) / (x.len() as f64).powi(2)
    }

    #[test]
    fn lengths_follow_the_symbol_rate() {
        let s = [0u8; 162];
        assert_eq!(fsk(&s, 1500.0, 0.0, 12_000, 1.0).len(), 1_327_104);
        assert_eq!(fsk(&s, 1500.0, 0.0, 48_000, 1.0).len(), 4 * 1_327_104);
        // 44.1 kHz: 162 x 8192 x 44100 / 12000 = 4 877 107.2 samples.
        assert_eq!(fsk(&s, 1500.0, 0.0, 44_100, 1.0).len(), 4_877_107);
        assert!(fsk(&[], 1500.0, 0.0, 12_000, 1.0).is_empty());
        assert!(fsk(&s, 1500.0, 0.0, 0, 1.0).is_empty());
    }

    #[test]
    fn each_symbol_sits_on_its_tone() {
        let symbols = [0u8, 1, 2, 3, 3, 2, 1, 0];
        let x = fsk(&symbols, 1500.0, 0.0, 12_000, 1.0);
        for (i, &s) in symbols.iter().enumerate() {
            let seg = &x[i * 8192..(i + 1) * 8192];
            let want = 1500.0 + (f64::from(s) - 1.5) * TONE_SPACING_HZ;
            let on = tone_power(seg, want, 12_000.0);
            let off = tone_power(seg, want + TONE_SPACING_HZ, 12_000.0);
            assert!((on - 0.25).abs() < 0.01, "symbol {i}: {on}");
            assert!(off < 0.02, "symbol {i}: {off}");
        }
    }

    #[test]
    fn drift_is_zero_at_the_middle() {
        let symbols = [1u8; 162];
        let drift = 0.04; // 4.4 Hz over the transmission
        let x = fsk(&symbols, 1500.0, drift, 12_000, 1.0);
        let fs = 12_000.0;
        let mid = x.len() / 2;
        let tone1 = 1500.0 - 0.5 * TONE_SPACING_HZ;
        let at = |start: usize, freq: f64| tone_power(&x[start..start + 12_000], freq, fs);
        // One second around the middle sits on tone 1; the first second is 2.2 Hz lower.
        assert!(at(mid - 6000, tone1) > 0.2);
        let early = tone1 - drift * (mid as f64 / fs - 0.5);
        assert!(at(0, early) > 0.2, "{}", at(0, early));
        assert!(at(0, tone1) < 0.05);
    }

    #[test]
    fn ramps_start_and_end_at_zero_and_keep_the_peak() {
        let x = fsk(&[2u8; 162], 1500.0, 0.0, 12_000, 0.5);
        assert_eq!(x[0], 0.0);
        assert!(x[x.len() - 1].abs() < 1e-3);
        let peak = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!((peak - 0.5).abs() < 1e-3 && peak <= 0.5);
    }
}
