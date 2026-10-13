//! RTTY for RR73: the ITA2 code, a continuous-phase AFSK encoder and a streaming decoder.
//!
//! Audio is mono at 12 kHz ([`SAMPLE_RATE`]) unless stated. Frequencies are audio
//! frequencies in Hz.
//!
//! The decoder mixes the pair's centre to baseband, filters and decimates to at least 16
//! samples per bit, runs one-bit matched filters on the mark and space tones and turns their
//! envelopes into per-tone log-likelihood ratios with automatic threshold correction. A framer
//! finds start bits and reads characters; the ITA2 decoder follows LTRS and FIGS. An averaged
//! spectrum finds pairs for the AFC and measures the SNR for the squelch, and the matched
//! filters' phase rotation tracks drift.

pub mod config;
pub mod decoder;
mod demod;
mod framer;
pub mod ita2;
pub mod modulator;
pub mod score;
mod spectrum;

pub use config::{
    ConfigError, DEFAULT_MARK_HZ, Figures, Polarity, RttyParams, STANDARD_BAUD, STANDARD_SHIFTS_HZ,
};
pub use decoder::{AfcConfig, DecoderConfig, Framer, FramingErrors, RttyDecoder, RttyEvent};
pub use ita2::Case;
pub use modulator::{Idle, Modulator, TxConfig, encode};

/// Sample rate of decoder input and of the bench, in Hz.
pub const SAMPLE_RATE: f64 = 12_000.0;
