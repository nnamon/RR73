//! Decoder output: decodes, counters and per-stage timings.

use rr73_ft8::{Message, Payload};
use serde::{Deserialize, Serialize};

/// One decoded message.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Decode {
    /// Canonical message text.
    pub text: String,
    /// The unpacked message.
    #[serde(skip)]
    pub message: Message,
    /// The 77-bit payload.
    #[serde(skip)]
    pub payload: Payload,
    /// Base-tone (tone 0) frequency, in Hz.
    pub freq_hz: f32,
    /// Start of the transmission minus the nominal start (0.5 s into the slot), in seconds.
    pub dt_s: f32,
    /// Signal-to-noise ratio in 2500 Hz, in dB.
    pub snr_db: f32,
    /// Decoding pass that found it, from 1.
    pub pass: u32,
    /// LDPC iterations until the codeword checked (0: the channel decision was a codeword).
    pub ldpc_iterations: u32,
    /// Code bits the LDPC decoder changed from the channel hard decision.
    pub hard_errors: u32,
    /// Candidate sync score, in dB.
    pub score: f32,
    /// `true` when ordered-statistics decoding found the codeword.
    pub osd: bool,
    /// For OSD decodes, the reliability-weighted distance to the received LLRs as a fraction
    /// of the total reliability; 0 otherwise.
    pub osd_distance: f32,
}

/// Counters for one slot.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct DecodeStats {
    /// Candidates from the search, summed over passes.
    pub candidates: u32,
    /// Candidates passed to the LDPC decoder.
    pub ldpc_attempts: u32,
    /// LDPC decodes that produced a codeword.
    pub ldpc_converged: u32,
    /// Of those, codewords from ordered-statistics decoding.
    pub osd_codewords: u32,
    /// Codewords with a wrong CRC.
    pub crc_failures: u32,
    /// Codewords with an all-zero payload.
    pub zero_payloads: u32,
    /// Payloads that did not unpack.
    pub unpack_failures: u32,
    /// Valid messages already decoded in the slot.
    pub duplicates: u32,
    /// OSD codewords whose message failed the plausibility checks.
    pub implausible: u32,
}

/// Wall time per stage for one slot, in seconds, summed over passes and candidates.
/// All zero on `wasm32`, which has no monotonic clock in the standard library.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct StageTimings {
    /// Spectrogram computation.
    pub spectrogram_s: f64,
    /// Candidate search.
    pub search_s: f64,
    /// Time and frequency refinement.
    pub refine_s: f64,
    /// LLR computation.
    pub demod_s: f64,
    /// LDPC decoding.
    pub ldpc_s: f64,
    /// CRC, unpack, duplicate check and SNR estimate.
    pub validate_s: f64,
    /// Signal subtraction.
    pub subtract_s: f64,
    /// The whole call.
    pub total_s: f64,
}

/// Everything one call to [`crate::decode`] returns.
#[derive(Clone, Debug, PartialEq)]
pub struct DecodeReport {
    /// Decodes in the order found: by pass, then by candidate score.
    pub decodes: Vec<Decode>,
    /// Counters.
    pub stats: DecodeStats,
    /// Per-stage wall time.
    pub timings: StageTimings,
}
