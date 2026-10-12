//! FT8 and FT4 decoder pipeline. Each stage is a trait with named implementations, chosen
//! by [`DecoderConfig`]. See `docs/architecture.md`.
//!
//! ```text
//! SlotAudio -> Spectrogram (rr73-dsp)
//!           -> CandidateSearch   Costas sync score         -> Vec<Candidate>
//!           -> SyncRefine        time and frequency        -> Candidate
//!           -> Demodulator       symbol energies to LLRs   -> [f32; 174]
//!           -> LdpcDecoder       belief propagation        -> codeword
//!           -> Validator         CRC, unpack, duplicates   -> message
//!           -> Subtractor        rebuild and remove decodes, next pass
//!           -> DecodeReport
//! ```
//!
//! Conventions: audio at 12 kHz with sample 0 at the slot start; frequencies in Hz (base
//! tone); DT in seconds from the nominal start (0.5 s into the slot); SNR in dB in 2500 Hz;
//! LLRs positive for bit 1. The crate starts no threads; callers parallelise over slots.

mod clock;
pub mod config;
pub mod demod;
pub mod layout;
pub mod ldpc;
pub mod pipeline;
pub mod report;
pub mod search;
pub mod snr;
pub mod stages;
pub mod subtract;
pub mod validate;
pub mod view;

#[cfg(test)]
mod testsig;

pub use config::{ConfigError, DecoderConfig, PRESETS};
pub use layout::FrameLayout;
pub use pipeline::{DecodeContext, Pipeline, SAMPLE_RATE, SlotAudio, decode};
pub use report::{Decode, DecodeReport, DecodeStats, StageTimings};
pub use view::Candidate;
