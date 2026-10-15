//! CI-V frames, as the CI-V guide gives them on p. 2 ("About the data format").
//!
//! A frame is `FE FE <to> <from> <command> [sub-command] [data] FD`. The controller sends to the
//! radio's address from its own; the radio answers to the controller's address from its own,
//! with the OK code `FB` or the NG code `FA` in place of the command when it only accepts or
//! refuses (p. 2).
//!
//! The guide gives no escaping, so a frame cannot carry `FE` or `FD` between its preamble and
//! its end code. [`Frame::encode`] refuses them, and [`FrameDecoder`] treats an `FE` inside a
//! frame as the start of the next one: the bytes before it are dropped as noise.
//!
//! The guide's preamble is two `FE` bytes. [`FrameDecoder`] also reads a frame whose first `FE`
//! was lost, so one `FE` followed by an address starts a frame.

use thiserror::Error;

/// Preamble byte; a frame starts with two (CI-V guide p. 2).
pub const PREAMBLE: u8 = 0xFE;
/// End of message code (p. 2).
pub const END: u8 = 0xFD;
/// OK code: the radio accepted the command (p. 2).
pub const OK: u8 = 0xFB;
/// NG code: the radio refused the command (p. 2).
pub const NG: u8 = 0xFA;

/// Longest frame body [`FrameDecoder`] keeps, in bytes, from the receiving address to the last
/// data byte. The longest IC-705 frame in the guide, memory content (p. 18), has 70 bytes of
/// sub-command and data. A longer run without an end code is dropped as noise.
pub const MAX_BODY: usize = 512;

/// One CI-V frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// Receiving address: the radio's when the controller sends.
    pub to: u8,
    /// Sending address.
    pub from: u8,
    /// Command number, or [`OK`] or [`NG`] in the radio's answers.
    pub command: u8,
    /// Sub-command and data bytes, in order.
    pub data: Vec<u8>,
}

/// Why a frame cannot be written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum FrameError {
    /// A byte between the preamble and the end code is `FE` or `FD`, which would end or restart
    /// the frame. `index` counts from the receiving address.
    #[error("byte {index} is {byte:#04X}, which CI-V reserves for the preamble and the end code")]
    Reserved {
        /// Position from the receiving address, from 0.
        index: usize,
        /// The reserved byte.
        byte: u8,
    },
    /// The frame body is longer than [`MAX_BODY`] bytes.
    #[error("the frame body is {0} bytes, more than {MAX_BODY}")]
    TooLong(usize),
}

impl Frame {
    /// A frame from its parts.
    pub fn new(to: u8, from: u8, command: u8, data: impl Into<Vec<u8>>) -> Self {
        Self {
            to,
            from,
            command,
            data: data.into(),
        }
    }

    /// The bytes on the wire: `FE FE`, the addresses, the command, the data and `FD`.
    pub fn encode(&self) -> Result<Vec<u8>, FrameError> {
        let body_len = 3 + self.data.len();
        if body_len > MAX_BODY {
            return Err(FrameError::TooLong(body_len));
        }
        let mut out = Vec::with_capacity(body_len + 3);
        out.extend([PREAMBLE, PREAMBLE]);
        for (index, &byte) in [self.to, self.from, self.command]
            .iter()
            .chain(&self.data)
            .enumerate()
        {
            if byte == PREAMBLE || byte == END {
                return Err(FrameError::Reserved { index, byte });
            }
            out.push(byte);
        }
        out.push(END);
        Ok(out)
    }
}

/// What [`FrameDecoder::push`] found in the bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decoded {
    /// A complete frame.
    Frame(Frame),
    /// Bytes that were not part of a complete frame: data from another device, a frame cut
    /// short, or a body too short or too long. Consecutive noise is reported as one count.
    Noise(usize),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    /// Waiting for a preamble.
    Idle,
    /// One preamble byte seen.
    Preamble,
    /// One or more preamble bytes seen; collecting the body until the end code.
    Body,
}

/// Streaming frame reader: push bytes as they arrive, in chunks of any size, and get back the
/// frames they complete. The same bytes give the same frames whatever the chunk boundaries.
/// Never panics on input.
#[derive(Debug, Clone)]
pub struct FrameDecoder {
    state: State,
    body: Vec<u8>,
    /// Preamble bytes counted for the frame in progress: 1 or 2.
    preamble: usize,
}

impl Default for FrameDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl FrameDecoder {
    /// A decoder waiting for a preamble.
    pub fn new() -> Self {
        Self {
            state: State::Idle,
            body: Vec::new(),
            preamble: 2,
        }
    }

    /// Forgets a frame in progress.
    pub fn reset(&mut self) {
        self.state = State::Idle;
        self.body.clear();
    }

    /// Bytes held for a frame not yet complete, preamble included.
    pub fn pending(&self) -> usize {
        match self.state {
            State::Idle => 0,
            State::Preamble => 1,
            State::Body => self.preamble + self.body.len(),
        }
    }

    /// Reads `bytes` and returns the frames they complete and the noise between them, in order.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Decoded> {
        let mut out = Vec::new();
        let mut noise = 0usize;
        for &b in bytes {
            match self.state {
                State::Idle => {
                    if b == PREAMBLE {
                        self.state = State::Preamble;
                    } else {
                        noise += 1;
                    }
                }
                State::Preamble => {
                    self.body.clear();
                    if b == PREAMBLE {
                        self.state = State::Body;
                        self.preamble = 2;
                    } else if b == END {
                        // A lone FE and an end code.
                        noise += 2;
                        self.state = State::Idle;
                    } else {
                        // One FE, then the receiving address: a frame whose first FE was lost.
                        self.state = State::Body;
                        self.preamble = 1;
                        self.body.push(b);
                    }
                }
                State::Body => {
                    if b == PREAMBLE {
                        if !self.body.is_empty() {
                            // A new preamble inside a frame: the frame was cut short.
                            noise += self.preamble + self.body.len();
                            self.body.clear();
                            self.state = State::Preamble;
                        }
                        // Further FE bytes before the addresses extend the preamble.
                    } else if b == END {
                        match self.body.as_slice() {
                            [to, from, command, data @ ..] => {
                                if noise > 0 {
                                    out.push(Decoded::Noise(noise));
                                    noise = 0;
                                }
                                out.push(Decoded::Frame(Frame::new(*to, *from, *command, data)));
                            }
                            short => noise += self.preamble + 1 + short.len(),
                        }
                        self.body.clear();
                        self.state = State::Idle;
                    } else if self.body.len() == MAX_BODY {
                        noise += self.preamble + 1 + self.body.len();
                        self.body.clear();
                        self.state = State::Idle;
                    } else {
                        self.body.push(b);
                    }
                }
            }
        }
        if noise > 0 {
            out.push(Decoded::Noise(noise));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames(d: &[Decoded]) -> Vec<Frame> {
        d.iter()
            .filter_map(|x| match x {
                Decoded::Frame(f) => Some(f.clone()),
                Decoded::Noise(_) => None,
            })
            .collect()
    }

    fn noise(d: &[Decoded]) -> usize {
        d.iter()
            .map(|x| match x {
                Decoded::Noise(n) => *n,
                Decoded::Frame(_) => 0,
            })
            .sum()
    }

    #[test]
    fn writes_the_layout_on_page_2() {
        // Controller to IC-705 with the default addresses: FE FE A4 E0 Cn Sc data FD.
        let f = Frame::new(0xA4, 0xE0, 0x1C, [0x00, 0x01]);
        assert_eq!(
            f.encode(),
            Ok(vec![0xFE, 0xFE, 0xA4, 0xE0, 0x1C, 0x00, 0x01, 0xFD])
        );
        // OK and NG messages to the controller: FE FE E0 A4 FB FD and FE FE E0 A4 FA FD.
        assert_eq!(
            Frame::new(0xE0, 0xA4, OK, []).encode(),
            Ok(vec![0xFE, 0xFE, 0xE0, 0xA4, 0xFB, 0xFD])
        );
        assert_eq!(
            Frame::new(0xE0, 0xA4, NG, []).encode(),
            Ok(vec![0xFE, 0xFE, 0xE0, 0xA4, 0xFA, 0xFD])
        );
    }

    #[test]
    fn refuses_reserved_bytes_and_long_bodies() {
        assert_eq!(
            Frame::new(0xA4, 0xE0, 0x05, [0x00, 0xFD]).encode(),
            Err(FrameError::Reserved { index: 4, byte: 0xFD })
        );
        assert_eq!(
            Frame::new(0xFE, 0xE0, 0x03, []).encode(),
            Err(FrameError::Reserved { index: 0, byte: 0xFE })
        );
        assert_eq!(
            Frame::new(0xA4, 0xE0, 0x1A, vec![0; MAX_BODY]).encode(),
            Err(FrameError::TooLong(MAX_BODY + 3))
        );
    }

    #[test]
    fn reads_frames_across_chunks_and_counts_noise() {
        let stream = [
            0x00, 0x13, // noise
            0xFE, 0xFE, 0xE0, 0xA4, 0xFB, 0xFD, // OK
            0xFE, 0xFE, 0xFE, 0xE0, 0xA4, 0x03, 0x00, 0x40, 0x07, 0x14, 0x00, 0xFD, // extra preamble
        ];
        let mut whole = FrameDecoder::new();
        let all = whole.push(&stream);
        assert_eq!(all.first(), Some(&Decoded::Noise(2)));
        assert_eq!(
            frames(&all),
            [
                Frame::new(0xE0, 0xA4, OK, []),
                Frame::new(0xE0, 0xA4, 0x03, [0x00, 0x40, 0x07, 0x14, 0x00])
            ]
        );
        for size in 1..stream.len() {
            let mut d = FrameDecoder::new();
            let parts: Vec<Decoded> = stream.chunks(size).flat_map(|c| d.push(c)).collect();
            assert_eq!(frames(&parts), frames(&all), "chunks of {size}");
            assert_eq!(noise(&parts), 2, "chunks of {size}");
        }
    }

    #[test]
    fn reads_a_frame_whose_first_preamble_byte_was_lost() {
        let mut d = FrameDecoder::new();
        assert_eq!(
            d.push(&[0x00, 0xFE, 0xE0, 0xA4, 0xFB, 0xFD]),
            [Decoded::Noise(1), Decoded::Frame(Frame::new(0xE0, 0xA4, OK, []))]
        );
        d.push(&[0xFE, 0xE0]);
        assert_eq!(d.pending(), 2);
        assert_eq!(
            d.push(&[0xA4, 0xFA, 0xFD]),
            [Decoded::Frame(Frame::new(0xE0, 0xA4, NG, []))]
        );
    }

    #[test]
    fn a_preamble_inside_a_frame_starts_the_next_one() {
        let mut d = FrameDecoder::new();
        let out = d.push(&[
            0xFE, 0xFE, 0xE0, 0xA4, 0x03, 0x00, 0xFE, 0xFE, 0xE0, 0xA4, 0xFA, 0xFD,
        ]);
        assert_eq!(
            out,
            [Decoded::Noise(6), Decoded::Frame(Frame::new(0xE0, 0xA4, NG, []))]
        );
        assert_eq!(d.pending(), 0);
    }

    #[test]
    fn short_and_overlong_bodies_are_noise() {
        let mut d = FrameDecoder::new();
        assert_eq!(d.push(&[0xFE, 0xFE, 0xE0, 0xA4, 0xFD]), [Decoded::Noise(5)]);
        assert_eq!(d.push(&[0xFE, 0xFD]), [Decoded::Noise(2)]);
        assert_eq!(d.push(&[0xFE, 0x01, 0xFD]), [Decoded::Noise(3)]);
        let mut long = vec![0xFE, 0xFE];
        long.extend(std::iter::repeat_n(0x11, MAX_BODY + 1));
        assert_eq!(d.push(&long), [Decoded::Noise(MAX_BODY + 3)]);
        assert_eq!(d.pending(), 0);
        d.push(&[0xFE, 0xFE, 0xE0]);
        assert_eq!(d.pending(), 3);
        d.reset();
        assert_eq!(d.pending(), 0);
    }
}
