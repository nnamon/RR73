//! Validation of LDPC codewords: CRC, payload checks, message unpacking and duplicates.
//!
//! LQ8 codewords unpack with the LQ message layer ([`rr73_ft8::lq8`]) and have their own
//! checks: the reserved types 14 to 16 and payloads whose unused bits are not zero are
//! refused, and OSD codewords pass only as types 1, 5, 8 and 9 with plausible callsigns, the
//! LQ8 counterpart of the FT8 rule (`docs/design/lq8.md`).

use rr73_ft8::lq8::{self, Kind};
use rr73_ft8::message::{self, Addressee, Exchange, Message, Station, UnpackError};
use rr73_ft8::{CallHash, Callsign, CallsignHashes, HashWidth, Mode, Payload, crc, ldpc};

use crate::report::DecodedMessage;

use crate::config::OsdMessages;
use crate::layout::CODEWORD_BITS;
use crate::ldpc::LdpcOutcome;

/// A codeword that passed validation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Validated {
    /// The 77-bit payload (for FT4, after removing the scrambling sequence).
    pub payload: Payload,
    /// The unpacked message.
    pub message: DecodedMessage,
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
    /// An LQ8 payload that does not unpack, of a reserved type, or with unused bits set.
    #[error("LQ8 payload refused")]
    Lq8Unpack,
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

/// A callsign that could have been issued. The ITU allocates no call sign series starting
/// with Q (the Q codes) or with the digits 0 or 1 (Radio Regulations, Appendix 42), so such
/// callsigns are rejected, except the two DXCC entities that use an unallocated 1 prefix:
/// 1A (Sovereign Military Order of Malta, 1A0KM) and 1S (Spratly Islands).
/// `docs/experiments/0002-osd.md` records why other 0 and 1 prefixes stay rejected.
pub fn plausible_callsign(call: &Callsign) -> bool {
    plausible_call(call.as_str())
}

/// [`plausible_callsign`] on text, for LQ8 callsigns (up to 13 characters, with /P).
pub fn plausible_call(call: &str) -> bool {
    match call.as_bytes() {
        [] | [b'Q', ..] | [b'0', ..] => false,
        [b'1', second, ..] => matches!(second, b'A' | b'S'),
        [b'1'] => false,
        _ => true,
    }
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
    let Message::Standard { to, de, exchange } = message else {
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
        OsdMessages::StandardHf => !matches!(exchange, Exchange::Grid { ack: true, .. }),
        _ => true,
    }
}

/// Applies `rule` to an LQ8 message decoded by OSD: any message for [`OsdMessages::Any`],
/// else types 1, 5, 8 and 9 (callsigns in full, standard) whose callsigns could have been
/// issued. [`OsdMessages::StandardKnown`] reads as [`OsdMessages::Standard`]: the validator has
/// no LQ8 callsign table.
pub fn plausible_lq8(message: &lq8::Message, rule: OsdMessages) -> bool {
    if rule == OsdMessages::Any {
        return true;
    }
    let calls: Vec<&str> = match message.kind {
        Kind::CqStd => vec![&message.call1],
        Kind::CallStd | Kind::Report73 | Kind::Seventy3Std => vec![&message.call1, &message.call2],
        _ => return false,
    };
    calls.iter().all(|c| {
        let base = c.strip_suffix("/P").unwrap_or(c);
        !matches!(base, "DE" | "QRZ" | "CQ") && plausible_call(base)
    })
}

/// Validates an LQ8 codeword: CRC, nonzero payload, a type in use with zero padding, unpack,
/// and the OSD rule. Hashes stay unresolved; the session resolves them from its LQ8 table.
fn validate_lq8(
    codeword: &[u8; CODEWORD_BITS],
    outcome: &LdpcOutcome,
    rule: OsdMessages,
) -> Result<Validated, Rejection> {
    let m91 = ldpc::message_bits(codeword);
    let payload = crc::payload_from_message91(Mode::Lq8, &m91).ok_or(Rejection::Crc)?;
    if payload.0.iter().all(|&b| b == 0) {
        return Err(Rejection::ZeroPayload);
    }
    if !lq8::padding_is_zero(&payload) {
        return Err(Rejection::Lq8Unpack);
    }
    let message = lq8::unpack(&payload).map_err(|_| Rejection::Lq8Unpack)?;
    if message.kind.is_reserved() {
        return Err(Rejection::Lq8Unpack);
    }
    if outcome.osd && !plausible_lq8(&message, rule) {
        return Err(Rejection::Implausible);
    }
    let text = message.render();
    Ok(Validated {
        payload,
        message: DecodedMessage::Lq8(message),
        text,
    })
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
        if mode == Mode::Lq8 {
            return validate_lq8(codeword, outcome, self.osd_messages);
        }
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
            message: DecodedMessage::Ft8(message),
            text,
        })
    }

    fn is_duplicate(&self, new: &Validated, seen: &[Payload]) -> bool {
        seen.contains(&new.payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(text: &str) -> Callsign {
        Callsign::new(text).expect(text)
    }

    #[test]
    fn callsign_plausibility_follows_the_itu_series_and_dxcc_exceptions() {
        for ok in [
            "K1ABC", "9V1NE", "2E0ABC", "1A0KM", "1S0XV", "3DA0XYZ", "A61AB", "E71A",
        ] {
            assert!(plausible_callsign(&call(ok)), "{ok}");
        }
        for bad in ["Q1ABC", "QA1XYZ", "0S1A", "1B1AB", "1Z9A", "0A1BC"] {
            assert!(!plausible_callsign(&call(bad)), "{bad}");
        }
    }

    #[test]
    fn the_lq8_osd_rule_takes_standard_calls_in_full() {
        let check = |text: &str| {
            let m = lq8::Message::parse(text).expect(text);
            plausible_lq8(&m, OsdMessages::StandardHf)
        };
        for ok in [
            "CQ AB4SS FN42",
            "CQ DX AB4SS/P FN42",
            "AB4SS 9V1NE OJ11 -03",
            "9V1NE AB4SS R+05",
            "AB4SS 9V1NE/P 73",
        ] {
            assert!(check(ok), "{ok}");
        }
        for bad in [
            "CQ Q1ABC FN42",
            "AB4SS 0A1BC OJ11 -03",
            "AB4SS 9V1NE/P OJ11 -03",
            "<AB4SS> VP8/9V1NE -03",
            "CQ 3DA0RU JN47",
            "TNX FER QSO",
            "<9V1NE> R+05 <OE3OGC> R-03 <AB4SS>",
        ] {
            assert!(!check(bad), "{bad}");
        }
        let any = lq8::Message::parse("TNX FER QSO").expect("parse");
        assert!(plausible_lq8(&any, OsdMessages::Any));
    }

    #[test]
    fn the_hf_rule_rejects_r_before_a_locator() {
        let hashes = CallsignHashes::new();
        let check = |text: &str, rule| plausible(&Message::parse(text).expect(text), rule, &hashes);
        for ok in [
            "CQ K1ABC FN42",
            "K1ABC W9XYZ R-15",
            "G4ABC/P PA9XYZ JO22",
            "K1ABC W9XYZ/R EN61",
        ] {
            assert!(check(ok, OsdMessages::StandardHf), "{ok}");
        }
        for bad in ["K1ABC W9XYZ R EN61", "G4ABC/P PA9XYZ R JO22"] {
            assert!(check(bad, OsdMessages::Standard), "{bad}");
            assert!(!check(bad, OsdMessages::StandardHf), "{bad}");
        }
    }
}
