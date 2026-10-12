//! Field values of FT8 and FT4 messages, each checked when it is built.

use super::PackError;
use std::fmt;

/// ARRL and RAC sections in S7 code order; the first has code 1. This is the list WSJT-X
/// 2.7.0-rc3 packs (probed with ft8sim, fixtures/ft8/wsjtx.json): the list `arrl_rac_sections.txt`
/// of the public protocol description with GH, NS and TER in place of GTA, MAR and NT, and PE
/// and NB added. QEX, Appendix A gives codes 0 to 83; WSJT-X sends AB as 1.
pub(crate) const SECTIONS: [&str; 86] = [
    "AB", "AK", "AL", "AR", "AZ", "BC", "CO", "CT", "DE", "EB", "EMA", "ENY", "EPA", "EWA", "GA", "GH", "IA",
    "ID", "IL", "IN", "KS", "KY", "LA", "LAX", "NS", "MB", "MDC", "ME", "MI", "MN", "MO", "MS", "MT", "NC",
    "ND", "NE", "NFL", "NH", "NL", "NLI", "NM", "NNJ", "NNY", "TER", "NTX", "NV", "OH", "OK", "ONE", "ONN",
    "ONS", "OR", "ORG", "PAC", "PR", "QC", "RI", "SB", "SC", "SCV", "SD", "SDG", "SF", "SFL", "SJV", "SK",
    "SNJ", "STX", "SV", "TN", "UT", "VA", "VI", "VT", "WCF", "WI", "WMA", "WNY", "WPA", "WTX", "WV", "WWA",
    "WY", "DX", "PE", "NB",
];

/// US states and Canadian provinces in s13 code order, from 8001 (QEX, Appendix A; list
/// `states_provinces.txt` of the public protocol description).
pub(crate) const STATES: [&str; 65] = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
    "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND",
    "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "NB",
    "NS", "QC", "ON", "MB", "SK", "AB", "BC", "NWT", "NF", "LB", "NU", "YT", "PEI", "DC",
];

/// Characters of free text, in f71 code order (QEX, Appendix A).
pub(crate) const FREE_TEXT_ALPHABET: &[u8; 42] = b" 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-./?";

/// A 4-character Maidenhead locator such as `FN42`.
///
/// `RR73` is a valid locator but cannot be sent: FT8 reads it as the word RR73.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Grid([u8; 4]);

impl Grid {
    /// Number of 4-character locators: 18 × 18 × 10 × 10.
    pub(crate) const COUNT: u16 = 32_400;

    /// Checks a locator: field letters A–R, square digits 0–9. Lowercase input is accepted.
    pub fn new(text: &str) -> Result<Grid, PackError> {
        let b = text.as_bytes();
        let invalid = || PackError::InvalidGrid(text.to_string());
        if b.len() != 4 {
            return Err(invalid());
        }
        let up = [b[0].to_ascii_uppercase(), b[1].to_ascii_uppercase(), b[2], b[3]];
        let field = |c: u8| (b'A'..=b'R').contains(&c);
        if !(field(up[0]) && field(up[1]) && up[2].is_ascii_digit() && up[3].is_ascii_digit())
            || &up == b"RR73"
        {
            return Err(invalid());
        }
        Ok(Grid(up))
    }

    /// The locator text.
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0).unwrap_or_default()
    }

    /// Index 0 to 32 399 (QEX, program grid4_to_g15).
    pub(crate) fn index(&self) -> u16 {
        let g = self.0;
        (u16::from(g[0] - b'A') * 18 + u16::from(g[1] - b'A')) * 100
            + u16::from(g[2] - b'0') * 10
            + u16::from(g[3] - b'0')
    }

    /// Inverse of [`Grid::index`]. `None` for 32 400 and above and for `RR73`.
    pub(crate) fn from_index(n: u16) -> Option<Grid> {
        if n >= Self::COUNT {
            return None;
        }
        let g = [
            b'A' + (n / 1800) as u8,
            b'A' + (n / 100 % 18) as u8,
            b'0' + (n / 10 % 10) as u8,
            b'0' + (n % 10) as u8,
        ];
        (&g != b"RR73").then_some(Grid(g))
    }
}

impl fmt::Display for Grid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for Grid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Grid({})", self.as_str())
    }
}

/// A 6-character Maidenhead locator such as `JO22DB`, used in EU VHF contest messages.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Grid6([u8; 6]);

impl Grid6 {
    /// Number of 6-character locators: 18 × 18 × 10 × 10 × 24 × 24.
    pub(crate) const COUNT: u32 = 18_662_400;

    /// Checks a locator: field letters A–R, square digits, subsquare letters A–X. Lowercase
    /// input is accepted; the value is stored in uppercase.
    pub fn new(text: &str) -> Result<Grid6, PackError> {
        let b = text.as_bytes();
        let invalid = || PackError::InvalidGrid(text.to_string());
        if b.len() != 6 {
            return Err(invalid());
        }
        let mut g = [0u8; 6];
        for (dst, c) in g.iter_mut().zip(b) {
            *dst = c.to_ascii_uppercase();
        }
        let ok = (b'A'..=b'R').contains(&g[0])
            && (b'A'..=b'R').contains(&g[1])
            && g[2].is_ascii_digit()
            && g[3].is_ascii_digit()
            && (b'A'..=b'X').contains(&g[4])
            && (b'A'..=b'X').contains(&g[5]);
        if !ok {
            return Err(invalid());
        }
        Ok(Grid6(g))
    }

    /// The locator text.
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0).unwrap_or_default()
    }

    /// The 4-character locator that contains this one.
    pub fn square(&self) -> Grid {
        Grid([self.0[0], self.0[1], self.0[2], self.0[3]])
    }

    /// Index 0 to 18 662 399 (QEX, program grid6_to_g25).
    pub(crate) fn index(&self) -> u32 {
        let g = self.0;
        let mut n = u32::from(g[0] - b'A');
        n = n * 18 + u32::from(g[1] - b'A');
        n = n * 10 + u32::from(g[2] - b'0');
        n = n * 10 + u32::from(g[3] - b'0');
        n = n * 24 + u32::from(g[4] - b'A');
        n * 24 + u32::from(g[5] - b'A')
    }

    /// Inverse of [`Grid6::index`].
    pub(crate) fn from_index(mut n: u32) -> Option<Grid6> {
        if n >= Self::COUNT {
            return None;
        }
        let mut g = [0u8; 6];
        for (i, radix, base) in [
            (5, 24, b'A'),
            (4, 24, b'A'),
            (3, 10, b'0'),
            (2, 10, b'0'),
            (1, 18, b'A'),
            (0, 18, b'A'),
        ] {
            g[i] = base + (n % radix) as u8;
            n /= radix;
        }
        Some(Grid6(g))
    }
}

impl fmt::Display for Grid6 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for Grid6 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Grid6({})", self.as_str())
    }
}

/// A signal report in dB, −50 to +50, shown with a sign and two digits: `-15`, `+05`.
///
/// This is the range WSJT-X 2.7.0-rc3 packs. QEX, Appendix A gives −30 to +99; WSJT-X sends −30
/// to +50 as g15 codes 5 to 85 and −50 to −31 as codes 86 to 105, the codes QEX would use for
/// +51 to +70. DXpedition messages carry only even reports from −30 to +32.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Report(i8);

impl Report {
    /// Lowest report a message carries, in dB.
    pub const MIN_DB: i8 = -50;
    /// Highest report a message carries, in dB.
    pub const MAX_DB: i8 = 50;

    /// Checks a report in dB.
    pub fn new(db: i32) -> Result<Report, PackError> {
        if (i32::from(Self::MIN_DB)..=i32::from(Self::MAX_DB)).contains(&db) {
            Ok(Report(db as i8))
        } else {
            Err(PackError::ReportOutOfRange(db))
        }
    }

    /// The report in dB.
    pub fn db(&self) -> i8 {
        self.0
    }

    /// The report code in g15 above the locators (g15 − 32 400): `dB + 35` from −30 dB up,
    /// `dB + 136` below.
    pub(crate) fn code(&self) -> u16 {
        let db = i16::from(self.0);
        (if db >= -30 { db + 35 } else { db + 136 }) as u16
    }

    /// The report for a code from 5 up, and whether the code is the one [`Report::code`]
    /// writes. WSJT-X reads code `c` as `c − 35` up to 85 and as `c − 136` from 86, so codes
    /// 106 to 186 repeat −30 to +50; codes from 187 give reports above +50 and are rejected.
    pub(crate) fn from_code(code: u16) -> Option<(Report, bool)> {
        if code < 5 {
            return None;
        }
        let db = if code <= 85 {
            i32::from(code) - 35
        } else {
            i32::from(code) - 136
        };
        let report = Report::new(db).ok()?;
        Some((report, report.code() == code))
    }

    /// Parses `+05`, `-15` or `-5`: a sign and one or two digits.
    pub(crate) fn parse(text: &str) -> Option<Result<Report, PackError>> {
        let b = text.as_bytes();
        let negative = match b.first() {
            Some(b'-') => true,
            Some(b'+') => false,
            _ => return None,
        };
        let digits = &b[1..];
        if digits.is_empty() || digits.len() > 2 || !digits.iter().all(u8::is_ascii_digit) {
            return None;
        }
        let value = digits.iter().fold(0i32, |acc, d| acc * 10 + i32::from(d - b'0'));
        Some(Report::new(if negative { -value } else { value }))
    }
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:+03}", self.0)
    }
}

impl fmt::Debug for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Report({:+03})", self.0)
    }
}

/// Free text: 1 to 13 characters from A–Z, 0–9, space and `+ - . / ?`, without leading or
/// trailing spaces. Lowercase input is accepted and stored in uppercase.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct FreeText {
    bytes: [u8; FreeText::MAX_LEN],
    len: u8,
}

impl FreeText {
    /// Longest free text in characters.
    pub const MAX_LEN: usize = 13;

    /// Checks free text. Interior spaces are kept as given.
    pub fn new(text: &str) -> Result<FreeText, PackError> {
        let count = text.chars().count();
        if count == 0 || text.trim_matches(' ').len() != text.len() {
            return Err(PackError::InvalidFreeText(text.to_string()));
        }
        if count > Self::MAX_LEN {
            return Err(PackError::FreeTextTooLong(count));
        }
        let mut bytes = [0u8; Self::MAX_LEN];
        for (dst, c) in bytes.iter_mut().zip(text.chars()) {
            let up = c.to_ascii_uppercase();
            if !up.is_ascii() || !FREE_TEXT_ALPHABET.contains(&(up as u8)) {
                return Err(PackError::FreeTextCharacter(c));
            }
            *dst = up as u8;
        }
        Ok(FreeText {
            bytes,
            len: count as u8,
        })
    }

    /// The text.
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.bytes[..usize::from(self.len)]).unwrap_or_default()
    }

    /// f71 value: the text right-justified in 13 characters, base 42, as in the public
    /// description (QEX, program free_text_to_f71) and the free text in
    /// `fixtures/ft8/onair.json`. ft8_lib pads on the right.
    pub(crate) fn f71(&self) -> u128 {
        let pad = Self::MAX_LEN - usize::from(self.len);
        std::iter::repeat_n(0u128, pad)
            .chain(self.as_str().bytes().map(free_text_index))
            .fold(0u128, |acc, v| acc * 42 + v)
    }

    /// Decodes an f71 value, trimming spaces on both sides. `None` for values of 42^13 and
    /// above and for all-space text.
    pub(crate) fn from_f71(mut v: u128) -> Option<FreeText> {
        if v >= 42u128.pow(13) {
            return None;
        }
        let mut chars = [b' '; 13];
        for c in chars.iter_mut().rev() {
            *c = FREE_TEXT_ALPHABET[(v % 42) as usize];
            v /= 42;
        }
        let text = std::str::from_utf8(&chars).ok()?.trim_matches(' ');
        FreeText::new(text).ok()
    }
}

fn free_text_index(c: u8) -> u128 {
    FREE_TEXT_ALPHABET.iter().position(|&x| x == c).unwrap_or(0) as u128
}

impl fmt::Display for FreeText {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for FreeText {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "FreeText({:?})", self.as_str())
    }
}

/// Telemetry: 71 bits, shown as up to 18 hexadecimal digits without leading zeros, as WSJT-X
/// shows it. Zero is shown as `0` (WSJT-X shows nothing).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Telemetry(u128);

impl Telemetry {
    /// Number of telemetry bits.
    pub const BITS: u32 = 71;

    /// Checks a value below 2^71.
    pub fn new(value: u128) -> Result<Telemetry, PackError> {
        if value >> Self::BITS == 0 {
            Ok(Telemetry(value))
        } else {
            Err(PackError::TelemetryTooLarge)
        }
    }

    /// Parses 1 to 18 hexadecimal digits.
    pub fn from_hex(text: &str) -> Result<Telemetry, PackError> {
        if text.is_empty() || text.len() > 18 || !text.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(PackError::InvalidTelemetry(text.to_string()));
        }
        let value =
            u128::from_str_radix(text, 16).map_err(|_| PackError::InvalidTelemetry(text.to_string()))?;
        Telemetry::new(value)
    }

    /// The 71-bit value.
    pub fn value(&self) -> u128 {
        self.0
    }

    /// The low 71 bits of `value`.
    pub(crate) fn from_bits(value: u128) -> Telemetry {
        Telemetry(value & ((1 << Self::BITS) - 1))
    }
}

impl fmt::Display for Telemetry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:X}", self.0)
    }
}

impl fmt::Debug for Telemetry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Telemetry({self})")
    }
}

/// The middle digit of an RS or RST contest report, 2 to 9: shown as 529 to 599 in RTTY
/// Roundup messages and as 52 to 59 in EU VHF messages (field r3, QEX Appendix A).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SignalStrength(u8);

impl SignalStrength {
    /// Checks a strength digit from 2 to 9.
    pub fn new(digit: u8) -> Result<SignalStrength, PackError> {
        if (2..=9).contains(&digit) {
            Ok(SignalStrength(digit))
        } else {
            Err(PackError::InvalidStrength(digit))
        }
    }

    /// The digit, 2 to 9.
    pub fn digit(&self) -> u8 {
        self.0
    }

    /// The RST form, 529 to 599.
    pub fn rst(&self) -> u16 {
        500 + u16::from(self.0) * 10 + 9
    }

    /// The RS form, 52 to 59.
    pub fn rs(&self) -> u8 {
        50 + self.0
    }
}

/// ARRL Field Day class, A to H: the 8 values of field k3. QEX, Appendix A lists A to F;
/// WSJT-X 2.7.0-rc3 packs and shows G and H too.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum FieldDayClass {
    /// Class A.
    A,
    /// Class B.
    B,
    /// Class C.
    C,
    /// Class D.
    D,
    /// Class E.
    E,
    /// Class F.
    F,
    /// Class G.
    G,
    /// Class H.
    H,
}

impl FieldDayClass {
    const ALL: [FieldDayClass; 8] = [
        FieldDayClass::A,
        FieldDayClass::B,
        FieldDayClass::C,
        FieldDayClass::D,
        FieldDayClass::E,
        FieldDayClass::F,
        FieldDayClass::G,
        FieldDayClass::H,
    ];

    /// The class for a letter A to H.
    pub fn from_letter(letter: char) -> Result<FieldDayClass, PackError> {
        let i = (letter.to_ascii_uppercase() as u32).wrapping_sub('A' as u32);
        Self::ALL
            .get(i as usize)
            .copied()
            .ok_or(PackError::InvalidFieldDayClass(letter))
    }

    /// The class letter.
    pub fn letter(&self) -> char {
        char::from(b'A' + self.code())
    }

    /// k3 code, 0 to 7.
    pub(crate) fn code(&self) -> u8 {
        *self as u8
    }

    /// The class for k3 code `code & 7`.
    pub(crate) fn from_code(code: u8) -> FieldDayClass {
        Self::ALL[usize::from(code & 7)]
    }
}

/// An ARRL or RAC section, such as `EMA`, or `DX` for stations outside them.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct ArrlSection(u8);

impl ArrlSection {
    /// Looks up a section abbreviation. Lowercase input is accepted.
    pub fn new(abbreviation: &str) -> Result<ArrlSection, PackError> {
        SECTIONS
            .iter()
            .position(|s| s.eq_ignore_ascii_case(abbreviation))
            .map(|i| ArrlSection(i as u8))
            .ok_or_else(|| PackError::UnknownSection(abbreviation.to_string()))
    }

    /// The abbreviation.
    pub fn as_str(&self) -> &'static str {
        SECTIONS[usize::from(self.0)]
    }

    /// S7 code, 1 to 86.
    pub(crate) fn code(&self) -> u8 {
        self.0 + 1
    }

    pub(crate) fn from_code(code: u8) -> Option<ArrlSection> {
        let index = code.checked_sub(1)?;
        (usize::from(index) < SECTIONS.len()).then_some(ArrlSection(index))
    }
}

impl fmt::Display for ArrlSection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for ArrlSection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ArrlSection({})", self.as_str())
    }
}

/// A US state or Canadian province, such as `MA` or `PEI`.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct StateProvince(u8);

impl StateProvince {
    /// Looks up an abbreviation. Lowercase input is accepted.
    pub fn new(abbreviation: &str) -> Result<StateProvince, PackError> {
        STATES
            .iter()
            .position(|s| s.eq_ignore_ascii_case(abbreviation))
            .map(|i| StateProvince(i as u8))
            .ok_or_else(|| PackError::UnknownStateProvince(abbreviation.to_string()))
    }

    /// The abbreviation.
    pub fn as_str(&self) -> &'static str {
        STATES[usize::from(self.0)]
    }

    pub(crate) fn code(&self) -> u8 {
        self.0
    }

    pub(crate) fn from_code(code: u8) -> Option<StateProvince> {
        (usize::from(code) < STATES.len()).then_some(StateProvince(code))
    }
}

impl fmt::Display for StateProvince {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for StateProvince {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "StateProvince({})", self.as_str())
    }
}

/// The exchange of a RTTY Roundup or FT Roundup message.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RoundupExchange {
    /// A serial number, 1 to 7999, shown with 4 digits: `0013`. WSJT-X 2.7.0-rc3 does not pack 0
    /// and shows nothing for it.
    Serial(u16),
    /// A US state or Canadian province.
    State(StateProvince),
}

impl RoundupExchange {
    /// Lowest serial number the field carries.
    pub const MIN_SERIAL: u16 = 1;
    /// Highest serial number the field carries.
    pub const MAX_SERIAL: u16 = 7999;

    /// s13 code: the serial number, or 8001 plus the state's position in the list.
    pub(crate) fn s13(&self) -> u16 {
        match self {
            RoundupExchange::Serial(n) => *n,
            RoundupExchange::State(s) => 8001 + u16::from(s.code()),
        }
    }

    pub(crate) fn from_s13(code: u16) -> Option<RoundupExchange> {
        match code {
            Self::MIN_SERIAL..=Self::MAX_SERIAL => Some(RoundupExchange::Serial(code)),
            8001.. => StateProvince::from_code(u8::try_from(code - 8001).ok()?).map(RoundupExchange::State),
            _ => None,
        }
    }
}

impl fmt::Display for RoundupExchange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RoundupExchange::Serial(n) => write!(f, "{n:04}"),
            RoundupExchange::State(s) => write!(f, "{s}"),
        }
    }
}

/// The last word of a standard message (field g15 with the R1 flag).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Exchange {
    /// No last word: `K1ABC W9XYZ`.
    Blank,
    /// A locator, after `R` when `ack` is set: `FN42`, `R FN42`.
    Grid {
        /// The locator.
        grid: Grid,
        /// Acknowledgement R.
        ack: bool,
    },
    /// A signal report, prefixed by `R` when `ack` is set: `-15`, `R-15`.
    Report {
        /// The report.
        report: Report,
        /// Acknowledgement R.
        ack: bool,
    },
    /// `RRR`.
    Rrr,
    /// `RR73`.
    Rr73,
    /// `R RR73`: RR73 with the acknowledgement flag. WSJT-X sends the text `R RR73` this way
    /// (R1 set, g15 the locator RR73).
    AckRr73,
    /// `73`.
    SeventyThree,
}

impl fmt::Display for Exchange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Exchange::Blank => Ok(()),
            Exchange::Grid { grid, ack } => write!(f, "{}{grid}", if *ack { "R " } else { "" }),
            Exchange::Report { report, ack } => write!(f, "{}{report}", if *ack { "R" } else { "" }),
            Exchange::Rrr => f.write_str("RRR"),
            Exchange::Rr73 => f.write_str("RR73"),
            Exchange::AckRr73 => f.write_str("R RR73"),
            Exchange::SeventyThree => f.write_str("73"),
        }
    }
}

/// The last word of a nonstandard-callsign message (field r2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Reply {
    /// `RRR`.
    Rrr,
    /// `RR73`.
    Rr73,
    /// `73`.
    SeventyThree,
}

impl Reply {
    pub(crate) fn code(reply: Option<Reply>) -> u8 {
        match reply {
            None => 0,
            Some(Reply::Rrr) => 1,
            Some(Reply::Rr73) => 2,
            Some(Reply::SeventyThree) => 3,
        }
    }

    pub(crate) fn from_code(code: u8) -> Option<Reply> {
        match code {
            1 => Some(Reply::Rrr),
            2 => Some(Reply::Rr73),
            3 => Some(Reply::SeventyThree),
            _ => None,
        }
    }
}

impl fmt::Display for Reply {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Reply::Rrr => "RRR",
            Reply::Rr73 => "RR73",
            Reply::SeventyThree => "73",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_indices_match_grid4_to_g15() {
        assert_eq!(Grid::new("AA00").map(|g| g.index()), Ok(0));
        assert_eq!(Grid::new("FN20").map(|g| g.index()), Ok(5 * 1800 + 13 * 100 + 20));
        assert_eq!(Grid::new("RR99").map(|g| g.index()), Ok(32_399));
        for n in 0..Grid::COUNT {
            match Grid::from_index(n) {
                Some(g) => assert_eq!(g.index(), n),
                None => assert_eq!(n, 32_373, "only RR73 is unrepresentable"),
            }
        }
        assert!(Grid::from_index(Grid::COUNT).is_none());
        assert!(Grid::new("RR73").is_err());
        assert!(Grid::new("SA00").is_err());
        assert_eq!(Grid::new("fn42").map(|g| g.to_string()), Ok("FN42".to_string()));
    }

    #[test]
    fn grid6_indices_match_grid6_to_g25() {
        let g = Grid6::new("IO91NP").expect("grid");
        let expected =
            8 * 18 * 10 * 10 * 24 * 24 + 14 * 10 * 10 * 24 * 24 + 9 * 10 * 24 * 24 + 24 * 24 + 13 * 24 + 15;
        assert_eq!(g.index(), expected);
        assert_eq!(Grid6::from_index(expected), Some(g));
        assert_eq!(Grid6::new("RR99XX").map(|g| g.index()), Ok(Grid6::COUNT - 1));
        assert!(Grid6::from_index(Grid6::COUNT).is_none());
        assert!(Grid6::new("IO91NY").is_err());
        assert_eq!(g.square().to_string(), "IO91");
    }

    #[test]
    fn reports_format_with_sign_and_two_digits() {
        let show = |db| Report::new(db).map(|r| r.to_string());
        assert_eq!(show(-30), Ok("-30".into()));
        assert_eq!(show(-5), Ok("-05".into()));
        assert_eq!(show(0), Ok("+00".into()));
        assert_eq!(show(50), Ok("+50".into()));
        assert_eq!(show(-50), Ok("-50".into()));
        assert_eq!(show(-51), Err(PackError::ReportOutOfRange(-51)));
        assert_eq!(show(51), Err(PackError::ReportOutOfRange(51)));
        assert_eq!(Report::parse("-5"), Some(Report::new(-5)));
        assert_eq!(Report::parse("+100"), None);
        assert_eq!(Report::parse("15"), None);
        assert_eq!(Report::parse("-"), None);
    }

    #[test]
    fn report_codes_follow_wsjtx() {
        // Codes seen from WSJT-X 2.7.0-rc3 (ft8sim and jt9, fixtures/ft8/wsjtx*.json).
        let code = |db| Report::new(db).map(|r| r.code());
        assert_eq!((code(-30), code(0), code(50)), (Ok(5), Ok(35), Ok(85)));
        assert_eq!((code(-50), code(-31)), (Ok(86), Ok(105)));
        let db = |c| Report::from_code(c).map(|(r, canonical)| (r.db(), canonical));
        assert_eq!(
            (db(86), db(105), db(106), db(186)),
            (
                Some((-50, true)),
                Some((-31, true)),
                Some((-30, false)),
                Some((50, false))
            )
        );
        assert_eq!((db(4), db(187), db(367)), (None, None, None));
        for d in -50..=50 {
            let r = Report::new(d).expect("in range");
            assert_eq!(Report::from_code(r.code()), Some((r, true)));
        }
    }

    #[test]
    fn free_text_f71_matches_the_public_description() {
        // "TNX BOB 73 GL" fills all 13 characters, so both paddings agree.
        let t = FreeText::new("tnx bob 73 gl").expect("text");
        assert_eq!(t.as_str(), "TNX BOB 73 GL");
        assert_eq!(FreeText::from_f71(t.f71()), Some(t));
        // Right-justified: "HELLO" has 8 leading spaces, so its value is below 42^5.
        let h = FreeText::new("HELLO").expect("text");
        assert!(h.f71() < 42u128.pow(5));
        assert_eq!(FreeText::from_f71(h.f71()), Some(h));
        // ft8_lib's left-justified form decodes to the same text.
        assert_eq!(FreeText::from_f71(h.f71() * 42u128.pow(8)), Some(h));
        assert!(FreeText::from_f71(0).is_none());
        assert!(FreeText::from_f71(42u128.pow(13)).is_none());
        assert_eq!(
            FreeText::new("ABCDEFGHIJKLMN"),
            Err(PackError::FreeTextTooLong(14))
        );
        assert_eq!(FreeText::new("A_B"), Err(PackError::FreeTextCharacter('_')));
        assert_eq!(FreeText::new("é"), Err(PackError::FreeTextCharacter('é')));
        assert!(FreeText::new(" A").is_err());
        assert!(FreeText::new("").is_err());
    }

    #[test]
    fn telemetry_shows_hex_without_leading_zeros() {
        let t = Telemetry::from_hex("123456789abcdef012").expect("telemetry");
        assert_eq!(t.to_string(), "123456789ABCDEF012");
        assert_eq!(
            Telemetry::from_hex("00001F").map(|t| t.to_string()),
            Ok("1F".into())
        );
        assert_eq!(Telemetry::from_hex("000").map(|t| t.to_string()), Ok("0".into()));
        assert_eq!(
            Telemetry::from_hex("800000000000000000"),
            Err(PackError::TelemetryTooLarge)
        );
        assert!(Telemetry::from_hex("12345678901234567890").is_err());
        assert!(Telemetry::from_hex("XYZ").is_err());
    }

    #[test]
    fn contest_fields() {
        assert_eq!(SignalStrength::new(7).map(|s| (s.rst(), s.rs())), Ok((579, 57)));
        assert!(SignalStrength::new(1).is_err());
        assert_eq!(FieldDayClass::from_letter('c'), Ok(FieldDayClass::C));
        assert_eq!(FieldDayClass::from_letter('H'), Ok(FieldDayClass::H));
        assert!(FieldDayClass::from_letter('I').is_err());
        assert_eq!(FieldDayClass::from_code(7), FieldDayClass::H);
        assert_eq!(
            ArrlSection::new("ema").map(|s| (s.code(), s.as_str())),
            Ok((11, "EMA"))
        );
        assert_eq!(ArrlSection::new("AB").map(|s| s.code()), Ok(1));
        assert_eq!(ArrlSection::new("DX").map(|s| s.code()), Ok(84));
        assert_eq!(ArrlSection::new("NB").map(|s| s.code()), Ok(86));
        assert!(ArrlSection::new("GTA").is_err());
        assert_eq!(ArrlSection::from_code(0), None);
        assert_eq!(ArrlSection::from_code(87), None);
        assert_eq!(StateProvince::new("DC").map(|s| s.code()), Ok(64));
        assert_eq!(RoundupExchange::from_s13(0), None);
        assert_eq!(RoundupExchange::from_s13(8000), None);
        assert_eq!(RoundupExchange::from_s13(8066), None);
        assert_eq!(
            RoundupExchange::from_s13(8001).map(|e| e.to_string()),
            Some("AL".into())
        );
        assert_eq!(RoundupExchange::Serial(13).to_string(), "0013");
    }
}
