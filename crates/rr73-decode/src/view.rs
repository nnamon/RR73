//! Candidates and the symbol grid view of a spectrogram.
//!
//! The spectrogram has `time_osr` frames per symbol and `freq_osr` bins per tone spacing.
//! A candidate fixes the frame of channel symbol 0 and the bin of tone 0; symbol `k`, tone
//! `j` then sits at frame `frame + k * time_osr`, bin `bin + j * freq_osr`.

use rr73_dsp::Spectrogram;

use crate::layout::FrameLayout;

/// A possible transmission found by the candidate search.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Candidate {
    /// Spectrogram frame whose centre falls on the middle of channel symbol 0. May be
    /// negative when the transmission started before the audio.
    pub frame: i32,
    /// Stored spectrogram bin of tone 0.
    pub bin: i32,
    /// Sync score, in dB.
    pub score: f32,
    /// Sub-frame correction from refinement, in frames. Reported DT uses `frame + frame_frac`.
    pub frame_frac: f32,
    /// Sub-bin correction from refinement, in bins. Reported frequency uses `bin + bin_frac`.
    pub bin_frac: f32,
}

impl Candidate {
    /// A candidate on the search grid, with no refinement.
    pub fn new(frame: i32, bin: i32, score: f32) -> Self {
        Self {
            frame,
            bin,
            score,
            frame_frac: 0.0,
            bin_frac: 0.0,
        }
    }
}

/// A spectrogram read as symbols and tones of one mode.
#[derive(Clone, Copy, Debug)]
pub struct SymbolView<'a> {
    /// The spectrogram, in dB.
    pub spec: &'a Spectrogram,
    /// The mode's layout.
    pub layout: &'a FrameLayout,
    /// Frames per symbol.
    pub time_osr: usize,
    /// Bins per tone spacing.
    pub freq_osr: usize,
    /// Frames that hold audio throughout, from [`crate::silence::live_frames`]. The search
    /// and the demodulator skip frames marked `false`; frames past the end of the slice
    /// count as live, so an empty slice reads every frame.
    pub live: &'a [bool],
}

impl<'a> SymbolView<'a> {
    /// Frame index of channel symbol `symbol` for a candidate starting at `frame`.
    #[inline]
    pub fn symbol_frame(&self, frame: i32, symbol: usize) -> isize {
        frame as isize + (symbol * self.time_osr) as isize
    }

    /// Bin index of tone `tone` for a candidate whose tone 0 is at `bin`.
    #[inline]
    pub fn tone_bin(&self, bin: i32, tone: usize) -> isize {
        bin as isize + (tone * self.freq_osr) as isize
    }

    /// `false` when `live` marks frame `frame` as overlapping digital silence.
    #[inline]
    pub fn is_live(&self, frame: isize) -> bool {
        usize::try_from(frame)
            .ok()
            .and_then(|f| self.live.get(f))
            .is_none_or(|&l| l)
    }

    /// The values of frame `frame`, or `None` outside the spectrogram.
    #[inline]
    pub fn row(&self, frame: isize) -> Option<&'a [f32]> {
        if frame < 0 {
            None
        } else {
            self.spec.frame(frame as usize)
        }
    }

    /// Base-tone frequency of a candidate, in Hz.
    pub fn freq_hz(&self, c: &Candidate) -> f32 {
        self.spec.bin_hz(c.bin as f32 + c.bin_frac)
    }

    /// DT of a candidate: start of symbol 0 minus the nominal start, in seconds.
    pub fn dt_s(&self, c: &Candidate) -> f32 {
        self.spec.frame_time_s(c.frame as f32 + c.frame_frac)
            - 0.5 * self.layout.symbol_s()
            - self.layout.start_offset_s
    }

    /// The (fractional) frame of symbol 0 for a transmission with DT `dt_s`.
    pub fn frame_for_dt(&self, dt_s: f32) -> f32 {
        frame_for_dt(self.layout, self.spec.hop(), dt_s)
    }

    /// Candidate frames whose DT lies in `[dt_min_s, dt_max_s]`.
    pub fn frame_range(&self, dt_min_s: f32, dt_max_s: f32) -> std::ops::RangeInclusive<i32> {
        frame_range(self.layout, self.spec.hop(), dt_min_s, dt_max_s)
    }

    /// Range of candidate bins that keep every tone inside the spectrogram.
    pub fn bin_range(&self) -> std::ops::Range<i32> {
        let span = (self.layout.tones - 1) * self.freq_osr;
        0..(self.spec.bins().saturating_sub(span)) as i32
    }
}

/// The (fractional) frame of symbol 0 for a transmission with DT `dt_s`, for frames every
/// `hop` samples at 12 kHz with frame `t` centred on sample `t * hop`.
pub fn frame_for_dt(layout: &FrameLayout, hop: usize, dt_s: f32) -> f32 {
    let start = (dt_s + layout.start_offset_s) * 12_000.0;
    (start + 0.5 * layout.samples_per_symbol as f32) / hop.max(1) as f32
}

/// Candidate frames whose DT lies in `[dt_min_s, dt_max_s]`. Empty when the bounds are not
/// finite or out of order.
pub fn frame_range(
    layout: &FrameLayout,
    hop: usize,
    dt_min_s: f32,
    dt_max_s: f32,
) -> std::ops::RangeInclusive<i32> {
    let lo = frame_for_dt(layout, hop, dt_min_s).ceil();
    let hi = frame_for_dt(layout, hop, dt_max_s).floor();
    if !(lo.is_finite() && hi.is_finite()) {
        return std::ops::RangeInclusive::new(1, 0);
    }
    let clamp = |x: f32| x.clamp(-1_000_000.0, 1_000_000.0) as i32;
    clamp(lo)..=clamp(hi)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::test_layouts;

    #[test]
    fn baseline_ft8_range_matches_ft8_lib_time_steps() {
        // ft8_lib scans 30 symbol offsets times 2 sub-steps: 60 frames.
        let r = frame_range(&test_layouts::ft8(), 960, -2.3, 2.5);
        assert_eq!(r, -21..=38);
        assert!(frame_range(&test_layouts::ft8(), 960, f32::NAN, 2.5).is_empty());
    }

    #[test]
    fn frame_and_dt_are_inverse() {
        let layout = test_layouts::ft8();
        for dt in [-1.5f32, 0.0, 0.73] {
            let f = frame_for_dt(&layout, 960, dt);
            let back = f * 960.0 / 12_000.0 - 0.08 - 0.5;
            assert!((back - dt).abs() < 1e-5, "{dt} {back}");
        }
    }
}
