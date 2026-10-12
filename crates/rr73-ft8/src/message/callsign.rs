//! Callsigns and the fields that carry them.
//!
//! A standard callsign has a 1 or 2 character prefix containing a letter, one digit and a
//! suffix of 1 to 3 letters (QEX, Appendix A). It fits the 28-bit field c28, optionally with
//! a /R or /P flag. Other callsigns up to 11 characters fit the 58-bit field c58 of message
//! type 4, or travel as a hash (see [`crate::hash`]).
//!
//! The standard-callsign layout, including the 3DA0 (Eswatini) and 3X (Guinea) prefix rules,
//! is ported from `pack_basecall()` and `unpack28()` in ft8_lib's `ft8/message.c`
//! (Kārlis Goba, MIT licence).

use super::PackError;
use crate::hash::{CallHash, HashWidth};
use std::fmt;
use std::str::FromStr;

/// Number of standard callsigns: 37 × 36 × 10 × 27 × 27 × 27 (QEX, Appendix A).
const STANDARD_CALLS: u32 = 37 * 36 * 10 * 27 * 27 * 27;
/// First c28 value used for 22-bit hashes. Values below are special tokens.
pub(crate) const NTOKENS: u32 = 2_063_592;
/// Number of 22-bit hash values in c28.
pub(crate) const MAX22: u32 = 1 << 22;
/// Highest c28 token value in use: `CQ ZZZZ`.
const LAST_TOKEN: u32 = 532_443;

/// Characters of the c58 field and of callsign hashes, in code order.
pub(crate) const ALPHABET38: &[u8; 38] = b" 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/";
/// Letters in code order.
const LETTERS: &[u8; 26] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/// A callsign: 3 to 11 characters from A–Z, 0–9 and `/`, with at least one letter and one
/// digit, no leading, trailing or doubled `/`, and not shaped like a 4-character grid.
///
/// Lowercase input is accepted and stored in uppercase. The value is `Copy` and holds no
/// heap memory.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Callsign {
    bytes: [u8; Callsign::MAX_LEN],
    len: u8,
}

impl Callsign {
    /// Longest callsign that FT8 and FT4 can carry, in characters.
    pub const MAX_LEN: usize = 11;

    /// Checks and stores a callsign.
    pub fn new(text: &str) -> Result<Callsign, PackError> {
        let invalid = || PackError::InvalidCallsign(text.to_string());
        let raw = text.as_bytes();
        if raw.len() < 3 || raw.len() > Self::MAX_LEN {
            return Err(invalid());
        }
        let mut bytes = [0u8; Self::MAX_LEN];
        for (dst, &c) in bytes.iter_mut().zip(raw) {
            let c = c.to_ascii_uppercase();
            if !(c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'/') {
                return Err(invalid());
            }
            *dst = c;
        }
        let s = &bytes[..raw.len()];
        let slash_ok = s[0] != b'/' && s[s.len() - 1] != b'/' && !s.windows(2).any(|w| w == b"//");
        let has_letter = s.iter().any(u8::is_ascii_uppercase);
        let has_digit = s.iter().any(u8::is_ascii_digit);
        let grid_shaped = s.len() == 4
            && s[..2].iter().all(|c| (b'A'..=b'R').contains(c))
            && s[2..].iter().all(u8::is_ascii_digit);
        if !(slash_ok && has_letter && has_digit) || grid_shaped {
            return Err(invalid());
        }
        Ok(Callsign {
            bytes,
            len: raw.len() as u8,
        })
    }

    /// The callsign text in uppercase.
    pub fn as_str(&self) -> &str {
        // Only ASCII is ever stored.
        std::str::from_utf8(&self.bytes[..usize::from(self.len)]).unwrap_or_default()
    }

    /// True for a standard callsign, with or without a /R or /P suffix: one that the 28-bit
    /// field of message types 1 and 2 carries in full.
    pub fn is_standard(&self) -> bool {
        let (base, _) = self.split_suffix();
        pack_base(base).is_some()
    }

    /// True for a standard callsign without a suffix: one that the 28-bit fields of message
    /// types 0.1, 0.3, 0.4 and 3 carry in full.
    pub fn is_standard_base(&self) -> bool {
        pack_base(self.as_str()).is_some()
    }

    /// Appends a suffix such as `/R`, if the result is still a callsign.
    pub(crate) fn with_suffix(&self, suffix: &str) -> Option<Callsign> {
        let len = usize::from(self.len);
        let mut text = [0u8; Self::MAX_LEN];
        text[..len].copy_from_slice(&self.bytes[..len]);
        let end = len + suffix.len();
        text.get_mut(len..end)?.copy_from_slice(suffix.as_bytes());
        Callsign::new(std::str::from_utf8(&text[..end]).ok()?).ok()
    }

    /// Splits a trailing /R or /P from the callsign.
    pub fn split_suffix(&self) -> (&str, Option<Suffix>) {
        let s = self.as_str();
        if let Some(base) = s.strip_suffix("/R") {
            (base, Some(Suffix::Rover))
        } else if let Some(base) = s.strip_suffix("/P") {
            (base, Some(Suffix::Portable))
        } else {
            (s, None)
        }
    }
}

impl fmt::Display for Callsign {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl fmt::Debug for Callsign {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Callsign({})", self.as_str())
    }
}

impl FromStr for Callsign {
    type Err = PackError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Callsign::new(s)
    }
}

/// A callsign suffix that message types 1 and 2 carry as a flag bit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Suffix {
    /// `/R`, rover (message type 1).
    Rover,
    /// `/P`, portable (message type 2).
    Portable,
}

/// A callsign carried as a hash code, written `<K1ABC>` when the callsign is known and
/// `<...>` when it is not.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HashedCallsign {
    /// The callsign is known: typed by the operator or resolved from [`crate::CallsignHashes`].
    /// Packing computes its hash at the width of the field.
    Known(Callsign),
    /// Only the hash is known. Packing requires the width of the field.
    Unknown(CallHash),
}

impl HashedCallsign {
    /// The callsign, if known.
    pub fn callsign(&self) -> Option<Callsign> {
        match self {
            HashedCallsign::Known(call) => Some(*call),
            HashedCallsign::Unknown(_) => None,
        }
    }

    /// The hash at `width`, if it can be computed: a known callsign hashes at any width; an
    /// unknown one only at its own width.
    pub fn hash(&self, width: HashWidth) -> Option<CallHash> {
        match self {
            HashedCallsign::Known(call) => Some(CallHash::of(call, width)),
            HashedCallsign::Unknown(h) => (h.width() == width).then_some(*h),
        }
    }
}

impl fmt::Display for HashedCallsign {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HashedCallsign::Known(call) => write!(f, "<{call}>"),
            HashedCallsign::Unknown(_) => f.write_str("<...>"),
        }
    }
}

/// A station in a callsign field: sent in full or as a hash.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Station {
    /// Sent in full. In a 28-bit field this must be a standard callsign.
    Call(Callsign),
    /// Sent as a hash.
    Hashed(HashedCallsign),
}

impl Station {
    /// The callsign, if known.
    pub fn callsign(&self) -> Option<Callsign> {
        match self {
            Station::Call(call) => Some(*call),
            Station::Hashed(h) => h.callsign(),
        }
    }
}

impl fmt::Display for Station {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Station::Call(call) => write!(f, "{call}"),
            Station::Hashed(h) => write!(f, "{h}"),
        }
    }
}

/// The first field of a standard message: a station or one of the words CQ, QRZ and DE.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Addressee {
    /// `CQ`, optionally with a modifier: `CQ DX`, `CQ POTA`, `CQ 123`.
    Cq {
        /// The modifier, if any.
        modifier: Option<CqModifier>,
    },
    /// `QRZ`.
    Qrz,
    /// `DE`.
    De,
    /// A station.
    Station(Station),
}

impl fmt::Display for Addressee {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Addressee::Cq { modifier: None } => f.write_str("CQ"),
            Addressee::Cq { modifier: Some(m) } => write!(f, "CQ {m}"),
            Addressee::Qrz => f.write_str("QRZ"),
            Addressee::De => f.write_str("DE"),
            Addressee::Station(s) => write!(f, "{s}"),
        }
    }
}

/// The word after CQ: three digits (`CQ 123`) or 1 to 4 letters (`CQ DX`, `CQ POTA`).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct CqModifier(ModifierKind);

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum ModifierKind {
    Number(u16),
    Letters([u8; 4], u8),
}

impl CqModifier {
    /// Parses `000` to `999` or 1 to 4 letters.
    pub fn new(text: &str) -> Result<CqModifier, PackError> {
        let b = text.as_bytes();
        if b.len() == 3 && b.iter().all(u8::is_ascii_digit) {
            let n = b.iter().fold(0u16, |acc, d| acc * 10 + u16::from(d - b'0'));
            return Ok(CqModifier(ModifierKind::Number(n)));
        }
        if (1..=4).contains(&b.len()) && b.iter().all(u8::is_ascii_alphabetic) {
            let mut letters = [0u8; 4];
            for (dst, c) in letters.iter_mut().zip(b) {
                *dst = c.to_ascii_uppercase();
            }
            return Ok(CqModifier(ModifierKind::Letters(letters, b.len() as u8)));
        }
        Err(PackError::InvalidCqModifier(text.to_string()))
    }

    /// The modifier number, for the three-digit form.
    pub fn number(&self) -> Option<u16> {
        match self.0 {
            ModifierKind::Number(n) => Some(n),
            ModifierKind::Letters(..) => None,
        }
    }

    /// c28 value of `CQ` followed by this modifier (QEX, Table 7).
    pub(crate) fn c28(&self) -> u32 {
        match self.0 {
            ModifierKind::Number(n) => 3 + u32::from(n),
            ModifierKind::Letters(letters, len) => {
                // Right-justified in 4 positions of " A..Z", base 27.
                let value = letters[..usize::from(len)]
                    .iter()
                    .fold(0u32, |acc, c| acc * 27 + u32::from(c - b'A' + 1));
                1003 + value
            }
        }
    }

    /// Inverse of [`CqModifier::c28`] for values 3 to 532 443. Rejects letter groups with
    /// gaps, which no encoder produces.
    pub(crate) fn from_c28(n: u32) -> Option<CqModifier> {
        match n {
            3..=1002 => Some(CqModifier(ModifierKind::Number((n - 3) as u16))),
            1004..=LAST_TOKEN => {
                let mut v = n - 1003;
                let mut digits = [0u8; 4];
                for d in digits.iter_mut().rev() {
                    *d = (v % 27) as u8;
                    v /= 27;
                }
                let first = digits.iter().position(|&d| d != 0)?;
                let used = &digits[first..];
                if used.contains(&0) {
                    return None;
                }
                let mut letters = [0u8; 4];
                for (dst, d) in letters.iter_mut().zip(used) {
                    *dst = LETTERS[usize::from(d - 1)];
                }
                Some(CqModifier(ModifierKind::Letters(letters, used.len() as u8)))
            }
            _ => None,
        }
    }
}

impl fmt::Display for CqModifier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            ModifierKind::Number(n) => write!(f, "{n:03}"),
            ModifierKind::Letters(letters, len) => {
                f.write_str(std::str::from_utf8(&letters[..usize::from(len)]).unwrap_or_default())
            }
        }
    }
}

impl fmt::Debug for CqModifier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "CqModifier({self})")
    }
}

/// What a c28 field holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum C28 {
    De,
    Qrz,
    Cq(Option<CqModifier>),
    /// A 22-bit hash.
    Hash(u32),
    /// A standard callsign without suffix and its index (see [`pack_base`]).
    Base {
        call: Callsign,
        index: u32,
    },
}

impl C28 {
    pub(crate) fn encode(&self) -> u32 {
        match self {
            C28::De => 0,
            C28::Qrz => 1,
            C28::Cq(None) => 2,
            C28::Cq(Some(m)) => m.c28(),
            C28::Hash(h) => NTOKENS + h,
            C28::Base { index, .. } => NTOKENS + MAX22 + index,
        }
    }

    /// Decodes a 28-bit value. Returns `None` for unused token values and for callsign
    /// values that do not decode to a standard callsign.
    pub(crate) fn decode(n: u32) -> Option<C28> {
        match n {
            0 => Some(C28::De),
            1 => Some(C28::Qrz),
            2 => Some(C28::Cq(None)),
            3..=LAST_TOKEN => CqModifier::from_c28(n).map(|m| C28::Cq(Some(m))),
            _ if n < NTOKENS => None,
            _ if n < NTOKENS + MAX22 => Some(C28::Hash(n - NTOKENS)),
            _ => {
                let index = n - NTOKENS - MAX22;
                unpack_base(index).map(|call| C28::Base { call, index })
            }
        }
    }
}

/// Index of a standard callsign without suffix (0 to 262 177 559), if it is one.
pub(crate) fn pack_base(call: &str) -> Option<u32> {
    let n = encode_c6(call.as_bytes())?;
    (decode_c6(n)?.as_str() == call).then_some(n)
}

/// The standard callsign with index `n`, if `n` decodes to a well-formed one.
pub(crate) fn unpack_base(n: u32) -> Option<Callsign> {
    let call = decode_c6(n)?;
    (encode_c6(call.as_str().as_bytes()) == Some(n)).then_some(call)
}

/// Lays a base callsign out in 6 positions so the digit lands in position 2, applies the
/// 3DA0 → 3D0 and 3X → Q prefix rules, and returns its index.
fn encode_c6(call: &[u8]) -> Option<u32> {
    let len = call.len();
    if len < 3 {
        return None;
    }
    let mut c6 = [b' '; 6];
    if call.starts_with(b"3DA0") && len > 4 && len <= 7 {
        c6[..3].copy_from_slice(b"3D0");
        c6[3..len - 1].copy_from_slice(&call[4..]);
    } else if call.starts_with(b"3X") && call[2].is_ascii_uppercase() && len <= 7 {
        c6[0] = b'Q';
        c6[1..len - 1].copy_from_slice(&call[2..]);
    } else if call[2].is_ascii_digit() && len <= 6 {
        c6[..len].copy_from_slice(call);
    } else if call[1].is_ascii_digit() && len <= 5 {
        c6[1..=len].copy_from_slice(call);
    } else {
        return None;
    }
    let alnum_space = |c: u8| match c {
        b' ' => Some(0),
        b'0'..=b'9' => Some(u32::from(c - b'0') + 1),
        b'A'..=b'Z' => Some(u32::from(c - b'A') + 11),
        _ => None,
    };
    let alnum = |c: u8| alnum_space(c).filter(|&v| v > 0).map(|v| v - 1);
    let digit = |c: u8| c.is_ascii_digit().then(|| u32::from(c - b'0'));
    let letter_space = |c: u8| match c {
        b' ' => Some(0),
        b'A'..=b'Z' => Some(u32::from(c - b'A') + 1),
        _ => None,
    };
    let mut n = alnum_space(c6[0])?;
    n = n * 36 + alnum(c6[1])?;
    n = n * 10 + digit(c6[2])?;
    for &c in &c6[3..] {
        n = n * 27 + letter_space(c)?;
    }
    Some(n)
}

/// Decodes a standard-callsign index. Accepts only layouts that a real callsign produces: a
/// prefix containing a letter and a suffix of 1 to 3 letters followed by spaces.
fn decode_c6(mut n: u32) -> Option<Callsign> {
    if n >= STANDARD_CALLS {
        return None;
    }
    const ALNUM_SPACE: &[u8; 37] = b" 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut c6 = [b' '; 6];
    for c in c6[3..].iter_mut().rev() {
        let v = (n % 27) as usize;
        *c = if v == 0 { b' ' } else { LETTERS[v - 1] };
        n /= 27;
    }
    c6[2] = b'0' + (n % 10) as u8;
    n /= 10;
    c6[1] = ALNUM_SPACE[(n % 36) as usize + 1];
    n /= 36;
    c6[0] = ALNUM_SPACE[n as usize];

    let suffix = &c6[3..];
    let suffix_len = suffix.iter().take_while(|c| c.is_ascii_uppercase()).count();
    if suffix_len == 0 || suffix[suffix_len..].iter().any(|&c| c != b' ') {
        return None;
    }
    let prefix_has_letter = c6[0].is_ascii_uppercase() || c6[1].is_ascii_uppercase();
    if !prefix_has_letter || (c6[0] == b' ' && !c6[1].is_ascii_uppercase()) {
        return None;
    }
    let end = 3 + suffix_len;
    let mut text = [0u8; 8];
    let len = if c6.starts_with(b"3D0") {
        text[..4].copy_from_slice(b"3DA0");
        text[4..4 + suffix_len].copy_from_slice(&c6[3..end]);
        4 + suffix_len
    } else if c6[0] == b'Q' && c6[1].is_ascii_uppercase() {
        text[..2].copy_from_slice(b"3X");
        text[2..end + 1].copy_from_slice(&c6[1..end]);
        end + 1
    } else {
        let start = usize::from(c6[0] == b' ');
        text[..end - start].copy_from_slice(&c6[start..end]);
        end - start
    };
    Callsign::new(std::str::from_utf8(&text[..len]).ok()?).ok()
}

/// 58-bit value of a callsign: 11 characters of [`ALPHABET38`], right-justified, as ft8_lib
/// and 27 of the 28 type 4 payloads in `fixtures/ft8/onair.json` have it. The example
/// program in the public protocol description left-justifies, which [`unpack58`] also
/// accepts.
pub(crate) fn pack58(call: &Callsign) -> u64 {
    call.as_str()
        .bytes()
        .fold(0u64, |acc, c| acc * 38 + alphabet38_index(c))
}

/// Decodes a 58-bit callsign. The text may be padded on either side.
pub(crate) fn unpack58(mut n: u64) -> Option<Callsign> {
    if n >= 38u64.pow(11) {
        return None;
    }
    let mut chars = [b' '; 11];
    for c in chars.iter_mut().rev() {
        *c = ALPHABET38[(n % 38) as usize];
        n /= 38;
    }
    let text = std::str::from_utf8(&chars).ok()?.trim_matches(' ');
    Callsign::new(text).ok()
}

/// Position of a callsign character in [`ALPHABET38`]; callsigns hold only these.
pub(crate) fn alphabet38_index(c: u8) -> u64 {
    match c {
        b'0'..=b'9' => u64::from(c - b'0') + 1,
        b'A'..=b'Z' => u64::from(c - b'A') + 11,
        b'/' => 37,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(s: &str) -> Callsign {
        Callsign::new(s).expect("valid callsign")
    }

    #[test]
    fn callsign_validation() {
        for ok in [
            "K1A",
            "k1abc",
            "PJ4/K1ABC",
            "YW18FIFA",
            "K1ABC/QRP",
            "0123/ABCDEF",
            "ZY50Y",
            "RR73A",
        ] {
            assert!(Callsign::new(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "K1",
            "K1ABC/QRPXYZ",
            "/K1ABC",
            "K1ABC/",
            "K1//ABC",
            "TNX",
            "73",
            "RRR",
            "RR73",
            "FN42",
            "K1-ABC",
            "K1 ABC",
            "<K1ABC>",
            "ÄÖ1",
        ] {
            assert!(Callsign::new(bad).is_err(), "{bad}");
        }
        assert_eq!(call("k1abc").as_str(), "K1ABC");
    }

    #[test]
    fn standard_callsigns() {
        for s in [
            "K1A", "K1ABC", "KA1ABC", "W1AW", "9V1NE", "2E0ABC", "A61AB", "E71A", "3DA0XYZ", "3DA0X",
            "3XA0XYZ", "3XZ0AB", "Q1ABC", "CQ1CQ", "DE6ABC",
        ] {
            assert!(call(s).is_standard_base(), "{s}");
        }
        for s in [
            "PJ4/K1ABC",
            "YW18FIFA",
            "ZY50Y",
            "KA1",
            "K1ABCD",
            "QA0XYZ",
            "3D0XYZ",
            "01AB",
            "K1ABC/QRP",
            "AB1CDEF",
        ] {
            assert!(!call(s).is_standard_base(), "{s}");
        }
        assert!(call("K1ABC/R").is_standard());
        assert!(call("G4ABC/P").is_standard());
        assert!(!call("G4ABC/P").is_standard_base());
        assert!(!call("PJ4/K1ABC/P").is_standard());
    }

    #[test]
    fn c28_values_match_qex_table_7() {
        let cq = |m: &str| C28::Cq(Some(CqModifier::new(m).expect("modifier"))).encode();
        assert_eq!(C28::De.encode(), 0);
        assert_eq!(C28::Qrz.encode(), 1);
        assert_eq!(C28::Cq(None).encode(), 2);
        assert_eq!((cq("000"), cq("999")), (3, 1002));
        assert_eq!((cq("A"), cq("Z")), (1004, 1029));
        assert_eq!((cq("AA"), cq("ZZ")), (1031, 1731));
        assert_eq!((cq("AAA"), cq("ZZZ")), (1760, 20685));
        assert_eq!((cq("AAAA"), cq("ZZZZ")), (21443, 532443));
        assert_eq!(C28::Hash(0).encode(), 2_063_592);
        let index = pack_base("K1ABC").expect("standard");
        assert!(
            C28::Base {
                call: call("K1ABC"),
                index
            }
            .encode()
                >= 6_257_896
        );
    }

    #[test]
    fn std_call_to_c28_example() {
        // The public description's program std_call_to_c28 right-justifies a 5-character
        // call: " K1ABC" = 1*36*10*27^3 ... computed by hand here.
        let a1 = |c: u8| {
            " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                .bytes()
                .position(|x| x == c)
                .unwrap_or(99) as u32
        };
        let a2 = |c: u8| {
            "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                .bytes()
                .position(|x| x == c)
                .unwrap_or(99) as u32
        };
        let a4 = |c: u8| {
            " ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                .bytes()
                .position(|x| x == c)
                .unwrap_or(99) as u32
        };
        let c6 = b" K1ABC";
        let expected = NTOKENS
            + MAX22
            + 36 * 10 * 27 * 27 * 27 * a1(c6[0])
            + 10 * 27 * 27 * 27 * a2(c6[1])
            + 27 * 27 * 27 * u32::from(c6[2] - b'0')
            + 27 * 27 * a4(c6[3])
            + 27 * a4(c6[4])
            + a4(c6[5]);
        let index = pack_base("K1ABC").expect("standard");
        assert_eq!(
            C28::Base {
                call: call("K1ABC"),
                index
            }
            .encode(),
            expected
        );
    }

    #[test]
    fn every_token_value_round_trips_or_is_rejected() {
        let mut valid = 0;
        for n in 0..NTOKENS {
            if let Some(token) = C28::decode(n) {
                assert_eq!(token.encode(), n);
                valid += 1;
            }
        }
        // DE, QRZ, CQ, 1000 numbers and 26 + 26² + 26³ + 26⁴ letter groups.
        assert_eq!(valid, 3 + 1000 + 26 + 676 + 17_576 + 456_976);
    }

    #[test]
    fn standard_call_values_round_trip_where_valid() {
        let mut state = 7u64;
        for _ in 0..200_000 {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let n = (state >> 33) as u32 % STANDARD_CALLS;
            if let Some(c) = unpack_base(n) {
                assert_eq!(pack_base(c.as_str()), Some(n), "{c}");
                assert!(c.is_standard_base());
            }
        }
    }

    #[test]
    fn c58_is_right_justified_and_accepts_either_padding() {
        let c = call("OR18TRA");
        // Value seen on air (fixtures/ft8/onair.json): bits 12 to 69 of
        // payload 77300000482ca75d8c60.
        assert_eq!(pack58(&c), 77_496_702_819);
        assert_eq!(unpack58(77_496_702_819), Some(c));
        let left = pack58(&c) * 38u64.pow(4);
        assert_eq!(unpack58(left), Some(c));
        assert_eq!(unpack58(38u64.pow(11)), None);
        assert_eq!(unpack58(0), None);
    }
}
