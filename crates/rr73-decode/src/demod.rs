//! Demodulation: symbol energies to 174 code-bit log-likelihood ratios.
//!
//! LLR sign convention throughout the crate: positive means the bit is more likely 1
//! (`log(P(1) / P(0))`), as in ft8_lib.
//!
//! [`MaxLogDemod`] is ported from ft8_lib (`ft8/decode.c`, `ft8_extract_likelihood`,
//! `ft4_extract_likelihood`, `ft8_extract_symbol`, `ft4_extract_symbol` and
//! `ftx_normalize_logl`), Copyright (c) 2018 Kārlis Goba, MIT licence. Changes: one routine
//! serves both modes from the frame layout's Gray map and data symbol list, and a zero or
//! non-finite variance leaves the LLRs at zero.

use crate::layout::CODEWORD_BITS;
use crate::view::{Candidate, SymbolView};

/// Turns a candidate's symbol energies into code-bit LLRs.
pub trait Demodulator {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Writes the 174 LLRs of `cand` into `llr`. Symbols outside the spectrogram give 0.
    fn llrs(&self, view: &SymbolView<'_>, cand: &Candidate, llr: &mut [f32; CODEWORD_BITS]);
}

/// ft8_lib's max-log demodulator over dB magnitudes.
///
/// For each data symbol and each of its bits, the LLR is the largest dB level among the
/// tones whose Gray-mapped value has the bit set, minus the largest among those with the bit
/// clear. The 174 values are then scaled so their variance is `variance`.
#[derive(Clone, Debug, PartialEq)]
pub struct MaxLogDemod {
    /// Target variance of the scaled LLRs (ft8_lib: 24).
    pub variance: f32,
}

/// Largest number of tones a layout may use (FT8: 8).
const MAX_TONES: usize = 8;

impl Demodulator for MaxLogDemod {
    fn name(&self) -> &'static str {
        "max-log"
    }

    fn llrs(&self, view: &SymbolView<'_>, cand: &Candidate, llr: &mut [f32; CODEWORD_BITS]) {
        llr.fill(0.0);
        // Bits of symbols in frames that overlap silence: erased, and left out of the
        // variance so the scale follows the symbols that carry audio.
        let mut silent = [false; CODEWORD_BITS];
        let layout = view.layout;
        let bps = layout.bits_per_symbol;
        let tones = layout.tones.min(MAX_TONES).min(layout.gray.len());
        let mut level = [0.0f32; MAX_TONES];
        for (k, &sym) in layout.data.iter().enumerate() {
            let base = k * bps;
            if base + bps > CODEWORD_BITS {
                break;
            }
            let frame = view.symbol_frame(cand.frame, sym);
            let Some(row) = view.row(frame) else {
                continue;
            };
            if !view.is_live(frame) {
                silent[base..base + bps].fill(true);
                continue;
            }
            let mut complete = true;
            for (v, l) in level.iter_mut().enumerate().take(tones) {
                let bin = view.tone_bin(cand.bin, layout.gray[v] as usize);
                match usize::try_from(bin).ok().and_then(|b| row.get(b)) {
                    Some(&x) if x.is_finite() => *l = x,
                    _ => complete = false,
                }
            }
            if !complete {
                continue;
            }
            for i in 0..bps {
                let mask = 1usize << (bps - 1 - i);
                let (mut one, mut zero) = (f32::NEG_INFINITY, f32::NEG_INFINITY);
                for (v, &l) in level.iter().enumerate().take(tones) {
                    if v & mask != 0 {
                        one = one.max(l);
                    } else {
                        zero = zero.max(l);
                    }
                }
                llr[base + i] = one - zero;
            }
        }
        normalise_variance_over(llr, self.variance, &silent);
    }
}

/// As [`normalise_variance`], with the variance taken over the entries not marked in
/// `skip`. Skipped entries stay zero.
pub fn normalise_variance_over(llr: &mut [f32], target: f32, skip: &[bool]) {
    if !skip.iter().any(|&s| s) {
        normalise_variance(llr, target);
        return;
    }
    let mut kept: Vec<f32> = llr
        .iter()
        .zip(skip)
        .filter(|&(_, &s)| !s)
        .map(|(&x, _)| x)
        .collect();
    normalise_variance(&mut kept, target);
    let mut it = kept.into_iter();
    for (x, &s) in llr.iter_mut().zip(skip) {
        *x = if s { 0.0 } else { it.next().unwrap_or(0.0) };
    }
}

/// Scales `llr` so that its variance is `target`. Leaves it unchanged when the variance is
/// zero or not finite, and zeroes any non-finite entries first.
pub fn normalise_variance(llr: &mut [f32], target: f32) {
    for x in llr.iter_mut() {
        if !x.is_finite() {
            *x = 0.0;
        }
    }
    let n = llr.len() as f32;
    if llr.is_empty() {
        return;
    }
    let sum: f32 = llr.iter().sum();
    let sum2: f32 = llr.iter().map(|x| x * x).sum();
    let variance = (sum2 - sum * sum / n) / n;
    if !(variance > 0.0 && variance.is_finite()) {
        return;
    }
    let factor = (target / variance).sqrt();
    if factor.is_finite() {
        for x in llr.iter_mut() {
            *x *= factor;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::test_layouts;
    use crate::search::{CandidateSearch, CostasSearch};
    use crate::testsig;

    fn decode_bits(layout: &crate::layout::FrameLayout, snr_db: f64, seed: u64) -> (Vec<u8>, [f32; 174]) {
        let tones = testsig::random_tones(layout, seed);
        let audio = testsig::render(layout, &tones, 1000.0, 0.0, snr_db, Some(seed + 1));
        let spec = testsig::spectrogram(layout, &audio);
        let view = SymbolView {
            spec: &spec,
            layout,
            time_osr: 2,
            freq_osr: 2,
            live: &[],
        };
        let mut cands = Vec::new();
        CostasSearch {
            max_candidates: 5,
            min_score_db: 1.0,
        }
        .search(&view, view.frame_range(-0.5, 0.5), &mut cands);
        let mut llr = [0.0f32; 174];
        MaxLogDemod { variance: 24.0 }.llrs(&view, &cands[0], &mut llr);
        (testsig::data_bits(layout, &tones), llr)
    }

    #[test]
    fn strong_signal_llrs_have_the_right_signs_and_variance() {
        for layout in [test_layouts::ft8(), test_layouts::ft4()] {
            let (bits, llr) = decode_bits(&layout, 0.0, 3);
            for (i, (&b, &l)) in bits.iter().zip(llr.iter()).enumerate() {
                assert_eq!(u8::from(l > 0.0), b, "{:?} bit {i}: llr {l}", layout.mode);
            }
            let mean = llr.iter().sum::<f32>() / 174.0;
            let var = llr.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / 174.0;
            assert!((var - 24.0).abs() < 0.01, "variance {var}");
        }
    }

    #[test]
    fn weak_signal_llrs_are_mostly_right() {
        let layout = test_layouts::ft8();
        let (bits, llr) = decode_bits(&layout, -16.0, 9);
        let errors = bits
            .iter()
            .zip(llr.iter())
            .filter(|(b, l)| u8::from(**l > 0.0) != **b)
            .count();
        assert!(errors < 40, "{errors} hard errors of 174");
    }

    #[test]
    fn missing_symbols_give_zero_llrs() {
        let layout = test_layouts::ft8();
        let spec = testsig::spectrogram(&layout, &testsig::noise(30_000, 1));
        let view = SymbolView {
            spec: &spec,
            layout: &layout,
            time_osr: 2,
            freq_osr: 2,
            live: &[],
        };
        let mut llr = [1.0f32; 174];
        MaxLogDemod { variance: 24.0 }.llrs(&view, &Candidate::new(0, 10, 0.0), &mut llr);
        // Only the first data symbols fall inside 30000 samples; the rest stay zero.
        assert!(llr[..12].iter().any(|&x| x != 0.0));
        assert!(llr[120..].iter().all(|&x| x == 0.0));
        MaxLogDemod { variance: 24.0 }.llrs(&view, &Candidate::new(10_000, 10, 0.0), &mut llr);
        assert!(llr.iter().all(|&x| x == 0.0));
        MaxLogDemod { variance: 24.0 }.llrs(&view, &Candidate::new(0, -50, 0.0), &mut llr);
        assert!(llr.iter().all(|&x| x == 0.0));
    }

    #[test]
    fn normalisation_handles_degenerate_input() {
        let mut flat = [2.0f32; 174];
        normalise_variance(&mut flat, 24.0);
        assert!(flat.iter().all(|&x| x == 2.0));
        let mut nan = [f32::NAN; 174];
        normalise_variance(&mut nan, 24.0);
        assert!(nan.iter().all(|&x| x == 0.0));
        let mut empty: [f32; 0] = [];
        normalise_variance(&mut empty, 24.0);
    }
}
