//! CRC-14 over the 77-bit payload, as used by FT8 and FT4.
//!
//! The CRC is computed over the payload zero-extended from 77 to 82 bits, with the polynomial
//! 0x6757 and an initial value of zero (QEX, section 3). The 91-bit message is the payload
//! followed by the 14 CRC bits, stored MSB first in 12 bytes with the last 5 bits zero.
//!
//! Ported from `ft8/crc.c` in ft8_lib by Kārlis Goba (MIT licence).

use crate::{Mode, Payload};

/// The CRC-14 polynomial without its x^14 term (0x6757 with the leading bit dropped).
pub const POLYNOMIAL: u16 = 0x2757;

/// Number of CRC bits.
pub const WIDTH: usize = 14;

const TOP_BIT: u16 = 1 << (WIDTH - 1);
const MASK: u16 = (1 << WIDTH) - 1;

/// Computes the CRC-14 of `bits` message bits packed MSB first in `data`. Bits past the
/// end of `data` count as zero.
pub fn crc14(data: &[u8], bits: usize) -> u16 {
    let mut remainder: u16 = 0;
    for i in 0..bits {
        if i % 8 == 0 {
            let byte = data.get(i / 8).copied().unwrap_or(0);
            remainder ^= u16::from(byte) << (WIDTH - 8);
        }
        remainder = if remainder & TOP_BIT != 0 {
            (remainder << 1) ^ POLYNOMIAL
        } else {
            remainder << 1
        };
    }
    remainder & MASK
}

/// Returns the 91-bit message (payload plus CRC) packed MSB first in 12 bytes.
pub fn append(payload: &crate::Payload) -> [u8; 12] {
    let mut a91 = [0u8; 12];
    a91[..10].copy_from_slice(&payload.masked().0);
    // 77 payload bits plus 5 zero bits.
    let crc = crc14(&a91, 82);
    a91[9] |= (crc >> 11) as u8;
    a91[10] = (crc >> 3) as u8;
    a91[11] = (crc << 5) as u8;
    a91
}

/// Returns the payload if the CRC in a 91-bit message (12 bytes, MSB first) is correct.
/// Bits after bit 90 are ignored.
pub fn check(message91: &[u8; 12]) -> Option<crate::Payload> {
    let received = (u16::from(message91[9] & 0x07) << 11)
        | (u16::from(message91[10]) << 3)
        | (u16::from(message91[11]) >> 5);
    let mut payload = [0u8; 10];
    payload.copy_from_slice(&message91[..10]);
    let payload = Payload(payload).masked();
    (crc14(&payload.0, 82) == received).then_some(payload)
}

/// Returns the 91-bit message sent in `mode`. FT4 XORs the payload with
/// [`FT4_XOR`](crate::tones::FT4_XOR) before computing the CRC; FT8 and LQ8 send it unchanged.
pub fn message91(mode: Mode, payload: &Payload) -> [u8; 12] {
    match mode {
        Mode::Ft8 | Mode::Lq8 => append(payload),
        Mode::Ft4 => append(&payload.ft4_scrambled()),
    }
}

/// Returns the payload carried by a 91-bit message received in `mode`, or `None` if the CRC
/// fails. Undoes the FT4 XOR. This is the inverse of [`message91`].
pub fn payload_from_message91(mode: Mode, message91: &[u8; 12]) -> Option<Payload> {
    let payload = check(message91)?;
    Some(match mode {
        Mode::Ft8 | Mode::Lq8 => payload,
        Mode::Ft4 => payload.ft4_scrambled(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Bitwise long division with the full 15-bit polynomial, written independently of
    /// [`crc14`] from the description in QEX, section 3.
    fn reference_crc(payload: &Payload) -> u16 {
        let poly: [u8; 15] = [1, 1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1];
        let mut bits: Vec<u8> = (0..77).map(|i| payload.bit(i)).collect();
        bits.extend([0; 5 + 14]);
        for i in 0..82 {
            if bits[i] == 1 {
                for (j, p) in poly.iter().enumerate() {
                    bits[i + j] ^= p;
                }
            }
        }
        bits[82..96].iter().fold(0, |acc, &b| (acc << 1) | u16::from(b))
    }

    #[test]
    fn polynomial_is_0x6757() {
        assert_eq!(0x4000 | POLYNOMIAL, 0x6757);
    }

    #[test]
    fn matches_long_division() {
        let mut state = 0x1234_5678_9abc_def0_u64;
        for _ in 0..500 {
            let mut bytes = [0u8; 10];
            for b in &mut bytes {
                state = state
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                *b = (state >> 56) as u8;
            }
            let payload = Payload(bytes).masked();
            let a91 = append(&payload);
            let crc = (u16::from(a91[9] & 7) << 11) | (u16::from(a91[10]) << 3) | (u16::from(a91[11]) >> 5);
            assert_eq!(crc, reference_crc(&payload));
        }
    }

    #[test]
    fn check_accepts_appended_and_rejects_flips() {
        let payload = Payload([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x28]);
        let a91 = append(&payload);
        assert_eq!(check(&a91), Some(payload.masked()));
        for bit in 0..91 {
            let mut bad = a91;
            bad[bit / 8] ^= 0x80 >> (bit % 8);
            assert_eq!(check(&bad), None, "bit {bit}");
        }
    }

    #[test]
    fn append_ignores_unused_payload_bits() {
        let dirty = Payload([0xff; 10]);
        assert_eq!(append(&dirty), append(&dirty.masked()));
        let only_unused = Payload([0, 0, 0, 0, 0, 0, 0, 0, 0, 0x07]);
        assert_eq!(append(&only_unused), append(&Payload::default()));
    }

    #[test]
    fn ft4_xor_round_trips() {
        let payload = Payload([0xa5; 10]).masked();
        for mode in [Mode::Ft8, Mode::Ft4] {
            let a91 = message91(mode, &payload);
            assert_eq!(payload_from_message91(mode, &a91), Some(payload));
        }
        assert_ne!(message91(Mode::Ft8, &payload), message91(Mode::Ft4, &payload));
    }

    #[test]
    fn crc14_handles_short_input() {
        assert_eq!(crc14(&[], 82), 0);
        assert_eq!(
            crc14(&[0x80], 82),
            crc14(&[0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 82)
        );
    }
}
