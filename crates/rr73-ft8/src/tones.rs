//! Mapping between codewords and channel symbols.
//!
//! FT8 sends 79 symbols: the Costas array at symbols 0, 36 and 72 and 58 data symbols of 3
//! codeword bits each. FT4 sends 105 symbols: a ramp symbol, four different 4-symbol sync
//! arrays separating three blocks of 29 data symbols of 2 bits each, and a closing ramp
//! symbol (QEX, section 4). Codeword bits map to tones through a Gray code (QEX, Table 3).
//!
//! LQ8 sends FT8's arrangement with its own Costas array (lq_lib by Luis Quesada HB9IPH, MIT
//! licence, commit 00f3bcf: `include/lq/constants.h` and `src/transport.cpp`).
//!
//! The arrangement follows `ft8/encode.c` in ft8_lib by Kārlis Goba (MIT licence); the
//! constants match `ft8/constants.c` there and QEX.

use crate::{Mode, Payload, crc, ldpc};

/// FT8 Costas sync array, sent at symbols 0, 36 and 72.
pub const FT8_COSTAS: [u8; 7] = [3, 1, 4, 0, 6, 5, 2];

/// LQ8 Costas sync array, sent at the FT8 positions, symbols 0, 36 and 72.
pub const LQ8_COSTAS: [u8; 7] = [2, 5, 6, 1, 3, 0, 4];

/// Symbol indices where each FT8 Costas array starts.
pub const FT8_COSTAS_STARTS: [usize; 3] = [0, 36, 72];

/// FT4 sync arrays, one per sync group.
pub const FT4_COSTAS: [[u8; 4]; 4] = [[0, 1, 3, 2], [1, 0, 2, 3], [2, 3, 1, 0], [3, 2, 0, 1]];

/// Symbol indices where each FT4 sync array starts. Symbols 0 and 104 are ramp symbols.
pub const FT4_COSTAS_STARTS: [usize; 4] = [1, 34, 67, 100];

/// Gray map from 3 code bits to an FT8 tone.
pub const FT8_GRAY: [u8; 8] = [0, 1, 3, 2, 5, 6, 4, 7];

/// Gray map from 2 code bits to an FT4 tone.
pub const FT4_GRAY: [u8; 4] = [0, 1, 3, 2];

/// Pseudorandom vector XORed with the FT4 payload before the CRC, 77 bits MSB first.
pub const FT4_XOR: [u8; 10] = [0x4A, 0x5E, 0x89, 0xB4, 0xB0, 0x8A, 0x79, 0x55, 0xBE, 0x28];

/// Returns the 174-bit codeword (one bit per byte) sent for a payload in `mode`: CRC, the
/// FT4 XOR where it applies, and LDPC parity.
pub fn codeword(mode: Mode, payload: &Payload) -> [u8; ldpc::N] {
    ldpc::encode(&crc::message91(mode, payload))
}

/// Returns the channel tones for a payload: 79 for FT8, 105 for FT4 (ramp symbols are tone 0).
pub fn from_payload(mode: Mode, payload: &Payload) -> Vec<u8> {
    from_codeword(mode, &codeword(mode, payload))
}

/// Returns the channel tones for a codeword of 174 bits (one bit per byte, lowest bit read):
/// sync and ramp symbols in place, data symbols Gray-mapped in codeword order.
pub fn from_codeword(mode: Mode, codeword: &[u8; ldpc::N]) -> Vec<u8> {
    let params = mode.params();
    let mut tones = vec![0u8; params.symbols];
    match mode {
        Mode::Ft8 | Mode::Lq8 => {
            let costas = if mode == Mode::Lq8 { LQ8_COSTAS } else { FT8_COSTAS };
            for start in FT8_COSTAS_STARTS {
                tones[start..start + 7].copy_from_slice(&costas);
            }
        }
        Mode::Ft4 => {
            for (start, costas) in FT4_COSTAS_STARTS.iter().zip(FT4_COSTAS) {
                tones[*start..start + 4].copy_from_slice(&costas);
            }
        }
    }
    let bits_per_symbol = bits_per_symbol(mode);
    for (k, symbol) in data_symbols(mode).into_iter().enumerate() {
        let bits = codeword[k * bits_per_symbol..(k + 1) * bits_per_symbol]
            .iter()
            .fold(0usize, |acc, &b| (acc << 1) | usize::from(b & 1));
        tones[symbol] = match mode {
            Mode::Ft8 | Mode::Lq8 => FT8_GRAY[bits],
            Mode::Ft4 => FT4_GRAY[bits],
        };
    }
    tones
}

/// Returns the data symbol indices of a mode, in the order the codeword is sent.
pub fn data_symbols(mode: Mode) -> Vec<usize> {
    match mode {
        Mode::Ft8 | Mode::Lq8 => (7..36).chain(43..72).collect(),
        Mode::Ft4 => (5..34).chain(38..67).chain(71..100).collect(),
    }
}

/// Codeword bits carried by one data symbol: 3 for FT8, 2 for FT4.
pub fn bits_per_symbol(mode: Mode) -> usize {
    match mode {
        Mode::Ft8 | Mode::Lq8 => 3,
        Mode::Ft4 => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gray_maps_match_qex_table_3() {
        // QEX Table 3 lists the bits for each channel symbol.
        let ft8_bits_of_tone = [0b000, 0b001, 0b011, 0b010, 0b110, 0b100, 0b101, 0b111];
        for (tone, bits) in ft8_bits_of_tone.iter().enumerate() {
            assert_eq!(usize::from(FT8_GRAY[*bits]), tone);
        }
        let ft4_bits_of_tone = [0b00, 0b01, 0b11, 0b10];
        for (tone, bits) in ft4_bits_of_tone.iter().enumerate() {
            assert_eq!(usize::from(FT4_GRAY[*bits]), tone);
        }
        // Adjacent tones differ in one bit.
        for t in 0..7 {
            assert_eq!((ft8_bits_of_tone[t] ^ ft8_bits_of_tone[t + 1]).count_ones(), 1);
        }
    }

    #[test]
    fn ft4_xor_matches_qex_appendix_a() {
        let bits = "0100101001011110100010\
                    0110110100101100001000\
                    1010011110010101010110\
                    11111000101";
        assert_eq!(bits.len(), 77);
        let from_text = Payload::from_bits(&bits.bytes().map(|b| b - b'0').collect::<Vec<_>>());
        assert_eq!(from_text.0, FT4_XOR);
    }

    #[test]
    fn costas_arrays_match_qex_section_4() {
        assert_eq!(FT8_COSTAS, [3, 1, 4, 0, 6, 5, 2]);
        assert_eq!(
            FT4_COSTAS,
            [[0, 1, 3, 2], [1, 0, 2, 3], [2, 3, 1, 0], [3, 2, 0, 1]]
        );
    }

    #[test]
    fn data_symbols_cover_the_codeword_once() {
        for mode in [Mode::Ft8, Mode::Ft4, Mode::Lq8] {
            let symbols = data_symbols(mode);
            assert_eq!(symbols.len() * bits_per_symbol(mode), ldpc::N);
            let mut sorted = symbols.clone();
            sorted.dedup();
            assert_eq!(sorted.len(), symbols.len());
        }
        let ft8 = data_symbols(Mode::Ft8);
        for start in FT8_COSTAS_STARTS {
            assert!((start..start + 7).all(|s| !ft8.contains(&s)));
        }
        let ft4 = data_symbols(Mode::Ft4);
        assert!(!ft4.contains(&0) && !ft4.contains(&104));
        for start in FT4_COSTAS_STARTS {
            assert!((start..start + 4).all(|s| !ft4.contains(&s)));
        }
    }

    #[test]
    fn sync_and_ramp_symbols_are_in_place() {
        let payload = Payload([0xff; 10]).masked();
        let ft8 = from_payload(Mode::Ft8, &payload);
        assert_eq!(ft8.len(), 79);
        for start in FT8_COSTAS_STARTS {
            assert_eq!(ft8[start..start + 7], FT8_COSTAS);
        }
        assert!(ft8.iter().all(|&t| t < 8));
        let ft4 = from_payload(Mode::Ft4, &payload);
        assert_eq!(ft4.len(), 105);
        assert_eq!((ft4[0], ft4[104]), (0, 0));
        for (start, costas) in FT4_COSTAS_STARTS.iter().zip(FT4_COSTAS) {
            assert_eq!(ft4[*start..start + 4], costas);
        }
        assert!(ft4.iter().all(|&t| t < 4));
        let lq8 = from_payload(Mode::Lq8, &payload);
        for start in FT8_COSTAS_STARTS {
            assert_eq!(lq8[start..start + 7], LQ8_COSTAS);
        }
        // Only the sync symbols differ from FT8.
        for k in data_symbols(Mode::Ft8) {
            assert_eq!(lq8[k], ft8[k]);
        }
    }
}
