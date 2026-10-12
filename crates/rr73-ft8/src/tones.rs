//! Mapping between codewords and channel symbols.

use crate::{Mode, Payload};

/// FT8 Costas sync array, sent at symbols 0, 36 and 72.
pub const FT8_COSTAS: [u8; 7] = [3, 1, 4, 0, 6, 5, 2];

/// Symbol indices where each FT8 Costas array starts.
pub const FT8_COSTAS_STARTS: [usize; 3] = [0, 36, 72];

/// FT4 sync arrays, one per sync group.
pub const FT4_COSTAS: [[u8; 4]; 4] = [[0, 1, 3, 2], [1, 0, 2, 3], [2, 3, 1, 0], [3, 2, 0, 1]];

/// Gray map from 3 code bits to an FT8 tone.
pub const FT8_GRAY: [u8; 8] = [0, 1, 3, 2, 5, 6, 4, 7];

/// Gray map from 2 code bits to an FT4 tone.
pub const FT4_GRAY: [u8; 4] = [0, 1, 3, 2];

/// Pseudorandom vector XORed with the FT4 payload before the CRC, 77 bits MSB first.
pub const FT4_XOR: [u8; 10] = [0x4A, 0x5E, 0x89, 0xB4, 0xB0, 0x8A, 0x79, 0x55, 0xBE, 0x28];

/// Returns the channel tones for a payload: 79 for FT8, 105 for FT4 (ramp symbols are tone 0).
pub fn from_payload(mode: Mode, payload: &Payload) -> Vec<u8> {
    let _ = (mode, payload);
    todo!("rr73-ft8: tones")
}

/// Returns the data symbol indices of a mode, in the order the codeword is sent.
pub fn data_symbols(mode: Mode) -> Vec<usize> {
    let _ = mode;
    todo!("rr73-ft8: data symbol layout")
}
