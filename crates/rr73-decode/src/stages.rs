//! The refinement and subtraction stage traits and their pass-through implementations. The
//! model-based subtractor is in [`crate::subtract`].

use crate::layout::FrameLayout;
use crate::report::Decode;
use crate::subtract::SubtractScratch;
use crate::view::{Candidate, SymbolView};

/// Improves a candidate's time and frequency before demodulation.
pub trait SyncRefine {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Adjusts `cand` in place. May move it on the grid or set the fractional parts.
    fn refine(&self, view: &SymbolView<'_>, cand: &mut Candidate);
}

/// Keeps the search grid position.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NoRefine;

impl SyncRefine for NoRefine {
    fn name(&self) -> &'static str {
        "none"
    }

    fn refine(&self, _view: &SymbolView<'_>, _cand: &mut Candidate) {}
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
