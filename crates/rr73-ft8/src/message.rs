//! FT8 and FT4 messages: the operator-facing model, text parsing and 77-bit packing.
//!
//! Every message is 77 bits. The last 3 bits, i3, select the type; type 0 has subtypes in
//! the 3 bits before it, n3 (QEX, section 2 and Table 1):
//!
//! | i3.n3 | Variant | Example | Fields |
//! | --- | --- | --- | --- |
//! | 0.0 | [`Message::FreeText`] | `TNX BOB 73 GL` | f71 |
//! | 0.1 | [`Message::Dxpedition`] | `K1ABC RR73; W9XYZ <KH1/KH7Z> -08` | c28 c28 h10 r5 |
//! | 0.3, 0.4 | [`Message::FieldDay`] | `W9XYZ K1ABC R 17B EMA` | c28 c28 R1 n4 k3 S7 |
//! | 0.5 | [`Message::Telemetry`] | `123456789ABCDEF012` | t71 |
//! | 1, 2 | [`Message::Standard`] | `K1ABC/R W9XYZ/R R EN37`, `G4ABC/P PA9XYZ JO22` | c28 r1 c28 r1 R1 g15 |
//! | 3 | [`Message::RttyRoundup`] | `TU; W9XYZ K1ABC R 579 MA` | t1 c28 c28 R1 r3 s13 |
//! | 4 | [`Message::NonStandard`], [`Message::NonStandardCq`] | `<W9XYZ> PJ4/K1ABC RRR` | h12 c58 h1 r2 c1 |
//! | 5 | [`Message::EuVhf`] | `<G4ABC> <PA9XYZ> R 570007 JO22DB` | h12 h22 R1 r3 s11 g25 |
//!
//! Types 0.2, 0.6, 0.7, 6 and 7 are reserved; [`unpack`] rejects them. WSJT-X 2.7.0-rc3 shows
//! type 0.6 as a WSPR-style `CALL GRID dBm` message; rr73-ft8 does not decode it (Unverified
//! layout: its variants with compound callsigns are not known).
//!
//! # WSJT-X
//!
//! The codec follows WSJT-X 2.7.0-rc3 where QEX and WSJT-X differ, because WSJT-X sets what
//! other stations send and display. `fixtures/ft8/wsjtx.json` (ft8sim) and
//! `fixtures/ft8/wsjtx_decodes.json` (jt9 decoding rr73-ft8 signals) pin each case:
//!
//! - Reports run from −50 to +50 dB (QEX: −30 to +99); see [`Report`].
//! - Field Day sections are numbered from 1 and use WSJT-X's current list (QEX: from 0, an
//!   older list); classes run from A to H (QEX: A to F); see [`ArrlSection`].
//! - RR73 is sent as the locator RR73, and `R RR73` sets R1 with it.
//! - CQ carries only a locator, RR73 or nothing, from a callsign sent in full.
//! - Telemetry is shown without leading zeros, and any single word of 1 to 18 hexadecimal
//!   digits other than `DE` is telemetry.
//! - Standard callsigns have no 3DA0 or 3X prefix substitution.
//! - RTTY Roundup serial numbers run from 1 to 7999.
//!
//! Where WSJT-X changes what the operator typed, [`Message::parse`] returns an error or keeps
//! the text: WSJT-X truncates long free text to 13 characters, rounds odd DXpedition reports,
//! wraps reports above +50, clamps serial numbers, drops a compound prefix or suffix from an
//! unbracketed callsign (`PJ4/K1ABC W9XYZ -05` becomes `K1ABC W9XYZ -05`), drops R before RRR,
//! 73 or a separate report word, and drops the report from `R2RFE/P <EA8/G5LSI> R+12`. WSJT-X
//! also refuses hashed callsigns in DXpedition, Field Day and RTTY Roundup messages, which its
//! jt9 decodes; rr73-ft8 packs them.
//!
//! # Callsigns
//!
//! Standard callsigns travel in full in the 28-bit field c28. Any callsign can travel as a
//! hash of 10, 12 or 22 bits (QEX, Appendix A); text shows a hashed callsign in angle
//! brackets, `<PJ4/K1ABC>` when [`CallsignHashes`] knows it and `<...>` when it does not.
//! Message type 4 carries one callsign of up to 11 characters in full.
//!
//! # Text
//!
//! [`Message::parse`] reads text the way WSJT-X operators type it: any case, any spacing,
//! brackets optional. A callsign that a field cannot carry in full is sent as a hash, so
//! `PJ4/K1ABC W9XYZ -05` becomes `<PJ4/K1ABC> W9XYZ -05`. With RRR, RR73, 73 or no last
//! word, a nonstandard callsign without brackets selects type 4, which carries it in full:
//! `W9XYZ PJ4/K1ABC RRR` becomes `<W9XYZ> PJ4/K1ABC RRR`. Text that fits no other type is
//! sent as free text with runs of spaces reduced to one. `Display` writes the canonical text,
//! which parses back to the same message with these exceptions: messages with an unknown
//! hash (`<...>`); type 4 messages whose full callsign is a standard one (their text parses
//! as type 1); free text with runs of spaces; and free text shaped like another message, such
//! as `K1ABC W9XYZ` or `CAFE` (telemetry).
//!
//! # Packing
//!
//! [`pack`] and [`unpack`] are exact inverses: `unpack(pack(m)) == m` for every message that
//! packs, given the hash table that `pack` updated, and `pack(unpack(p)) == p` for every
//! payload that unpacks, except for the forms below. `unpack` accepts them, showing what
//! WSJT-X 2.7.0-rc3 shows, and `pack` writes the canonical form given in brackets.
//!
//! - RR73 as g15 value 32 403, the value in the public protocol description and ft8_lib
//!   (32 373, the locator RR73, as WSJT-X and all 66 RR73 messages in
//!   `fixtures/ft8/onair.json` send it).
//! - R before a blank, RRR or 73, which WSJT-X ignores (R1 clear).
//! - Report codes 106 to 186, which WSJT-X reads as −30 to +50 (codes 5 to 85).
//! - Free text padded on the right, as ft8_lib sends it (right-justified in 13 characters).
//! - A type 4 callsign padded on the right, as one station in the recordings sends it
//!   (right-justified in 11 characters, as WSJT-X, ft8_lib and all other stations send it).
//! - A type 4 CQ whose h12 field is not the 12-bit hash of its callsign, such as ft8_lib's
//!   zero (the hash, as WSJT-X sends it; QEX says receivers ignore h12 in a CQ).
//! - Type 2 without a /P flag (type 1).
//! - Nonzero bits 77 to 79 (zero).
//!
//! `unpack` rejects what WSJT-X 2.7.0-rc3 shows no text for, and values no encoder produces:
//! unused token values, a /R or /P flag on a word or hash, CQ with anything but a locator, RR73
//! (as 32 373) or nothing, R before RR73 sent as 32 403, RTTY Roundup serial number 0, a type
//! 4 CQ with a reply or the h1 flag, and values beyond the end of each table. It also rejects
//! two forms WSJT-X shows: report codes from 187 (reports above +50, which no encoder sends)
//! and CQ, QRZ or DE as the second callsign, which the model has no place for.

mod bits;
mod callsign;
mod codec;
mod fields;
mod parse;

pub(crate) use callsign::alphabet38_index as callsign_alphabet_index;
pub use callsign::{Addressee, Callsign, CqModifier, HashedCallsign, Station, Suffix};
pub use fields::{
    ArrlSection, Exchange, FieldDayClass, FreeText, Grid, Grid6, Reply, Report, RoundupExchange,
    SignalStrength, StateProvince, Telemetry,
};

use crate::{CallsignHashes, Payload};
use std::fmt;

/// A message in one of the 77-bit formats (i3.n3 types).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Message {
    /// Type 0.0: up to 13 characters of free text. `TNX BOB 73 GL`.
    FreeText {
        /// The text.
        text: FreeText,
    },
    /// Type 0.1: a DXpedition (Fox) message that completes one QSO and sends a report to the
    /// next station. `K1ABC RR73; W9XYZ <KH1/KH7Z> -08`.
    Dxpedition {
        /// The station whose QSO is complete (receives RR73).
        rr73_to: Station,
        /// The next station (receives the report).
        report_to: Station,
        /// The DXpedition's callsign, sent as a 10-bit hash.
        fox: HashedCallsign,
        /// The report: even, −30 to +32 dB.
        report: Report,
    },
    /// Types 0.3 and 0.4: ARRL Field Day exchange. `W9XYZ K1ABC R 17B EMA`.
    FieldDay {
        /// The station called.
        to: Station,
        /// The sending station.
        de: Station,
        /// Acknowledgement R.
        ack: bool,
        /// Number of transmitters, 1 to 32 (type 0.3 carries 1 to 16, type 0.4 17 to 32).
        transmitters: u8,
        /// Class A to F.
        class: FieldDayClass,
        /// ARRL or RAC section.
        section: ArrlSection,
    },
    /// Type 0.5: 71 bits of telemetry, shown as 18 hexadecimal digits.
    Telemetry {
        /// The data.
        data: Telemetry,
    },
    /// Types 1 and 2: the standard QSO message. Type 2 is used when a callsign carries /P.
    /// `CQ K1ABC FN42`, `K1ABC W9XYZ R-15`, `G4ABC/P PA9XYZ JO22`.
    Standard {
        /// The first word: a station, CQ (with an optional modifier), QRZ or DE.
        to: Addressee,
        /// The sending station.
        de: Station,
        /// The last word: locator, report, RRR, RR73, 73 or none.
        exchange: Exchange,
    },
    /// Type 3: RTTY Roundup and FT Roundup exchange. `TU; W9XYZ K1ABC R 579 MA`.
    RttyRoundup {
        /// `TU;` before the message.
        tu: bool,
        /// The station called.
        to: Station,
        /// The sending station.
        de: Station,
        /// Acknowledgement R.
        ack: bool,
        /// The report, shown as 529 to 599.
        report: SignalStrength,
        /// Serial number or state or province.
        exchange: RoundupExchange,
    },
    /// Type 4 with c1 set: CQ from a nonstandard callsign. `CQ PJ4/K1ABC`.
    NonStandardCq {
        /// The calling station, up to 11 characters.
        call: Callsign,
    },
    /// Type 4: one callsign of up to 11 characters in full and the other as a 12-bit hash.
    /// `<W9XYZ> PJ4/K1ABC RRR`, `PJ4/K1ABC <W9XYZ> 73`.
    NonStandard {
        /// The callsign sent in full.
        call: Callsign,
        /// The other callsign, sent as a 12-bit hash.
        hashed: HashedCallsign,
        /// True when the hashed callsign comes second (h1).
        hashed_second: bool,
        /// RRR, RR73, 73 or none.
        reply: Option<Reply>,
    },
    /// Type 5: EU VHF contest exchange. `<G4ABC> <PA9XYZ> R 570007 JO22DB`.
    EuVhf {
        /// The station called, sent as a 12-bit hash.
        to: HashedCallsign,
        /// The sending station, sent as a 22-bit hash.
        de: HashedCallsign,
        /// Acknowledgement R.
        ack: bool,
        /// The report, shown as 52 to 59.
        report: SignalStrength,
        /// Serial number, 0 to 2047, shown with 4 digits.
        serial: u16,
        /// 6-character locator.
        grid: Grid6,
    },
}

/// Errors from [`Message::parse`], [`pack`] and the field constructors.
#[derive(Debug, thiserror::Error, Clone, PartialEq, Eq)]
pub enum PackError {
    /// The text does not fit any message format.
    #[error("text does not fit any FT8 message format: {0}")]
    Unsupported(String),
    /// The text is empty.
    #[error("the message is empty")]
    Empty,
    /// A word in a callsign position is not a callsign.
    #[error("{0} is not a callsign")]
    InvalidCallsign(String),
    /// A callsign written `<...>`: its hash is unknown, so it cannot be sent.
    #[error("<...> stands for an unknown callsign and cannot be sent")]
    UnresolvedHash,
    /// A callsign sent in full in a 28-bit field must be a standard callsign.
    #[error("{0} is not a standard callsign; send it as a hash, written <{0}>")]
    NotStandardCallsign(Callsign),
    /// A nonstandard callsign after CQ, QRZ or DE with a modifier, locator or report. Only
    /// `CQ CALL` carries such a callsign in full.
    #[error("{0} is not a standard callsign: only \"CQ {0}\" carries it in full")]
    NonStandardCq(Callsign),
    /// /R and /P in one message: type 1 carries /R, type 2 carries /P.
    #[error("a message cannot carry both /R and /P")]
    MixedSuffixes,
    /// An unknown hash in a field of a different width.
    #[error("a {hash_bits}-bit hash cannot fill a {field_bits}-bit field")]
    HashWidth {
        /// Width of the field in bits.
        field_bits: u32,
        /// Width of the hash in bits.
        hash_bits: u32,
    },
    /// Not a CQ modifier: three digits or one to four letters.
    #[error("{0} is not a CQ modifier: use three digits or one to four letters")]
    InvalidCqModifier(String),
    /// Not a 4-character (or 6-character) locator, or the locator RR73.
    #[error("{0} is not a locator FT8 can send")]
    InvalidGrid(String),
    /// A report outside −50 to +50 dB.
    #[error("report {0} dB is outside -50 to +50 dB")]
    ReportOutOfRange(i32),
    /// CQ with something other than a locator, RR73 or nothing after the callsign.
    #[error("{0} cannot follow CQ: CQ carries a locator, RR73 or nothing")]
    CqExchange(Exchange),
    /// CQ from a hashed callsign. A nonstandard callsign calls CQ as `CQ PJ4/K1ABC`.
    #[error("CQ cannot carry a hashed callsign; send CQ with the callsign in full")]
    HashedCq,
    /// A DXpedition report that is odd or above +32 dB.
    #[error("DXpedition report {0} dB must be even, from -30 to +32 dB")]
    DxpeditionReport(i8),
    /// A contest report digit outside 2 to 9.
    #[error("report digit {0} is outside 2 to 9")]
    InvalidStrength(u8),
    /// Field Day transmitters outside 1 to 32.
    #[error("{0} transmitters is outside 1 to 32")]
    Transmitters(u8),
    /// A Field Day class other than A to H.
    #[error("Field Day class {0} is not A to H")]
    InvalidFieldDayClass(char),
    /// An ARRL or RAC section not in the list.
    #[error("{0} is not an ARRL or RAC section")]
    UnknownSection(String),
    /// A state or province abbreviation not in the list.
    #[error("{0} is not a US state or Canadian province")]
    UnknownStateProvince(String),
    /// A serial number outside the field's range.
    #[error("serial number {serial} is outside {min} to {max}")]
    SerialOutOfRange {
        /// The serial number.
        serial: u16,
        /// Lowest serial number of the field.
        min: u16,
        /// Highest serial number of the field.
        max: u16,
    },
    /// Free text longer than 13 characters.
    #[error("free text has {0} characters; the limit is 13")]
    FreeTextTooLong(usize),
    /// A character free text cannot carry.
    #[error("free text cannot carry '{0}': use A-Z, 0-9, space and + - . / ?")]
    FreeTextCharacter(char),
    /// Free text that is empty or starts or ends with a space.
    #[error("free text \"{0}\" is empty or starts or ends with a space")]
    InvalidFreeText(String),
    /// Telemetry that is not 1 to 18 hexadecimal digits.
    #[error("{0} is not 1 to 18 hexadecimal digits")]
    InvalidTelemetry(String),
    /// Telemetry of more than 71 bits: 18 digits must start with 0 to 7.
    #[error("telemetry exceeds 71 bits: with 18 digits the first must be 0 to 7")]
    TelemetryTooLarge,
}

/// A payload field that [`unpack`] rejects.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Field {
    /// A callsign field: an unused token value, a malformed callsign, or CQ, QRZ or DE where
    /// a station is required.
    Callsign,
    /// A /R or /P flag on CQ, QRZ, DE or a hash.
    SuffixFlag,
    /// The g15 field: value 32 400 or a value above the reports.
    Grid,
    /// A report outside its range.
    Report,
    /// R before RR73 sent as g15 value 32 403.
    Acknowledgement,
    /// CQ with a report, R, RRR, 73 or RR73 sent as 32 403, or from a hashed callsign; or a
    /// type 4 CQ with a reply or the h1 flag.
    Cq,
    /// Free text of 42^13 or more, or only spaces.
    FreeText,
    /// ARRL section code 0 or above 86.
    Section,
    /// RTTY Roundup exchange 0, 8000 or above 8065.
    RoundupExchange,
    /// 6-character locator code beyond RR99XX.
    Grid6,
}

impl fmt::Display for Field {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Field::Callsign => "callsign",
            Field::SuffixFlag => "suffix flag",
            Field::Grid => "locator",
            Field::Report => "report",
            Field::Acknowledgement => "acknowledgement",
            Field::FreeText => "free text",
            Field::Section => "section",
            Field::RoundupExchange => "Roundup exchange",
            Field::Grid6 => "6-character locator",
            Field::Cq => "CQ",
        })
    }
}

/// Errors from [`unpack`].
#[derive(Debug, thiserror::Error, Clone, Copy, PartialEq, Eq)]
pub enum UnpackError {
    /// The i3.n3 type is reserved or invalid.
    #[error("invalid message type {i3}.{n3}")]
    InvalidType {
        /// i3 field.
        i3: u8,
        /// n3 field (bits 71 to 73, meaningful only when i3 is 0).
        n3: u8,
    },
    /// A field holds a value outside its legal range.
    #[error("invalid {0} field")]
    InvalidField(Field),
}

impl Message {
    /// Parses operator text such as `CQ 9V1NE OJ11` or `JA1KXM 9V1NE R-14`.
    ///
    /// Every message returned packs without error. See the module documentation for the
    /// rules.
    pub fn parse(text: &str) -> Result<Message, PackError> {
        parse::parse(text)
    }

    /// The i3 and n3 fields this message packs to (n3 is 0 unless i3 is 0).
    pub fn i3_n3(&self) -> (u8, u8) {
        match self {
            Message::FreeText { .. } => (0, 0),
            Message::Dxpedition { .. } => (0, 1),
            Message::FieldDay { transmitters, .. } => (0, if *transmitters > 16 { 4 } else { 3 }),
            Message::Telemetry { .. } => (0, 5),
            Message::Standard { to, de, .. } => {
                let portable = |s: &Station| match s {
                    Station::Call(c) => c.split_suffix().1 == Some(Suffix::Portable),
                    Station::Hashed(_) => false,
                };
                let to_portable = matches!(to, Addressee::Station(s) if portable(s));
                (if to_portable || portable(de) { 2 } else { 1 }, 0)
            }
            Message::RttyRoundup { .. } => (3, 0),
            Message::NonStandardCq { .. } | Message::NonStandard { .. } => (4, 0),
            Message::EuVhf { .. } => (5, 0),
        }
    }

    /// Callsigns this message carries in full.
    pub(crate) fn full_callsigns(&self) -> [Option<Callsign>; 2] {
        let call = |s: &Station| match s {
            Station::Call(c) => Some(*c),
            Station::Hashed(_) => None,
        };
        match self {
            Message::Dxpedition {
                rr73_to, report_to, ..
            } => [call(rr73_to), call(report_to)],
            Message::FieldDay { to, de, .. } | Message::RttyRoundup { to, de, .. } => [call(to), call(de)],
            Message::Standard { to, de, .. } => {
                let to = match to {
                    Addressee::Station(s) => call(s),
                    _ => None,
                };
                [to, call(de)]
            }
            Message::NonStandardCq { call } | Message::NonStandard { call, .. } => [Some(*call), None],
            Message::FreeText { .. } | Message::Telemetry { .. } | Message::EuVhf { .. } => [None, None],
        }
    }

    /// Known callsigns this message carries as hashes, widest field first.
    pub(crate) fn hashed_callsigns(&self) -> [Option<Callsign>; 3] {
        let hashed = |s: &Station| match s {
            Station::Hashed(h) => h.callsign(),
            Station::Call(_) => None,
        };
        match self {
            Message::Dxpedition {
                rr73_to,
                report_to,
                fox,
                ..
            } => [hashed(rr73_to), hashed(report_to), fox.callsign()],
            Message::FieldDay { to, de, .. } | Message::RttyRoundup { to, de, .. } => {
                [hashed(to), hashed(de), None]
            }
            Message::Standard { to, de, .. } => {
                let to = match to {
                    Addressee::Station(s) => hashed(s),
                    _ => None,
                };
                [to, hashed(de), None]
            }
            Message::NonStandard { hashed, .. } => [hashed.callsign(), None, None],
            Message::EuVhf { to, de, .. } => [de.callsign(), to.callsign(), None],
            Message::FreeText { .. } | Message::Telemetry { .. } | Message::NonStandardCq { .. } => {
                [None, None, None]
            }
        }
    }
}

impl fmt::Display for Message {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let r = |ack: bool| if ack { "R " } else { "" };
        match self {
            Message::FreeText { text } => write!(f, "{text}"),
            Message::Dxpedition {
                rr73_to,
                report_to,
                fox,
                report,
            } => {
                write!(f, "{rr73_to} RR73; {report_to} {fox} {report}")
            }
            Message::FieldDay {
                to,
                de,
                ack,
                transmitters,
                class,
                section,
            } => {
                write!(
                    f,
                    "{to} {de} {}{transmitters}{} {section}",
                    r(*ack),
                    class.letter()
                )
            }
            Message::Telemetry { data } => write!(f, "{data}"),
            Message::Standard {
                to,
                de,
                exchange: Exchange::Blank,
            } => write!(f, "{to} {de}"),
            Message::Standard { to, de, exchange } => write!(f, "{to} {de} {exchange}"),
            Message::RttyRoundup {
                tu,
                to,
                de,
                ack,
                report,
                exchange,
            } => {
                let tu = if *tu { "TU; " } else { "" };
                write!(f, "{tu}{to} {de} {}{} {exchange}", r(*ack), report.rst())
            }
            Message::NonStandardCq { call } => write!(f, "CQ {call}"),
            Message::NonStandard {
                call,
                hashed,
                hashed_second,
                reply,
            } => {
                if *hashed_second {
                    write!(f, "{call} {hashed}")?;
                } else {
                    write!(f, "{hashed} {call}")?;
                }
                match reply {
                    Some(reply) => write!(f, " {reply}"),
                    None => Ok(()),
                }
            }
            Message::EuVhf {
                to,
                de,
                ack,
                report,
                serial,
                grid,
            } => {
                write!(f, "{to} {de} {}{}{serial:04} {grid}", r(*ack), report.rs())
            }
        }
    }
}

/// Packs a message into 77 bits, recording any full callsigns in `hashes`.
///
/// Records the callsigns the message carries in full and the known callsigns it carries as
/// hashes, so that [`unpack`] with the same table restores them.
pub fn pack(message: &Message, hashes: &mut CallsignHashes) -> Result<Payload, PackError> {
    let payload = codec::encode(message)?;
    hashes.learn(message);
    // Narrow hashes last, so a later lookup of a 10- or 12-bit hash finds this message's call.
    for call in message.hashed_callsigns().into_iter().flatten() {
        hashes.insert(&call);
    }
    Ok(payload)
}

/// Unpacks 77 bits into a message, resolving hashed callsigns from `hashes` where known.
///
/// The table is not updated; call [`CallsignHashes::learn`] with the result to record the
/// callsigns it carries in full.
pub fn unpack(payload: &Payload, hashes: &CallsignHashes) -> Result<Message, UnpackError> {
    codec::decode(payload, hashes)
}
