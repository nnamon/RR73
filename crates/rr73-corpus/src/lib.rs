//! Corpus slots (12 kHz WAV plus JSON sidecar) and decode scoring. See `docs/corpus.md`.
//!
//! - [`sidecar`]: the `rr73-slot/1` JSON schema.
//! - [`wav`]: 16-bit mono PCM reading and writing.
//! - [`slot`]: slot files on disk, discovery under paths, reading and writing pairs.
//! - [`score`]: matching decodes against truth or reference entries.
//! - [`stats`]: SNR50 fitting and percentiles.
//!
//! The crate does not depend on the codec or the decoder: decodes are scored as plain
//! [`Entry`] values (text, frequency, DT, SNR).

pub mod score;
pub mod sidecar;
pub mod slot;
pub mod stats;
pub mod wav;

pub use score::{SlotScore, Tolerance, match_entries, normalise_text};
pub use sidecar::{Entry, Reference, SlotMeta, SlotMode, Source, SourceKind, Timing, TimingReference};
pub use slot::{Slot, SlotFiles, discover, read_slot, write_slot};

/// Sample rate of every corpus slot, in Hz.
pub const SAMPLE_RATE: u32 = 12_000;

/// Errors from reading or writing corpus files.
#[derive(Debug, thiserror::Error)]
pub enum CorpusError {
    /// File system error, with the path involved.
    #[error("{path}: {source}")]
    Io {
        /// Path being read or written.
        path: String,
        /// Underlying error.
        source: std::io::Error,
    },
    /// The WAV file could not be parsed or written.
    #[error("{path}: WAV error: {source}")]
    Wav {
        /// Path being read or written.
        path: String,
        /// Underlying error.
        source: hound::Error,
    },
    /// The sidecar is not valid JSON for the schema.
    #[error("{path}: sidecar error: {source}")]
    Json {
        /// Path being read or written.
        path: String,
        /// Underlying error.
        source: serde_json::Error,
    },
    /// The files parse but break a rule of the format.
    #[error("{path}: {reason}")]
    Format {
        /// Path of the offending file.
        path: String,
        /// The rule that was broken.
        reason: String,
    },
}

impl CorpusError {
    pub(crate) fn format(path: &std::path::Path, reason: impl Into<String>) -> Self {
        CorpusError::Format {
            path: path.display().to_string(),
            reason: reason.into(),
        }
    }
}
