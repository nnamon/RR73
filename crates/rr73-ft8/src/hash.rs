//! Callsign hash table for nonstandard and compound callsigns.

/// Remembers callsigns seen in full so hashed references (10, 12 and 22 bits) can be resolved.
#[derive(Clone, Debug, Default)]
pub struct CallsignHashes {
    _private: (),
}

impl CallsignHashes {
    /// Creates an empty table.
    pub fn new() -> Self {
        Self::default()
    }
}
