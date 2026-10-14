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
//!
//! Both averages leave out frames that overlap digital silence (`crate::silence`), so a
//! slot that audio joined partway through, or that holds a zero-filled hole, gives the SNR
//! of the audio it holds. Silent cells read -120 dB: counted as noise they pull the 20th
//! percentile down by tens of dB once about 3 s of an FT8 slot is silent.

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
    /// `live` marks the spectrogram frames to use (see [`crate::silence::live_frames`]);
    /// frames past its end count as live, so an empty slice uses every frame. `scratch`
    /// holds the noise cells between calls.
    pub fn estimate(
        &self,
        view: &SymbolView<'_>,
        cand: &Candidate,
        tones: &[u8],
        live: &[bool],
        scratch: &mut Vec<f32>,
    ) -> f32 {
        let noise = noise_power(view, cand, live, scratch);
        let layout = view.layout;
        let (mut sum, mut count) = (0.0f64, 0usize);
        for (k, &tone) in tones.iter().enumerate().take(layout.symbols) {
            let frame = view.symbol_frame(cand.frame, k);
            if !is_live(live, frame) {
                continue;
            }
            let Some(row) = view.row(frame) else {
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

/// Whether frame `frame` is marked live in `live`; frames past its end are.
fn is_live(live: &[bool], frame: isize) -> bool {
    usize::try_from(frame)
        .ok()
        .and_then(|f| live.get(f))
        .is_none_or(|&l| l)
}

/// Mean noise power per cell near a candidate over the live frames, or `None` with no
/// usable cells.
fn noise_power(
    view: &SymbolView<'_>,
    cand: &Candidate,
    live: &[bool],
    scratch: &mut Vec<f32>,
) -> Option<f32> {
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
        if !is_live(live, frame) {
            frame += tosr.max(1);
            continue;
        }
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
    use rr73_dsp::{SpectrogramConfig, WindowKind};

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
            let est = scale.estimate(&view, best, &tones, &[], &mut scratch);
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
    fn silent_frames_leave_the_estimate_unchanged() {
        // The app zero-fills the part of a slot before audio arrived and holes after an
        // interruption. With the same candidate, the estimate over what remains stays within
        // 1.5 dB of the full slot's. Counting silent cells as noise read 5 dB high with 2 s
        // silent and gave the 60 dB ceiling from 4 s.
        let layout = test_layouts::ft8();
        let config = SpectrogramConfig::oversampled(1920, 2, 2, 200.0, 3000.0, 12_000).expect("config");
        let scale = SnrScale::new(&layout, 3840, &WindowKind::Hann.build(3840));
        let mut scratch = Vec::new();
        let mut live = Vec::new();
        for (seed, snr) in [(1u64, -16.0), (2, -8.0), (3, 0.0), (4, 10.0)] {
            let tones = testsig::random_tones(&layout, seed);
            let audio = testsig::render(&layout, &tones, 1234.5, 0.3, snr, Some(500 + seed));
            let estimate =
                |audio: &[f32], live: &mut Vec<bool>, scratch: &mut Vec<f32>, cand: Option<Candidate>| {
                    let spec = testsig::spectrogram(&layout, audio);
                    let view = SymbolView {
                        spec: &spec,
                        layout: &layout,
                        time_osr: 2,
                        freq_osr: 2,
                    };
                    let cand = cand.unwrap_or_else(|| {
                        let mut cands = Vec::new();
                        CostasSearch {
                            max_candidates: 3,
                            min_score_db: 0.0,
                        }
                        .search(&view, view.frame_range(-1.0, 1.0), &mut cands);
                        *cands.first().expect("candidate")
                    });
                    crate::silence::live_frames(audio, &config, spec.frames(), live);
                    (scale.estimate(&view, &cand, &tones, live, scratch), cand)
                };
            let (full, cand) = estimate(&audio, &mut live, &mut scratch, None);
            assert!(live.iter().all(|&l| l));
            let mut cases: Vec<(String, Vec<f32>)> = [2usize, 4, 7, 9]
                .iter()
                .map(|&s| {
                    let mut a = audio.clone();
                    a[..s * 12_000].fill(0.0);
                    (format!("first {s} s silent"), a)
                })
                .collect();
            let mut hole = audio.clone();
            hole[72_000..78_000].fill(0.0);
            cases.push(("0.5 s hole at 6 s".into(), hole));
            let mut tail = audio.clone();
            tail[150_000..].fill(0.0);
            cases.push(("last 2.5 s silent".into(), tail));
            for (name, a) in cases {
                let (est, _) = estimate(&a, &mut live, &mut scratch, Some(cand));
                assert!(
                    (est - full).abs() <= 1.5,
                    "{snr} dB, {name}: full slot {full:.2} dB, estimate {est:.2} dB"
                );
            }
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
        let snr = scale.estimate(&view, &Candidate::new(0, 0, 0.0), &[0; 79], &[], &mut Vec::new());
        assert_eq!(snr, FLOOR_DB);
    }
}
