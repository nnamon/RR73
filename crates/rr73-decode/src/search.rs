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
                if k > 0 {
                    add(view.row(f - tosr).and_then(|r| r.get(p)));
                }
                if k + 1 < group.tones.len() {
                    add(view.row(f + tosr).and_then(|r| r.get(p)));
                }
            }
        }
        if n == 0 { None } else { Some(sum / n as f32) }
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
        out.clear();
        if self.max_candidates == 0 {
            return;
        }
        // `out` is a min-heap on quality while scanning: out[0] is the worst kept.
        for frame in frames {
            for bin in view.bin_range() {
                let Some(score) = Self::score(view, frame, bin) else {
                    continue;
                };
                if score.is_nan() || score < self.min_score_db {
                    continue;
                }
                let cand = Candidate::new(frame, bin, score);
                if out.len() < self.max_candidates {
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
}
