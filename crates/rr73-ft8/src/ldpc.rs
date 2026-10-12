//! The (174,91) LDPC code shared by FT8 and FT4.
//!
//! Codeword bit order: the 91 message bits (payload and CRC) first, then 83 parity bits.

/// Codeword length in bits.
pub const N: usize = 174;
/// Message length in bits (77 payload + 14 CRC).
pub const K: usize = 91;
/// Number of parity checks.
pub const M: usize = 83;

/// Encodes a 91-bit message (12 bytes, MSB first) into a codeword of 174 bits, one bit per byte.
pub fn encode(message91: &[u8; 12]) -> [u8; N] {
    let _ = message91;
    todo!("rr73-ft8: ldpc encode")
}

/// Returns the number of unsatisfied parity checks for a codeword of 174 hard bits (0/1).
pub fn check(codeword: &[u8; N]) -> usize {
    let _ = codeword;
    todo!("rr73-ft8: ldpc check")
}

/// For each parity check, the codeword bit indices (0-based) it covers. Rows hold 6 or 7 bits.
pub fn check_to_bits() -> &'static [&'static [u16]; M] {
    todo!("rr73-ft8: parity structure")
}

/// For each codeword bit, the three parity checks (0-based) it takes part in.
pub fn bit_to_checks() -> &'static [[u16; 3]; N] {
    todo!("rr73-ft8: parity structure")
}

/// Packs the first 91 bits of a codeword (one bit per byte) into 12 bytes, MSB first.
pub fn message_bits(codeword: &[u8; N]) -> [u8; 12] {
    let mut out = [0u8; 12];
    for (i, &b) in codeword.iter().take(K).enumerate() {
        out[i / 8] |= (b & 1) << (7 - (i % 8));
    }
    out
}
