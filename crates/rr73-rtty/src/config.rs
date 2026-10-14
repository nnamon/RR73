//! Modem parameters shared by the encoder and the decoder, and their range checks.

use serde::{Deserialize, Serialize};

/// Standard amateur signalling rates, in baud. 45.45 baud is the default.
pub const STANDARD_BAUD: [f64; 3] = [45.45, 50.0, 75.0];

/// Standard mark-space shifts, in Hz. 170 Hz is the default.
pub const STANDARD_SHIFTS_HZ: [f64; 4] = [170.0, 200.0, 425.0, 850.0];

/// Default mark tone, in Hz. With the default 170 Hz shift and normal polarity the pair is
/// centred on 1500 Hz: mark 1585 Hz, space 1415 Hz.
pub const DEFAULT_MARK_HZ: f64 = 1585.0;

/// Which audio tone carries mark.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Polarity {
    /// Mark is the higher audio tone. This is amateur RTTY (mark on the higher radio
    /// frequency) received with the radio in USB.
    #[default]
    Normal,
    /// Mark is the lower audio tone: amateur RTTY received in LSB, or a station sending
    /// reversed.
    Reverse,
}

/// Figures-case table: ITA2 and US teleprinters differ in 8 figures-case characters.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Figures {
    /// ITA2: S is ', J is BELL, D is WRU (ENQ), Z is +, V is =. F, G and H are unassigned.
    Ita2,
    /// US teleprinters: S is BELL, J is ', D is $, F is !, G is &, H is #, Z is ", V is ;.
    #[default]
    Us,
}

/// Line code and keying shared by both ends of a link.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RttyParams {
    /// Signalling rate, in baud. 45.45, 50 or 75 on the amateur bands; 20 to 150 accepted.
    pub baud: f64,
    /// Spacing between mark and space, in Hz. 170, 200, 425 or 850; 50 to 1000 accepted.
    pub shift_hz: f64,
    /// Stop bits after each character, in bits: 1, 1.5 or 2.
    pub stop_bits: f64,
    /// Which tone carries mark.
    pub polarity: Polarity,
    /// Figures-case table.
    pub figures: Figures,
    /// Unshift on space: a space received in figures case returns the receiver to letters,
    /// and the encoder sends FIGS again before a figure that follows a space.
    pub unshift_on_space: bool,
}

impl Default for RttyParams {
    fn default() -> Self {
        Self {
            baud: 45.45,
            shift_hz: 170.0,
            stop_bits: 1.5,
            polarity: Polarity::Normal,
            figures: Figures::Us,
            unshift_on_space: true,
        }
    }
}

/// A parameter outside the range the modem supports.
#[derive(Clone, Debug, PartialEq, thiserror::Error)]
pub enum ConfigError {
    /// Rate outside 20 to 150 baud.
    #[error("rate {0} baud is outside 20 to 150 baud")]
    Baud(f64),
    /// Shift outside 50 to 1000 Hz.
    #[error("shift {0} Hz is outside 50 to 1000 Hz")]
    Shift(f64),
    /// Stop bits outside 1 to 2.
    #[error("{0} stop bits is outside 1 to 2")]
    StopBits(f64),
    /// A mark or space tone outside 100 to 5000 Hz.
    #[error("tone at {0} Hz is outside 100 to 5000 Hz")]
    Tone(f64),
    /// Another named value out of its range.
    #[error("{name} = {value} is outside {min} to {max}")]
    Range {
        /// Field name.
        name: &'static str,
        /// Value given.
        value: f64,
        /// Smallest accepted value.
        min: f64,
        /// Largest accepted value.
        max: f64,
    },
}

/// Checks that `value` lies in `min..=max` (finite).
pub(crate) fn check_range(name: &'static str, value: f64, min: f64, max: f64) -> Result<(), ConfigError> {
    if (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(ConfigError::Range {
            name,
            value,
            min,
            max,
        })
    }
}

/// Checks a tone frequency, in Hz.
pub(crate) fn check_tone(hz: f64) -> Result<(), ConfigError> {
    if (100.0..=5000.0).contains(&hz) {
        Ok(())
    } else {
        Err(ConfigError::Tone(hz))
    }
}

impl RttyParams {
    /// Checks every field against the supported ranges.
    pub fn check(&self) -> Result<(), ConfigError> {
        if !(20.0..=150.0).contains(&self.baud) {
            return Err(ConfigError::Baud(self.baud));
        }
        if !(50.0..=1000.0).contains(&self.shift_hz) {
            return Err(ConfigError::Shift(self.shift_hz));
        }
        if !(1.0..=2.0).contains(&self.stop_bits) {
            return Err(ConfigError::StopBits(self.stop_bits));
        }
        Ok(())
    }

    /// Length of one bit, in seconds.
    pub fn bit_s(&self) -> f64 {
        1.0 / self.baud
    }

    /// Length of one character (start, 5 data and stop bits), in bits.
    pub fn char_bits(&self) -> f64 {
        6.0 + self.stop_bits
    }

    /// Space tone for a mark at `mark_hz`, in Hz.
    pub fn space_hz(&self, mark_hz: f64) -> f64 {
        match self.polarity {
            Polarity::Normal => mark_hz - self.shift_hz,
            Polarity::Reverse => mark_hz + self.shift_hz,
        }
    }

    /// Centre of the pair for a mark at `mark_hz`, in Hz.
    pub fn center_hz(&self, mark_hz: f64) -> f64 {
        0.5 * (mark_hz + self.space_hz(mark_hz))
    }

    /// Mark tone of the pair centred on `center_hz`, in Hz.
    pub fn mark_for_center(&self, center_hz: f64) -> f64 {
        match self.polarity {
            Polarity::Normal => center_hz + 0.5 * self.shift_hz,
            Polarity::Reverse => center_hz - 0.5 * self.shift_hz,
        }
    }

    /// Offset of the mark tone from the pair's centre, in Hz: positive for normal polarity.
    pub(crate) fn mark_offset_hz(&self) -> f64 {
        self.mark_for_center(0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tones_follow_polarity() {
        let mut p = RttyParams::default();
        assert_eq!(p.space_hz(1585.0), 1415.0);
        assert_eq!(p.center_hz(1585.0), 1500.0);
        assert_eq!(p.mark_for_center(1500.0), 1585.0);
        p.polarity = Polarity::Reverse;
        assert_eq!(p.space_hz(2125.0), 2295.0);
        assert_eq!(p.mark_for_center(2210.0), 2125.0);
        assert_eq!(p.char_bits(), 7.5);
    }

    #[test]
    fn ranges_are_checked() {
        assert!(RttyParams::default().check().is_ok());
        for baud in STANDARD_BAUD {
            for shift_hz in STANDARD_SHIFTS_HZ {
                let p = RttyParams {
                    baud,
                    shift_hz,
                    ..RttyParams::default()
                };
                assert!(p.check().is_ok());
            }
        }
        let bad = |f: fn(&mut RttyParams)| {
            let mut p = RttyParams::default();
            f(&mut p);
            p.check().is_err()
        };
        assert!(bad(|p| p.baud = 300.0));
        assert!(bad(|p| p.baud = f64::NAN));
        assert!(bad(|p| p.shift_hz = 20.0));
        assert!(bad(|p| p.stop_bits = 3.0));
        assert!(check_tone(50.0).is_err());
        assert!(check_range("x", 2.0, 0.0, 1.0).is_err());
    }
}
