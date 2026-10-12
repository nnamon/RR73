//! FT8 and FT4 protocol primitives.
//!
//! This crate turns operator text into the 77-bit payload and back, adds the CRC-14,
//! encodes with the (174,91) LDPC code, maps codewords to tones and synthesises GFSK
//! audio. It contains no decoding logic; `rr73-decode` builds on the tables exported here.
//!
//! References: Franke, Somerville and Taylor, "The FT4 and FT8 Communication Protocols",
//! QEX, July/August 2020. Parts are ported from ft8_lib by Kārlis Goba (MIT); each such
//! file says so in its header.
//!
//! Units: frequencies in Hz, times in seconds, sample counts at 12 kHz unless stated.

pub mod crc;
pub mod hash;
pub mod ldpc;
pub mod message;
pub mod mode;
pub mod synth;
pub mod tones;

pub use hash::CallsignHashes;
pub use message::Message;
pub use mode::{Mode, ModeParams};

/// Number of payload bits in every FT8 and FT4 message.
pub const PAYLOAD_BITS: usize = 77;

/// A 77-bit message payload, most significant bit first. The last 3 bits of byte 9 are zero.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub struct Payload(pub [u8; 10]);

impl Payload {
    /// Returns bit `i` (0 = first transmitted bit) as 0 or 1.
    pub fn bit(&self, i: usize) -> u8 {
        (self.0[i / 8] >> (7 - (i % 8))) & 1
    }

    /// Builds a payload from 77 bits given as 0/1 values, first transmitted bit first.
    pub fn from_bits(bits: &[u8]) -> Self {
        let mut out = [0u8; 10];
        for (i, &b) in bits.iter().take(PAYLOAD_BITS).enumerate() {
            out[i / 8] |= (b & 1) << (7 - (i % 8));
        }
        Payload(out)
    }
}
