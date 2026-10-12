//! GFSK waveform synthesis.
//!
//! Both modes use continuous-phase FSK with modulation index 1. The frequency deviation is a
//! sum of Gaussian-smoothed rectangular pulses, one per symbol (QEX, section 5, equations 1
//! to 3):
//!
//! ```text
//! p(t) = [erf(k·BT·(t/T + 0.5)) − erf(k·BT·(t/T − 0.5))] / 2T,   k = π·√(2 / ln 2)
//! ```
//!
//! with BT = 2 for FT8 and BT = 1 for FT4. Each pulse is truncated to 3 symbol periods. The
//! first and last tones are extended by one symbol so the pulse tails at the edges keep
//! their frequency. The phase starts at 0 and is the running sum of the instantaneous
//! frequency, sampled at the start of each sample interval. The output is `amplitude ·
//! sin(phase)`. These details follow `synth_gfsk()` in ft8_lib's `demo/gen_ft8.c`
//! (Kārlis Goba, MIT licence).
//!
//! Amplitude ramps follow QEX, section 5: FT8 rises and falls with a raised cosine over
//! T/8 (20 ms) at each end; FT4 uses a raised cosine over its full 48 ms ramp symbols.
//! ft8_lib uses T/8 for FT4 too, so FT4 waveforms differ from ft8_lib in the first and last
//! symbol only.

use crate::Mode;
use std::f64::consts::{PI, TAU};

/// Synthesises a phase-continuous GFSK waveform for `tones`, with the base tone at `f0_hz`,
/// at `sample_rate` Hz and peak `amplitude`. The waveform starts at the first sample and
/// includes the protocol's amplitude ramps at both ends.
///
/// Each symbol lasts `round(sample_rate × T)` samples, with T = 0.16 s (FT8) or 0.048 s
/// (FT4). That is exact at 8, 12, 16, 24, 48 and 96 kHz; at 44.1 kHz FT4 symbols come out
/// 0.2 samples (0.009 %) long. Tone `n` sits at `f0_hz + n × sample_rate / samples per
/// symbol`; tone values are not checked against the mode's alphabet. Returns an empty vector
/// for empty `tones` or for fewer than 8 samples per symbol (sample rates below 50 Hz for
/// FT8 and 167 Hz for FT4).
pub fn gfsk(mode: Mode, tones: &[u8], f0_hz: f32, sample_rate: u32, amplitude: f32) -> Vec<f32> {
    let params = mode.params();
    let n = (f64::from(sample_rate) * params.symbol_s()).round() as usize;
    if tones.is_empty() || n < 8 {
        return Vec::new();
    }
    let pulse = gfsk_pulse(n, f64::from(params.gfsk_bt));
    let base = TAU * f64::from(f0_hz) / f64::from(sample_rate);
    let peak = TAU / n as f64;
    let count = tones.len();
    // Symbol i for i in -1..=count, with the first and last tones repeated at the ends.
    let tone = |i: isize| -> f64 {
        let clamped = i.clamp(0, count as isize - 1) as usize;
        f64::from(tones[clamped])
    };

    let mut out = Vec::with_capacity(count * n);
    let mut phase = 0.0f64;
    for k in 0..count * n {
        out.push((f64::from(amplitude) * phase.sin()) as f32);
        // Frequency of sample k: ft8_lib keeps the deviation in an array padded by one
        // symbol at the start, adds the pulse of symbol i at offset i·n and reads position
        // k + n. The pulses covering that position belong to symbols q − 2 to q.
        let m = k + n;
        let q = (m / n) as isize;
        let mut dev = 0.0;
        for i in (q - 2)..=q {
            if i < -1 || i > count as isize {
                continue;
            }
            let j = m as isize - i * n as isize;
            if (0..3 * n as isize).contains(&j) {
                dev += tone(i) * pulse[j as usize];
            }
        }
        phase = (phase + base + peak * dev).rem_euclid(TAU);
    }

    let ramp = match mode {
        Mode::Ft8 => n / 8,
        Mode::Ft4 => n,
    }
    .min(out.len() / 2);
    for i in 0..ramp {
        let env = ((1.0 - (PI * i as f64 / ramp as f64).cos()) / 2.0) as f32;
        out[i] *= env;
        let last = out.len() - 1 - i;
        out[last] *= env;
    }
    out
}

/// Returns the Gaussian-smoothed frequency pulse sampled at `t = i / n − 1.5` symbols for
/// `i` in `0..3n`, scaled to unit area per symbol (QEX, equation 3).
fn gfsk_pulse(n: usize, bt: f64) -> Vec<f64> {
    let k = PI * (2.0 / std::f64::consts::LN_2).sqrt();
    (0..3 * n)
        .map(|i| {
            let t = i as f64 / n as f64 - 1.5;
            (erf(k * bt * (t + 0.5)) - erf(k * bt * (t - 0.5))) / 2.0
        })
        .collect()
}

/// The error function, to about 1e-15 absolute.
///
/// Uses `erf(x) = 2/√π · e^(−x²) · Σ 2ⁿ x^(2n+1) / (1·3·…·(2n+1))`, whose terms are all
/// positive, so there is no cancellation. For |x| ≥ 6, erf(x) = ±1 to double precision.
fn erf(x: f64) -> f64 {
    let a = x.abs();
    if a >= 6.0 {
        return x.signum();
    }
    let a2 = a * a;
    let mut term = a;
    let mut sum = a;
    let mut n = 0.0;
    while term > sum * 1e-17 {
        n += 1.0;
        term *= 2.0 * a2 / (2.0 * n + 1.0);
        sum += term;
    }
    let value = 2.0 / PI.sqrt() * (-a2).exp() * sum;
    value.copysign(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn erf_matches_reference_values() {
        // Values from Abramowitz and Stegun, Table 7.1, and standard tables.
        let cases = [
            (0.0, 0.0),
            (0.1, 0.112_462_916_018_284_9),
            (0.5, 0.520_499_877_813_046_5),
            (1.0, 0.842_700_792_949_714_9),
            (1.5, 0.966_105_146_475_310_7),
            (2.0, 0.995_322_265_018_952_7),
            (3.0, 0.999_977_909_503_001_4),
            (4.0, 0.999_999_984_582_742_1),
            (5.9, 0.999_999_999_999_999_9),
        ];
        for (x, want) in cases {
            assert!((erf(x) - want).abs() < 2e-15, "erf({x})");
            assert!((erf(-x) + want).abs() < 2e-15, "erf(-{x})");
        }
        assert_eq!(erf(6.0), 1.0);
        assert_eq!(erf(-30.0), -1.0);
    }

    #[test]
    fn pulse_has_unit_area() {
        for bt in [1.0, 2.0] {
            let n = 1920;
            let area: f64 = gfsk_pulse(n, bt).iter().sum::<f64>() / n as f64;
            assert!((area - 1.0).abs() < 1e-3, "BT {bt}: area {area}");
        }
    }

    #[test]
    fn length_is_symbols_times_samples_per_symbol() {
        let tones = vec![0u8; 79];
        assert_eq!(gfsk(Mode::Ft8, &tones, 1000.0, 12_000, 1.0).len(), 79 * 1920);
        assert_eq!(gfsk(Mode::Ft8, &tones, 1000.0, 48_000, 1.0).len(), 79 * 7680);
        assert_eq!(gfsk(Mode::Ft4, &[0u8; 105], 1000.0, 12_000, 1.0).len(), 105 * 576);
        assert_eq!(
            gfsk(Mode::Ft4, &[0u8; 105], 1000.0, 44_100, 1.0).len(),
            105 * 2117
        );
    }

    #[test]
    fn degenerate_inputs_do_not_panic() {
        assert!(gfsk(Mode::Ft8, &[], 1000.0, 12_000, 1.0).is_empty());
        assert!(gfsk(Mode::Ft8, &[3], 1000.0, 0, 1.0).is_empty());
        assert_eq!(gfsk(Mode::Ft4, &[1], 1000.0, 12_000, 1.0).len(), 576);
        assert_eq!(gfsk(Mode::Ft8, &[255, 0], -50.0, 12_000, 1.0).len(), 3840);
    }
}
