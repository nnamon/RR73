//! Candidate search: Costas sync scoring over the spectrogram.
//!
//! The Costas score is ported from ft8_lib (`ft8/decode.c`, `ft8_sync_score`,
//! `ft4_sync_score` and `ftx_find_candidates`), Copyright (c) 2018 Kārlis Goba, MIT
//! licence. Changes: dB values stay in floating point (ft8_lib quantises to 0.5 dB steps and
//! averages with integer division), the time range is given as DT in seconds, and ties
//! between equal scores are broken by position so results do not depend on heap order.

use crate::view::{Candidate, SymbolView};

/// Finds candidate transmissions in a spectrogram.
pub trait CandidateSearch {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Fills `out` (cleared first) with candidates whose symbol-0 frame lies in
    /// `frames`, best first.
    fn search(&self, view: &SymbolView<'_>, frames: std::ops::RangeInclusive<i32>, out: &mut Vec<Candidate>);
}

/// ft8_lib's Costas sync search.
///
/// For every sync symbol inside the spectrogram, the expected tone's level is compared with
/// the tones one spacing below and above and with the same tone one symbol earlier and
/// later (within the sync group). The score is the mean of these differences in dB. The
/// `max_candidates` best positions scoring at least `min_score_db` are kept.
#[derive(Clone, Debug, PartialEq)]
pub struct CostasSearch {
    /// Most candidates kept.
    pub max_candidates: usize,
    /// Lowest score kept, in dB.
    pub min_score_db: f32,
}

impl CostasSearch {
    /// Sync score of a candidate at `frame`, `bin`, in dB. `None` when no sync symbol lies
    /// inside the spectrogram.
    pub fn score(view: &SymbolView<'_>, frame: i32, bin: i32) -> Option<f32> {
        let layout = view.layout;
        let last_tone = layout.tones.saturating_sub(1);
        let step = view.freq_osr;
        let frames = view.spec.frames() as isize;
        let tosr = view.time_osr as isize;
        let mut sum = 0.0f32;
        let mut n = 0u32;
        for group in &layout.sync {
            for (k, &tone) in group.tones.iter().enumerate() {
                let f = view.symbol_frame(frame, group.start + k);
                if f < 0 {
                    continue;
                }
                if f >= frames {
                    break;
                }
                let Some(row) = view.row(f) else { break };
                if !view.is_live(f) {
                    continue;
                }
                let sm = tone as usize;
                let Ok(p) = usize::try_from(view.tone_bin(bin, sm)) else {
                    continue;
                };
                let Some(&level) = row.get(p) else { continue };
                let mut add = |other: Option<&f32>| {
                    if let Some(&o) = other {
                        sum += level - o;
                        n += 1;
                    }
                };
                if sm > 0 {
                    add(p.checked_sub(step).and_then(|q| row.get(q)));
                }
                if sm < last_tone {
                    add(row.get(p + step));
                }
                if k > 0 && view.is_live(f - tosr) {
                    add(view.row(f - tosr).and_then(|r| r.get(p)));
                }
                if k + 1 < group.tones.len() && view.is_live(f + tosr) {
                    add(view.row(f + tosr).and_then(|r| r.get(p)));
                }
            }
        }
        if n == 0 { None } else { Some(sum / n as f32) }
    }

    /// The scores of every bin of [`SymbolView::bin_range`] at `frame`, into `out`, equal bit
    /// for bit to [`CostasSearch::score`] of each bin. Returns `false` where `score` gives
    /// `None` for every bin: no sync symbol lies inside the spectrogram.
    ///
    /// The bin range keeps every tone and its neighbours inside the spectrogram, so at one
    /// frame all its bins make the same comparisons in the same order. The sums then run as
    /// slice operations across the bins, which vectorise, and each bin's sum takes its terms
    /// in the order `score` adds them.
    pub fn frame_scores(view: &SymbolView<'_>, frame: i32, out: &mut Vec<f32>) -> bool {
        let width = view.bin_range().len();
        out.clear();
        out.resize(width, 0.0);
        let layout = view.layout;
        let last_tone = layout.tones.saturating_sub(1);
        let step = view.freq_osr;
        let frames = view.spec.frames() as isize;
        let tosr = view.time_osr as isize;
        let mut n = 0u32;
        for group in &layout.sync {
            for (k, &tone) in group.tones.iter().enumerate() {
                let f = view.symbol_frame(frame, group.start + k);
                if f < 0 {
                    continue;
                }
                if f >= frames {
                    break;
                }
                let Some(row) = view.row(f) else { break };
                if !view.is_live(f) {
                    continue;
                }
                let sm = tone as usize;
                let p = sm * step;
                let level = &row[p..p + width];
                let mut add = |other: &[f32]| {
                    for ((s, &l), &o) in out.iter_mut().zip(level).zip(other) {
                        *s += l - o;
                    }
                    n += 1;
                };
                if sm > 0 {
                    add(&row[p - step..p - step + width]);
                }
                if sm < last_tone {
                    add(&row[p + step..p + step + width]);
                }
                if k > 0
                    && view.is_live(f - tosr)
                    && let Some(r) = view.row(f - tosr)
                {
                    add(&r[p..p + width]);
                }
                if k + 1 < group.tones.len()
                    && view.is_live(f + tosr)
                    && let Some(r) = view.row(f + tosr)
                {
                    add(&r[p..p + width]);
                }
            }
        }
        if n == 0 || width == 0 {
            return false;
        }
        let n = n as f32;
        for s in out.iter_mut() {
            *s /= n;
        }
        true
    }
}

/// Sort order of candidate lists: best first (see [`better`]).
pub(crate) fn best_first(a: &Candidate, b: &Candidate) -> std::cmp::Ordering {
    if better(a, b) {
        std::cmp::Ordering::Less
    } else if better(b, a) {
        std::cmp::Ordering::Greater
    } else {
        std::cmp::Ordering::Equal
    }
}

/// Orders candidates best first: higher score, then earlier frame, then lower bin.
fn better(a: &Candidate, b: &Candidate) -> bool {
    match a.score.total_cmp(&b.score) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => (a.frame, a.bin) < (b.frame, b.bin),
    }
}

impl CandidateSearch for CostasSearch {
    fn name(&self) -> &'static str {
        "costas"
    }

    fn search(&self, view: &SymbolView<'_>, frames: std::ops::RangeInclusive<i32>, out: &mut Vec<Candidate>) {
        scan(view, frames, self.max_candidates, |_| self.min_score_db, out);
    }
}

/// [`CostasSearch`] with a threshold of its own for positions whose sync symbols do not all
/// lie inside the slot: a transmission that starts before the slot or runs past its end.
/// Their score averages fewer sync symbols and varies more in noise, so at one threshold
/// more noise positions pass there.
#[derive(Clone, Debug, PartialEq)]
pub struct CostasPartialSearch {
    /// Most candidates kept.
    pub max_candidates: usize,
    /// Lowest score kept where every sync symbol lies inside the slot, in dB.
    pub min_score_db: f32,
    /// Lowest score kept at the other positions, in dB.
    pub partial_min_score_db: f32,
}

impl CostasPartialSearch {
    /// Whether every sync symbol of a candidate at `frame` lies inside the slot, from the first
    /// frame to the last frame of a whole slot. In a partial slot (audio still arriving) a
    /// symbol past the audio but inside the slot counts as inside, so the early pass keeps the
    /// main threshold for transmissions that are on time.
    pub fn whole(view: &SymbolView<'_>, frame: i32) -> bool {
        let layout = view.layout;
        let (Some(first), Some(last)) = (layout.sync.first(), layout.sync.last()) else {
            return true;
        };
        let end = last.start + last.tones.len().saturating_sub(1);
        let slot_frames = layout.slot_samples().div_ceil(view.spec.hop().max(1));
        view.symbol_frame(frame, first.start) >= 0 && view.symbol_frame(frame, end) < slot_frames as isize
    }
}

impl CandidateSearch for CostasPartialSearch {
    fn name(&self) -> &'static str {
        "costas-partial"
    }

    fn search(&self, view: &SymbolView<'_>, frames: std::ops::RangeInclusive<i32>, out: &mut Vec<Candidate>) {
        let threshold = |frame: i32| {
            if Self::whole(view, frame) {
                self.min_score_db
            } else {
                self.partial_min_score_db
            }
        };
        scan(view, frames, self.max_candidates, threshold, out);
    }
}

/// Fills `out` with the `max_candidates` best Costas positions in `frames` that score at least
/// `min_score(frame)` dB, best first. Scores a whole frame at once
/// ([`CostasSearch::frame_scores`]).
fn scan(
    view: &SymbolView<'_>,
    frames: std::ops::RangeInclusive<i32>,
    max_candidates: usize,
    min_score: impl Fn(i32) -> f32,
    out: &mut Vec<Candidate>,
) {
    out.clear();
    if max_candidates == 0 {
        return;
    }
    // `out` is a min-heap on quality while scanning: out[0] is the worst kept.
    let mut scores = Vec::new();
    for frame in frames {
        if !CostasSearch::frame_scores(view, frame, &mut scores) {
            continue;
        }
        let min_score_db = min_score(frame);
        for (bin, &score) in view.bin_range().zip(&scores) {
            if score.is_nan() || score < min_score_db {
                continue;
            }
            let cand = Candidate::new(frame, bin, score);
            if out.len() < max_candidates {
                out.push(cand);
                let last = out.len() - 1;
                sift_up(out, last);
            } else if better(&cand, &out[0]) {
                out[0] = cand;
                sift_down(out, 0);
            }
        }
    }
    out.sort_by(|a, b| {
        if better(a, b) {
            std::cmp::Ordering::Less
        } else if better(b, a) {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    });
}

fn sift_up(heap: &mut [Candidate], mut i: usize) {
    while i > 0 {
        let parent = (i - 1) / 2;
        if better(&heap[parent], &heap[i]) {
            heap.swap(parent, i);
            i = parent;
        } else {
            break;
        }
    }
}

fn sift_down(heap: &mut [Candidate], mut i: usize) {
    let n = heap.len();
    loop {
        let (l, r) = (2 * i + 1, 2 * i + 2);
        let mut worst = i;
        if l < n && better(&heap[worst], &heap[l]) {
            worst = l;
        }
        if r < n && better(&heap[worst], &heap[r]) {
            worst = r;
        }
        if worst == i {
            break;
        }
        heap.swap(i, worst);
        i = worst;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::test_layouts;
    use crate::testsig;
    use rr73_dsp::Spectrogram;

    fn view<'a>(spec: &'a Spectrogram, layout: &'a crate::layout::FrameLayout) -> SymbolView<'a> {
        SymbolView {
            spec,
            layout,
            time_osr: 2,
            freq_osr: 2,
            live: &[],
        }
    }

    #[test]
    fn finds_a_clean_ft8_signal_at_its_frequency_and_dt() {
        let layout = test_layouts::ft8();
        for &(freq, dt) in &[(1234.4, 0.13), (600.0, -0.71), (2410.0, 1.37)] {
            let tones = testsig::random_tones(&layout, 7);
            let audio = testsig::render(&layout, &tones, freq, dt, -10.0, Some(3));
            let spec = testsig::spectrogram(&layout, &audio);
            let v = view(&spec, &layout);
            let mut out = Vec::new();
            let search = CostasSearch {
                max_candidates: 20,
                min_score_db: 2.0,
            };
            search.search(&v, v.frame_range(-2.3, 2.5), &mut out);
            let best = out.first().expect("a candidate");
            assert!(
                (f64::from(v.freq_hz(best)) - freq).abs() <= 1.6,
                "freq {} vs {freq}",
                v.freq_hz(best)
            );
            assert!(
                (f64::from(v.dt_s(best)) - dt).abs() <= 0.041,
                "dt {} vs {dt}",
                v.dt_s(best)
            );
            assert!(best.score > 5.0, "score {}", best.score);
            assert!(out.windows(2).all(|w| !better(&w[1], &w[0])), "sorted best first");
        }
    }

    #[test]
    fn finds_a_clean_ft4_signal() {
        let layout = test_layouts::ft4();
        let tones = testsig::random_tones(&layout, 11);
        let audio = testsig::render(&layout, &tones, 1500.0, 0.2, -5.0, Some(5));
        let spec = testsig::spectrogram(&layout, &audio);
        let v = view(&spec, &layout);
        let mut out = Vec::new();
        CostasSearch {
            max_candidates: 10,
            min_score_db: 2.0,
        }
        .search(&v, v.frame_range(-1.0, 1.0), &mut out);
        let best = out.first().expect("a candidate");
        assert!(
            (v.freq_hz(best) - 1500.0).abs() <= 5.3,
            "freq {}",
            v.freq_hz(best)
        );
        assert!((v.dt_s(best) - 0.2).abs() <= 0.013, "dt {}", v.dt_s(best));
    }

    #[test]
    fn silent_frames_leave_the_sync_score_alone() {
        // The first 2 s silent, as when capture starts partway into a slot: the signal's
        // first Costas array lies in silence. Its comparisons there read 0 dB (silence
        // against silence) and pulled the mean down by about a third, so weak signals fell
        // below the threshold. Left out, the score is that of the two arrays in the audio.
        let layout = test_layouts::ft8();
        let config =
            rr73_dsp::SpectrogramConfig::oversampled(1920, 2, 2, 200.0, 3000.0, 12_000).expect("config");
        let search = CostasSearch {
            max_candidates: 20,
            min_score_db: 5.0,
        };
        let near = |v: &SymbolView<'_>, c: &Candidate| {
            (v.freq_hz(c) - 1500.0).abs() <= 1.6 && (v.dt_s(c) - 0.2).abs() <= 0.05
        };
        for seed in 1..=4u64 {
            let tones = testsig::random_tones(&layout, seed);
            let clean = testsig::render(&layout, &tones, 1500.0, 0.2, -20.0, Some(seed + 10));
            let mut audio = clean.clone();
            audio[..24_000].fill(0.0);
            let (full_spec, spec) = (
                testsig::spectrogram(&layout, &clean),
                testsig::spectrogram(&layout, &audio),
            );
            let mut live = Vec::new();
            crate::silence::live_frames(&audio, &config, spec.frames(), &mut live);
            let full = view(&full_spec, &layout);
            let plain = view(&spec, &layout);
            let masked = SymbolView { live: &live, ..plain };
            let mut out = Vec::new();
            search.search(&masked, masked.frame_range(-2.3, 2.5), &mut out);
            let best = *out
                .iter()
                .find(|c| near(&masked, c))
                .expect("signal found with the mask");
            let s_full = CostasSearch::score(&full, best.frame, best.bin).expect("score");
            let s_plain = CostasSearch::score(&plain, best.frame, best.bin).expect("score");
            let s_masked = CostasSearch::score(&masked, best.frame, best.bin).expect("score");
            // Measured: full slot 7.9 to 8.4 dB, silence counted 4.8 to 6.1 dB, left out 7.2 to
            // 9.1 dB.
            assert!(
                (s_masked - s_full).abs() <= 1.5 && s_plain < s_full - 1.5,
                "seed {seed}: full slot {s_full:.2} dB, silence counted {s_plain:.2} dB, left out {s_masked:.2} dB"
            );
        }
    }

    #[test]
    fn keeps_only_the_best_and_respects_the_threshold() {
        let layout = test_layouts::ft8();
        let audio = testsig::noise(180_000, 1);
        let spec = testsig::spectrogram(&layout, &audio);
        let v = view(&spec, &layout);
        let mut all = Vec::new();
        CostasSearch {
            max_candidates: 100_000,
            min_score_db: f32::NEG_INFINITY,
        }
        .search(&v, v.frame_range(-2.3, 2.5), &mut all);
        let mut top = Vec::new();
        CostasSearch {
            max_candidates: 25,
            min_score_db: f32::NEG_INFINITY,
        }
        .search(&v, v.frame_range(-2.3, 2.5), &mut top);
        assert_eq!(top, all[..25].to_vec());
        let mut strict = Vec::new();
        CostasSearch {
            max_candidates: 100_000,
            min_score_db: 3.0,
        }
        .search(&v, v.frame_range(-2.3, 2.5), &mut strict);
        assert!(strict.iter().all(|c| c.score >= 3.0));
        assert_eq!(strict.len(), all.iter().filter(|c| c.score >= 3.0).count());
    }

    #[test]
    fn partial_search_holds_positions_past_the_slot_to_their_own_threshold() {
        let layout = test_layouts::ft8();
        let tones = testsig::random_tones(&layout, 31);
        // DT 3.5 s: the third Costas array lies past the end of the slot.
        let audio = testsig::render(&layout, &tones, 1500.0, 3.5, -8.0, Some(32));
        let spec = testsig::spectrogram(&layout, &audio);
        let v = view(&spec, &layout);
        let range = v.frame_range(-2.3, 4.5);
        let late = |c: &Candidate| !CostasPartialSearch::whole(&v, c.frame);
        let mut plain = Vec::new();
        CostasSearch {
            max_candidates: 100_000,
            min_score_db: 2.0,
        }
        .search(&v, range.clone(), &mut plain);
        let found = *plain
            .iter()
            .find(|c| (v.freq_hz(c) - 1500.0).abs() < 3.0 && (v.dt_s(c) - 3.5).abs() < 0.1)
            .expect("the late signal is a candidate");
        assert!(late(&found));
        assert!(plain.iter().any(|c| !late(c)));
        // One threshold everywhere gives the plain search.
        let mut same = Vec::new();
        CostasPartialSearch {
            max_candidates: 100_000,
            min_score_db: 2.0,
            partial_min_score_db: 2.0,
        }
        .search(&v, range.clone(), &mut same);
        assert_eq!(same, plain);
        // A threshold above the signal's score drops it and nothing whole.
        let partial_min = found.score + 0.1;
        let mut strict = Vec::new();
        CostasPartialSearch {
            max_candidates: 100_000,
            min_score_db: 2.0,
            partial_min_score_db: partial_min,
        }
        .search(&v, range, &mut strict);
        assert!(!strict.contains(&found));
        assert!(strict.iter().all(|c| !late(c) || c.score >= partial_min));
        let whole = |l: &[Candidate]| l.iter().filter(|c| !late(c)).copied().collect::<Vec<_>>();
        assert_eq!(whole(&strict), whole(&plain));
    }

    #[test]
    fn empty_and_tiny_spectrograms_give_no_candidates() {
        let layout = test_layouts::ft8();
        for len in [0usize, 1, 500, 5000] {
            let spec = testsig::spectrogram(&layout, &vec![0.0; len]);
            let v = view(&spec, &layout);
            let mut out = vec![Candidate::new(0, 0, 0.0)];
            CostasSearch {
                max_candidates: 10,
                min_score_db: 0.5,
            }
            .search(&v, -40..=40, &mut out);
            assert!(out.is_empty(), "len {len}");
        }
    }

    #[test]
    fn frame_scores_equal_the_per_bin_score_bit_for_bit() {
        use rr73_dsp::{FftPlans, SpectrogramConfig, SpectrogramPlan};
        let mut checked = 0usize;
        for (layout, seed) in [(test_layouts::ft8(), 3u64), (test_layouts::ft4(), 4)] {
            let tones = testsig::random_tones(&layout, seed);
            let slot = layout.slot_samples();
            let mut audio = testsig::render(&layout, &tones, 1234.5, 0.3, -12.0, Some(seed));
            for (i, x) in testsig::noise(slot, seed + 1).iter().enumerate() {
                audio[i] += x;
            }
            // Whole and cut slots, and a slot with a silent start and a hole.
            let mut silent = audio.clone();
            silent[..slot / 7].fill(0.0);
            silent[slot / 2..slot / 2 + 3000].fill(0.0);
            let cut = audio[..slot * 2 / 3].to_vec();
            for samples in [&audio, &silent, &cut] {
                for (tosr, fosr) in [(2usize, 2usize), (4, 4), (8, 4), (1, 1)] {
                    let config = SpectrogramConfig::oversampled(
                        layout.samples_per_symbol,
                        tosr,
                        fosr,
                        200.0,
                        3000.0,
                        12_000,
                    )
                    .expect("config");
                    let frames = config.frames_for(samples.len());
                    let mut plans = FftPlans::new();
                    let mut plan = SpectrogramPlan::new(config.clone(), &mut plans).expect("plan");
                    let mut spec = Spectrogram::new();
                    plan.compute(samples, frames, &mut spec);
                    let mut live = Vec::new();
                    crate::silence::live_frames(samples, &config, frames, &mut live);
                    for mask in [&live[..], &[]] {
                        let view = SymbolView {
                            spec: &spec,
                            layout: &layout,
                            time_osr: tosr,
                            freq_osr: fosr,
                            live: mask,
                        };
                        let mut scores = Vec::new();
                        let reach = (layout.symbols * tosr) as i32;
                        // Every fifth frame: 5 is prime to every time_osr, so all phases occur.
                        for frame in (-reach - 2..frames as i32 + 2).step_by(5) {
                            let some = CostasSearch::frame_scores(&view, frame, &mut scores);
                            for (bin, &s) in view.bin_range().zip(&scores) {
                                let want = CostasSearch::score(&view, frame, bin);
                                assert_eq!(
                                    want.map(f32::to_bits),
                                    some.then_some(s.to_bits()),
                                    "{:?} osr {tosr}/{fosr} frame {frame} bin {bin}",
                                    layout.mode
                                );
                                checked += 1;
                            }
                        }
                    }
                }
            }
        }
        assert!(checked > 300_000, "{checked}");
    }
}
