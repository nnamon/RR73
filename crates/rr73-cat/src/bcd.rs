//! Binary-coded decimal as CI-V carries it: two decimal digits per byte, the higher digit in the
//! upper four bits.
//!
//! Frequencies run least significant byte first (CI-V guide p. 17, "Operating frequency"):
//!
//! | Byte | Upper 4 bits | Lower 4 bits |
//! | --- | --- | --- |
//! | 1 | 10 Hz | 1 Hz |
//! | 2 | 1 kHz | 100 Hz |
//! | 3 | 100 kHz | 10 kHz |
//! | 4 | 10 MHz | 1 MHz |
//! | 5 | 1 GHz, fixed at 0 | 100 MHz, 0 to 4 |
//!
//! Codes and levels of two or four digits run most significant byte first: menu item `0131` is
//! the bytes `01 31` and level `0255` the bytes `02 55` (pp. 3 to 16).

use thiserror::Error;

/// Highest frequency the IC-705's 5-byte format carries, in Hz: the 1 GHz digit is fixed at 0
/// and the 100 MHz digit runs from 0 to 4 (CI-V guide p. 17).
pub const MAX_FREQUENCY_HZ: u64 = 499_999_999;

/// Bytes in a frequency (p. 17).
pub const FREQUENCY_BYTES: usize = 5;

/// Why bytes or a value do not convert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum BcdError {
    /// A digit above 9.
    #[error("byte {0:#04X} is not two decimal digits")]
    NotBcd(u8),
    /// The wrong number of bytes.
    #[error("{found} bytes where {expected} are needed")]
    Length {
        /// Bytes needed.
        expected: usize,
        /// Bytes given.
        found: usize,
    },
    /// A value the format cannot carry.
    #[error("{0} is outside the range the format carries")]
    Range(u64),
}

/// The two digits of one byte, as a number from 0 to 99.
pub fn decode_byte(b: u8) -> Result<u8, BcdError> {
    let (hi, lo) = (b >> 4, b & 0x0F);
    if hi > 9 || lo > 9 {
        return Err(BcdError::NotBcd(b));
    }
    Ok(hi * 10 + lo)
}

/// A number from 0 to 99 as one byte of two digits.
pub fn encode_byte(v: u8) -> Result<u8, BcdError> {
    if v > 99 {
        return Err(BcdError::Range(u64::from(v)));
    }
    Ok(((v / 10) << 4) | (v % 10))
}

/// Bytes most significant first, as for menu items and levels: `[0x02, 0x55]` is 255.
pub fn decode_be(bytes: &[u8]) -> Result<u32, BcdError> {
    if bytes.len() > 4 {
        return Err(BcdError::Length {
            expected: 4,
            found: bytes.len(),
        });
    }
    bytes
        .iter()
        .try_fold(0u32, |acc, &b| Ok(acc * 100 + u32::from(decode_byte(b)?)))
}

/// `value` as `n` bytes most significant first: 255 in 2 bytes is `[0x02, 0x55]`.
pub fn encode_be(value: u32, n: usize) -> Result<Vec<u8>, BcdError> {
    let mut out = vec![0u8; n];
    let mut v = value;
    for b in out.iter_mut().rev() {
        *b = encode_byte((v % 100) as u8)?;
        v /= 100;
    }
    if v != 0 {
        return Err(BcdError::Range(u64::from(value)));
    }
    Ok(out)
}

/// A frequency in Hz as the 5 bytes of p. 17. Refuses frequencies above [`MAX_FREQUENCY_HZ`].
pub fn encode_frequency(hz: u64) -> Result<[u8; FREQUENCY_BYTES], BcdError> {
    if hz > MAX_FREQUENCY_HZ {
        return Err(BcdError::Range(hz));
    }
    let mut out = [0u8; FREQUENCY_BYTES];
    let mut v = hz;
    for b in &mut out {
        *b = encode_byte((v % 100) as u8)?;
        v /= 100;
    }
    Ok(out)
}

/// The frequency in Hz that 5 bytes of p. 17 carry. Refuses digits above 9, a 1 GHz digit
/// other than 0 and a 100 MHz digit above 4, which the IC-705's format does not use.
pub fn decode_frequency(bytes: &[u8]) -> Result<u64, BcdError> {
    if bytes.len() != FREQUENCY_BYTES {
        return Err(BcdError::Length {
            expected: FREQUENCY_BYTES,
            found: bytes.len(),
        });
    }
    let mut hz = 0u64;
    for &b in bytes.iter().rev() {
        hz = hz * 100 + u64::from(decode_byte(b)?);
    }
    if hz > MAX_FREQUENCY_HZ {
        return Err(BcdError::Range(hz));
    }
    Ok(hz)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frequency_digits_follow_page_17() {
        // 14.074000 MHz: 10 Hz 0, 1 Hz 0 | 1 kHz 4, 100 Hz 0 | 100 kHz 0, 10 kHz 7 |
        // 10 MHz 1, 1 MHz 4 | 1 GHz 0, 100 MHz 0.
        assert_eq!(encode_frequency(14_074_000), Ok([0x00, 0x40, 0x07, 0x14, 0x00]));
        // 432.123456 MHz uses every position the format has.
        assert_eq!(encode_frequency(432_123_456), Ok([0x56, 0x34, 0x12, 0x32, 0x04]));
        assert_eq!(decode_frequency(&[0x56, 0x34, 0x12, 0x32, 0x04]), Ok(432_123_456));
        assert_eq!(
            encode_frequency(MAX_FREQUENCY_HZ),
            Ok([0x99, 0x99, 0x99, 0x99, 0x04])
        );
        assert_eq!(encode_frequency(0), Ok([0; 5]));
    }

    #[test]
    fn frequencies_outside_the_format_are_refused() {
        assert_eq!(encode_frequency(500_000_000), Err(BcdError::Range(500_000_000)));
        assert_eq!(
            decode_frequency(&[0, 0, 0, 0, 0x05]),
            Err(BcdError::Range(500_000_000))
        );
        assert_eq!(
            decode_frequency(&[0, 0, 0, 0, 0x10]),
            Err(BcdError::Range(1_000_000_000))
        );
        assert_eq!(decode_frequency(&[0x0A, 0, 0, 0, 0]), Err(BcdError::NotBcd(0x0A)));
        assert_eq!(
            decode_frequency(&[0, 0, 0, 0]),
            Err(BcdError::Length {
                expected: 5,
                found: 4
            })
        );
    }

    #[test]
    fn codes_and_levels_run_most_significant_first() {
        assert_eq!(encode_be(131, 2), Ok(vec![0x01, 0x31]));
        assert_eq!(encode_be(255, 2), Ok(vec![0x02, 0x55]));
        assert_eq!(decode_be(&[0x02, 0x55]), Ok(255));
        assert_eq!(decode_be(&[0x01]), Ok(1));
        assert_eq!(decode_be(&[]), Ok(0));
        assert_eq!(encode_be(100, 1), Err(BcdError::Range(100)));
        assert_eq!(decode_be(&[0x1F]), Err(BcdError::NotBcd(0x1F)));
        assert_eq!(encode_byte(17), Ok(0x17));
        assert_eq!(decode_byte(0x99), Ok(99));
    }
}
