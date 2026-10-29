//! LQ8 message fields: the 28-bit standard callsign, the /P flag, base-38 non-standard
//! callsigns, the 15-bit locator, the 20-bit CQ modifier, the 5-bit report and the callsign
//! hashes (CRC-24/Q in 24 and 20 bits, and the 16-bit multiplicative hash).
//!
//! Ported from `src/callsign.cpp`, `src/callsign_nonstd.cpp`, `src/locator.cpp`,
//! `src/modifier.cpp`, `src/rst.cpp` and `src/hash.cpp` in lq_lib by Luis Quesada HB9IPH
//! (MIT licence, commit 00f3bcf); the licence is in `LICENSE-lq_lib` next to this crate's
//! manifest. The layouts follow the specification's section IV (`paper/lq_digitalmode.tex`).

/// Highest 28-bit value of a standard callsign: 37 × 36 × 10 × 27³ − 1.
pub const CALL_MAX_STD: u32 = 262_177_559;
/// The 28-bit token DE.
pub const TOKEN_DE: u32 = 262_177_560;
/// The 28-bit token QRZ.
pub const TOKEN_QRZ: u32 = 262_177_561;
/// The 28-bit token CQ.
pub const TOKEN_CQ: u32 = 262_177_562;

/// The 15-bit locator value of a blank locator.
pub const LOCATOR_BLANK: u16 = 32_400;

/// Lowest report a 5-bit field carries, dB.
pub const REPORT_MIN_DB: i32 = -26;
/// Highest report a 5-bit field carries, dB.
pub const REPORT_MAX_DB: i32 = 5;

const RADIX_S2: u32 = 27;
const RADIX_S1: u32 = 27 * 27;
const RADIX_D: u32 = 27 * 27 * 27;
const RADIX_C2: u32 = 10 * RADIX_D;
const RADIX_C1: u32 = 36 * RADIX_C2;

/// The base-38 alphabet of non-standard callsigns, letters before digits.
const NONSTD: &[u8; 38] = b" ABCDEFGHIJKLMNOPQRSTUVWXYZ/0123456789";

/// Upper-cases ASCII and drops surrounding whitespace.
pub(crate) fn clean(call: &str) -> String {
    call.trim().to_ascii_uppercase()
}

/// The 6-character layout `c1 c2 d s1 s2 s3` of a standard callsign, or `None` when `call`
/// is not one: a prefix of 1 or 2 letters or digits, one digit, then 1 to 3 letters.
pub fn normalise_standard(call: &str) -> Option<[u8; 6]> {
    let s: Vec<u8> = call
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .map(|b| b.to_ascii_uppercase())
        .collect();
    if s.len() < 3 || s.len() > 6 {
        return None;
    }
    let digit = (1..s.len()).find(|&i| {
        let after = s.len() - 1 - i;
        s[i].is_ascii_digit() && (1..=3).contains(&after) && s[i + 1..].iter().all(u8::is_ascii_alphabetic)
    })?;
    if digit > 2 || !s[..digit].iter().all(u8::is_ascii_alphanumeric) {
        return None;
    }
    let mut out = [b' '; 6];
    if digit == 1 {
        out[1] = s[0];
    } else {
        out[0] = s[0];
        out[1] = s[1];
    }
    out[2] = s[digit];
    out[3..3 + s.len() - digit - 1].copy_from_slice(&s[digit + 1..]);
    Some(out)
}

/// True for a standard callsign and for the tokens DE, QRZ and CQ.
pub fn is_standard(call: &str) -> bool {
    matches!(call, "DE" | "QRZ" | "CQ") || normalise_standard(call).is_some()
}

/// Packs a standard callsign or token into 28 bits.
pub fn pack28(call: &str) -> Option<u32> {
    match call {
        "DE" => return Some(TOKEN_DE),
        "QRZ" => return Some(TOKEN_QRZ),
        "CQ" => return Some(TOKEN_CQ),
        _ => {}
    }
    let n = normalise_standard(call)?;
    let c1 = match n[0] {
        b' ' => 0,
        d @ b'0'..=b'9' => 1 + u32::from(d - b'0'),
        l => 11 + u32::from(l - b'A'),
    };
    let c2 = match n[1] {
        d @ b'0'..=b'9' => u32::from(d - b'0'),
        l => 10 + u32::from(l - b'A'),
    };
    let s = |b: u8| if b == b' ' { 0 } else { 1 + u32::from(b - b'A') };
    Some(
        c1 * RADIX_C1
            + c2 * RADIX_C2
            + u32::from(n[2] - b'0') * RADIX_D
            + s(n[3]) * RADIX_S1
            + s(n[4]) * RADIX_S2
            + s(n[5]),
    )
}

/// Unpacks a 28-bit standard callsign or token. `None` for values past the tokens and for
/// layouts with no letter after the digit.
pub fn unpack28(value: u32) -> Option<String> {
    match value {
        TOKEN_DE => return Some("DE".into()),
        TOKEN_QRZ => return Some("QRZ".into()),
        TOKEN_CQ => return Some("CQ".into()),
        v if v > CALL_MAX_STD => return None,
        _ => {}
    }
    let mut rem = value;
    let c1 = rem / RADIX_C1;
    rem %= RADIX_C1;
    let c2 = rem / RADIX_C2;
    rem %= RADIX_C2;
    let d = rem / RADIX_D;
    rem %= RADIX_D;
    let s1 = rem / RADIX_S1;
    rem %= RADIX_S1;
    if s1 == 0 {
        return None;
    }
    let s2 = rem / RADIX_S2;
    let s3 = rem % RADIX_S2;
    let letter = |i: u32| (b'A' + (i - 1) as u8) as char;
    let mut out = String::new();
    match c1 {
        0 => {}
        1..=10 => out.push((b'0' + (c1 - 1) as u8) as char),
        _ => out.push((b'A' + (c1 - 11) as u8) as char),
    }
    out.push(if c2 < 10 {
        (b'0' + c2 as u8) as char
    } else {
        (b'A' + (c2 - 10) as u8) as char
    });
    out.push((b'0' + d as u8) as char);
    for s in [s1, s2, s3] {
        if s > 0 {
            out.push(letter(s));
        }
    }
    Some(out)
}

/// Splits a standard callsign with an optional /P into its base and the /P flag. `None` when
/// the base is not standard.
pub fn split_standard(call: &str) -> Option<(String, bool)> {
    let c = clean(call);
    if c.is_empty() {
        return None;
    }
    if c.len() > 2 && c.ends_with("/P") {
        let base = &c[..c.len() - 2];
        return is_standard(base).then(|| (base.to_string(), true));
    }
    is_standard(&c).then_some((c, false))
}

/// Splits any callsign the base-38 field can carry (up to 13 characters) into its base and
/// the /P flag; standard callsigns first, as the reference does.
pub fn split_any(call: &str) -> Option<(String, bool)> {
    if let Some(s) = split_standard(call) {
        return Some(s);
    }
    if call.len() > 2 && call.ends_with("/P") {
        let base = &call[..call.len() - 2];
        return valid_nonstd(base, 13).then(|| (base.to_string(), true));
    }
    valid_nonstd(call, 13).then(|| (call.to_string(), false))
}

/// Writes a callsign with its /P flag, never doubling the /P.
pub fn with_suffix(base: &str, portable: bool) -> String {
    if portable && !base.ends_with("/P") {
        format!("{base}/P")
    } else {
        base.to_string()
    }
}

fn base38_index(c: u8) -> Option<u8> {
    match c {
        b' ' => Some(0),
        b'A'..=b'Z' => Some(1 + c - b'A'),
        b'a'..=b'z' => Some(1 + c - b'a'),
        b'/' => Some(27),
        b'0'..=b'9' => Some(28 + c - b'0'),
        _ => None,
    }
}

/// True when `call` has 1 to `max` characters of the base-38 alphabet.
pub fn valid_nonstd(call: &str, max: usize) -> bool {
    !call.is_empty() && call.len() <= max && call.bytes().all(|c| base38_index(c).is_some())
}

/// Bits of a base-38 field of `chars` characters: 48 for 9, 69 for 13.
pub fn base38_bits(chars: usize) -> u32 {
    match chars {
        9 => 48,
        13 => 69,
        _ => 0,
    }
}

/// Packs up to `chars` base-38 characters, right-padded with spaces, as a big-endian number.
pub fn pack_base38(call: &str, chars: usize) -> Option<u128> {
    if !valid_nonstd(call, chars) {
        return None;
    }
    let bytes = call.as_bytes();
    let mut acc = 0u128;
    for i in 0..chars {
        acc = acc * 38 + u128::from(base38_index(*bytes.get(i).unwrap_or(&b' '))?);
    }
    Some(acc)
}

/// Unpacks a base-38 field of `chars` characters, dropping trailing spaces. `None` when the
/// value does not fit `chars` characters.
pub fn unpack_base38(mut value: u128, chars: usize) -> Option<String> {
    let mut out = vec![b' '; chars];
    for slot in out.iter_mut().rev() {
        *slot = NONSTD[(value % 38) as usize];
        value /= 38;
    }
    if value != 0 {
        return None;
    }
    let text = String::from_utf8(out).ok()?;
    Some(text.trim_end_matches(' ').to_string())
}

/// True for a Maidenhead square of 4 characters, AA00 to RR99 (any case for the letters).
pub fn valid_locator(loc: &str) -> bool {
    let b = loc.as_bytes();
    b.len() == 4
        && matches!(b[0].to_ascii_uppercase(), b'A'..=b'R')
        && matches!(b[1].to_ascii_uppercase(), b'A'..=b'R')
        && b[2].is_ascii_digit()
        && b[3].is_ascii_digit()
}

/// Packs a 4-character locator into 15 bits; an empty one is [`LOCATOR_BLANK`].
pub fn pack_locator(loc: &str) -> Option<u16> {
    if loc.is_empty() {
        return Some(LOCATOR_BLANK);
    }
    if !valid_locator(loc) {
        return None;
    }
    let b = loc.as_bytes();
    let f = |c: u8| u16::from(c.to_ascii_uppercase() - b'A');
    Some(f(b[0]) * 1800 + f(b[1]) * 100 + u16::from(b[2] - b'0') * 10 + u16::from(b[3] - b'0'))
}

/// Unpacks a 15-bit locator: `Some("")` for the blank value, `None` past it.
pub fn unpack_locator(value: u16) -> Option<String> {
    if value == LOCATOR_BLANK {
        return Some(String::new());
    }
    if value > LOCATOR_BLANK - 1 {
        return None;
    }
    let chars = [
        b'A' + (value / 1800) as u8,
        b'A' + (value % 1800 / 100) as u8,
        b'0' + (value % 100 / 10) as u8,
        b'0' + (value % 10) as u8,
    ];
    String::from_utf8(chars.to_vec()).ok()
}

fn base32_index(c: u8) -> Option<u32> {
    match c {
        b' ' => Some(0),
        b'A'..=b'Z' => Some(1 + u32::from(c - b'A')),
        b'a'..=b'z' => Some(1 + u32::from(c - b'a')),
        b'0'..=b'4' => Some(27 + u32::from(c - b'0')),
        _ => None,
    }
}

/// Packs a CQ modifier into 20 bits: 0 for none, 1 to 1000 for `000` to `999`, then up to 4
/// characters of A to Z and 0 to 4.
pub fn pack_modifier(text: &str) -> Option<u32> {
    let m = text.trim();
    if m.is_empty() {
        return Some(0);
    }
    let b = m.as_bytes();
    if b.len() == 3 && b.iter().all(u8::is_ascii_digit) {
        let v = b.iter().fold(0u32, |acc, &d| acc * 10 + u32::from(d - b'0'));
        return Some(v + 1);
    }
    if b.len() > 4 {
        return None;
    }
    let mut acc = 0u32;
    for i in 0..4 {
        acc = (acc << 5) | base32_index(*b.get(i).unwrap_or(&b' '))?;
    }
    let packed = 1000 + acc;
    (packed < 1 << 20).then_some(packed)
}

/// Unpacks a 20-bit CQ modifier; `Some("")` for none.
pub fn unpack_modifier(value: u32) -> Option<String> {
    match value {
        0 => Some(String::new()),
        1..=1000 => Some(format!("{:03}", value - 1)),
        v if v < 1 << 20 => {
            let mut acc = v - 1000;
            let mut chars = [b' '; 4];
            for slot in chars.iter_mut().rev() {
                let i = (acc & 0x1F) as u8;
                *slot = match i {
                    1..=26 => b'A' + i - 1,
                    27..=31 => b'0' + i - 27,
                    _ => b' ',
                };
                acc >>= 5;
            }
            let text = String::from_utf8(chars.to_vec()).ok()?;
            Some(text.trim_end_matches(' ').to_string())
        }
        _ => None,
    }
}

/// Packs a report into 5 bits, clamped to −26 to +5 dB.
pub fn pack_report(db: i32) -> u32 {
    (db.clamp(REPORT_MIN_DB, REPORT_MAX_DB) - REPORT_MIN_DB) as u32
}

/// Unpacks a 5-bit report, dB.
pub fn unpack_report(value: u32) -> i32 {
    value.min(31) as i32 + REPORT_MIN_DB
}

/// A report as text: sign and two digits, `-03`, `+05`.
pub fn format_report(db: i32) -> String {
    let v = db.clamp(-30, 30);
    format!("{}{:02}", if v >= 0 { '+' } else { '-' }, v.abs())
}

/// Reads a report such as `-03`, `+05`, `05` or `R-03` (the R is optional); `None` past
/// ±30 dB or for anything else.
pub fn parse_report(text: &str) -> Option<i32> {
    let t = text.trim();
    let t = t.strip_prefix(['R', 'r']).unwrap_or(t);
    let (sign, digits) = match t.as_bytes().first()? {
        b'+' => (1, &t[1..]),
        b'-' => (-1, &t[1..]),
        _ => (1, t),
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) || digits.len() > 3 {
        return None;
    }
    let v: i32 = digits.parse().ok()?;
    (v <= 30).then_some(sign * v)
}

/// The CRC-24/Q table for polynomial 0x864CFB.
const CRC24: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut byte = 0;
    while byte < 256 {
        let mut crc = (byte as u32) << 16;
        let mut b = 0;
        while b < 8 {
            crc = if crc & 0x80_0000 != 0 {
                ((crc << 1) ^ 0x86_4CFB) & 0xFF_FFFF
            } else {
                (crc << 1) & 0xFF_FFFF
            };
            b += 1;
        }
        table[byte] = crc;
        byte += 1;
    }
    table
};

/// The 24-bit callsign hash: CRC-24/Q (initial value and final XOR 0) over the callsign in
/// upper case without surrounding whitespace.
pub fn hash24(call: &str) -> u32 {
    clean(call).bytes().fold(0u32, |crc, b| {
        let i = ((crc >> 16) as u8 ^ b) as usize;
        ((crc << 8) & 0xFF_FFFF) ^ CRC24[i]
    })
}

/// The 20-bit hash of message type 7: the top 20 bits of [`hash24`].
pub fn hash20(call: &str) -> u32 {
    hash24(call) >> 4
}

/// The 16-bit DX hash of the multi-station messages: the callsign left-justified in 11
/// characters of `" 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/"` read in base 38, times
/// 47 055 833 459 modulo 2⁶⁴, top 16 bits. 0 for a callsign with other characters.
pub fn hash16(call: &str) -> u32 {
    const ALPHABET: &[u8] = b" 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/@";
    let c = clean(call);
    let mut x = 0u64;
    for i in 0..11 {
        let ch = *c.as_bytes().get(i).unwrap_or(&b' ');
        let Some(idx) = ALPHABET.iter().position(|&a| a == ch) else {
            return 0;
        };
        x = x.wrapping_mul(38).wrapping_add(idx as u64);
    }
    (x.wrapping_mul(47_055_833_459) >> 48) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_callsigns_pack_by_the_mixed_radix_layout() {
        for call in ["9V1NE", "AB4SS", "9V1DE", "W1AW", "K1ABC", "2E0ABC", "A1B"] {
            let v = pack28(call).expect(call);
            assert!(v <= CALL_MAX_STD);
            assert_eq!(unpack28(v).as_deref(), Some(call));
        }
        assert_eq!(pack28("CQ"), Some(TOKEN_CQ));
        assert_eq!(unpack28(TOKEN_QRZ).as_deref(), Some("QRZ"));
        // A space as the first letter after the digit is no callsign.
        assert_eq!(unpack28(0), None);
        assert_eq!(unpack28(TOKEN_CQ + 1), None);
        for bad in ["OE3OGC/P", "3DA0RU", "VP8/AB4SS", "K1", "ABC1"] {
            assert_eq!(pack28(bad), None, "{bad}");
        }
    }

    #[test]
    fn base38_round_trips_and_rejects_overflow() {
        for call in ["3DA0RU", "VP8/AB4SS", "OE3OGC/QRP"] {
            let v = pack_base38(call, 13).expect(call);
            assert_eq!(unpack_base38(v, 13).as_deref(), Some(call));
        }
        assert!(38u128.pow(9) < 1 << 48 && 38u128.pow(13) < 1 << 69);
        assert_eq!(unpack_base38(1 << 48, 9), None);
        assert_eq!(pack_base38("ABCDEFGHIJ", 9), None);
    }

    #[test]
    fn locators_modifiers_and_reports_follow_section_iv() {
        assert_eq!(pack_locator("AA00"), Some(0));
        assert_eq!(pack_locator("RR99"), Some(32_399));
        assert_eq!(unpack_locator(32_399).as_deref(), Some("RR99"));
        assert_eq!(unpack_locator(LOCATOR_BLANK).as_deref(), Some(""));
        assert_eq!(unpack_locator(32_401), None);
        assert_eq!(pack_modifier("040"), Some(41));
        assert_eq!(unpack_modifier(41).as_deref(), Some("040"));
        for m in ["DX", "POTA", "TEST", "4X4", "100K"] {
            assert_eq!(unpack_modifier(pack_modifier(m).expect(m)).as_deref(), Some(m));
        }
        assert_eq!(pack_modifier("WWFF5"), None);
        assert_eq!(pack_modifier("CQ9"), None);
        assert_eq!(pack_report(-40), 0);
        assert_eq!(unpack_report(pack_report(12)), 5);
        assert_eq!(format_report(0), "+00");
        assert_eq!(parse_report("R-03"), Some(-3));
        assert_eq!(parse_report("73"), None);
    }

    #[test]
    fn hashes_match_the_specification_examples() {
        // Section IV: H16(HB9IPH) = 0x7A8B. The reference's golden vectors give the 24-bit
        // hashes of HB9IPH and YO1YO as 5fe437 and f674cb (GV_M73_NONSTD_02 and _03).
        assert_eq!(hash16("HB9IPH"), 0x7a8b);
        assert_eq!(hash24("HB9IPH"), 0x5f_e437);
        assert_eq!(hash24("yo1yo "), 0xf6_74cb);
        assert_eq!(hash20("YO1YO"), 0xf_674c);
    }
}
