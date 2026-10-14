//! The channel code: K = 32, rate 1/2 convolutional code, bit-reversal interleaving and the
//! 162-bit sync vector.
//!
//! The 50 message bits are followed by 31 zero bits that return the encoder to the zero
//! state, giving 81 input bits. Each input bit is shifted into a 32-bit register (new bit in
//! the least significant position), and the register ANDed with each of the two generator
//! polynomials gives one parity bit, [`POLY_A`] first: 162 code bits. Code bit `p` goes to
//! channel position [`INTERLEAVE`]`[p]`, the `p`-th value of `0..=255` whose 8-bit reversal is
//! below 162. Channel symbol `i` is `SYNC[i] + 2 × data[i]`.

use crate::SYMBOLS;
use crate::message::Packed;

/// First generator polynomial.
pub const POLY_A: u32 = 0xF2D0_5351;

/// Second generator polynomial.
pub const POLY_B: u32 = 0xE461_3C47;

/// Message bits.
pub const MESSAGE_BITS: usize = 50;

/// Zero tail bits that flush the encoder.
pub const TAIL_BITS: usize = 31;

/// Encoder input bits: message plus tail.
pub const INPUT_BITS: usize = MESSAGE_BITS + TAIL_BITS;

/// Code bits, one per channel symbol.
pub const CODE_BITS: usize = 2 * INPUT_BITS;

/// The sync vector: the low bit of each channel symbol.
pub const SYNC: [u8; SYMBOLS] = [
    1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, //
    0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, //
    0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0, //
    0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, //
    0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, //
    0, 0,
];

/// Channel position of each code bit: code bit `p` is sent in symbol `INTERLEAVE[p]`.
pub const INTERLEAVE: [u8; CODE_BITS] = interleave_table();

const fn interleave_table() -> [u8; CODE_BITS] {
    let mut table = [0u8; CODE_BITS];
    let mut p = 0;
    let mut i = 0u32;
    while i < 256 && p < CODE_BITS {
        let j = (i as u8).reverse_bits();
        if (j as usize) < CODE_BITS {
            table[p] = j;
            p += 1;
        }
        i += 1;
    }
    table
}

/// Parity (0 or 1) of the set bits of `x`.
#[inline]
pub fn parity(x: u32) -> u8 {
    (x.count_ones() & 1) as u8
}

/// The two code bits produced when the encoder register holds `register` (the newest input
/// bit in bit 0), [`POLY_A`] first.
#[inline]
pub fn branch_bits(register: u32) -> (u8, u8) {
    (parity(register & POLY_A), parity(register & POLY_B))
}

/// Encodes 81 input bits (0 or 1; message then tail) into 162 code bits in transmission
/// order before interleaving. Values above 1 are read by their low bit.
pub fn convolve(input: &[u8; INPUT_BITS]) -> [u8; CODE_BITS] {
    let mut out = [0u8; CODE_BITS];
    let mut register = 0u32;
    for (i, &bit) in input.iter().enumerate() {
        register = (register << 1) | u32::from(bit & 1);
        let (a, b) = branch_bits(register);
        out[2 * i] = a;
        out[2 * i + 1] = b;
    }
    out
}

/// Moves code bits to their channel positions.
pub fn interleave<T: Copy + Default>(code: &[T; CODE_BITS]) -> [T; CODE_BITS] {
    let mut out = [T::default(); CODE_BITS];
    for (p, &j) in INTERLEAVE.iter().enumerate() {
        out[usize::from(j)] = code[p];
    }
    out
}

/// Reads code bits back from their channel positions: the inverse of [`interleave`].
pub fn deinterleave<T: Copy + Default>(channel: &[T; CODE_BITS]) -> [T; CODE_BITS] {
    let mut out = [T::default(); CODE_BITS];
    for (p, &j) in INTERLEAVE.iter().enumerate() {
        out[p] = channel[usize::from(j)];
    }
    out
}

/// The 162 interleaved data bits of a packed message: the high bit of each channel symbol.
pub fn data_bits(packed: &Packed) -> [u8; SYMBOLS] {
    interleave(&convolve(&packed.encoder_input()))
}

/// The 162 channel symbols (tones 0 to 3) of a packed message.
pub fn symbols(packed: &Packed) -> [u8; SYMBOLS] {
    let data = data_bits(packed);
    let mut out = [0u8; SYMBOLS];
    for i in 0..SYMBOLS {
        out[i] = SYNC[i] + 2 * data[i];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interleaver_is_a_permutation_starting_with_bit_reversal() {
        let mut seen = [false; CODE_BITS];
        for &j in &INTERLEAVE {
            assert!(!seen[usize::from(j)]);
            seen[usize::from(j)] = true;
        }
        // 0 -> 0, 1 -> 128, 2 -> 64, 3 -> 192 (too large, skipped), 4 -> 32.
        assert_eq!(&INTERLEAVE[..4], &[0, 128, 64, 32]);
        let x: [u16; CODE_BITS] = std::array::from_fn(|i| i as u16);
        assert_eq!(deinterleave(&interleave(&x)), x);
    }

    #[test]
    fn sync_vector_is_balanced_as_published() {
        assert_eq!(SYNC.iter().filter(|&&b| b == 1).count(), 63);
        assert_eq!(&SYNC[..8], &[1, 1, 0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn encoder_is_linear_and_flushes_to_zero() {
        let mut a = [0u8; INPUT_BITS];
        let mut b = [0u8; INPUT_BITS];
        a[0] = 1;
        a[17] = 1;
        b[3] = 1;
        b[49] = 1;
        let mut ab = [0u8; INPUT_BITS];
        for i in 0..INPUT_BITS {
            ab[i] = a[i] ^ b[i];
        }
        let (ca, cb, cab) = (convolve(&a), convolve(&b), convolve(&ab));
        for i in 0..CODE_BITS {
            assert_eq!(cab[i], ca[i] ^ cb[i]);
        }
        // A single 1 at the first position produces the polynomials' bits over 32 steps.
        let mut one = [0u8; INPUT_BITS];
        one[0] = 1;
        let c = convolve(&one);
        for k in 0..32 {
            assert_eq!(c[2 * k], ((POLY_A >> k) & 1) as u8);
            assert_eq!(c[2 * k + 1], ((POLY_B >> k) & 1) as u8);
        }
        assert!(c[64..].iter().all(|&x| x == 0));
    }
}
