//! Audio frames QSP sends the app on a stream (docs/design/qsp.md, The audio stream): one per
//! WebSocket message, big-endian.
//!
//! | Bytes | Field |
//! | --- | --- |
//! | 1 | Format version, 1 |
//! | 1 | Encoding: 0 PCM 16-bit, 1 IMA ADPCM 4-bit |
//! | 2 | Flags: [`FLAG_GPS`], [`FLAG_GAP`] |
//! | 4 | Sequence number of the frame |
//! | 8 | UTC of the first sample, µs since 1970 |
//! | 4 | Samples in the frame, at 12 000 per second |
//! | 4 | ADPCM only: predictor (i16), step index (u8), 0 |
//! | n | Samples: i16 each for PCM; two per byte, low nibble first, for ADPCM |
//!
//! Each ADPCM frame starts from its own predictor and step index, so a lost frame costs only
//! itself.

use serde::{Deserialize, Serialize};

/// Samples per second in every frame.
pub const SAMPLE_RATE_HZ: u32 = 12_000;
/// Format version written in byte 0.
pub const VERSION: u8 = 1;
/// The frame's time comes from the receiver's GPS.
pub const FLAG_GPS: u16 = 1;
/// Audio is missing before this frame: its time does not follow on from the frame before.
pub const FLAG_GAP: u16 = 2;
/// Bytes before the samples: 20, and 4 more for ADPCM.
pub const HEADER_BYTES: usize = 20;

/// How samples are carried.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Encoding {
    /// 16-bit PCM: 24 kB/s.
    Pcm16,
    /// IMA ADPCM, 4 bits a sample: 6 kB/s.
    #[default]
    ImaAdpcm,
}

impl Encoding {
    fn code(self) -> u8 {
        match self {
            Encoding::Pcm16 => 0,
            Encoding::ImaAdpcm => 1,
        }
    }
}

/// One frame's header fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHead {
    /// Frame sequence number, from 0.
    pub seq: u32,
    /// UTC of the first sample, µs since 1970.
    pub utc_us: i64,
    /// [`FLAG_GPS`] and [`FLAG_GAP`].
    pub flags: u16,
}

/// Builds one frame of `samples` (12 kHz) in `encoding`. `adpcm` carries the encoder's state
/// from frame to frame.
pub fn encode(head: FrameHead, encoding: Encoding, samples: &[i16], adpcm: &mut AdpcmState) -> Vec<u8> {
    let count = u32::try_from(samples.len()).unwrap_or(u32::MAX);
    let mut out = Vec::with_capacity(HEADER_BYTES + 4 + samples.len() * 2);
    out.push(VERSION);
    out.push(encoding.code());
    out.extend_from_slice(&head.flags.to_be_bytes());
    out.extend_from_slice(&head.seq.to_be_bytes());
    out.extend_from_slice(&head.utc_us.to_be_bytes());
    out.extend_from_slice(&count.to_be_bytes());
    match encoding {
        Encoding::Pcm16 => {
            for s in samples {
                out.extend_from_slice(&s.to_be_bytes());
            }
        }
        Encoding::ImaAdpcm => {
            out.extend_from_slice(&adpcm.predictor.to_be_bytes());
            out.push(adpcm.index);
            out.push(0);
            let mut byte = 0u8;
            for (i, &s) in samples.iter().enumerate() {
                let code = adpcm.encode(s);
                if i % 2 == 0 {
                    byte = code;
                } else {
                    out.push(byte | (code << 4));
                }
            }
            if samples.len() % 2 == 1 {
                out.push(byte);
            }
        }
    }
    out
}

/// A decoded frame, for tests and tools.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decoded {
    /// The header.
    pub head: FrameHead,
    /// The encoding.
    pub encoding: Encoding,
    /// The samples, 12 kHz.
    pub samples: Vec<i16>,
}

/// Reads a frame back; None when it is short or of another version.
pub fn decode(bytes: &[u8]) -> Option<Decoded> {
    if bytes.len() < HEADER_BYTES || bytes[0] != VERSION {
        return None;
    }
    let u16_at = |i: usize| u16::from_be_bytes([bytes[i], bytes[i + 1]]);
    let u32_at = |i: usize| u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    let encoding = match bytes[1] {
        0 => Encoding::Pcm16,
        1 => Encoding::ImaAdpcm,
        _ => return None,
    };
    let mut utc = [0u8; 8];
    utc.copy_from_slice(&bytes[8..16]);
    let head = FrameHead {
        flags: u16_at(2),
        seq: u32_at(4),
        utc_us: i64::from_be_bytes(utc),
    };
    let count = usize::try_from(u32_at(16)).ok()?;
    let body = &bytes[HEADER_BYTES..];
    let samples = match encoding {
        Encoding::Pcm16 => {
            if body.len() < count * 2 {
                return None;
            }
            body.as_chunks::<2>()
                .0
                .iter()
                .take(count)
                .map(|c| i16::from_be_bytes(*c))
                .collect()
        }
        Encoding::ImaAdpcm => {
            if body.len() < 4 + count.div_ceil(2) {
                return None;
            }
            let mut state = AdpcmState {
                predictor: i16::from_be_bytes([body[0], body[1]]),
                index: body[2].min(88),
            };
            let mut out = Vec::with_capacity(count);
            for i in 0..count {
                let byte = body[4 + i / 2];
                let code = if i % 2 == 0 { byte & 0x0f } else { byte >> 4 };
                out.push(state.decode(code));
            }
            out
        }
    };
    Some(Decoded {
        head,
        encoding,
        samples,
    })
}

/// IMA ADPCM's predictor and step index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AdpcmState {
    /// The last sample as the decoder will rebuild it.
    pub predictor: i16,
    /// Index into the step table, 0 to 88.
    pub index: u8,
}

const STEPS: [i32; 89] = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88,
    97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658,
    724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660,
    4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
    18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_STEP: [i32; 8] = [-1, -1, -1, -1, 2, 4, 6, 8];

impl AdpcmState {
    fn step(&self) -> i32 {
        STEPS[usize::from(self.index.min(88))]
    }

    fn advance(&mut self, code: u8, diff: i32) {
        let p = i32::from(self.predictor) + if code & 8 != 0 { -diff } else { diff };
        self.predictor = p.clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16;
        let i = i32::from(self.index) + INDEX_STEP[usize::from(code & 7)];
        self.index = i.clamp(0, 88) as u8;
    }

    fn diff(step: i32, code: u8) -> i32 {
        let mut d = step >> 3;
        if code & 4 != 0 {
            d += step;
        }
        if code & 2 != 0 {
            d += step >> 1;
        }
        if code & 1 != 0 {
            d += step >> 2;
        }
        d
    }

    /// Encodes one sample to a 4-bit code and moves the state on, as the decoder will.
    pub fn encode(&mut self, sample: i16) -> u8 {
        let step = self.step();
        let mut delta = i32::from(sample) - i32::from(self.predictor);
        let mut code = 0u8;
        if delta < 0 {
            code = 8;
            delta = -delta;
        }
        let mut s = step;
        if delta >= s {
            code |= 4;
            delta -= s;
        }
        s >>= 1;
        if delta >= s {
            code |= 2;
            delta -= s;
        }
        s >>= 1;
        if delta >= s {
            code |= 1;
        }
        self.advance(code, Self::diff(step, code));
        code
    }

    /// Decodes one 4-bit code to a sample.
    pub fn decode(&mut self, code: u8) -> i16 {
        let step = self.step();
        self.advance(code, Self::diff(step, code));
        self.predictor
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(n: usize, hz: f64, amp: f64) -> Vec<i16> {
        (0..n)
            .map(|i| (amp * (2.0 * std::f64::consts::PI * hz * i as f64 / 12_000.0).sin()) as i16)
            .collect()
    }

    #[test]
    fn pcm_frames_round_trip_with_their_header() {
        let head = FrameHead {
            seq: 7,
            utc_us: 1_791_994_255_123_456,
            flags: FLAG_GAP,
        };
        let s = tone(512, 1000.0, 8000.0);
        let bytes = encode(head, Encoding::Pcm16, &s, &mut AdpcmState::default());
        assert_eq!(bytes.len(), HEADER_BYTES + 1024);
        assert_eq!(&bytes[..4], &[1, 0, 0, 2]);
        let d = decode(&bytes).expect("decodes");
        assert_eq!(d.head, head);
        assert_eq!(d.samples, s);
    }

    #[test]
    fn adpcm_frames_follow_the_signal_within_a_few_percent() {
        let s = tone(2048, 1500.0, 12000.0);
        let mut enc = AdpcmState::default();
        let mut got = Vec::new();
        for (i, chunk) in s.chunks(512).enumerate() {
            let bytes = encode(
                FrameHead {
                    seq: i as u32,
                    utc_us: 0,
                    flags: 0,
                },
                Encoding::ImaAdpcm,
                chunk,
                &mut enc,
            );
            assert_eq!(bytes.len(), HEADER_BYTES + 4 + 256);
            got.extend(decode(&bytes).expect("decodes").samples);
        }
        // After the first frame's settling, the error is small against the signal.
        let err: f64 = s[512..]
            .iter()
            .zip(&got[512..])
            .map(|(a, b)| (f64::from(*a) - f64::from(*b)).powi(2))
            .sum();
        let sig: f64 = s[512..].iter().map(|a| f64::from(*a).powi(2)).sum();
        assert!(err / sig < 0.01, "error {:.4} of the signal's power", err / sig);
    }

    #[test]
    fn short_or_foreign_frames_are_refused() {
        assert!(decode(&[1, 0, 0]).is_none());
        let mut b = encode(
            FrameHead {
                seq: 0,
                utc_us: 0,
                flags: 0,
            },
            Encoding::Pcm16,
            &[1, 2],
            &mut AdpcmState::default(),
        );
        b[0] = 9;
        assert!(decode(&b).is_none());
    }
}
