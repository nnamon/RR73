//! The refinement and subtraction stage traits and their pass-through implementations. The
//! model-based subtractor is in [`crate::subtract`].

use crate::layout::FrameLayout;
use crate::refine::{BasebandRefine, RefineScratch, Refined};
use crate::report::Decode;
use crate::subtract::SubtractScratch;
use crate::view::{Candidate, SymbolView};

/// Improves a candidate's time and frequency before demodulation.
pub trait SyncRefine {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Called once per pass, before its candidates, with the audio the pass searched
    /// (12 kHz, slot start at sample 0). `partial` marks a slot still being received.
    fn prepare(&self, _layout: &FrameLayout, _audio: &[f32], _partial: bool, _scratch: &mut RefineScratch) {}

    /// Adjusts `cand` in place: may move it on the grid and set the fractional parts. With
    /// [`Refined::Levels`] it read the candidate's symbol levels at the refined position into
    /// `scratch`, and the demodulator reads those in place of the spectrogram; with
    /// [`Refined::Repeat`] the position repeats one tried in the pass and the candidate is
    /// skipped.
    fn refine(&self, view: &SymbolView<'_>, cand: &mut Candidate, scratch: &mut RefineScratch) -> Refined;
}

/// Keeps the search grid position.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NoRefine;

impl SyncRefine for NoRefine {
    fn name(&self) -> &'static str {
        "none"
    }

    fn refine(&self, _view: &SymbolView<'_>, _cand: &mut Candidate, _scratch: &mut RefineScratch) -> Refined {
        Refined::Grid
    }
}

impl SyncRefine for BasebandRefine {
    fn name(&self) -> &'static str {
        "baseband"
    }

    fn prepare(&self, layout: &FrameLayout, audio: &[f32], partial: bool, scratch: &mut RefineScratch) {
        scratch.prepare(layout, audio, partial);
    }

    fn refine(&self, view: &SymbolView<'_>, cand: &mut Candidate, scratch: &mut RefineScratch) -> Refined {
        BasebandRefine::refine(self, view, cand, scratch)
    }
}

/// Removes decoded signals from the audio before the next pass.
pub trait Subtractor {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Subtracts `decodes` (found by the pass that ended) from `audio` (12 kHz, slot start
    /// at sample 0), using `scratch` for working buffers.
    fn subtract(
        &self,
        layout: &FrameLayout,
        audio: &mut [f32],
        decodes: &[Decode],
        scratch: &mut SubtractScratch,
    );
}

/// Leaves the audio unchanged.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NoSubtract;

impl Subtractor for NoSubtract {
    fn name(&self) -> &'static str {
        "none"
    }

    fn subtract(
        &self,
        _layout: &FrameLayout,
        _audio: &mut [f32],
        _decodes: &[Decode],
        _scratch: &mut SubtractScratch,
    ) {
    }
}
