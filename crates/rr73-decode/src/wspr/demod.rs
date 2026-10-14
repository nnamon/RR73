//! Soft bits from tone powers.
//!
//! In symbol `i` the sync bit `s` leaves two tones: `s` (data bit 0) and `s + 2` (data bit
//! 1). With noise power `N` per correlator output and signal amplitude `A`, the amplitude `r`
//! of the tone carrying the signal is Rician and the other Rayleigh, so the log-likelihood
//! ratio of bit 1 is `ln I0(2 A r1 / N) - ln I0(2 A r0 / N)`. `N` comes from the two tones
//! the sync bit rules out, which carry no signal; `A²` from the mean power of the two allowed
//! tones less `2 N`.

use rr73_wspr::SYMBOLS;
use rr73_wspr::code::SYNC;

use rr73_dsp::fft::Complex32;

use super::refine::{ToneCorrs, TonePowers};

/// Soft information about one candidate.
#[derive(Clone, Debug, PartialEq)]
pub struct SoftSymbols {
    /// Log-likelihood ratio of data bit 1 for each channel symbol, in channel order.
    pub llr: [f32; SYMBOLS],
    /// Noise power per tone correlation.
    pub noise: f32,
    /// Estimated signal power per tone correlation.
    pub signal: f32,
}

impl Default for SoftSymbols {
    fn default() -> Self {
        Self {
            llr: [0.0; SYMBOLS],
            noise: 0.0,
            signal: 0.0,
        }
    }
}

/// Turns tone powers into soft bits.
pub trait WsprDemod {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Fills `out` from the phase-aligned correlations `corrs` and their powers.
    fn soft(&self, corrs: &ToneCorrs, powers: &TonePowers, out: &mut SoftSymbols);
}

/// Noncoherent binary FSK log-likelihood ratios.
#[derive(Clone, Debug, PartialEq)]
pub struct NoncoherentDemod {
    /// Factor applied to every ratio.
    pub llr_scale: f32,
}

/// Noise power from the two tones each symbol's sync bit rules out.
pub fn noise_power(powers: &TonePowers) -> f32 {
    let sum: f32 = powers
        .iter()
        .zip(SYNC.iter())
        .map(|(p, &s)| {
            let s = usize::from(s);
            p[1 - s] + p[3 - s]
        })
        .sum();
    sum / (2 * SYMBOLS) as f32
}

impl WsprDemod for NoncoherentDemod {
    fn name(&self) -> &'static str {
        "noncoherent"
    }

    fn soft(&self, _corrs: &ToneCorrs, powers: &TonePowers, out: &mut SoftSymbols) {
        let (noise, signal, k) = levels(powers);
        for (i, (p, &s)) in powers.iter().zip(SYNC.iter()).enumerate() {
            let s = usize::from(s);
            let r0 = p[s].max(0.0).sqrt();
            let r1 = p[s + 2].max(0.0).sqrt();
            out.llr[i] = self.llr_scale * (ln_i0(k * r1) - ln_i0(k * r0));
        }
        out.noise = noise;
        out.signal = signal;
    }
}

/// Noise power per correlation, signal power per correlation, and the factor `2 A / N` of
/// the Rician likelihood.
fn levels(powers: &TonePowers) -> (f32, f32, f32) {
    let noise = noise_power(powers).max(f32::MIN_POSITIVE);
    let allowed: f32 = powers
        .iter()
        .zip(SYNC.iter())
        .map(|(p, &s)| p[usize::from(s)] + p[usize::from(s) + 2])
        .sum::<f32>()
        / SYMBOLS as f32;
    // A floor of a tenth of the noise keeps the ratios finite and small when the estimate
    // says no signal.
    let signal = (allowed - 2.0 * noise).max(0.1 * noise);
    (noise, signal, 2.0 * signal.sqrt() / noise)
}

/// Multi-symbol noncoherent detection: for each symbol, every data pattern of the `block`
/// symbols centred on it is scored by the Rician likelihood of the coherent sum of their
/// phase-aligned correlations, and the bit's ratio is the log-sum of the patterns with the bit
/// set over those with it clear. With `block` 1 this is [`NoncoherentDemod`]. Longer blocks
/// gain from the phase continuity of the signal and lose when its phase wanders (fading,
/// frequency error).
#[derive(Clone, Debug, PartialEq)]
pub struct BlockDemod {
    /// Symbols per block, odd, 1 to 9.
    pub block: usize,
    /// Factor applied to every ratio.
    pub llr_scale: f32,
}

impl WsprDemod for BlockDemod {
    fn name(&self) -> &'static str {
        "block"
    }

    fn soft(&self, corrs: &ToneCorrs, powers: &TonePowers, out: &mut SoftSymbols) {
        let (noise, signal, k) = levels(powers);
        let half = (self.block.clamp(1, 9) / 2) as isize;
        let mut metrics = [0.0f32; 1 << 9];
        for i in 0..SYMBOLS {
            let lo = (i as isize - half).max(0) as usize;
            let hi = ((i as isize + half) as usize).min(SYMBOLS - 1);
            let n = hi - lo + 1;
            let centre = i - lo;
            for (h, m) in metrics.iter_mut().enumerate().take(1 << n) {
                let mut sum = Complex32::new(0.0, 0.0);
                for j in 0..n {
                    let s = usize::from(SYNC[lo + j]);
                    let d = (h >> j) & 1;
                    sum += corrs[lo + j][s + 2 * d];
                }
                *m = ln_i0(k * sum.norm());
            }
            let (mut one, mut zero) = (f32::NEG_INFINITY, f32::NEG_INFINITY);
            for (h, &m) in metrics.iter().enumerate().take(1 << n) {
                if (h >> centre) & 1 == 1 {
                    one = log_add(one, m);
                } else {
                    zero = log_add(zero, m);
                }
            }
            out.llr[i] = self.llr_scale * (one - zero);
        }
        out.noise = noise;
        out.signal = signal;
    }
}

/// `ln(e^a + e^b)`.
fn log_add(a: f32, b: f32) -> f32 {
    let (hi, lo) = if a > b { (a, b) } else { (b, a) };
    if lo == f32::NEG_INFINITY {
        hi
    } else {
        hi + (lo - hi).exp().ln_1p()
    }
}

/// Natural logarithm of the modified Bessel function I0, for x >= 0, to about 1e-6 relative.
/// Polynomial approximations from Abramowitz and Stegun 9.8.1 and 9.8.2.
pub fn ln_i0(x: f32) -> f32 {
    let x = f64::from(x.abs());
    if x <= 3.75 {
        let t = (x / 3.75).powi(2);
        let i0 = 1.0
            + t * (3.515_622_9
                + t * (3.089_942_4
                    + t * (1.206_749_2 + t * (0.265_973_2 + t * (0.036_076_8 + t * 0.004_581_3)))));
        i0.ln() as f32
    } else {
        let t = 3.75 / x;
        let poly = 0.398_942_28
            + t * (0.013_285_92
                + t * (0.002_253_19
                    + t * (-0.001_575_65
                        + t * (0.009_162_81
                            + t * (-0.020_577_06
                                + t * (0.026_355_37 + t * (-0.016_476_33 + t * 0.003_923_77)))))));
        (x - 0.5 * x.ln() + poly.ln()) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ln_i0_matches_tabulated_values() {
        // I0(1) = 1.266066, I0(5) = 27.239872, I0(20) = 4.355828e7.
        assert!((ln_i0(0.0)).abs() < 1e-7);
        assert!((ln_i0(1.0) - 1.266_066f32.ln()).abs() < 1e-5);
        assert!((ln_i0(5.0) - 27.239_872f32.ln()).abs() < 1e-4);
        assert!((ln_i0(20.0) - 4.355_828e7f32.ln()).abs() < 1e-3);
        // Continuous across the switch at 3.75.
        assert!((ln_i0(3.749_99) - ln_i0(3.750_01)).abs() < 1e-4);
    }

    #[test]
    fn ratios_follow_the_tones() {
        let mut p = [[1.0f32; 4]; SYMBOLS];
        for (i, row) in p.iter_mut().enumerate() {
            let s = usize::from(SYNC[i]);
            row[s + 2 * (i % 2)] = 9.0;
        }
        let mut out = SoftSymbols::default();
        let c = [[Complex32::new(0.0, 0.0); 4]; SYMBOLS];
        NoncoherentDemod { llr_scale: 1.0 }.soft(&c, &p, &mut out);
        assert!((out.noise - 1.0).abs() < 1e-6);
        assert!((out.signal - 8.0).abs() < 1e-4);
        for (i, l) in out.llr.iter().enumerate() {
            assert_eq!(*l > 0.0, i % 2 == 1, "{i}: {l}");
        }
    }

    #[test]
    fn block_of_one_matches_single_symbol_detection() {
        let mut p = [[0.0f32; 4]; SYMBOLS];
        let mut c = [[Complex32::new(0.0, 0.0); 4]; SYMBOLS];
        for i in 0..SYMBOLS {
            for k in 0..4 {
                let v = Complex32::new(((i * 7 + k * 3) % 5) as f32 * 0.7, ((i + k) % 3) as f32);
                c[i][k] = v;
                p[i][k] = v.norm_sqr();
            }
        }
        let (mut a, mut b) = (SoftSymbols::default(), SoftSymbols::default());
        NoncoherentDemod { llr_scale: 1.0 }.soft(&c, &p, &mut a);
        BlockDemod {
            block: 1,
            llr_scale: 1.0,
        }
        .soft(&c, &p, &mut b);
        for i in 0..SYMBOLS {
            assert!((a.llr[i] - b.llr[i]).abs() < 1e-4, "{i}");
        }
    }

    #[test]
    fn phase_aligned_neighbours_sharpen_the_decision() {
        // Every symbol sends data 1 with the same phase; the wrong tones hold small noise.
        let mut p = [[0.0f32; 4]; SYMBOLS];
        let mut c = [[Complex32::new(0.1, -0.1); 4]; SYMBOLS];
        for i in 0..SYMBOLS {
            let s = usize::from(SYNC[i]);
            c[i][s + 2] = Complex32::new(1.0, 0.5);
            c[i][s] = Complex32::new(-0.6, 0.6);
            for k in 0..4 {
                p[i][k] = c[i][k].norm_sqr();
            }
        }
        let (mut one, mut three) = (SoftSymbols::default(), SoftSymbols::default());
        BlockDemod {
            block: 1,
            llr_scale: 1.0,
        }
        .soft(&c, &p, &mut one);
        BlockDemod {
            block: 3,
            llr_scale: 1.0,
        }
        .soft(&c, &p, &mut three);
        assert!(
            three.llr[80] > one.llr[80] && one.llr[80] > 0.0,
            "{} {}",
            one.llr[80],
            three.llr[80]
        );
    }
}
