//! GFSK waveform synthesis.

use crate::Mode;

/// Synthesises a phase-continuous GFSK waveform for `tones`, with the base tone at `f0_hz`,
/// at `sample_rate` Hz and peak `amplitude`. The waveform starts at the first sample and
/// includes the protocol's amplitude ramps at both ends.
pub fn gfsk(mode: Mode, tones: &[u8], f0_hz: f32, sample_rate: u32, amplitude: f32) -> Vec<f32> {
    let _ = (mode, tones, f0_hz, sample_rate, amplitude);
    todo!("rr73-ft8: gfsk")
}
