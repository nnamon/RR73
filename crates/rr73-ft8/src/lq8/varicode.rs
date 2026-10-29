//! The LQ free-text code: a prefix code of 104 characters, 3 to 18 bits each, filling the 73
//! payload bits of message type 13.
//!
//! Ported from `src/varicode.cpp` in lq_lib by Luis Quesada HB9IPH (MIT licence, commit
//! 00f3bcf); the licence is in `LICENSE-lq_lib` next to this crate's manifest. The table is
//! the specification's Table 4.

/// Payload bits of a free-text message.
pub const BITS: u32 = 73;

/// End of message: stops decoding, and follows the text when it fits.
const EOM: u8 = 0x01;
/// The all-zero codeword: stops decoding.
const FILL: u8 = 0x04;

/// (character as Latin-1, code, code length) in the reference's order.
const TABLE: [(u8, u32, u32); 104] = [
    (0x20, 0x00001, 3),
    (0x45, 0x00002, 3),
    (0x54, 0x00006, 4),
    (0x41, 0x00007, 4),
    (0x4F, 0x00008, 4),
    (0x4E, 0x00009, 4),
    (0x49, 0x0000A, 4),
    (0x53, 0x0000B, 4),
    (0x52, 0x0000C, 4),
    (0x48, 0x0000D, 4),
    (0x44, 0x0001C, 5),
    (0x4C, 0x0001D, 5),
    (0x43, 0x0001E, 5),
    (0x55, 0x0003E, 6),
    (0x4D, 0x0003F, 6),
    (0x46, 0x00004, 6),
    (0x57, 0x00005, 6),
    (0x50, 0x00006, 6),
    (0x47, 0x00007, 6),
    (0x59, 0x00002, 6),
    (0x42, 0x00003, 6),
    (0x56, 0x00002, 7),
    (0x4B, 0x00006, 8),
    (0x01, 0x00007, 8),
    (0x58, 0x00004, 9),
    (0x4A, 0x0000A, 10),
    (0x31, 0x0000B, 10),
    (0x51, 0x0000C, 10),
    (0x21, 0x0000D, 10),
    (0x3F, 0x0000E, 10),
    (0x5A, 0x0000F, 10),
    (0x2C, 0x00008, 11),
    (0x2E, 0x00009, 11),
    (0x30, 0x0000A, 11),
    (0x32, 0x0000B, 11),
    (0x38, 0x0000C, 11),
    (0x33, 0x0000D, 11),
    (0x34, 0x0000E, 11),
    (0x35, 0x0000F, 11),
    (0x39, 0x00004, 11),
    (0x36, 0x00005, 11),
    (0x37, 0x0000C, 12),
    (0x22, 0x0000D, 12),
    (0x2D, 0x0000E, 12),
    (0x27, 0x0000F, 12),
    (0x5F, 0x00004, 12),
    (0x3B, 0x00005, 12),
    (0x3A, 0x00006, 12),
    (0x3D, 0x0000E, 13),
    (0x28, 0x0000F, 13),
    (0x29, 0x00004, 13),
    (0x23, 0x00005, 13),
    (0x2A, 0x00006, 13),
    (0x5B, 0x0000E, 14),
    (0x5D, 0x0000F, 14),
    (0x7C, 0x00004, 14),
    (0x2F, 0x0000A, 15),
    (0x24, 0x00016, 16),
    (0x2B, 0x00017, 16),
    (0x0A, 0x00018, 16),
    (0x25, 0x00019, 16),
    (0x26, 0x0001A, 16),
    (0x3C, 0x0001B, 16),
    (0x3E, 0x00038, 17),
    (0x40, 0x00039, 17),
    (0x5C, 0x0003A, 17),
    (0x5E, 0x0003B, 17),
    (0x60, 0x0003C, 17),
    (0x7B, 0x0003D, 17),
    (0x7D, 0x0003E, 17),
    (0x7E, 0x0003F, 17),
    (0xA1, 0x00010, 17),
    (0xBF, 0x00011, 17),
    (0xC0, 0x00012, 17),
    (0xC1, 0x00013, 17),
    (0xC2, 0x00014, 17),
    (0xC3, 0x00015, 17),
    (0xC4, 0x00016, 17),
    (0xC5, 0x00017, 17),
    (0xC6, 0x00018, 17),
    (0xC7, 0x00019, 17),
    (0xC8, 0x0001A, 17),
    (0xC9, 0x0001B, 17),
    (0xCA, 0x0001C, 17),
    (0xCB, 0x0001D, 17),
    (0xCC, 0x0001E, 17),
    (0xCD, 0x0001F, 17),
    (0xCE, 0x00008, 17),
    (0xCF, 0x00009, 17),
    (0xD0, 0x0000A, 17),
    (0xD1, 0x0000B, 17),
    (0xD2, 0x0000C, 17),
    (0xD3, 0x0000D, 17),
    (0xD4, 0x0000E, 17),
    (0xD5, 0x0000F, 17),
    (0xD6, 0x00004, 17),
    (0xD8, 0x00005, 17),
    (0xD9, 0x00006, 17),
    (0xDA, 0x00007, 17),
    (0xDB, 0x00002, 17),
    (0xDC, 0x00003, 17),
    (0xDD, 0x00001, 17),
    (0xDE, 0x00001, 18),
    (0x04, 0x00000, 18),
];

fn entry(byte: u8) -> Option<(u32, u32)> {
    let norm = match byte {
        b'a'..=b'z' => byte - 32,
        0xE0..=0xFE if byte != 0xF7 => byte - 32,
        _ => byte,
    };
    TABLE
        .iter()
        .find(|(c, _, _)| *c == norm)
        .map(|&(_, code, len)| (code, len))
}

/// The Latin-1 characters of `text` as the encoder reads them: UTF-8 Latin-1 letters become
/// their byte, the two lightning signs become the end of message, other characters a space.
fn bytes_of(text: &str) -> Vec<u8> {
    let b = text.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c < 0x80 {
            out.push(c);
            i += 1;
        } else if (c == 0xC2 || c == 0xC3) && i + 1 < b.len() && b[i + 1] & 0xC0 == 0x80 {
            out.push(if c == 0xC2 { b[i + 1] } else { b[i + 1] + 0x40 });
            i += 2;
        } else if c == 0xE2 && i + 2 < b.len() {
            let eom = matches!((b[i + 1], b[i + 2]), (0x8C, 0x81) | (0x9A, 0xA1));
            out.push(if eom { EOM } else { b' ' });
            i += 3;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// Encodes `text` into at most [`BITS`] bits as the reference does: each character that fits
/// with room for the end-of-message code, then that code, then zeros. Characters without a
/// code go as a space. Returns the bits (MSB first, in the low [`BITS`] bits) and the number
/// of characters written.
pub fn encode(text: &str) -> (u128, usize) {
    let mut acc = 0u128;
    let mut used = 0u32;
    let mut written = 0;
    let space = entry(b' ').unwrap_or((1, 3));
    for byte in bytes_of(text) {
        let (code, len) = entry(byte).unwrap_or(space);
        if used + len + 8 > BITS {
            break;
        }
        acc = (acc << len) | u128::from(code);
        used += len;
        written += 1;
    }
    if let Some((code, len)) = entry(EOM).filter(|&(_, len)| used + len <= BITS) {
        acc = (acc << len) | u128::from(code);
        used += len;
    }
    (acc << (BITS - used), written)
}

/// Number of characters of `text` (as the encoder reads it) that fit in one message.
pub fn fitting(text: &str) -> usize {
    encode(text).1
}

/// Number of characters in `text` as the encoder reads it.
pub fn length(text: &str) -> usize {
    bytes_of(text).len()
}

/// Decodes [`BITS`] bits (MSB first, in the low bits of `bits`) up to the end of message, the
/// fill code or a bit pattern with no code.
pub fn decode(bits: u128) -> String {
    let mut out = String::new();
    let mut code = 0u32;
    let mut len = 0u32;
    for i in (0..BITS).rev() {
        code = (code << 1) | ((bits >> i) & 1) as u32;
        len += 1;
        if let Some(&(c, _, _)) = TABLE.iter().find(|&&(_, k, l)| l == len && k == code) {
            if c == EOM || c == FILL {
                return out;
            }
            out.push(char::from(c));
            code = 0;
            len = 0;
        } else if len >= 18 {
            return out;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_is_a_complete_prefix_code() {
        let kraft: f64 = TABLE.iter().map(|&(_, _, l)| 0.5f64.powi(l as i32)).sum();
        assert!((kraft - 1.0).abs() < 1e-12);
        for (i, a) in TABLE.iter().enumerate() {
            for b in &TABLE[i + 1..] {
                let (short, long) = if a.2 <= b.2 { (a, b) } else { (b, a) };
                assert_ne!(long.1 >> (long.2 - short.2), short.1, "{a:?} {b:?}");
            }
        }
    }

    #[test]
    fn text_round_trips_with_latin_1_and_case_folding() {
        for text in ["TNX 73 GL", "ESPAÑA 73", "HELLO DE EA8"] {
            assert_eq!(decode(encode(text).0), text);
        }
        assert_eq!(decode(encode("tnx fer qso").0), "TNX FER QSO");
        assert_eq!(decode(encode("año").0), "AÑO");
        // A character without a code goes as a space.
        assert_eq!(decode(encode("A€B").0), "A B");
    }

    #[test]
    fn long_text_stops_where_it_no_longer_fits() {
        let long = "ETAOIN SHRDLU ETAOIN SHRDLU ETAOIN";
        let (bits, n) = encode(long);
        assert!(n < long.len() && n > 13);
        assert_eq!(decode(bits), &long[..n]);
        assert_eq!(fitting("QQQQQQQQQQ"), 6);
    }
}
