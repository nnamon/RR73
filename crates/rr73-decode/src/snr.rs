//! SNR of a decoded signal in the WSJT-X convention: signal power over the noise power in a
//! 2500 Hz bandwidth, in dB.
//!
//! Signal: the mean power, over all channel symbols, of the spectrogram cell at the
//! transmitted tone. Noise: a low percentile of the cells around the transmission but
//! outside its footprint, converted to a mean. The footprint is the signal's tone bins
//! widened by two tone spacings on each side, over the frames from one symbol before the
//! first symbol to one symbol after the last; a strong signal spreads into all of it
//! through the window's time and frequency leakage. The reference region is 16 tone
//! spacings on each side of the footprint over the whole slot, plus the footprint's bins
//! outside its frames. Cell powers of noise are exponentially distributed, so the 20th
//! percentile is `-ln(0.8)` = 0.223 times the mean; a low percentile keeps neighbouring
//! signals from raising the estimate. The excess of signal over noise is converted from
//! one cell to 2500 Hz with the window's equivalent noise bandwidth and the fraction of a
//! symbol's energy one frame captures.

use rr73_dsp::window;

use crate::layout::FrameLayout;
use crate::view::{Candidate, SymbolView};

/// Correction added after the analytic conversion, in dB. Fitted on simulated FT8 signals
/// in AWGN (see `docs/bench.md`, SNR calibration).
pub const EMPIRICAL_OFFSET_DB: f32 = 0.0;

/// Lowest SNR reported, in dB.
pub const FLOOR_DB: f32 = -30.0;

/// Highest SNR reported, in dB.
pub const CEILING_DB: f32 = 60.0;

/// Conversion constants for one spectrogram layout.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SnrScale {
    /// dB added to `10 log10(excess / noise)` to get SNR in 2500 Hz.
    pub offset_db: f32,
}

impl SnrScale {
    /// Constants for a spectrogram of `fft_size` points with `window` spanning it, a
    /// symbol of `layout.samples_per_symbol` samples, and a 12 kHz sample rate.
    pub fn new(layout: &FrameLayout, fft_size: usize, window: &[f32]) -> Self {
        let enbw_bins = window::enbw_bins(window);
        let total = window::sum(window);
        // Coherent gain for a tone present only during the symbol centred in the frame.
        let sps = layout.samples_per_symbol.min(window.len());
        let lead = (window.len() - sps) / 2;
        let centre: f64 = window[lead..lead + sps].iter().map(|&w| f64::from(w)).sum();
        let symbol_gain = if total > 0.0 {
            (centre / total).powi(2)
        } else {
            1.0
        };
        // A bin-centred sine of power P reads P/2 in the spectrogram (A^2/4 for A^2/2).
        // Noise of variance s^2 per sample reads s^2 * enbw / fft_size per cell. SNR in
        // 2500 Hz is P / (s^2 * 2500 / 6000).
        let nyquist = 6000.0;
        let ratio = 2.0 * (nyquist / 2500.0) * enbw_bins / fft_size.max(1) as f64 / symbol_gain.max(1e-9);
        Self {
            offset_db: (10.0 * ratio.log10()) as f32 + EMPIRICAL_OFFSET_DB,
        }
    }

    /// SNR estimate for a decoded candidate whose channel symbols are `tones`.
    /// `scratch` holds the noise cells between calls.
    pub fn estimate(
        &self,
        view: &SymbolView<'_>,
        cand: &Candidate,
        tones: &[u8],
        scratch: &mut Vec<f32>,
    ) -> f32 {
        let noise = noise_power(view, cand, scratch);
        let layout = view.layout;
        let (mut sum, mut count) = (0.0f64, 0usize);
        for (k, &tone) in tones.iter().enumerate().take(layout.symbols) {
            let Some(row) = view.row(view.symbol_frame(cand.frame, k)) else {
                continue;
            };
            if let Some(&v) = usize::try_from(view.tone_bin(cand.bin, tone as usize))
                .ok()
                .and_then(|b| row.get(b))
            {
                sum += f64::from(view.spec.to_power(v));
                count += 1;
            }
        }
        let Some(noise) = noise else { return FLOOR_DB };
        if count == 0 {
            return FLOOR_DB;
        }
        let signal = (sum / count as f64) as f32;
        let excess = ((signal - noise) / noise).max(1e-6);
        let snr = 10.0 * excess.log10() + self.offset_db;
        if snr.is_finite() {
            snr.clamp(FLOOR_DB, CEILING_DB)
        } else {
            FLOOR_DB
        }
    }
}

/// Tone spacings between the signal's outer tones and the noise reference region.
const GUARD_TONES: isize = 2;
/// Width of the noise reference region on each side, in tone spacings.
const REFERENCE_TONES: isize = 16;
/// Percentile of the reference cells used for the noise level.
const NOISE_PERCENTILE: f32 = 0.2;

/// Mean noise power per cell near a candidate, or `None` with no usable cells.
fn noise_power(view: &SymbolView<'_>, cand: &Candidate, scratch: &mut Vec<f32>) -> Option<f32> {
    let layout = view.layout;
    let fosr = view.freq_osr as isize;
    let tosr = view.time_osr as isize;
    let b0 = cand.bin as isize;
    let span = (layout.tones as isize - 1) * fosr;
    let foot_lo = b0 - GUARD_TONES * fosr;
    let foot_hi = b0 + span + GUARD_TONES * fosr;
    let ref_lo = foot_lo - REFERENCE_TONES * fosr;
    let ref_hi = foot_hi + REFERENCE_TONES * fosr;
    let first = view.symbol_frame(cand.frame, 0) - tosr;
    let last = view.symbol_frame(cand.frame, layout.symbols.saturating_sub(1)) + tosr;
    scratch.clear();
    // Every time_osr-th frame: neighbouring frames overlap and add little information.
    let mut frame = 0isize;
    while let Some(row) = view.row(frame) {
        let inside = frame >= first && frame <= last;
        let bins = row.len() as isize;
        for b in ref_lo.max(0)..(ref_hi + 1).min(bins) {
            if inside && b >= foot_lo && b <= foot_hi {
                continue;
            }
            let v = row[b as usize];
            if v.is_finite() {
                scratch.push(v);
            }
        }
        frame += tosr.max(1);
    }
    if scratch.is_empty() {
        return None;
    }
    let k = ((scratch.len() as f32 * NOISE_PERCENTILE) as usize).min(scratch.len() - 1);
    let (_, q, _) = scratch.select_nth_unstable_by(k, f32::total_cmp);
    let noise = view.spec.to_power(*q) / -(1.0 - NOISE_PERCENTILE).ln();
    (noise.is_finite() && noise > 0.0).then_some(noise)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::test_layouts;
    use crate::search::{CandidateSearch, CostasSearch};
    use crate::testsig;
    use rr73_dsp::WindowKind;

    /// Mean estimate over several noise draws for a CPFSK signal at `snr_db`.
    fn mean_estimate(snr_db: f64, trials: u64) -> f32 {
        let layout = test_layouts::ft8();
        let scale = SnrScale::new(&layout, 3840, &WindowKind::Hann.build(3840));
        let mut total = 0.0;
        let mut scratch = Vec::new();
        for seed in 0..trials {
            let tones = testsig::random_tones(&layout, seed);
            let freq = 900.0 + 37.3 * (seed % 20) as f64;
            let dt = -0.3 + 0.03 * (seed % 20) as f64;
            let audio = testsig::render(&layout, &tones, freq, dt, snr_db, Some(1000 + seed));
            let spec = testsig::spectrogram(&layout, &audio);
            let view = SymbolView {
                spec: &spec,
                layout: &layout,
                time_osr: 2,
                freq_osr: 2,
            };
            let mut cands = Vec::new();
            CostasSearch {
                max_candidates: 3,
                min_score_db: 0.0,
            }
            .search(&view, view.frame_range(-1.0, 1.0), &mut cands);
            let best = cands.first().expect("candidate");
            let est = scale.estimate(&view, best, &tones, &mut scratch);
            total += est;
        }
        total / trials as f32
    }

    #[test]
    fn analytic_constant_matches_the_derivation() {
        // Hann over 2 symbols: 10 log10(2 * 2.4 * 1.5 / 3840) = -27.27 dB, plus 1.74 dB for
        // the symbol filling the middle half of the window.
        let layout = test_layouts::ft8();
        let s = SnrScale::new(&layout, 3840, &WindowKind::Hann.build(3840));
        assert!(
            (s.offset_db - EMPIRICAL_OFFSET_DB - (-25.53)).abs() < 0.02,
            "{}",
            s.offset_db
        );
    }

    #[test]
    fn estimates_track_the_true_snr_for_cpfsk() {
        // CPFSK test signals at assorted sub-bin offsets and DTs: the mean of 8 estimates
        // stays within 1 dB of the truth from -20 to +10 dB.
        for snr in [-20.0, -14.0, -8.0, 0.0, 5.0, 10.0] {
            let est = mean_estimate(snr, 8) - EMPIRICAL_OFFSET_DB;
            assert!((f64::from(est) - snr).abs() < 1.0, "true {snr} estimated {est}");
        }
    }

    #[test]
    #[ignore = "prints the calibration curve"]
    fn print_curve() {
        for snr in [-24.0, -20.0, -17.0, -14.0, -11.0, -8.0, -4.0, 0.0, 5.0, 10.0] {
            println!("CURVE {snr} {}", mean_estimate(snr, 24));
        }
    }

    #[test]
    fn empty_view_gives_the_floor() {
        let layout = test_layouts::ft8();
        let spec = testsig::spectrogram(&layout, &[]);
        let view = SymbolView {
            spec: &spec,
            layout: &layout,
            time_osr: 2,
            freq_osr: 2,
        };
        let scale = SnrScale::new(&layout, 3840, &WindowKind::Hann.build(3840));
        let snr = scale.estimate(&view, &Candidate::new(0, 0, 0.0), &[0; 79], &mut Vec::new());
        assert_eq!(snr, FLOOR_DB);
    }
}
