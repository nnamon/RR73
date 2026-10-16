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
//!
//! Near a receiver's passband edge the noise is not flat over the reference region: past the
//! edge it falls by tens of dB (`crate::passband`). Given the pass's noise floor, the estimate
//! looks for an edge in the region: a bin whose floor lies more than [`EDGE_DB`] below the
//! region's passband level, the upper quartile of its floor outside the footprint. With an
//! edge there, bins that far down are left out of the reference, and the noise at each
//! symbol's tone is the reference level times that tone's attenuation (its floor against the
//! passband level, once that exceeds [`KNEE_DB`]). A signal on the skirt is attenuated with
//! the noise around it, so the ratio keeps its SNR at the antenna. Without an edge in the
//! region the estimate is the flat one, value for value.

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
    /// frames past its end count as live, so an empty slice uses every frame. `floor` is the
    /// spectrogram's noise floor per stored bin ([`crate::passband::NoiseFloor`]), or empty
    /// for a flat floor. `scratch` holds buffers between calls.
    pub fn estimate(
        &self,
        view: &SymbolView<'_>,
        cand: &Candidate,
        tones: &[u8],
        live: &[bool],
        floor: &[f32],
        scratch: &mut SnrScratch,
    ) -> f32 {
        let edge = passband_level(view, cand, floor, &mut scratch.cells).map(|level| Edge { floor, level });
        let skirt = edge.map(|e| skirt(view, cand, live, e, scratch));
        let noise = noise_power(
            view,
            cand,
            live,
            skirt.map(|s| (s, &scratch.shape[..])),
            &mut scratch.cells,
        );
        let layout = view.layout;
        let (mut sum, mut count) = (0.0f64, 0usize);
        let mut gain = 0.0f64;
        for (k, &tone) in tones.iter().enumerate().take(layout.symbols) {
            let frame = view.symbol_frame(cand.frame, k);
            if !is_live(live, frame) {
                continue;
            }
            let Some(row) = view.row(frame) else {
                continue;
            };
            let bin = view.tone_bin(cand.bin, tone as usize);
            if let Some(&v) = usize::try_from(bin).ok().and_then(|b| row.get(b)) {
                sum += f64::from(view.spec.to_power(v));
                count += 1;
                if let Some(s) = skirt {
                    gain += f64::from(s.attenuation(bin, &scratch.shape));
                }
            }
        }
        let Some(noise) = noise else { return FLOOR_DB };
        if count == 0 {
            return FLOOR_DB;
        }
        let signal = (sum / count as f64) as f32;
        // The noise at the symbols' tones: on a passband skirt it falls with the signal.
        let noise = if skirt.is_some() {
            noise * (gain / count as f64) as f32
        } else {
            noise
        };
        let excess = ((signal - noise) / noise).max(1e-6);
        let snr = 10.0 * excess.log10() + self.offset_db;
        if snr.is_finite() {
            snr.clamp(FLOOR_DB, CEILING_DB)
        } else {
            FLOOR_DB
        }
    }
}

/// Buffers the SNR estimate keeps between calls.
#[derive(Clone, Debug, Default)]
pub struct SnrScratch {
    cells: Vec<f32>,
    shape: Vec<f32>,
    column: Vec<f32>,
}

/// Tone spacings between the signal's outer tones and the noise reference region.
const GUARD_TONES: isize = 2;
/// Width of the noise reference region on each side, in tone spacings.
const REFERENCE_TONES: isize = 16;
/// Percentile of the reference cells used for the noise level.
const NOISE_PERCENTILE: f32 = 0.2;
/// A region bin whose noise floor lies this far below the region's passband level marks a
/// receiver's passband edge, in dB. Inside the passband the floor of the recorded slots
/// varies by up to 9 dB (experiment 0011).
pub const EDGE_DB: f32 = 10.0;
/// With an edge in the region, a tone whose floor lies this far below the passband level
/// counts as attenuated by the receiver's filter, in dB.
pub const KNEE_DB: f32 = 3.0;
/// Percentile of the region's floor outside the footprint taken as the passband level.
const LEVEL_PERCENTILE: f32 = 0.75;
/// Fewest live frames outside a transmission from which the skirt's shape is measured; with
/// fewer, the pass's floor gives it.
const MIN_OUTSIDE_FRAMES: usize = 8;

/// A passband edge in a candidate's reference region: the pass's noise floor per stored bin
/// and the region's passband level, in dB.
#[derive(Clone, Copy, Debug)]
struct Edge<'a> {
    floor: &'a [f32],
    level: f32,
}

/// The receiver's skirt across a candidate's region: the floor of bins `lo` onward in a
/// buffer, and the passband level, in dB.
#[derive(Clone, Copy, Debug)]
struct Skirt {
    lo: isize,
    level: f32,
}

impl Skirt {
    /// The floor at bin `b` against the passband level, from the floor in `shape`, in dB: 0
    /// outside the region.
    fn below(&self, b: isize, shape: &[f32]) -> f32 {
        usize::try_from(b - self.lo)
            .ok()
            .and_then(|i| shape.get(i))
            .map_or(0.0, |&f| f - self.level)
    }

    /// Power gain of the receiver's filter at bin `b` against the passband level, from the
    /// floor in `shape`: 1 inside the passband.
    fn attenuation(&self, b: isize, shape: &[f32]) -> f32 {
        let below = self.below(b, shape);
        if below < -KNEE_DB {
            10f32.powf(below / 10.0)
        } else {
            1.0
        }
    }
}

/// A candidate's footprint and reference region: lowest and highest footprint bin, lowest
/// and highest reference bin.
fn region(view: &SymbolView<'_>, cand: &Candidate) -> (isize, isize, isize, isize) {
    let fosr = view.freq_osr as isize;
    let b0 = cand.bin as isize;
    let span = (view.layout.tones as isize - 1) * fosr;
    let foot_lo = b0 - GUARD_TONES * fosr;
    let foot_hi = b0 + span + GUARD_TONES * fosr;
    (
        foot_lo,
        foot_hi,
        foot_lo - REFERENCE_TONES * fosr,
        foot_hi + REFERENCE_TONES * fosr,
    )
}

/// The first and last frame a candidate's transmission spans, widened by one symbol.
fn span_frames(view: &SymbolView<'_>, cand: &Candidate) -> (isize, isize) {
    let tosr = view.time_osr as isize;
    let first = view.symbol_frame(cand.frame, 0) - tosr;
    let last = view.symbol_frame(cand.frame, view.layout.symbols.saturating_sub(1)) + tosr;
    (first, last)
}

/// The upper quartile of `values` outside the footprint bins, which `values` holds from bin
/// `lo` on; `scratch` is overwritten.
fn passband_quartile(values: &[f32], lo: isize, foot: (isize, isize), scratch: &mut Vec<f32>) -> Option<f32> {
    scratch.clear();
    for (i, &v) in values.iter().enumerate() {
        let b = lo + i as isize;
        if b < foot.0 || b > foot.1 {
            scratch.push(v);
        }
    }
    if scratch.is_empty() {
        return None;
    }
    let k = ((scratch.len() as f32 * LEVEL_PERCENTILE) as usize).min(scratch.len() - 1);
    let (_, level, _) = scratch.select_nth_unstable_by(k, f32::total_cmp);
    Some(*level)
}

/// The passband level of a candidate's reference region, in dB, when a passband edge lies in
/// the region; else `None`. `floor` holds the noise floor per stored bin; an empty floor, or
/// one of another length, gives `None`.
fn passband_level(
    view: &SymbolView<'_>,
    cand: &Candidate,
    floor: &[f32],
    scratch: &mut Vec<f32>,
) -> Option<f32> {
    let bins = view.spec.bins();
    if floor.len() != bins || bins == 0 {
        return None;
    }
    let (foot_lo, foot_hi, ref_lo, ref_hi) = region(view, cand);
    let (lo, hi) = (ref_lo.max(0), (ref_hi + 1).min(bins as isize));
    if lo >= hi {
        return None;
    }
    let values = &floor[lo as usize..hi as usize];
    let level = passband_quartile(values, lo, (foot_lo, foot_hi), scratch)?;
    values.iter().any(|&f| f < level - EDGE_DB).then_some(level)
}

/// The skirt across a candidate's region, into `scratch.shape`. A strong signal lights its
/// own bins through much of its transmission and lifts the pass's floor there, so the floor
/// of the region comes from the frames outside the transmission: the 20th percentile of each
/// bin over them, smoothed as the pass's floor is. With fewer than [`MIN_OUTSIDE_FRAMES`] of
/// them, the pass's floor serves.
fn skirt(
    view: &SymbolView<'_>,
    cand: &Candidate,
    live: &[bool],
    edge: Edge<'_>,
    scratch: &mut SnrScratch,
) -> Skirt {
    let bins = view.spec.bins() as isize;
    let (foot_lo, foot_hi, ref_lo, ref_hi) = region(view, cand);
    let (lo, hi) = (ref_lo.max(0), (ref_hi + 1).min(bins));
    let (first, last) = span_frames(view, cand);
    let frames = view.spec.frames() as isize;
    let outside = (0..frames)
        .filter(|&f| (f < first || f > last) && is_live(live, f))
        .count();
    scratch.shape.clear();
    if outside < MIN_OUTSIDE_FRAMES {
        scratch
            .shape
            .extend_from_slice(&edge.floor[lo as usize..hi as usize]);
        return Skirt {
            lo,
            level: edge.level,
        };
    }
    let k = ((outside as f32 * crate::passband::TIME_PERCENTILE) as usize).min(outside - 1);
    scratch.cells.clear();
    for b in lo..hi {
        scratch.column.clear();
        for f in (0..frames).filter(|&f| (f < first || f > last) && is_live(live, f)) {
            if let Some(v) = view.spec.get(f, b) {
                scratch.column.push(v);
            }
        }
        let v = if scratch.column.len() > k {
            *scratch.column.select_nth_unstable_by(k, f32::total_cmp).1
        } else {
            edge.floor[b as usize]
        };
        scratch.cells.push(v);
    }
    let width = view.spec.bin_width_hz();
    let m = if width > 0.0 {
        ((crate::passband::SMOOTH_HZ / width).round() as usize).max(1)
    } else {
        1
    };
    // `cells` holds the raw floor here; the median runs into `shape`.
    let raw = std::mem::take(&mut scratch.cells);
    for i in 0..raw.len() {
        let a = i.saturating_sub(m);
        let z = (i + m + 1).min(raw.len());
        scratch.column.clear();
        scratch.column.extend_from_slice(&raw[a..z]);
        let mid = scratch.column.len() / 2;
        scratch
            .shape
            .push(*scratch.column.select_nth_unstable_by(mid, f32::total_cmp).1);
    }
    scratch.cells = raw;
    let level =
        passband_quartile(&scratch.shape, lo, (foot_lo, foot_hi), &mut scratch.cells).unwrap_or(edge.level);
    Skirt { lo, level }
}

/// Whether frame `frame` is marked live in `live`; frames past its end are.
fn is_live(live: &[bool], frame: isize) -> bool {
    usize::try_from(frame)
        .ok()
        .and_then(|f| live.get(f))
        .is_none_or(|&l| l)
}

/// Mean noise power per cell near a candidate over the live frames, or `None` with no
/// usable cells. With a skirt and its floor, each cell is raised by its bin's attenuation, so
/// the estimate is the passband's noise, and bins more than [`EDGE_DB`] down are left out.
fn noise_power(
    view: &SymbolView<'_>,
    cand: &Candidate,
    live: &[bool],
    skirt: Option<(Skirt, &[f32])>,
    scratch: &mut Vec<f32>,
) -> Option<f32> {
    let layout = view.layout;
    let tosr = view.time_osr as isize;
    let (foot_lo, foot_hi, ref_lo, ref_hi) = region(view, cand);
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
            let mut v = row[b as usize];
            if let Some((s, shape)) = skirt {
                let below = s.below(b, shape);
                if below < -EDGE_DB {
                    continue;
                }
                if below < -KNEE_DB {
                    v -= below;
                }
            }
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
        let mut scratch = SnrScratch::default();
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
                live: &[],
            };
            let mut cands = Vec::new();
            CostasSearch {
                max_candidates: 3,
                min_score_db: 0.0,
            }
            .search(&view, view.frame_range(-1.0, 1.0), &mut cands);
            let best = cands.first().expect("candidate");
            let est = scale.estimate(&view, best, &tones, &[], &[], &mut scratch);
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
        let mut scratch = SnrScratch::default();
        let mut live = Vec::new();
        for (seed, snr) in [(1u64, -16.0), (2, -8.0), (3, 0.0), (4, 10.0)] {
            let tones = testsig::random_tones(&layout, seed);
            let audio = testsig::render(&layout, &tones, 1234.5, 0.3, snr, Some(500 + seed));
            let estimate =
                |audio: &[f32], live: &mut Vec<bool>, scratch: &mut SnrScratch, cand: Option<Candidate>| {
                    let spec = testsig::spectrogram(&layout, audio);
                    let view = SymbolView {
                        spec: &spec,
                        layout: &layout,
                        time_osr: 2,
                        freq_osr: 2,
                        live: &[],
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
                    (scale.estimate(&view, &cand, &tones, live, &[], scratch), cand)
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

    /// Estimates for a CPFSK signal at `freq` Hz and `snr_db` in a slot through a receiver
    /// passband ending at `edge_hz` with a `skirt_hz` skirt, on a spectrogram to 3400 Hz: flat
    /// and with the pass's noise floor.
    fn edge_estimates(freq: f64, snr_db: f64, edge_hz: f64, skirt_hz: f64, seed: u64) -> (f32, f32) {
        let layout = test_layouts::ft8();
        let config = SpectrogramConfig::oversampled(1920, 2, 2, 200.0, 3400.0, 12_000).expect("config");
        let mut window = vec![0.0; config.fft_size];
        config.window.fill(&mut window);
        let scale = SnrScale::new(&layout, config.fft_size, &window);
        let tones = testsig::random_tones(&layout, seed);
        let audio = testsig::passband(
            &testsig::render(&layout, &tones, freq, 0.2, snr_db, Some(700 + seed)),
            edge_hz,
            skirt_hz,
        );
        let mut plans = rr73_dsp::FftPlans::new();
        let mut plan = rr73_dsp::SpectrogramPlan::new(config.clone(), &mut plans).expect("plan");
        let mut spec = rr73_dsp::Spectrogram::new();
        plan.compute(&audio, config.frames_for(audio.len()), &mut spec);
        let view = SymbolView {
            spec: &spec,
            layout: &layout,
            time_osr: 2,
            freq_osr: 2,
            live: &[],
        };
        let mut cands = Vec::new();
        CostasSearch {
            max_candidates: 20,
            min_score_db: 0.0,
        }
        .search(&view, view.frame_range(-1.0, 1.0), &mut cands);
        let cand = *cands
            .iter()
            .find(|c| (f64::from(view.freq_hz(c)) - freq).abs() < 3.2 && (view.dt_s(c) - 0.2).abs() < 0.09)
            .expect("the signal is a candidate");
        let mut floor = crate::passband::NoiseFloor::default();
        floor.compute(&spec, &[], 2);
        let mut scratch = SnrScratch::default();
        let flat = scale.estimate(&view, &cand, &tones, &[], &[], &mut scratch);
        let shaped = scale.estimate(&view, &cand, &tones, &[], floor.db(), &mut scratch);
        (flat, shaped)
    }

    #[test]
    fn estimates_hold_at_a_passband_edge() {
        // A passband falling 6 dB at 3000 Hz and 70 dB by 3025 Hz, near the SARTS recordings'.
        // Measured: with the noise taken as flat, signals within 100 Hz of the edge read 18.7 to
        // 64.5 dB high (the strongest at the 60 dB ceiling); with the floor, 1.3 dB low to 1.4 dB
        // high.
        let sharp = [
            (1u64, 2996.0, 10.0),
            (2, 2990.0, 0.0),
            (3, 2985.0, -10.0),
            (4, 2960.0, 5.0),
            (11, 2996.0, -10.0),
            (12, 2996.0, 0.0),
            (13, 2996.0, 20.0),
            (14, 3005.0, 0.0),
            (15, 2975.0, 20.0),
            (16, 2950.0, -15.0),
            (17, 2900.0, 0.0),
            (18, 2930.0, 10.0),
        ];
        for (seed, freq, snr) in sharp {
            let (flat, shaped) = edge_estimates(freq, snr, 3000.0, 50.0, seed);
            assert!(
                (f64::from(shaped) - snr).abs() <= 2.5 && f64::from(flat) - snr > 10.0,
                "{freq} Hz, {snr} dB: flat {flat:.1} dB, with the floor {shaped:.1} dB"
            );
        }
        // A gentle skirt, -6 dB at 2900 Hz and 400 Hz wide: flat 6.8 to 42.8 dB high, with the
        // floor 0.4 to 2.3 dB high (measured).
        for (seed, freq, snr) in [(5u64, 2880.0, 0.0), (6, 2950.0, 5.0), (7, 3000.0, 10.0)] {
            let (flat, shaped) = edge_estimates(freq, snr, 2900.0, 400.0, seed);
            assert!(
                (f64::from(shaped) - snr).abs() <= 2.5 && f64::from(flat) - snr > 5.0,
                "{freq} Hz, {snr} dB, soft edge: flat {flat:.1} dB, with the floor {shaped:.1} dB"
            );
        }
        // Inside the passband, more than a region's width from the edge, the floor changes
        // nothing.
        for (seed, freq, snr) in [(8u64, 1500.0, -10.0), (9, 2500.0, 10.0), (10, 2700.0, 0.0)] {
            let (flat, shaped) = edge_estimates(freq, snr, 3000.0, 50.0, seed);
            assert_eq!(
                flat.to_bits(),
                shaped.to_bits(),
                "{freq} Hz: {flat} against {shaped}"
            );
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
            live: &[],
        };
        let scale = SnrScale::new(&layout, 3840, &WindowKind::Hann.build(3840));
        let snr = scale.estimate(
            &view,
            &Candidate::new(0, 0, 0.0),
            &[0; 79],
            &[],
            &[],
            &mut SnrScratch::default(),
        );
        assert_eq!(snr, FLOOR_DB);
    }
}
