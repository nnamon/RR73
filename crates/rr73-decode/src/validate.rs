//! Validation of LDPC codewords: CRC, payload checks, message unpacking and duplicates.

use rr73_ft8::message::{self, Message, UnpackError};
use rr73_ft8::{CallsignHashes, Mode, Payload, crc, ldpc};

use crate::layout::CODEWORD_BITS;

/// A codeword that passed validation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Validated {
    /// The 77-bit payload (for FT4, after removing the scrambling sequence).
    pub payload: Payload,
    /// The unpacked message.
    pub message: Message,
    /// Canonical message text.
    pub text: String,
}

/// Why a codeword was rejected.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum Rejection {
    /// The CRC-14 does not match.
    #[error("CRC mismatch")]
    Crc,
    /// The payload is all zero (a valid codeword with a zero CRC, never sent).
    #[error("all-zero payload")]
    ZeroPayload,
    /// The payload does not unpack to a message.
    #[error("unpack failed: {0}")]
    Unpack(UnpackError),
}

/// Checks a decoded codeword and turns it into a message.
pub trait Validator {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Validates `codeword` (174 hard bits) for `mode`. May record callsigns in `hashes`.
    fn validate(
        &self,
        mode: Mode,
        codeword: &[u8; CODEWORD_BITS],
        hashes: &mut CallsignHashes,
    ) -> Result<Validated, Rejection>;

    /// `true` when `new` repeats a message already in `seen`.
    fn is_duplicate(&self, new: &Validated, seen: &[Payload]) -> bool;
}

/// CRC-14 check (with the FT4 descrambling), non-zero payload, unpack. Duplicates are
/// identical payloads.
///
/// After a successful unpack the message's full callsigns go into `hashes`, so later
/// candidates in the slot (and later slots sharing the table) resolve their hashes, as
/// ft8_lib does with its hash table.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CrcUnpack;

impl Validator for CrcUnpack {
    fn name(&self) -> &'static str {
        "crc-unpack"
    }

    fn validate(
        &self,
        mode: Mode,
        codeword: &[u8; CODEWORD_BITS],
        hashes: &mut CallsignHashes,
    ) -> Result<Validated, Rejection> {
        let m91 = ldpc::message_bits(codeword);
        let payload = crc::payload_from_message91(mode, &m91).ok_or(Rejection::Crc)?;
        if payload.0.iter().all(|&b| b == 0) {
            return Err(Rejection::ZeroPayload);
        }
        let message = message::unpack(&payload, hashes).map_err(Rejection::Unpack)?;
        hashes.learn(&message);
        let text = message.to_string();
        Ok(Validated {
            payload,
            message,
            text,
        })
    }

    fn is_duplicate(&self, new: &Validated, seen: &[Payload]) -> bool {
        seen.contains(&new.payload)
    }
}
