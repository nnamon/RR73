//! Validation of LDPC codewords: CRC, payload checks, message unpacking and duplicates.

use rr73_ft8::message::{self, Addressee, Message, Station, UnpackError};
use rr73_ft8::{CallHash, Callsign, CallsignHashes, HashWidth, Mode, Payload, crc, ldpc};

use crate::config::OsdMessages;
use crate::layout::CODEWORD_BITS;
use crate::ldpc::LdpcOutcome;

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
    /// An OSD codeword carries a message that fails the plausibility checks.
    #[error("implausible message from OSD")]
    Implausible,
}

/// Checks a decoded codeword and turns it into a message.
pub trait Validator {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Validates `codeword` (174 hard bits) for `mode`, decoded with `outcome`, resolving
    /// hashed callsigns from `hashes`. The pipeline records the callsigns of accepted
    /// decodes.
    fn validate(
        &self,
        mode: Mode,
        codeword: &[u8; CODEWORD_BITS],
        outcome: &LdpcOutcome,
        hashes: &mut CallsignHashes,
    ) -> Result<Validated, Rejection>;

    /// `true` when `new` repeats a message already in `seen`.
    fn is_duplicate(&self, new: &Validated, seen: &[Payload]) -> bool;
}

/// CRC-14 check (with the FT4 descrambling), non-zero payload, unpack, and for OSD
/// codewords the message plausibility rule. Duplicates are identical payloads. The pipeline
/// records the full callsigns of each accepted decode in the hash table, so later candidates
/// in the slot (and later slots sharing the table) resolve their hashes, as ft8_lib does.
#[derive(Clone, Debug, PartialEq)]
pub struct CrcUnpack {
    /// Messages accepted from OSD codewords.
    pub osd_messages: OsdMessages,
}

impl Default for CrcUnpack {
    fn default() -> Self {
        Self {
            osd_messages: OsdMessages::Standard,
        }
    }
}

/// A callsign that could have been issued: not starting with Q (the ITU Q series is not
/// allocated to stations) or with the digits 0 or 1.
pub fn plausible_callsign(call: &Callsign) -> bool {
    !matches!(call.as_str().as_bytes().first(), None | Some(b'Q' | b'0' | b'1'))
}

/// `true` when `hashes` already holds `call`.
fn known(call: &Callsign, hashes: &CallsignHashes) -> bool {
    hashes.resolve(CallHash::of(call, HashWidth::Bits22)) == Some(*call)
}

/// Applies `rule` to a message decoded by OSD.
pub fn plausible(message: &Message, rule: OsdMessages, hashes: &CallsignHashes) -> bool {
    if rule == OsdMessages::Any {
        return true;
    }
    let Message::Standard { to, de, .. } = message else {
        return false;
    };
    let Station::Call(de) = de else { return false };
    let to = match to {
        Addressee::Station(Station::Call(call)) => Some(call),
        Addressee::Station(Station::Hashed(_)) => return false,
        Addressee::Cq { .. } | Addressee::Qrz | Addressee::De => None,
    };
    if !plausible_callsign(de) || to.is_some_and(|c| !plausible_callsign(c)) {
        return false;
    }
    match rule {
        OsdMessages::StandardKnown => known(de, hashes) || to.is_some_and(|c| known(c, hashes)),
        _ => true,
    }
}

impl Validator for CrcUnpack {
    fn name(&self) -> &'static str {
        "crc-unpack"
    }

    fn validate(
        &self,
        mode: Mode,
        codeword: &[u8; CODEWORD_BITS],
        outcome: &LdpcOutcome,
        hashes: &mut CallsignHashes,
    ) -> Result<Validated, Rejection> {
        let m91 = ldpc::message_bits(codeword);
        let payload = crc::payload_from_message91(mode, &m91).ok_or(Rejection::Crc)?;
        if payload.0.iter().all(|&b| b == 0) {
            return Err(Rejection::ZeroPayload);
        }
        let message = message::unpack(&payload, hashes).map_err(Rejection::Unpack)?;
        if outcome.osd && !plausible(&message, self.osd_messages, hashes) {
            return Err(Rejection::Implausible);
        }
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
