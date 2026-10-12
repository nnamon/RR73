//! FT8 and FT4 messages: the operator-facing model, text parsing and 77-bit packing.

use crate::{CallsignHashes, Payload};
use std::fmt;

/// A message in one of the 77-bit formats (i3.n3 types).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Message {
    /// Placeholder until the codec lands.
    Unimplemented,
}

/// Errors from [`Message::parse`] and [`pack`].
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PackError {
    /// The text does not fit any message format.
    #[error("text does not fit any FT8 message format: {0}")]
    Unsupported(String),
}

/// Errors from [`unpack`].
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum UnpackError {
    /// The i3.n3 type is reserved or invalid.
    #[error("invalid message type {i3}.{n3}")]
    InvalidType {
        /// i3 field.
        i3: u8,
        /// n3 field.
        n3: u8,
    },
    /// A field holds a value outside its legal range.
    #[error("invalid field value")]
    InvalidField,
}

impl Message {
    /// Parses operator text such as `CQ 9V1NE OJ11` or `JA1KXM 9V1NE R-14`.
    pub fn parse(text: &str) -> Result<Message, PackError> {
        let _ = text;
        todo!("rr73-ft8: message parse")
    }
}

impl fmt::Display for Message {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = f;
        todo!("rr73-ft8: message display")
    }
}

/// Packs a message into 77 bits, recording any full callsigns in `hashes`.
pub fn pack(message: &Message, hashes: &mut CallsignHashes) -> Result<Payload, PackError> {
    let _ = (message, hashes);
    todo!("rr73-ft8: pack")
}

/// Unpacks 77 bits into a message, resolving hashed callsigns from `hashes` where known.
pub fn unpack(payload: &Payload, hashes: &CallsignHashes) -> Result<Message, UnpackError> {
    let _ = (payload, hashes);
    todo!("rr73-ft8: unpack")
}
