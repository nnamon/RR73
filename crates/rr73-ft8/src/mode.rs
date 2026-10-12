//! Mode parameters shared by encoder, synthesiser and decoders.
//!
//! Values are from QEX, sections 4 and 5 and Table 4, and match ft8_lib's `constants.h`.
//! The FT8 start offset of 0.5 s is the nominal start time given in QEX, section 8. QEX does
//! not state the FT4 start offset; 0.5 s follows WSJT-X practice (Unverified against a WSJT-X
//! binary).

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

/// Sample rate in Hz that [`ModeParams::samples_per_symbol`] refers to.
pub const SAMPLE_RATE_HZ: u32 = 12_000;

const FT8: ModeParams = ModeParams {
    tones: 8,
    symbols: 79,
    samples_per_symbol: 1920,
    tone_spacing_hz: 6.25,
    slot_s: 15.0,
    start_offset_s: 0.5,
    gfsk_bt: 2.0,
};

const FT4: ModeParams = ModeParams {
    tones: 4,
    symbols: 105,
    samples_per_symbol: 576,
    tone_spacing_hz: 12_000.0 / 576.0,
    slot_s: 7.5,
    start_offset_s: 0.5,
    gfsk_bt: 1.0,
};

impl Mode {
    /// Returns the fixed parameters of this mode.
    pub fn params(self) -> ModeParams {
        match self {
            Mode::Ft8 => FT8,
            Mode::Ft4 => FT4,
        }
    }
}

impl ModeParams {
    /// Symbol duration in seconds (0.16 s for FT8, 0.048 s for FT4).
    pub fn symbol_s(&self) -> f64 {
        self.samples_per_symbol as f64 / f64::from(SAMPLE_RATE_HZ)
    }

    /// Duration of one transmission in seconds (12.64 s for FT8, 5.04 s for FT4).
    pub fn transmission_s(&self) -> f64 {
        self.symbols as f64 * self.symbol_s()
    }

    /// Samples in one transmission at 12 kHz (151 680 for FT8, 60 480 for FT4).
    pub fn transmission_samples(&self) -> usize {
        self.symbols * self.samples_per_symbol
    }

    /// Bandwidth occupied by the tones, `tones × tone_spacing_hz`, in Hz (50 Hz for FT8,
    /// 83.3 Hz for FT4).
    pub fn bandwidth_hz(&self) -> f32 {
        self.tones as f32 * self.tone_spacing_hz
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ft8_parameters_match_qex_table_4() {
        let p = Mode::Ft8.params();
        assert_eq!(p.tones, 8);
        assert_eq!(p.symbols, 79);
        assert_eq!(p.samples_per_symbol, 1920);
        assert!((p.symbol_s() - 0.160).abs() < 1e-12);
        // Modulation index 1: tone spacing is the keying rate 1/T.
        assert!((f64::from(p.tone_spacing_hz) - 1.0 / p.symbol_s()).abs() < 1e-6);
        assert_eq!(p.slot_s, 15.0);
        assert_eq!(p.start_offset_s, 0.5);
        assert_eq!(p.gfsk_bt, 2.0);
        assert!((p.transmission_s() - 12.64).abs() < 1e-9);
        assert_eq!(p.transmission_samples(), 151_680);
    }

    #[test]
    fn ft4_parameters_match_qex_table_4() {
        let p = Mode::Ft4.params();
        assert_eq!(p.tones, 4);
        // 87 data symbols, 4 sync groups of 4 and 2 ramp symbols.
        assert_eq!(p.symbols, 87 + 16 + 2);
        assert_eq!(p.samples_per_symbol, 576);
        assert!((p.symbol_s() - 0.048).abs() < 1e-12);
        assert!((f64::from(p.tone_spacing_hz) - 1.0 / p.symbol_s()).abs() < 1e-4);
        assert!((p.tone_spacing_hz - 20.833_334).abs() < 1e-4);
        assert_eq!(p.slot_s, 7.5);
        assert_eq!(p.start_offset_s, 0.5);
        assert_eq!(p.gfsk_bt, 1.0);
        assert!((p.transmission_s() - 5.04).abs() < 1e-9);
    }

    #[test]
    fn transmissions_fit_their_slots() {
        for mode in [Mode::Ft8, Mode::Ft4] {
            let p = mode.params();
            assert!(f64::from(p.start_offset_s) + p.transmission_s() < f64::from(p.slot_s));
        }
    }
}
