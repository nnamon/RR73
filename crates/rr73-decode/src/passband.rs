//! The noise floor across the band, for SNR estimates near a receiver's passband edges.
//!
//! A receiver passes audio only within its filter. On the recorded slots the floor falls by
//! 6 dB at the filter's edge and by 20 to 60 dB within 25 to 50 Hz past it (experiment
//! 0011). The SNR estimate (`crate::snr`) takes the noise from cells up to 18 tone spacings
//! either side of a signal and treats it as flat there. Across an edge the stopband's cells
//! pull its low percentile down, and a signal near the edge read up to 30 dB high.
//!
//! [`NoiseFloor::compute`] measures the floor's shape once per pass: for each stored bin,
//! the 20th percentile over time of its cells in live frames (every `time_osr`-th frame, as
//! the SNR estimate reads them), then a running median over 25 Hz either side. The median
//! keeps a monotonic edge where it is and removes the scatter of single bins. Values are in
//! the spectrogram's dB, and only differences between bins are used.

use rr73_dsp::Spectrogram;

/// Percentile over time of each bin's cells.
pub(crate) const TIME_PERCENTILE: f32 = 0.2;

/// Half-width of the running median across bins, in Hz.
pub const SMOOTH_HZ: f32 = 25.0;

/// The noise floor of one spectrogram, per stored bin, in dB.
#[derive(Clone, Debug, Default)]
pub struct NoiseFloor {
    db: Vec<f32>,
    frames: Vec<usize>,
    columns: Vec<f32>,
    raw: Vec<f32>,
    window: Vec<f32>,
}

impl NoiseFloor {
    /// The floor per stored bin of the last [`NoiseFloor::compute`], in dB; empty after
    /// [`NoiseFloor::clear`] or when no frame was live.
    pub fn db(&self) -> &[f32] {
        &self.db
    }

    /// Forgets the floor, so estimates fall back to a flat floor.
    pub fn clear(&mut self) {
        self.db.clear();
    }

    /// Measures the floor of `spec`: every `time_osr`-th frame that `live` marks live (frames
    /// past its end count as live), the 20th percentile of each bin over them, then a running
    /// median over [`SMOOTH_HZ`] either side.
    pub fn compute(&mut self, spec: &Spectrogram, live: &[bool], time_osr: usize) {
        self.db.clear();
        let bins = spec.bins();
        let step = time_osr.max(1);
        self.frames.clear();
        self.frames.extend(
            (0..spec.frames())
                .step_by(step)
                .filter(|&t| live.get(t).is_none_or(|&l| l)),
        );
        let n = self.frames.len();
        if n == 0 || bins == 0 {
            return;
        }
        // Bin-major copy, so each bin's cells are one slice to select in.
        self.columns.clear();
        self.columns.resize(bins * n, 0.0);
        for (j, &t) in self.frames.iter().enumerate() {
            if let Some(row) = spec.frame(t) {
                for (b, &v) in row.iter().enumerate() {
                    self.columns[b * n + j] = v;
                }
            }
        }
        let k = ((n as f32 * TIME_PERCENTILE) as usize).min(n - 1);
        self.raw.clear();
        for column in self.columns.chunks_exact_mut(n) {
            let (_, q, _) = column.select_nth_unstable_by(k, f32::total_cmp);
            self.raw.push(*q);
        }
        let width = spec.bin_width_hz();
        let m = if width > 0.0 {
            ((SMOOTH_HZ / width).round() as usize).max(1)
        } else {
            1
        };
        self.db.reserve(bins);
        for b in 0..bins {
            let lo = b.saturating_sub(m);
            let hi = (b + m + 1).min(bins);
            self.window.clear();
            self.window.extend_from_slice(&self.raw[lo..hi]);
            let mid = self.window.len() / 2;
            let (_, v, _) = self.window.select_nth_unstable_by(mid, f32::total_cmp);
            self.db.push(*v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::test_layouts;
    use crate::testsig;

    /// White noise through a receiver passband that ends at `edge_hz`: unity gain below,
    /// a raised-cosine fall over `skirt_hz` and 70 dB down beyond.
    pub(crate) fn filtered_noise(samples: usize, seed: u64, edge_hz: f64, skirt_hz: f64) -> Vec<f32> {
        testsig::passband(&testsig::noise(samples, seed), edge_hz, skirt_hz)
    }

    #[test]
    fn floor_follows_a_passband_edge_and_is_flat_inside() {
        let audio = filtered_noise(180_000, 3, 3000.0, 50.0);
        let config =
            rr73_dsp::SpectrogramConfig::oversampled(1920, 2, 2, 200.0, 3400.0, 12_000).expect("config");
        let mut plans = rr73_dsp::FftPlans::new();
        let mut plan = rr73_dsp::SpectrogramPlan::new(config.clone(), &mut plans).expect("plan");
        let mut spec = Spectrogram::new();
        plan.compute(&audio, config.frames_for(audio.len()), &mut spec);
        let mut floor = NoiseFloor::default();
        floor.compute(&spec, &[], 2);
        let db = floor.db();
        assert_eq!(db.len(), spec.bins());
        let at = |hz: f32| db[((hz / spec.bin_width_hz()) as usize).saturating_sub(spec.min_bin())];
        let inside: Vec<f32> = (300..2900).step_by(25).map(|f| at(f as f32)).collect();
        let level = inside.iter().sum::<f32>() / inside.len() as f32;
        assert!(
            inside.iter().all(|&v| (v - level).abs() < 1.0),
            "inside the passband: {inside:?}"
        );
        assert!(
            (at(3000.0) - level + 6.0).abs() < 2.0,
            "edge {}",
            at(3000.0) - level
        );
        assert!(at(3050.0) - level < -30.0, "past the edge {}", at(3050.0) - level);
        assert!(at(3300.0) - level < -50.0, "stopband {}", at(3300.0) - level);
    }

    #[test]
    fn empty_and_silent_spectrograms_give_no_floor() {
        let mut floor = NoiseFloor::default();
        floor.compute(&Spectrogram::new(), &[], 2);
        assert!(floor.db().is_empty());
        let layout = test_layouts::ft8();
        let spec = testsig::spectrogram(&layout, &testsig::noise(30_000, 1));
        let dead = vec![false; spec.frames()];
        floor.compute(&spec, &dead, 2);
        assert!(floor.db().is_empty());
        floor.compute(&spec, &[], 2);
        assert_eq!(floor.db().len(), spec.bins());
        floor.clear();
        assert!(floor.db().is_empty());
    }
}
