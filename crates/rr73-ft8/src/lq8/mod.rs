//! LQ8 messages: the 16 message types of the LQ digital mode family, their 77-bit payloads
//! and their text.
//!
//! LQ8 sends FT8's physical frame (8-GFSK, 79 symbols, CRC-14 and the (174,91) LDPC code) with
//! its own Costas array ([`crate::tones::LQ8_COSTAS`]) and a message layer of its own: a
//! Huffman prefix names the message type, so a call can carry both callsigns, a locator and a
//! report, and a QSO takes 4 messages (`CQ AB4SS FN42`, `AB4SS 9V1NE OJ11 -03`,
//! `9V1NE AB4SS R+05`, `AB4SS 9V1NE 73`).
//!
//! Ported from `src/message.cpp`, `src/huffman.cpp` and `include/lq/types.h` in lq_lib by Luis
//! Quesada HB9IPH (MIT licence, commit 00f3bcf); the licence is in `LICENSE-lq_lib` next to
//! this crate's manifest. The message text is the reference's `format_message`, and
//! [`Message::parse`] is its `parse_message`. Every LQ8 golden vector the reference publishes
//! is checked in `tests/lq8.rs`, from `fixtures/lq8/golden_vectors.json`.
//!
//! The reference shows an unresolved hash in hexadecimal (`<01a4f2>`); [`Message::to_string`]
//! does the same, and [`Message::render`] shows it as `<...>`, as RR73 shows FT8 hashes.

pub mod fields;
mod parse;
pub mod table;
pub mod varicode;

pub use table::CallTable;

use std::fmt;

use crate::Payload;
use fields::{
    format_report, hash16, hash20, hash24, pack_base38, pack_locator, pack_modifier, pack_report, pack28,
    split_any, split_standard, unpack_base38, unpack_locator, unpack_modifier, unpack_report, unpack28,
    with_suffix,
};

/// The 16 message types, numbered 1 to 16 as in the specification's Table 3.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    /// 1: CQ from a standard callsign with /P flag, modifier and locator.
    CqStd,
    /// 2: CQ from a callsign of up to 9 characters with /P flag and locator.
    CqNonstd1,
    /// 3: CQ from a callsign of up to 9 characters with /P flag and modifier.
    CqNonstd2,
    /// 4: CQ from a callsign of up to 13 characters with /P flag.
    CqNonstd3,
    /// 5: a call between two standard callsigns without /P: both callsigns, locator, report.
    CallStd,
    /// 6: a call from a standard callsign with /P flag to a 24-bit hash, locator, report.
    CallStdSuf,
    /// 7: a call from a callsign of up to 9 characters with /P flag to a 20-bit hash, report.
    CallNonstd,
    /// 8: REPORT+73 between standard callsigns with /P flags.
    Report73,
    /// 9: 73 between standard callsigns with /P flags.
    Seventy3Std,
    /// 10: 73 from a callsign of up to 9 characters with /P flag to a 24-bit hash.
    Seventy3Nonstd,
    /// 11: MULTI-REPORT+73: a 16-bit sender hash and two 24-bit targets with reports.
    MultiReport73,
    /// 12: MULTI-73: a 16-bit sender hash and two 24-bit targets.
    Multi73,
    /// 13: free text of up to about 17 characters.
    FreeText,
    /// 14: reserved, 72 payload bits.
    ReservedA,
    /// 15: reserved, 70 payload bits.
    ReservedB,
    /// 16: reserved, 69 payload bits.
    ReservedC,
}

/// Every type, in order of type number.
pub const KINDS: [Kind; 16] = [
    Kind::CqStd,
    Kind::CqNonstd1,
    Kind::CqNonstd2,
    Kind::CqNonstd3,
    Kind::CallStd,
    Kind::CallStdSuf,
    Kind::CallNonstd,
    Kind::Report73,
    Kind::Seventy3Std,
    Kind::Seventy3Nonstd,
    Kind::MultiReport73,
    Kind::Multi73,
    Kind::FreeText,
    Kind::ReservedA,
    Kind::ReservedB,
    Kind::ReservedC,
];

impl Kind {
    /// The type number, 1 to 16.
    pub fn id(self) -> u8 {
        KINDS.iter().position(|&k| k == self).map_or(0, |i| i as u8 + 1)
    }

    /// The reference's name for the type, as in its golden vectors: `CQ_STD`, `CALL_NONSTD`.
    pub fn name(self) -> &'static str {
        match self {
            Kind::CqStd => "CQ_STD",
            Kind::CqNonstd1 => "CQ_NONSTD_1",
            Kind::CqNonstd2 => "CQ_NONSTD_2",
            Kind::CqNonstd3 => "CQ_NONSTD_3",
            Kind::CallStd => "CALL_STD_NOSUF",
            Kind::CallStdSuf => "CALL_STD_SUF",
            Kind::CallNonstd => "CALL_NONSTD",
            Kind::Report73 => "REPORT73_STD",
            Kind::Seventy3Std => "M73_STD",
            Kind::Seventy3Nonstd => "M73_NONSTD",
            Kind::MultiReport73 => "MULTI_REPORT73",
            Kind::Multi73 => "MULTI_73",
            Kind::FreeText => "FREE_TEXT",
            Kind::ReservedA => "RESERVED_A",
            Kind::ReservedB => "RESERVED_B",
            Kind::ReservedC => "RESERVED_C",
        }
    }

    /// The Huffman prefix (value, length in bits).
    pub fn prefix(self) -> (u32, u32) {
        match self {
            Kind::CallStd => (0b1, 1),
            Kind::CallNonstd => (0b001, 3),
            Kind::MultiReport73 => (0b011, 3),
            Kind::CallStdSuf => (0b0100, 4),
            Kind::FreeText => (0b0101, 4),
            Kind::Seventy3Nonstd => (0b0001, 4),
            Kind::ReservedA => (0b00001, 5),
            Kind::ReservedB => (0b0000010, 7),
            Kind::ReservedC => (0b00000110, 8),
            Kind::Multi73 => (0b00000111, 8),
            Kind::CqNonstd3 => (0b0000001, 7),
            Kind::CqNonstd2 => (0b00000001, 8),
            Kind::CqStd => (0b0000000000, 10),
            Kind::CqNonstd1 => (0b0000000001, 10),
            Kind::Report73 => (0b0000000010, 10),
            Kind::Seventy3Std => (0b0000000011, 10),
        }
    }

    /// Payload bits the type uses after its prefix; the rest of the 77 bits are zero.
    pub fn used_bits(self) -> u32 {
        match self {
            Kind::CqStd | Kind::CqNonstd1 => 74,
            Kind::Report73 => 73,
            Kind::Seventy3Std => 68,
            Kind::Multi73 => 72,
            _ => 77,
        }
    }

    /// True for the CQ types 1 to 4.
    pub fn is_cq(self) -> bool {
        matches!(
            self,
            Kind::CqStd | Kind::CqNonstd1 | Kind::CqNonstd2 | Kind::CqNonstd3
        )
    }

    /// True for the reserved types 14 to 16.
    pub fn is_reserved(self) -> bool {
        matches!(self, Kind::ReservedA | Kind::ReservedB | Kind::ReservedC)
    }
}

/// One target of a multi-station message.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Target {
    /// The callsign, when known; empty otherwise.
    pub call: String,
    /// The 24-bit hash.
    pub hash: u32,
    /// The report, dB; 0 in MULTI-73.
    pub report: i32,
}

/// One LQ8 message. The fields a type does not use stay empty or zero.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Message {
    /// The message type.
    pub kind: Kind,
    /// The station calling CQ, the station called, or the sender of a multi-station message.
    /// Callsigns carry their /P.
    pub call1: String,
    /// The sending station of a call, REPORT+73 or 73.
    pub call2: String,
    /// /P flag of `call1`.
    pub portable1: bool,
    /// /P flag of `call2`.
    pub portable2: bool,
    /// The hash of `call1`: 24 bits (types 6, 10), 20 bits (type 7) or 16 bits (types 11,
    /// 12); 0 when not sent as a hash.
    pub hash1: u32,
    /// The hash of `call2`; unused by the 16 types, kept as the reference keeps it.
    pub hash2: u32,
    /// CQ modifier: `DX`, `POTA`, `040`.
    pub modifier: String,
    /// 4-character locator, or empty.
    pub locator: String,
    /// Report, dB (−26 to +5 on air).
    pub report: i32,
    /// Free text.
    pub text: String,
    /// Payload bits of a reserved type, MSB first.
    pub raw: Vec<u8>,
    /// Targets of a multi-station message: one or two.
    pub targets: Vec<Target>,
}

impl Message {
    /// An empty message of `kind`.
    pub fn new(kind: Kind) -> Message {
        Message {
            kind,
            call1: String::new(),
            call2: String::new(),
            portable1: false,
            portable2: false,
            hash1: 0,
            hash2: 0,
            modifier: String::new(),
            locator: String::new(),
            report: 0,
            text: String::new(),
            raw: Vec::new(),
            targets: Vec::new(),
        }
    }

    /// Reads operator text as the reference does: CQ, call, REPORT+73, 73 and the
    /// multi-station forms, else free text. The text must be upper case.
    pub fn parse(text: &str) -> Result<Message, PackError> {
        parse::parse(text).ok_or(PackError::Empty)
    }

    /// Callsigns the message carries in full, as sent (with /P), for a [`CallTable`].
    pub fn full_callsigns(&self) -> Vec<&str> {
        let both = [self.call1.as_str(), self.call2.as_str()];
        let calls: Vec<&str> = match self.kind {
            k if k.is_cq() => vec![self.call1.as_str()],
            Kind::CallStd | Kind::Report73 | Kind::Seventy3Std => both.to_vec(),
            Kind::CallStdSuf | Kind::CallNonstd | Kind::Seventy3Nonstd => vec![self.call2.as_str()],
            _ => Vec::new(),
        };
        calls
            .into_iter()
            .filter(|c| !c.is_empty() && !c.starts_with('<') && !matches!(*c, "DE" | "QRZ" | "CQ"))
            .collect()
    }

    /// Fills in the callsigns of hashes `table` knows, with the reference's precedence rules:
    /// a type 6 hash never names an unsuffixed standard callsign when the sender is one too
    /// (they would have sent type 5), and a type 10 hash never names a standard callsign when
    /// the sender is standard (type 9). Returns true when a hash resolved.
    pub fn resolve(&mut self, table: &CallTable) -> bool {
        let mut any = false;
        if self.hash1 != 0 && (self.call1.is_empty() || self.call1.starts_with('<')) {
            let sender = split_standard(&self.call2).filter(|_| !self.call2.is_empty());
            let found = match self.kind {
                Kind::MultiReport73 | Kind::Multi73 => table.resolve16(self.hash1),
                Kind::CallNonstd => table.resolve20(self.hash1),
                _ => table.resolve24(self.hash1),
            };
            let allowed = |call: &str| {
                !matches!(
                    (self.kind, &sender, split_standard(call)),
                    (Kind::CallStdSuf, Some((_, false)), Some((_, false)))
                        | (Kind::Seventy3Nonstd, Some(_), Some(_))
                )
            };
            if let Some(call) = found.filter(|c| allowed(c)) {
                self.call1 = call.to_string();
                any = true;
            }
        }
        if self.hash2 != 0
            && (self.call2.is_empty() || self.call2.starts_with('<'))
            && let Some(call) = table.resolve24(self.hash2)
        {
            self.call2 = call.to_string();
            any = true;
        }
        if matches!(self.kind, Kind::MultiReport73 | Kind::Multi73) {
            for t in &mut self.targets {
                if t.hash != 0
                    && (t.call.is_empty() || t.call.starts_with('<'))
                    && let Some(call) = table.resolve24(t.hash)
                {
                    t.call = call.to_string();
                    any = true;
                }
            }
        }
        any
    }

    /// The message text with unresolved hashes as `<...>`.
    pub fn render(&self) -> String {
        self.format(false)
    }

    fn format(&self, hex: bool) -> String {
        let hashed = |call: &str, hash: u32, digits: usize| -> String {
            if !call.is_empty() {
                if call.starts_with('<') {
                    call.to_string()
                } else {
                    format!("<{call}>")
                }
            } else if hash != 0 && hex {
                format!("<{hash:0digits$x}>")
            } else {
                "<...>".to_string()
            }
        };
        let c1 = with_suffix(&self.call1, self.portable1);
        let c2 = with_suffix(&self.call2, self.portable2);
        let rpt = format_report(self.report);
        let mut words: Vec<String> = Vec::new();
        match self.kind {
            Kind::CqStd | Kind::CqNonstd2 => {
                words.push("CQ".into());
                if !self.modifier.is_empty() {
                    words.push(self.modifier.clone());
                }
                words.push(c1);
                if self.kind == Kind::CqStd && !self.locator.is_empty() {
                    words.push(self.locator.clone());
                }
            }
            Kind::CqNonstd1 | Kind::CqNonstd3 => {
                words.push("CQ".into());
                words.push(c1);
                if self.kind == Kind::CqNonstd1 && !self.locator.is_empty() {
                    words.push(self.locator.clone());
                }
            }
            Kind::CallStd => {
                words.extend([c1, c2]);
                if !self.locator.is_empty() {
                    words.push(self.locator.clone());
                }
                words.push(rpt);
            }
            Kind::CallStdSuf => {
                words.extend([hashed(&self.call1, self.hash1, 6), c2]);
                if !self.locator.is_empty() {
                    words.push(self.locator.clone());
                }
                words.push(rpt);
            }
            Kind::CallNonstd => words.extend([hashed(&self.call1, self.hash1, 5), c2, rpt]),
            Kind::Report73 => words.extend([c1, c2, format!("R{rpt}")]),
            Kind::Seventy3Std => words.extend([c1, c2, "73".into()]),
            Kind::Seventy3Nonstd => words.extend([hashed(&self.call1, self.hash1, 6), c2, "73".into()]),
            Kind::MultiReport73 | Kind::Multi73 => {
                for t in &self.targets {
                    words.push(hashed(&t.call, t.hash, 6));
                    if self.kind == Kind::MultiReport73 {
                        words.push(format!("R{}", format_report(t.report)));
                    }
                }
                words.push(hashed(&self.call1, self.hash1, 4));
                if self.kind == Kind::Multi73 {
                    words.push("73".into());
                }
            }
            Kind::FreeText => return self.text.clone(),
            Kind::ReservedA | Kind::ReservedB | Kind::ReservedC => return "[RESERVED]".into(),
        }
        words.join(" ")
    }
}

impl fmt::Display for Message {
    /// The reference's text: unresolved hashes in hexadecimal (`<01a4f2>`).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.format(true))
    }
}

/// Why a message could not be packed.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum PackError {
    /// No text.
    #[error("empty message")]
    Empty,
    /// A callsign does not fit the field its type needs.
    #[error("callsign {0:?} does not fit an LQ8 message")]
    Callsign(String),
    /// A locator other than 4 characters AA00 to RR99.
    #[error("locator {0:?} is not a 4-character grid square")]
    Locator(String),
    /// A CQ modifier other than 000 to 999 or up to 4 characters of A to Z and 0 to 4.
    #[error("CQ modifier {0:?} does not fit")]
    Modifier(String),
    /// Free text longer than one message holds.
    #[error("free text holds {fits} of its {len} characters")]
    TooLong {
        /// Characters that fit.
        fits: usize,
        /// Characters in the text.
        len: usize,
    },
}

/// Why a payload does not unpack.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum UnpackError {
    /// A callsign, locator or modifier field holds a value outside its range.
    #[error("field out of range")]
    Field,
}

struct Writer {
    bytes: [u8; 10],
    pos: u32,
}

impl Writer {
    fn put(&mut self, value: u128, bits: u32) {
        for i in (0..bits).rev() {
            if self.pos < 77 && (value >> i) & 1 == 1 {
                self.bytes[(self.pos / 8) as usize] |= 0x80 >> (self.pos % 8);
            }
            self.pos += 1;
        }
    }
}

struct Reader<'a> {
    payload: &'a Payload,
    pos: usize,
}

impl Reader<'_> {
    fn take(&mut self, bits: u32) -> u128 {
        let mut v = 0u128;
        for _ in 0..bits {
            let bit = if self.pos < 77 {
                self.payload.bit(self.pos)
            } else {
                0
            };
            v = (v << 1) | u128::from(bit);
            self.pos += 1;
        }
        v
    }

    fn take32(&mut self, bits: u32) -> u32 {
        self.take(bits) as u32
    }
}

/// Reads the Huffman prefix. `None` only for a payload shorter than every prefix, which a
/// 77-bit payload never is: every 10-bit pattern starts with a prefix.
pub fn kind_of(payload: &Payload) -> Option<Kind> {
    let mut code = 0u32;
    for len in 1..=10 {
        code = (code << 1) | u32::from(payload.bit(len as usize - 1));
        if let Some(&k) = KINDS.iter().find(|k| k.prefix() == (code, len)) {
            return Some(k);
        }
    }
    None
}

/// True when the bits a type leaves unused are zero, as the specification requires of a
/// transmitter. The reference decoder does not check them; RR73's decoder does, for codewords
/// that reach it by ordered-statistics decoding.
pub fn padding_is_zero(payload: &Payload) -> bool {
    kind_of(payload).is_some_and(|k| (k.used_bits() as usize..77).all(|i| payload.bit(i) == 0))
}

fn base_or_raw(call: &str) -> (String, bool) {
    split_any(call).unwrap_or_else(|| (call.to_string(), false))
}

fn std_call(call: &str, portable: bool) -> Result<(u32, bool), PackError> {
    let (base, suf) = split_standard(call).ok_or_else(|| PackError::Callsign(call.into()))?;
    let v = pack28(&base).ok_or_else(|| PackError::Callsign(call.into()))?;
    Ok((v, suf || portable))
}

fn nonstd(call: &str, chars: usize) -> Result<u128, PackError> {
    pack_base38(call, chars).ok_or_else(|| PackError::Callsign(call.into()))
}

fn locator(loc: &str) -> Result<u32, PackError> {
    pack_locator(loc)
        .map(u32::from)
        .ok_or_else(|| PackError::Locator(loc.into()))
}

fn modifier(m: &str) -> Result<u32, PackError> {
    pack_modifier(m).ok_or_else(|| PackError::Modifier(m.into()))
}

fn target_hash(t: &Target) -> u32 {
    if t.hash != 0 {
        t.hash & 0xFF_FFFF
    } else if t.call.is_empty() {
        0
    } else {
        hash24(&t.call)
    }
}

/// Packs a message into its 77-bit payload, as the reference's `encode_message`, except
/// that free text that does not fit is refused (the reference cuts it short).
pub fn pack(m: &Message) -> Result<Payload, PackError> {
    let mut w = Writer {
        bytes: [0; 10],
        pos: 0,
    };
    let (code, len) = m.kind.prefix();
    w.put(u128::from(code), len);
    match m.kind {
        Kind::CallStd => {
            let c1 = pack28(&m.call1).ok_or_else(|| PackError::Callsign(m.call1.clone()))?;
            let c2 = pack28(&m.call2).ok_or_else(|| PackError::Callsign(m.call2.clone()))?;
            let loc = locator(&m.locator)?;
            w.put(c1.into(), 28);
            w.put(c2.into(), 28);
            w.put(loc.into(), 15);
            w.put(pack_report(m.report).into(), 5);
        }
        Kind::CallStdSuf => {
            let h1 = if m.hash1 != 0 {
                m.hash1 & 0xFF_FFFF
            } else {
                hash24(&m.call1)
            };
            let (c2, s2) = std_call(&m.call2, m.portable2)?;
            let loc = locator(&m.locator)?;
            w.put(h1.into(), 24);
            w.put(c2.into(), 28);
            w.put(u128::from(s2), 1);
            w.put(loc.into(), 15);
            w.put(pack_report(m.report).into(), 5);
        }
        Kind::CallNonstd => {
            // A named target hashes in 20 bits from its callsign. The reference takes a 24-bit
            // value of 2^20 or more and drops its low 4 bits, which is the same for hexadecimal
            // input; for a named target it keeps a 24-bit hash below 2^20 whole
            // (docs/design/lq8.md, Open risks).
            let h1 = if !m.call1.is_empty() && !m.call1.starts_with('<') {
                hash20(&m.call1)
            } else if m.hash1 > 0xF_FFFF {
                (m.hash1 >> 4) & 0xF_FFFF
            } else {
                m.hash1
            };
            let (base, suf) = base_or_raw(&m.call2);
            w.put(h1.into(), 20);
            w.put(nonstd(&base, 9)?, 48);
            w.put(u128::from(suf || m.portable2), 1);
            w.put(pack_report(m.report).into(), 5);
        }
        Kind::Seventy3Nonstd => {
            let h1 = if m.hash1 != 0 {
                m.hash1 & 0xFF_FFFF
            } else {
                hash24(&m.call1)
            };
            let (base, suf) = base_or_raw(&m.call2);
            w.put(h1.into(), 24);
            w.put(nonstd(&base, 9)?, 48);
            w.put(u128::from(suf || m.portable2), 1);
        }
        Kind::MultiReport73 | Kind::Multi73 => {
            let dx = if m.hash1 != 0 {
                m.hash1 & 0xFFFF
            } else if m.call1.is_empty() {
                0
            } else {
                hash16(&m.call1)
            };
            w.put(dx.into(), 16);
            let first = m.targets.first().cloned().unwrap_or_else(|| Target {
                call: m.call2.clone(),
                hash: m.hash2,
                report: m.report,
            });
            let second = m.targets.get(1).cloned().unwrap_or_else(|| first.clone());
            for t in [&first, &second] {
                w.put(target_hash(t).into(), 24);
                if m.kind == Kind::MultiReport73 {
                    w.put(pack_report(t.report).into(), 5);
                }
            }
        }
        Kind::FreeText => {
            let (bits, written) = varicode::encode(&m.text);
            let len = varicode::length(&m.text);
            if written < len {
                return Err(PackError::TooLong { fits: written, len });
            }
            w.put(bits, varicode::BITS);
        }
        Kind::ReservedA | Kind::ReservedB | Kind::ReservedC => {
            let n = 77 - len;
            for i in 0..n as usize {
                let bit = m.raw.get(i / 8).map_or(0, |b| (b >> (7 - i % 8)) & 1);
                w.put(bit.into(), 1);
            }
        }
        Kind::CqNonstd3 => {
            let (base, suf) = base_or_raw(&m.call1);
            w.put(nonstd(&base, 13)?, 69);
            w.put(u128::from(suf || m.portable1), 1);
        }
        Kind::CqNonstd2 => {
            let (base, suf) = base_or_raw(&m.call1);
            w.put(nonstd(&base, 9)?, 48);
            w.put(u128::from(suf || m.portable1), 1);
            w.put(modifier(&m.modifier)?.into(), 20);
        }
        Kind::CqStd => {
            let (c1, s1) = std_call(&m.call1, m.portable1)?;
            let md = modifier(&m.modifier)?;
            let loc = locator(&m.locator)?;
            w.put(c1.into(), 28);
            w.put(u128::from(s1), 1);
            w.put(md.into(), 20);
            w.put(loc.into(), 15);
        }
        Kind::CqNonstd1 => {
            let (base, suf) = base_or_raw(&m.call1);
            w.put(nonstd(&base, 9)?, 48);
            w.put(u128::from(suf || m.portable1), 1);
            w.put(locator(&m.locator)?.into(), 15);
        }
        Kind::Report73 | Kind::Seventy3Std => {
            let (c1, s1) = std_call(&m.call1, m.portable1)?;
            let (c2, s2) = std_call(&m.call2, m.portable2)?;
            w.put(c1.into(), 28);
            w.put(u128::from(s1), 1);
            w.put(c2.into(), 28);
            w.put(u128::from(s2), 1);
            if m.kind == Kind::Report73 {
                w.put(pack_report(m.report).into(), 5);
            }
        }
    }
    Ok(Payload(w.bytes))
}

/// Unpacks a 77-bit payload, as the reference's `decode_message`. Hashes stay unresolved;
/// [`Message::resolve`] fills them in.
pub fn unpack(payload: &Payload) -> Result<Message, UnpackError> {
    let kind = kind_of(payload).ok_or(UnpackError::Field)?;
    let mut r = Reader {
        payload,
        pos: kind.prefix().1 as usize,
    };
    let mut m = Message::new(kind);
    let std = |v: u32| unpack28(v).ok_or(UnpackError::Field);
    let loc = |v: u32| unpack_locator(v as u16).ok_or(UnpackError::Field);
    let b38 = |v: u128, n| unpack_base38(v, n).ok_or(UnpackError::Field);
    let md = |v: u32| unpack_modifier(v).ok_or(UnpackError::Field);
    match kind {
        Kind::CallStd => {
            m.call1 = std(r.take32(28))?;
            m.call2 = std(r.take32(28))?;
            m.locator = loc(r.take32(15))?;
            m.report = unpack_report(r.take32(5));
        }
        Kind::CallStdSuf => {
            m.hash1 = r.take32(24);
            let c2 = std(r.take32(28))?;
            m.portable2 = r.take32(1) == 1;
            m.call2 = with_suffix(&c2, m.portable2);
            m.locator = loc(r.take32(15))?;
            m.report = unpack_report(r.take32(5));
        }
        Kind::FreeText => m.text = varicode::decode(r.take(varicode::BITS)),
        Kind::CallNonstd => {
            m.hash1 = r.take32(20);
            let c2 = b38(r.take(48), 9)?;
            m.portable2 = r.take32(1) == 1;
            m.call2 = with_suffix(&c2, m.portable2);
            m.report = unpack_report(r.take32(5));
        }
        Kind::Seventy3Nonstd => {
            m.hash1 = r.take32(24);
            let c2 = b38(r.take(48), 9)?;
            m.portable2 = r.take32(1) == 1;
            m.call2 = with_suffix(&c2, m.portable2);
        }
        Kind::MultiReport73 | Kind::Multi73 => {
            m.hash1 = r.take32(16);
            let read = |r: &mut Reader| {
                let hash = r.take32(24);
                let report = if kind == Kind::MultiReport73 {
                    unpack_report(r.take32(5))
                } else {
                    0
                };
                Target {
                    call: String::new(),
                    hash,
                    report,
                }
            };
            let t1 = read(&mut r);
            let t2 = read(&mut r);
            // A single target goes twice; a second target of hash 0 is none.
            let same = t2.hash == t1.hash && t2.report == t1.report;
            m.targets.push(t1);
            if t2.hash != 0 && !same {
                m.targets.push(t2);
            }
        }
        Kind::ReservedA | Kind::ReservedB | Kind::ReservedC => {
            let n = 77 - kind.prefix().1;
            let mut raw = vec![0u8; 10];
            for i in 0..n as usize {
                raw[i / 8] |= (r.take32(1) as u8) << (7 - i % 8);
            }
            m.raw = raw;
        }
        Kind::CqNonstd3 => {
            let c1 = b38(r.take(69), 13)?;
            m.portable1 = r.take32(1) == 1;
            m.call1 = with_suffix(&c1, m.portable1);
        }
        Kind::CqNonstd2 => {
            let c1 = b38(r.take(48), 9)?;
            m.portable1 = r.take32(1) == 1;
            m.call1 = with_suffix(&c1, m.portable1);
            m.modifier = md(r.take32(20))?;
        }
        Kind::CqStd => {
            let c1 = r.take32(28);
            m.portable1 = r.take32(1) == 1;
            let modifier = r.take32(20);
            let locator = r.take32(15);
            m.call1 = with_suffix(&std(c1)?, m.portable1);
            m.modifier = md(modifier)?;
            m.locator = loc(locator)?;
        }
        Kind::CqNonstd1 => {
            let c1 = b38(r.take(48), 9)?;
            m.portable1 = r.take32(1) == 1;
            m.call1 = with_suffix(&c1, m.portable1);
            m.locator = loc(r.take32(15))?;
        }
        Kind::Report73 | Kind::Seventy3Std => {
            let c1 = r.take32(28);
            m.portable1 = r.take32(1) == 1;
            let c2 = r.take32(28);
            m.portable2 = r.take32(1) == 1;
            m.call1 = with_suffix(&std(c1)?, m.portable1);
            m.call2 = with_suffix(&std(c2)?, m.portable2);
            if kind == Kind::Report73 {
                m.report = unpack_report(r.take32(5));
            }
        }
    }
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(text: &str) -> String {
        let m = Message::parse(text).expect(text);
        let p = pack(&m).expect(text);
        let mut back = unpack(&p).expect(text);
        let mut table = CallTable::new();
        table.set_active(&["9V1NE", "AB4SS", "9V1DE", "OE3OGC"]);
        back.resolve(&table);
        back.render()
    }

    #[test]
    fn the_prefixes_form_a_complete_prefix_code() {
        let kraft: f64 = KINDS.iter().map(|k| 0.5f64.powi(k.prefix().1 as i32)).sum();
        assert!((kraft - 1.0).abs() < 1e-12);
        for (i, a) in KINDS.iter().enumerate() {
            assert_eq!(a.id() as usize, i + 1);
            for b in &KINDS[i + 1..] {
                let ((ca, la), (cb, lb)) = (a.prefix(), b.prefix());
                let (short, long) = if la <= lb {
                    ((ca, la), (cb, lb))
                } else {
                    ((cb, lb), (ca, la))
                };
                assert_ne!(long.0 >> (long.1 - short.1), short.0, "{a:?} {b:?}");
            }
        }
    }

    #[test]
    fn the_four_message_qso_round_trips() {
        for text in [
            "CQ AB4SS FN42",
            "AB4SS 9V1NE OJ11 -03",
            "9V1NE AB4SS R+05",
            "AB4SS 9V1NE 73",
        ] {
            assert_eq!(round_trip(text), text);
        }
        assert_eq!(
            Message::parse("AB4SS 9V1NE OJ11 -03").map(|m| m.kind),
            Ok(Kind::CallStd)
        );
        assert_eq!(
            Message::parse("9V1NE AB4SS R+05").map(|m| m.kind),
            Ok(Kind::Report73)
        );
    }

    #[test]
    fn hashed_and_compound_forms_resolve_from_the_table() {
        assert_eq!(round_trip("AB4SS 9V1NE/P OJ11 -03"), "<AB4SS> 9V1NE/P OJ11 -03");
        assert_eq!(round_trip("AB4SS VP8/9V1NE OJ11 -07"), "<AB4SS> VP8/9V1NE -07");
        assert_eq!(
            round_trip("<9V1NE> R+05 <OE3OGC> R-03 <AB4SS>"),
            "<9V1NE> R+05 <OE3OGC> R-03 <AB4SS>"
        );
        assert_eq!(
            round_trip("<9V1NE> <OE3OGC> <AB4SS> 73"),
            "<9V1NE> <OE3OGC> <AB4SS> 73"
        );
        assert_eq!(round_trip("AB4SS VP8/9V1NE 73"), "<AB4SS> VP8/9V1NE 73");
        // Unknown hashes show as <...>, and in hexadecimal in the reference's text.
        let m = unpack(&pack(&Message::parse("K1ABC VP8/9V1NE 73").expect("parse")).expect("pack"))
            .expect("unpack");
        assert_eq!(m.render(), "<...> VP8/9V1NE 73");
        assert_eq!(m.to_string(), format!("<{:06x}> VP8/9V1NE 73", hash24("K1ABC")));
    }

    #[test]
    fn hashes_follow_the_canonical_precedence_rules() {
        let mut table = CallTable::new();
        table.insert("9V1NE");
        let mut m = Message::new(Kind::CallStdSuf);
        m.hash1 = hash24("9V1NE");
        m.call2 = "AB4SS".into();
        // Two standard callsigns without /P would have sent type 5.
        assert!(!m.clone().resolve(&table));
        m.call2 = "AB4SS/P".into();
        assert!(m.resolve(&table));
        assert_eq!(m.call1, "9V1NE");
        let mut m = Message::new(Kind::Seventy3Nonstd);
        m.hash1 = hash24("9V1NE");
        m.call2 = "AB4SS".into();
        assert!(!m.clone().resolve(&table));
        m.call2 = "VP8/AB4SS".into();
        assert!(m.resolve(&table));
    }

    #[test]
    fn a_named_type_7_target_hashes_in_20_bits() {
        // W1AW's CRC-24 is below 2^20, where the reference keeps all 24 bits.
        assert!(hash24("W1AW") < 1 << 20);
        let m = Message::parse("W1AW VP8/9V1NE -03").expect("parse");
        assert_eq!(m.kind, Kind::CallNonstd);
        let back = unpack(&pack(&m).expect("pack")).expect("unpack");
        assert_eq!(back.hash1, hash20("W1AW"));
    }

    #[test]
    fn free_text_that_does_not_fit_is_refused() {
        let m = Message::parse("TNX FER QSO ES 73 GL DE").expect("parse");
        assert_eq!(m.kind, Kind::FreeText);
        assert!(matches!(pack(&m), Err(PackError::TooLong { .. })));
        assert_eq!(round_trip("TNX FER QSO"), "TNX FER QSO");
        // Four words ending in 73 are MULTI-73, as the reference reads them.
        assert_eq!(
            Message::parse("TNX FER QSO 73").map(|m| m.kind),
            Ok(Kind::Multi73)
        );
    }

    #[test]
    fn padding_bits_are_checked() {
        let p = pack(&Message::parse("AB4SS 9V1NE 73").expect("parse")).expect("pack");
        assert!(padding_is_zero(&p));
        let mut bad = p;
        bad.0[9] |= 0x08;
        assert!(!padding_is_zero(&bad));
        assert!(unpack(&bad).is_ok());
    }
}
