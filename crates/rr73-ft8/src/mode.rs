//! Mode parameters shared by encoder, synthesiser and decoders.

/// Transmission mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Mode {
    /// FT8: 8-GFSK, 79 symbols of 0.16 s, 15 s slots.
    Ft8,
    /// FT4: 4-GFSK, 105 symbols of 0.048 s, 7.5 s slots.
    Ft4,
}

/// Fixed parameters of a mode. All sample counts are at 12 kHz.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ModeParams {
    /// Number of tones in the alphabet (8 or 4).
    pub tones: usize,
    /// Channel symbols per transmission, including sync and ramp symbols.
    pub symbols: usize,
    /// Samples per symbol at 12 kHz.
    pub samples_per_symbol: usize,
    /// Tone spacing in Hz.
    pub tone_spacing_hz: f32,
    /// Slot length in seconds.
    pub slot_s: f32,
    /// Nominal start of a transmission after the slot boundary, in seconds.
    pub start_offset_s: f32,
    /// Gaussian filter bandwidth-time product used for GFSK shaping.
    pub gfsk_bt: f32,
}

impl Mode {
    /// Returns the fixed parameters of this mode.
    pub fn params(self) -> ModeParams {
        todo!("rr73-ft8: mode parameters")
    }
}
