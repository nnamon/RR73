//! CRC-14 over the 77-bit payload, as used by FT8 and FT4.

/// Computes the CRC-14 of `bits` message bits packed MSB first in `data`.
pub fn crc14(data: &[u8], bits: usize) -> u16 {
    let _ = (data, bits);
    todo!("rr73-ft8: crc14")
}

/// Returns the 91-bit message (payload plus CRC) packed MSB first in 12 bytes.
pub fn append(payload: &crate::Payload) -> [u8; 12] {
    let _ = payload;
    todo!("rr73-ft8: crc append")
}

/// Returns the payload if the CRC in a 91-bit message (12 bytes, MSB first) is correct.
pub fn check(message91: &[u8; 12]) -> Option<crate::Payload> {
    let _ = message91;
    todo!("rr73-ft8: crc check")
}
