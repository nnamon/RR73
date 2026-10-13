//! RTTY for RR73: the ITA2 code and a continuous-phase AFSK encoder.
//!
//! Audio is mono at 12 kHz ([`SAMPLE_RATE`]) unless stated. Frequencies are audio
//! frequencies in Hz.

pub mod config;
pub mod ita2;
pub mod modulator;
pub mod score;

pub use config::{
    ConfigError, DEFAULT_MARK_HZ, Figures, Polarity, RttyParams, STANDARD_BAUD, STANDARD_SHIFTS_HZ,
};
pub use ita2::Case;
pub use modulator::{Idle, Modulator, TxConfig, encode};

/// Sample rate of decoder input and of the bench, in Hz.
pub const SAMPLE_RATE: f64 = 12_000.0;
