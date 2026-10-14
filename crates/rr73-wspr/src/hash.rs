//! The 15-bit callsign hash of type 3 messages and the table that resolves it.
//!
//! The hash is Bob Jenkins' `hashlittle` from lookup3 (public domain, May 2006) with initial
//! value 146 over the callsign's ASCII text, keeping the low 15 bits. The initial value and
//! the masking were confirmed against WSJT-X's `wsprsim` as a black box: every type 3 vector
//! in `fixtures/wspr/wsjtx.json` matches.

use std::collections::HashMap;

use crate::message::Message;

/// Initial value of the lookup3 hash for WSPR callsign hashes.
pub const HASH_INITVAL: u32 = 146;

/// Bob Jenkins' lookup3 `hashlittle` over `key` with `initval`. Public domain algorithm;
/// written from its published description.
pub fn hashlittle(key: &[u8], initval: u32) -> u32 {
    let start = 0xdead_beef_u32
        .wrapping_add(key.len() as u32)
        .wrapping_add(initval);
    let (mut a, mut b, mut c) = (start, start, start);
    let mut k = key;
    while k.len() > 12 {
        a = a.wrapping_add(le32(&k[0..4]));
        b = b.wrapping_add(le32(&k[4..8]));
        c = c.wrapping_add(le32(&k[8..12]));
        mix(&mut a, &mut b, &mut c);
        k = &k[12..];
    }
    if k.is_empty() {
        return c;
    }
    let mut tail = [0u8; 12];
    tail[..k.len()].copy_from_slice(k);
    a = a.wrapping_add(le32(&tail[0..4]));
    b = b.wrapping_add(le32(&tail[4..8]));
    c = c.wrapping_add(le32(&tail[8..12]));
    finish(&mut a, &mut b, &mut c);
    c
}

fn le32(b: &[u8]) -> u32 {
    u32::from(b[0]) | (u32::from(b[1]) << 8) | (u32::from(b[2]) << 16) | (u32::from(b[3]) << 24)
}

fn mix(a: &mut u32, b: &mut u32, c: &mut u32) {
    *a = a.wrapping_sub(*c);
    *a ^= c.rotate_left(4);
    *c = c.wrapping_add(*b);
    *b = b.wrapping_sub(*a);
    *b ^= a.rotate_left(6);
    *a = a.wrapping_add(*c);
    *c = c.wrapping_sub(*b);
    *c ^= b.rotate_left(8);
    *b = b.wrapping_add(*a);
    *a = a.wrapping_sub(*c);
    *a ^= c.rotate_left(16);
    *c = c.wrapping_add(*b);
    *b = b.wrapping_sub(*a);
    *b ^= a.rotate_left(19);
    *a = a.wrapping_add(*c);
    *c = c.wrapping_sub(*b);
    *c ^= b.rotate_left(4);
    *b = b.wrapping_add(*a);
}

fn finish(a: &mut u32, b: &mut u32, c: &mut u32) {
    *c ^= *b;
    *c = c.wrapping_sub(b.rotate_left(14));
    *a ^= *c;
    *a = a.wrapping_sub(c.rotate_left(11));
    *b ^= *a;
    *b = b.wrapping_sub(a.rotate_left(25));
    *c ^= *b;
    *c = c.wrapping_sub(b.rotate_left(16));
    *a ^= *c;
    *a = a.wrapping_sub(c.rotate_left(4));
    *b ^= *a;
    *b = b.wrapping_sub(a.rotate_left(14));
    *c ^= *b;
    *c = c.wrapping_sub(b.rotate_left(24));
}

/// The 15-bit hash of a callsign as type 3 messages carry it. `call` is hashed as given
/// (upper case, compound calls with their `/`).
pub fn hash15(call: &str) -> u16 {
    (hashlittle(call.as_bytes(), HASH_INITVAL) & 0x7FFF) as u16
}

/// Callsigns seen in full, by 15-bit hash, for resolving type 3 messages. A station with a
/// compound callsign or a 6-character locator alternates a type 1 or type 2 message (full
/// callsign) with a type 3 message (hash), so the table fills from earlier decodes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CallsignHashes {
    calls: HashMap<u16, String>,
}

impl CallsignHashes {
    /// An empty table.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds `call`; a later call with the same hash replaces the earlier one.
    pub fn insert(&mut self, call: &str) {
        self.calls.insert(hash15(call), call.to_string());
    }

    /// Learns the full callsign of a type 1 or type 2 message. Type 3 messages carry none.
    pub fn learn(&mut self, msg: &Message) {
        match msg {
            Message::Standard { call, .. } | Message::Compound { call, .. } => self.insert(call),
            Message::Hashed { .. } => {}
        }
    }

    /// The callsign with this hash, if one has been seen.
    pub fn lookup(&self, hash: u16) -> Option<&str> {
        self.calls.get(&hash).map(String::as_str)
    }

    /// Number of callsigns held.
    pub fn len(&self) -> usize {
        self.calls.len()
    }

    /// `true` when no callsign is held.
    pub fn is_empty(&self) -> bool {
        self.calls.is_empty()
    }

    /// Forgets every callsign.
    pub fn clear(&mut self) {
        self.calls.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup3_matches_its_published_driver_values() {
        // From the self-test values printed in lookup3.c's driver (public domain).
        assert_eq!(hashlittle(b"", 0), 0xdead_beef);
        assert_eq!(hashlittle(b"", 0xdead_beef), 0xbd5b_7dde);
        assert_eq!(hashlittle(b"Four score and seven years ago", 0), 0x1777_0551);
        assert_eq!(hashlittle(b"Four score and seven years ago", 1), 0xcd62_8161);
    }

    #[test]
    fn hashes_match_wsprsim() {
        // Hash fields of `<CALL> GRID6 POWER` messages packed by wsprsim.
        assert_eq!(hash15("K1ABC"), 6521);
        assert_eq!(hash15("PJ4/K1ABC"), 19735);
        assert_eq!(hash15("K1ABC/P"), 12544);
    }

    #[test]
    fn table_learns_full_callsigns() {
        let mut t = CallsignHashes::new();
        assert!(t.is_empty());
        t.learn(&Message::Compound {
            call: "PJ4/K1ABC".into(),
            power_dbm: 33,
        });
        assert_eq!(t.lookup(19735), Some("PJ4/K1ABC"));
        assert_eq!(t.len(), 1);
        t.clear();
        assert_eq!(t.lookup(19735), None);
    }
}
