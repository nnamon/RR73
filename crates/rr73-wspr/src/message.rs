//! WSPR messages and their 50-bit packing.
//!
//! A message is a 28-bit callsign field followed by a 22-bit field holding 15 bits of locator
//! (or prefix, suffix or hash) and 7 bits of power. The power field carries `power + 64` for
//! type 1, `power + 1 + n + 64` for type 2 and `-(power + 1) + 64` for type 3, so the type
//! follows from the field: type 1 powers end in 0, 3 or 7, type 2 values end in 1, 2, 4, 5, 8
//! or 9, and type 3 values are negative.
//!
//! | Type | Text | Callsign field | 15-bit field |
//! | --- | --- | --- | --- |
//! | 1 | `K1ABC FN42 37` | callsign | 4-character locator |
//! | 2 | `PJ4/K1ABC 33`, `K1ABC/P 33` | base callsign | prefix or suffix (and `n`) |
//! | 3 | `<PJ4/K1ABC> FK52UD 33` | 6-character locator, rotated | callsign hash |
//!
//! Type 1 packing follows G4JNT's "The WSPR Coding Process". The type 2 and type 3 layouts
//! below were established by packing messages with WSJT-X's `wsprsim` and reading its output
//! (black-box; no WSJT-X source was read):
//!
//! - Prefix of 1 to 3 characters: right-aligned with leading spaces, read as 3 base-37 digits
//!   (`0`-`9`, `A`-`Z`, space) into `m`. The 15-bit field holds `m mod 32768` and `n = m / 32768`.
//! - Suffix: one character `c` gives `m = 60000 + c` (`0`-`9` as 0 to 9, `A`-`Z` as 10 to 35);
//!   two digits 10 to 99 give `m = 60026 + value`. Both have `n = 1`.
//! - Type 3: the callsign field holds the locator rotated left by one character (`FN42AB` as
//!   `N42ABF`), which always fits the callsign layout; the 15-bit field holds
//!   [`crate::hash15`] of the callsign.

use std::fmt;

use crate::code::MESSAGE_BITS;
use crate::hash::{CallsignHashes, hash15};

/// Characters of the callsign alphabet in value order: digits, letters, space.
const ALPHABET: &[u8; 37] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ";

/// One more than the largest callsign field value: 37 x 36 x 10 x 27 x 27 x 27.
pub const CALL_FIELD_LIMIT: u32 = 262_177_560;

/// Number of 4-character locators: 180 x 180.
pub const GRID_FIELD_LIMIT: u32 = 32_400;

/// A WSPR message.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Message {
    /// Type 1: a standard callsign, a 4-character locator and the power.
    Standard {
        /// Callsign, such as `K1ABC`.
        call: String,
        /// 4-character Maidenhead locator, such as `FN42`.
        grid: String,
        /// Transmitter power, in dBm: 0 to 60, ending in 0, 3 or 7.
        power_dbm: u8,
    },
    /// Type 2: a compound callsign (prefix or suffix) and the power, without a locator.
    Compound {
        /// Callsign with prefix or suffix, such as `PJ4/K1ABC` or `K1ABC/P`.
        call: String,
        /// Transmitter power, in dBm.
        power_dbm: u8,
    },
    /// Type 3: a hashed callsign, a 6-character locator and the power.
    Hashed {
        /// The callsign when known: given when packing, or found in the hash table when
        /// unpacking. `None` prints as `<...>`.
        call: Option<String>,
        /// 15-bit hash of the callsign ([`crate::hash15`]).
        hash: u16,
        /// 6-character Maidenhead locator, such as `FN42AB`.
        grid: String,
        /// Transmitter power, in dBm.
        power_dbm: u8,
    },
}

/// Errors from parsing or packing operator text.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PackError {
    /// The text has neither 2 nor 3 words in a known layout.
    #[error(
        "{0:?} is not a WSPR message: use CALL GRID POWER (K1ABC FN42 37), PFX/CALL POWER or CALL/SFX POWER (PJ4/K1ABC 33), or <CALL> GRID6 POWER (<K1ABC> FN42AB 37)"
    )]
    Format(String),
    /// The callsign does not fit the 28-bit field.
    #[error(
        "callsign {0:?} does not fit a WSPR message: it needs a digit in position 2 or 3 and at most 3 letters after it"
    )]
    Callsign(String),
    /// The prefix or suffix of a compound callsign cannot be sent.
    #[error(
        "compound callsign {0:?} cannot be sent: use a prefix of 1 to 3 letters or digits, or a suffix of one letter or digit or two digits from 10 to 99"
    )]
    Compound(String),
    /// The locator is not a 4- or 6-character Maidenhead locator as the type needs.
    #[error(
        "locator {0:?} is not valid here: use 4 characters (FN42) after a callsign, or 6 (FN42AB) after <CALL>"
    )]
    Grid(String),
    /// The power is not one of the 19 levels the protocol sends.
    #[error("power {0:?} cannot be sent: use 0 to 60 dBm ending in 0, 3 or 7")]
    Power(String),
}

/// Errors from unpacking a 50-bit message.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UnpackError {
    /// The callsign field is outside the values a callsign produces.
    #[error("callsign field {0} is out of range")]
    CallField(u32),
    /// The locator field is outside the 32400 locators.
    #[error("locator field {0} is out of range")]
    GridField(u32),
    /// The power field gives no valid power for any message type.
    #[error("power field {0} is not valid")]
    PowerField(i32),
    /// The prefix or suffix field of a type 2 message is not valid.
    #[error("prefix or suffix field {0} is not valid")]
    AffixField(u32),
    /// The callsign field of a type 3 message is not a rotated 6-character locator.
    #[error("type 3 locator field {0:?} is not a locator")]
    HashedGrid(String),
}

/// A packed message: the 28-bit callsign field and the 22-bit locator and power field.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Packed {
    /// Callsign field, 28 bits.
    pub call_field: u32,
    /// Locator (15 bits, high) and power (7 bits, low) field, 22 bits.
    pub grid_power_field: u32,
}

impl Packed {
    /// A packed message from its two fields, masked to 28 and 22 bits.
    pub fn new(call_field: u32, grid_power_field: u32) -> Self {
        Self {
            call_field: call_field & 0x0FFF_FFFF,
            grid_power_field: grid_power_field & 0x003F_FFFF,
        }
    }

    /// The message from 50 bits (0 or 1, first transmitted first). Missing bits read as 0.
    pub fn from_bits(bits: &[u8]) -> Self {
        let mut v = 0u64;
        for i in 0..MESSAGE_BITS {
            v = (v << 1) | u64::from(bits.get(i).copied().unwrap_or(0) & 1);
        }
        Self::new((v >> 22) as u32, (v & 0x003F_FFFF) as u32)
    }

    /// The 50 message bits, first transmitted first.
    pub fn bits(&self) -> [u8; MESSAGE_BITS] {
        let v = (u64::from(self.call_field) << 22) | u64::from(self.grid_power_field);
        std::array::from_fn(|i| ((v >> (MESSAGE_BITS - 1 - i)) & 1) as u8)
    }

    /// The 81 encoder input bits: the message followed by 31 zeros.
    pub fn encoder_input(&self) -> [u8; crate::code::INPUT_BITS] {
        let mut out = [0u8; crate::code::INPUT_BITS];
        out[..MESSAGE_BITS].copy_from_slice(&self.bits());
        out
    }

    /// The message and zero tail as 11 bytes, most significant bit first (the layout
    /// `wsprsim -d` prints).
    pub fn bytes(&self) -> [u8; 11] {
        let bits = self.bits();
        let mut out = [0u8; 11];
        for (i, &b) in bits.iter().enumerate() {
            out[i / 8] |= b << (7 - i % 8);
        }
        out
    }

    /// The 15-bit locator, prefix, suffix or hash field.
    pub fn grid_field(&self) -> u32 {
        self.grid_power_field >> 7
    }

    /// The power field with its offset of 64 removed (-64 to 63).
    pub fn power_field(&self) -> i32 {
        (self.grid_power_field & 0x7F) as i32 - 64
    }
}

/// `true` for the 19 power levels the protocol sends: 0 to 60 dBm ending in 0, 3 or 7.
pub fn is_valid_power(dbm: i32) -> bool {
    (0..=60).contains(&dbm) && matches!(dbm % 10, 0 | 3 | 7)
}

fn char_value(c: u8) -> Option<u32> {
    ALPHABET.iter().position(|&a| a == c).map(|p| p as u32)
}

/// The callsign as the 6 characters of the callsign field: a leading space when the digit
/// is in position 2, trailing spaces to 6 characters. `None` when it does not fit.
fn align_call(call: &str) -> Option<[u8; 6]> {
    let b = call.as_bytes();
    if b.is_empty() || b.len() > 6 || !b.iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
        return None;
    }
    let mut out = [b' '; 6];
    let shift =
        usize::from(b.len() >= 2 && b[1].is_ascii_digit() && !b.get(2).is_some_and(u8::is_ascii_digit));
    if b.len() + shift > 6 {
        return None;
    }
    out[shift..shift + b.len()].copy_from_slice(b);
    // Position 2 is the area digit; 3 to 5 are letters, then only spaces.
    let letters = &out[3..];
    let tail_ok = letters[0].is_ascii_uppercase()
        && letters
            .windows(2)
            .all(|w| !(w[0] == b' ' && w[1] != b' ') && (w[1] == b' ' || w[1].is_ascii_uppercase()));
    let prefix_has_letter = out[..2].iter().any(u8::is_ascii_uppercase);
    let first_ok = out[1] != b' ';
    (out[2].is_ascii_digit() && tail_ok && prefix_has_letter && first_ok).then_some(out)
}

/// Packs the 6 aligned characters of a callsign field. Callers check the layout.
fn pack_field(c: &[u8; 6]) -> Option<u32> {
    let letter = |x: u8| -> Option<u32> {
        match x {
            b'A'..=b'Z' => Some(u32::from(x - b'A')),
            b' ' => Some(26),
            _ => None,
        }
    };
    let mut n = char_value(c[0])?;
    let c1 = char_value(c[1]).filter(|&v| v < 36)?;
    n = n * 36 + c1;
    let c2 = c[2].is_ascii_digit().then(|| u32::from(c[2] - b'0'))?;
    n = n * 10 + c2;
    for &x in &c[3..] {
        n = n * 27 + letter(x)?;
    }
    Some(n)
}

fn unpack_field(n: u32) -> Result<[u8; 6], UnpackError> {
    if n >= CALL_FIELD_LIMIT {
        return Err(UnpackError::CallField(n));
    }
    let mut v = n;
    let mut out = [b' '; 6];
    for i in (3..6).rev() {
        let x = (v % 27) as u8;
        out[i] = if x == 26 { b' ' } else { b'A' + x };
        v /= 27;
    }
    out[2] = b'0' + (v % 10) as u8;
    v /= 10;
    out[1] = ALPHABET[(v % 36) as usize];
    v /= 36;
    out[0] = ALPHABET[v as usize];
    Ok(out)
}

/// Packs a standard callsign into the 28-bit field.
pub fn pack_call(call: &str) -> Result<u32, PackError> {
    align_call(call)
        .and_then(|c| pack_field(&c))
        .ok_or_else(|| PackError::Callsign(call.to_string()))
}

/// Unpacks the 28-bit callsign field to text without the alignment spaces. The text may not
/// be a plausible callsign; decoders check that separately.
pub fn unpack_call(n: u32) -> Result<String, UnpackError> {
    let c = unpack_field(n)?;
    Ok(String::from_utf8_lossy(&c).trim().to_string())
}

fn is_grid4(g: &[u8]) -> bool {
    g.len() == 4
        && matches!(g[0], b'A'..=b'R')
        && matches!(g[1], b'A'..=b'R')
        && g[2].is_ascii_digit()
        && g[3].is_ascii_digit()
}

fn is_grid6(g: &[u8]) -> bool {
    g.len() == 6 && is_grid4(&g[..4]) && matches!(g[4], b'A'..=b'X') && matches!(g[5], b'A'..=b'X')
}

/// Packs a 4-character locator into the 15-bit field.
pub fn pack_grid(grid: &str) -> Result<u32, PackError> {
    let g = grid.as_bytes();
    if !is_grid4(g) {
        return Err(PackError::Grid(grid.to_string()));
    }
    let (a, b) = (u32::from(g[0] - b'A'), u32::from(g[1] - b'A'));
    let (c, d) = (u32::from(g[2] - b'0'), u32::from(g[3] - b'0'));
    Ok((179 - 10 * a - c) * 180 + 10 * b + d)
}

/// Unpacks the 15-bit locator field of a type 1 message.
pub fn unpack_grid(m: u32) -> Result<String, UnpackError> {
    if m >= GRID_FIELD_LIMIT {
        return Err(UnpackError::GridField(m));
    }
    let t = 179 - m / 180;
    let r = m % 180;
    let g = [
        b'A' + (t / 10) as u8,
        b'A' + (r / 10) as u8,
        b'0' + (t % 10) as u8,
        b'0' + (r % 10) as u8,
    ];
    Ok(String::from_utf8_lossy(&g).into_owned())
}

/// The prefix or suffix value `m` of a compound callsign and its base callsign.
fn affix_value(call: &str) -> Result<(u32, &str), PackError> {
    let err = || PackError::Compound(call.to_string());
    let (left, right) = call.split_once('/').ok_or_else(err)?;
    if right.contains('/') {
        return Err(err());
    }
    let alnum = |s: &str| !s.is_empty() && s.bytes().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    if !alnum(left) || !alnum(right) {
        return Err(err());
    }
    let left_is_call = align_call(left).is_some();
    let right_is_call = align_call(right).is_some();
    // A suffix is one character or two digits after a callsign; otherwise the left part is a
    // prefix of 1 to 3 characters before one.
    let suffix =
        left_is_call && (right.len() == 1 || (right.len() == 2 && right.bytes().all(|c| c.is_ascii_digit())));
    if suffix {
        let r = right.as_bytes();
        let m = if r.len() == 1 {
            60_000 + char_value(r[0]).ok_or_else(err)?
        } else {
            let v = u32::from(r[0] - b'0') * 10 + u32::from(r[1] - b'0');
            if v < 10 {
                return Err(err());
            }
            60_026 + v
        };
        return Ok((m, left));
    }
    if right_is_call && left.len() <= 3 {
        let mut padded = [b' '; 3];
        padded[3 - left.len()..].copy_from_slice(left.as_bytes());
        let mut m = 0;
        for &c in &padded {
            m = m * 37 + char_value(c).ok_or_else(err)?;
        }
        return Ok((m, right));
    }
    Err(err())
}

/// Packs a message into its two fields.
pub fn pack(msg: &Message) -> Result<Packed, PackError> {
    let power = |p: u8| -> Result<u32, PackError> {
        if is_valid_power(i32::from(p)) {
            Ok(u32::from(p))
        } else {
            Err(PackError::Power(p.to_string()))
        }
    };
    match msg {
        Message::Standard {
            call,
            grid,
            power_dbm,
        } => {
            let n = pack_call(call)?;
            let m1 = pack_grid(grid)?;
            Ok(Packed::new(n, m1 * 128 + power(*power_dbm)? + 64))
        }
        Message::Compound { call, power_dbm } => {
            let (m, base) = affix_value(call)?;
            let n = pack_call(base)?;
            let nadd = m >> 15;
            let ntype = power(*power_dbm)? + 1 + nadd;
            Ok(Packed::new(n, (m & 0x7FFF) * 128 + ntype + 64))
        }
        Message::Hashed {
            call,
            hash,
            grid,
            power_dbm,
        } => {
            let g = grid.as_bytes();
            if !is_grid6(g) {
                return Err(PackError::Grid(grid.clone()));
            }
            let rotated = [g[1], g[2], g[3], g[4], g[5], g[0]];
            let n = pack_field(&rotated).ok_or_else(|| PackError::Grid(grid.clone()))?;
            let h = call.as_deref().map_or(*hash, hash15);
            let p = power(*power_dbm)?;
            Ok(Packed::new(n, u32::from(h & 0x7FFF) * 128 + 63 - p))
        }
    }
}

/// Unpacks a message. Type 3 callsigns are looked up in `hashes`; an unknown hash leaves
/// `call` as `None`.
pub fn unpack(packed: &Packed, hashes: &CallsignHashes) -> Result<Message, UnpackError> {
    let ntype = packed.power_field();
    let m1 = packed.grid_field();
    if ntype < 0 {
        let power = -(ntype + 1);
        if !is_valid_power(power) {
            return Err(UnpackError::PowerField(ntype));
        }
        let f = unpack_field(packed.call_field)?;
        let grid = [f[5], f[0], f[1], f[2], f[3], f[4]];
        let text = String::from_utf8_lossy(&grid).into_owned();
        if !is_grid6(&grid) {
            return Err(UnpackError::HashedGrid(text));
        }
        let hash = m1 as u16;
        return Ok(Message::Hashed {
            call: hashes.lookup(hash).map(str::to_string),
            hash,
            grid: text,
            power_dbm: power as u8,
        });
    }
    if is_valid_power(ntype) {
        return Ok(Message::Standard {
            call: unpack_call(packed.call_field)?,
            grid: unpack_grid(m1)?,
            power_dbm: ntype as u8,
        });
    }
    let nadd = match ntype % 10 {
        1 | 4 | 8 => 0,
        2 | 5 | 9 => 1,
        _ => return Err(UnpackError::PowerField(ntype)),
    };
    let power = ntype - 1 - nadd;
    if !is_valid_power(power) {
        return Err(UnpackError::PowerField(ntype));
    }
    let base = unpack_call(packed.call_field)?;
    let m = m1 + 32_768 * nadd as u32;
    let call = if m < 37 * 37 * 37 {
        let chars = [m / 1369, (m / 37) % 37, m % 37].map(|v| ALPHABET[v as usize]);
        let prefix = String::from_utf8_lossy(&chars).trim_start().to_string();
        if prefix.is_empty() || prefix.contains(' ') {
            return Err(UnpackError::AffixField(m));
        }
        format!("{prefix}/{base}")
    } else if (60_000..60_036).contains(&m) {
        format!("{base}/{}", ALPHABET[(m - 60_000) as usize] as char)
    } else if (60_036..=60_125).contains(&m) {
        format!("{base}/{}", m - 60_026)
    } else {
        return Err(UnpackError::AffixField(m));
    };
    Ok(Message::Compound {
        call,
        power_dbm: power as u8,
    })
}

impl Message {
    /// Parses operator text: `K1ABC FN42 37`, `PJ4/K1ABC 33`, `K1ABC/P 33` or
    /// `<K1ABC> FN42AB 37`. Case and surrounding spaces are ignored. The message is checked
    /// to pack.
    pub fn parse(text: &str) -> Result<Message, PackError> {
        let upper = text.trim().to_ascii_uppercase();
        let words: Vec<&str> = upper.split_whitespace().collect();
        let power = |w: &str| -> Result<u8, PackError> {
            w.parse::<i32>()
                .ok()
                .filter(|&p| is_valid_power(p))
                .map(|p| p as u8)
                .ok_or_else(|| PackError::Power(w.to_string()))
        };
        let msg = match words.as_slice() {
            [call, grid, p] if call.starts_with('<') => {
                let inner = call
                    .strip_prefix('<')
                    .and_then(|c| c.strip_suffix('>'))
                    .filter(|c| !c.is_empty() && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'/'))
                    .ok_or_else(|| PackError::Callsign((*call).to_string()))?;
                Message::Hashed {
                    call: Some(inner.to_string()),
                    hash: hash15(inner),
                    grid: (*grid).to_string(),
                    power_dbm: power(p)?,
                }
            }
            [call, grid, p] => {
                if call.contains('/') {
                    return Err(PackError::Format(text.to_string()));
                }
                if is_grid6(grid.as_bytes()) {
                    return Err(PackError::Grid((*grid).to_string()));
                }
                Message::Standard {
                    call: (*call).to_string(),
                    grid: (*grid).to_string(),
                    power_dbm: power(p)?,
                }
            }
            [call, p] if call.contains('/') => Message::Compound {
                call: (*call).to_string(),
                power_dbm: power(p)?,
            },
            _ => return Err(PackError::Format(text.to_string())),
        };
        pack(&msg)?;
        Ok(msg)
    }

    /// The message type: 1, 2 or 3.
    pub fn message_type(&self) -> u8 {
        match self {
            Message::Standard { .. } => 1,
            Message::Compound { .. } => 2,
            Message::Hashed { .. } => 3,
        }
    }

    /// Transmitter power, in dBm.
    pub fn power_dbm(&self) -> u8 {
        match self {
            Message::Standard { power_dbm, .. }
            | Message::Compound { power_dbm, .. }
            | Message::Hashed { power_dbm, .. } => *power_dbm,
        }
    }
}

impl fmt::Display for Message {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Message::Standard {
                call,
                grid,
                power_dbm,
            } => write!(f, "{call} {grid} {power_dbm}"),
            Message::Compound { call, power_dbm } => write!(f, "{call} {power_dbm}"),
            Message::Hashed {
                call,
                grid,
                power_dbm,
                ..
            } => write!(f, "<{}> {grid} {power_dbm}", call.as_deref().unwrap_or("...")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packed(text: &str) -> Packed {
        pack(&Message::parse(text).expect(text)).expect(text)
    }

    #[test]
    fn type_1_matches_the_g4jnt_worked_layout() {
        let p = packed("K1ABC FN42 37");
        assert_eq!(p.call_field, 259_047_992);
        assert_eq!(p.grid_field(), 22_632);
        assert_eq!(p.power_field(), 37);
        assert_eq!(p.bytes(), [0xF7, 0x0C, 0x23, 0x8B, 0x0D, 0x19, 0x40, 0, 0, 0, 0]);
        assert_eq!(Packed::from_bits(&p.bits()), p);
    }

    #[test]
    fn callsigns_align_on_the_area_digit() {
        assert_eq!(align_call("K1ABC").map(|c| c.to_vec()), Some(b" K1ABC".to_vec()));
        assert_eq!(align_call("9V1NE").map(|c| c.to_vec()), Some(b"9V1NE ".to_vec()));
        assert_eq!(align_call("W1A").map(|c| c.to_vec()), Some(b" W1A  ".to_vec()));
        assert_eq!(align_call("2E0ABC").map(|c| c.to_vec()), Some(b"2E0ABC".to_vec()));
        for bad in [
            "K1ABCD", "3DA0XYZ", "K1", "KA", "11ABC", "K1A2", "K 1AB", "", "k1abc",
        ] {
            assert_eq!(align_call(bad), None, "{bad}");
        }
    }

    #[test]
    fn every_field_round_trips() {
        for n in [0, 1, 262_177_559, 37_053_022] {
            if let Ok(c) = unpack_field(n) {
                assert_eq!(pack_field(&c), Some(n));
            }
        }
        assert!(unpack_call(CALL_FIELD_LIMIT).is_err());
        for m in [0, 179, 180, 22_632, 32_399] {
            assert_eq!(pack_grid(&unpack_grid(m).expect("grid")), Ok(m));
        }
        assert!(unpack_grid(GRID_FIELD_LIMIT).is_err());
    }

    #[test]
    fn types_2_and_3_match_wsprsim_fields() {
        // Fields read from `wsprsim -d` (tools/wsjtx); see the module documentation.
        let cases: [(&str, u32, i32); 10] = [
            ("PJ4/K1ABC 33", 2164, 35),
            ("A/K1ABC 33", 17_858, 35),
            ("3D2/K1ABC 33", 4590, 34),
            ("K1ABC/P 33", 27_257, 35),
            ("K1ABC/0 33", 27_232, 35),
            ("K1ABC/12 33", 27_270, 35),
            ("K1ABC/99 33", 27_357, 35),
            ("<PJ4/K1ABC> FK52UD 33", 19_735, -34),
            ("<K1ABC> FN42AB 60", 6521, -61),
            ("<K1ABC/P> FN42AB 37", 12_544, -38),
        ];
        for (text, field, ntype) in cases {
            let p = packed(text);
            assert_eq!((p.grid_field(), p.power_field()), (field, ntype), "{text}");
        }
        assert_eq!(packed("<K1ABC> FN42AB 0").call_field, 163_801_958);
    }

    #[test]
    fn unpack_restores_text_and_resolves_hashes() {
        let mut hashes = CallsignHashes::new();
        for text in [
            "K1ABC FN42 37",
            "9V1NE OJ11 0",
            "PJ4/K1ABC 33",
            "ZZZ/K1ABC 60",
            "K1ABC/Z 3",
            "K1ABC/10 7",
        ] {
            let msg = Message::parse(text).expect(text);
            assert_eq!(msg.to_string(), text);
            assert_eq!(
                unpack(&pack(&msg).expect(text), &hashes),
                Ok(msg.clone()),
                "{text}"
            );
            hashes.learn(&msg);
        }
        let hashed = packed("<PJ4/K1ABC> FK52UD 33");
        let unknown = unpack(&hashed, &CallsignHashes::new()).expect("unpack");
        assert_eq!(unknown.to_string(), "<...> FK52UD 33");
        assert_eq!(
            unpack(&hashed, &hashes).expect("unpack").to_string(),
            "<PJ4/K1ABC> FK52UD 33"
        );
    }

    #[test]
    fn parse_refuses_what_cannot_be_sent() {
        let refused = [
            ("K1ABC FN42 31", "power"),
            ("K1ABC FN42 63", "power"),
            ("K1ABC FN42 -3", "power"),
            ("K1ABC FN42AB 37", "6-character locator without brackets"),
            ("K1ABC SS42 37", "locator letters beyond R"),
            ("K1ABCD FN42 37", "too long"),
            ("3DA0XYZ FN42 37", "digit in position 4"),
            ("K1ABC 37", "standard call without a locator"),
            ("K1ABC/QRP 33", "3-character suffix"),
            ("VK2ABC/MM 37", "2-letter suffix"),
            ("K1ABC/05 37", "2-digit suffix below 10"),
            ("ABCD/K1ABC 33", "4-character prefix"),
            ("PJ4/K1ABC FN42 33", "compound call with a locator"),
            ("<K1ABC> FN42 37", "4-character locator in type 3"),
            ("<K1ABC> FN42AZ 37", "subsquare letters beyond X"),
            ("<> FN42AB 37", "empty hashed call"),
            ("", "empty"),
            ("CQ K1ABC FN42 37", "four words"),
        ];
        for (text, why) in refused {
            assert!(Message::parse(text).is_err(), "{text}: {why}");
        }
        assert_eq!(
            Message::parse("  k1abc  fn42 37 ").map(|m| m.to_string()),
            Ok("K1ABC FN42 37".into())
        );
    }

    #[test]
    fn invalid_fields_do_not_unpack() {
        let h = CallsignHashes::new();
        // Power field 6 (ends in 6) is no type; 61 is no valid type 1 power.
        assert!(unpack(&Packed::new(259_047_992, 22_632 * 128 + 6 + 64), &h).is_err());
        assert!(unpack(&Packed::new(259_047_992, 22_632 * 128 + 63 + 64), &h).is_err());
        // Type 3 whose callsign field is not a rotated locator (` K1ABC`).
        assert!(unpack(&Packed::new(259_047_992, 6521 * 128 + 63 - 37), &h).is_err());
        // Type 2 affix values between the prefix and suffix ranges.
        assert!(unpack(&Packed::new(259_047_992, (55_000 - 32_768) * 128 + 35 + 64), &h).is_err());
    }

    #[test]
    fn power_levels() {
        let valid: Vec<i32> = (-5..70).filter(|&p| is_valid_power(p)).collect();
        assert_eq!(valid.len(), 19);
        assert_eq!(valid.first(), Some(&0));
        assert_eq!(valid.last(), Some(&60));
    }
}
