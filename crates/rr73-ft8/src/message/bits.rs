//! Sequential access to the 77 payload bits, MSB first.

use crate::{PAYLOAD_BITS, Payload};

/// Appends fields to a payload.
pub(crate) struct BitWriter {
    bytes: [u8; 10],
    pos: usize,
}

impl BitWriter {
    pub(crate) fn new() -> Self {
        BitWriter {
            bytes: [0; 10],
            pos: 0,
        }
    }

    /// Appends the low `bits` bits of `value`, most significant first.
    pub(crate) fn put(&mut self, value: u128, bits: u32) {
        for i in (0..bits).rev() {
            if self.pos < PAYLOAD_BITS && (value >> i) & 1 == 1 {
                self.bytes[self.pos / 8] |= 0x80 >> (self.pos % 8);
            }
            self.pos += 1;
        }
    }

    pub(crate) fn finish(self) -> Payload {
        debug_assert_eq!(self.pos, PAYLOAD_BITS, "message layout must fill 77 bits");
        Payload(self.bytes)
    }
}

/// Reads fields from a payload.
pub(crate) struct BitReader<'a> {
    payload: &'a Payload,
    pos: usize,
}

impl<'a> BitReader<'a> {
    pub(crate) fn new(payload: &'a Payload) -> Self {
        BitReader { payload, pos: 0 }
    }

    /// Reads the next `bits` bits as an unsigned number.
    pub(crate) fn take(&mut self, bits: u32) -> u128 {
        let mut value = 0u128;
        for _ in 0..bits {
            value = (value << 1) | u128::from(self.payload.bit(self.pos));
            self.pos += 1;
        }
        value
    }

    /// Reads up to 32 bits.
    pub(crate) fn take_u32(&mut self, bits: u32) -> u32 {
        debug_assert!(bits <= 32);
        self.take(bits) as u32
    }

    pub(crate) fn flag(&mut self) -> bool {
        self.take(1) == 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writer_and_reader_agree() {
        let mut w = BitWriter::new();
        w.put(0x7A_BCDE_F012_3456_789A, 71);
        w.put(5, 3);
        w.put(3, 3);
        let p = w.finish();
        assert_eq!(p.i3(), 3);
        assert_eq!(p.n3(), 5);
        let mut r = BitReader::new(&p);
        assert_eq!(r.take(71), 0x7A_BCDE_F012_3456_789A);
        assert_eq!(r.take_u32(3), 5);
        assert_eq!(r.take_u32(3), 3);
    }
}
