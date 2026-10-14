//! WSPR protocol primitives.
//!
//! This crate turns operator text into the 50-bit WSPR message and back, encodes it with the
//! K = 32, rate 1/2 convolutional code, interleaves the 162 code bits, merges them with the
//! sync vector into 162 4-FSK channel symbols and synthesises the audio. It contains no
//! decoding logic; `rr73-decode` builds on the tables exported here.
//!
//! The transmit chain for one message:
//!
//! ```
//! use rr73_wspr::{Message, channel_symbols, synth};
//!
//! let msg = Message::parse("K1ABC FN42 37").unwrap();
//! let symbols = channel_symbols(&msg).unwrap();
//! let audio = synth::fsk(&symbols, 1500.0, 0.0, 12_000, 1.0);
//! assert_eq!(audio.len(), 162 * 8192);
//! ```
//!
//! References: J. Taylor, K1JT, and the WSJT-X User Guide, section on WSPR (message types 1,
//! 2 and 3, power levels, slot timing); A. Talbot, G4JNT, "The WSPR Coding Process" (callsign,
//! locator and power packing into 50 bits, the convolutional code polynomials, bit-reversal
//! interleaving and the 162-bit sync vector). The type 2 prefix and suffix layout and the type
//! 3 hash were established by running WSJT-X's `wsprsim` as a black box (`tools/wsjtx`); no
//! WSJT-X source was read. Every function is checked against `wsprsim` with the vectors in
//! `fixtures/wspr/wsjtx.json`.
//!
//! Units: frequencies in Hz, times in seconds, sample counts at 12 kHz unless stated.

pub mod code;
pub mod hash;
pub mod message;
pub mod synth;

pub use hash::{CallsignHashes, hash15};
pub use message::{Message, PackError, Packed, UnpackError, pack, unpack};

/// Sample rate the protocol's sample counts refer to, in Hz.
pub const SAMPLE_RATE_HZ: u32 = 12_000;

/// Channel symbols per transmission.
pub const SYMBOLS: usize = 162;

/// Samples per symbol at 12 kHz.
pub const SAMPLES_PER_SYMBOL: usize = 8192;

/// Symbol length, in seconds (8192 / 12000, about 0.683 s; 1.4648 baud).
pub const SYMBOL_S: f64 = SAMPLES_PER_SYMBOL as f64 / SAMPLE_RATE_HZ as f64;

/// Tone spacing, in Hz (12000 / 8192, about 1.4648 Hz).
pub const TONE_SPACING_HZ: f64 = SAMPLE_RATE_HZ as f64 / SAMPLES_PER_SYMBOL as f64;

/// Length of one transmission, in seconds (162 symbols, 110.592 s).
pub const TRANSMISSION_S: f64 = SYMBOLS as f64 * SYMBOL_S;

/// Samples in one transmission at 12 kHz (1 327 104).
pub const TRANSMISSION_SAMPLES: usize = SYMBOLS * SAMPLES_PER_SYMBOL;

/// Slot length, in seconds. Transmissions start in even UTC minutes.
pub const SLOT_S: f64 = 120.0;

/// Samples in one slot at 12 kHz (1 440 000).
pub const SLOT_SAMPLES: usize = 1_440_000;

/// Nominal start of a transmission after the slot boundary, in seconds.
pub const START_OFFSET_S: f64 = 1.0;

/// Centre of the WSPR sub-band in the receiver's audio, in Hz (dial plus 1500 Hz).
pub const BAND_CENTRE_HZ: f64 = 1500.0;

/// Half width of the WSPR sub-band, in Hz: signal centres lie within 1400 to 1600 Hz.
pub const BAND_HALF_WIDTH_HZ: f64 = 100.0;

/// The 162 channel symbols (tones 0 to 3) of `msg`.
pub fn channel_symbols(msg: &Message) -> Result<[u8; SYMBOLS], PackError> {
    Ok(code::symbols(&pack(msg)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timing_constants_match_the_protocol() {
        assert!((TONE_SPACING_HZ - 1.464_843_75).abs() < 1e-12);
        assert!((SYMBOL_S - 0.682_666_666_666).abs() < 1e-9);
        assert!((TRANSMISSION_S - 110.592).abs() < 1e-9);
        assert_eq!(TRANSMISSION_SAMPLES, 1_327_104);
        assert_eq!(SLOT_SAMPLES as f64, SLOT_S * f64::from(SAMPLE_RATE_HZ));
        const { assert!(START_OFFSET_S + TRANSMISSION_S < SLOT_S) };
        // Modulation index 1: tone spacing is the keying rate.
        assert!((TONE_SPACING_HZ * SYMBOL_S - 1.0).abs() < 1e-12);
    }
}
