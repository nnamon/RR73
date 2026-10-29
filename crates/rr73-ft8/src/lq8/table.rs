//! The callsigns an LQ8 receiver has heard in full, for the hashes of later messages.
//!
//! LQ8 hashes a callsign three ways (section IV of the specification): 24 bits (CRC-24/Q) in
//! types 6, 10, 11 and 12, the top 20 of those in type 7, and 16 bits (the multiplicative
//! hash) for the sending station of types 11 and 12. A hash resolves to the most recently
//! recorded callsign with that value, as [`crate::CallsignHashes`] does for FT8. The 16-bit
//! hash resolves only against the callsigns of the QSO under way ([`CallTable::set_active`]):
//! with 65 536 values, a table of every station heard would name the wrong station about once
//! in 16 messages, and the specification restricts it the same way.

use std::collections::{HashMap, VecDeque};

use super::fields::{hash16, hash20, hash24};

#[derive(Clone, Debug)]
struct Entry {
    call: String,
    seen: u64,
}

/// Callsigns heard in full, keyed by their 24-bit and 20-bit hashes, and the callsigns of the
/// QSO under way for the 16-bit hash.
#[derive(Clone, Debug)]
pub struct CallTable {
    by24: HashMap<u32, Entry>,
    by20: HashMap<u32, Entry>,
    order: VecDeque<(String, u64)>,
    counter: u64,
    capacity: usize,
    active: Vec<String>,
}

impl Default for CallTable {
    fn default() -> Self {
        Self::with_capacity(Self::DEFAULT_CAPACITY)
    }
}

impl CallTable {
    /// Callsigns held by [`CallTable::new`].
    pub const DEFAULT_CAPACITY: usize = 4096;

    /// An empty table.
    pub fn new() -> Self {
        Self::default()
    }

    /// An empty table holding up to `capacity` callsigns (at least 1), forgetting the least
    /// recently recorded first.
    pub fn with_capacity(capacity: usize) -> Self {
        CallTable {
            by24: HashMap::new(),
            by20: HashMap::new(),
            order: VecDeque::new(),
            counter: 0,
            capacity: capacity.max(1),
            active: Vec::new(),
        }
    }

    /// Number of callsigns held.
    pub fn len(&self) -> usize {
        self.by24.len()
    }

    /// True when the table holds no callsign.
    pub fn is_empty(&self) -> bool {
        self.by24.is_empty()
    }

    /// Records `call` (upper case, as sent) as the most recent callsign for its hashes.
    pub fn insert(&mut self, call: &str) {
        let call = call.trim().to_ascii_uppercase();
        if call.is_empty() || call.starts_with('<') {
            return;
        }
        self.counter += 1;
        let entry = Entry {
            call: call.clone(),
            seen: self.counter,
        };
        self.by24.insert(hash24(&call), entry.clone());
        self.by20.insert(hash20(&call), entry);
        self.order.push_back((call, self.counter));
        while self.by24.len() > self.capacity {
            let Some((old, seen)) = self.order.pop_front() else {
                break;
            };
            for (map, key) in [(&mut self.by24, hash24(&old)), (&mut self.by20, hash20(&old))] {
                if map.get(&key).is_some_and(|e| e.seen == seen) {
                    map.remove(&key);
                }
            }
        }
        if self.order.len() > 2 * self.capacity {
            let by24 = &self.by24;
            self.order
                .retain(|(c, seen)| by24.get(&hash24(c)).is_some_and(|e| e.seen == *seen));
        }
    }

    /// Sets the callsigns the 16-bit hash may resolve to (the operator's and the other
    /// station's), and records them for the other hashes too.
    pub fn set_active(&mut self, calls: &[&str]) {
        self.active = calls
            .iter()
            .map(|c| c.trim().to_ascii_uppercase())
            .filter(|c| !c.is_empty())
            .collect();
        for call in self.active.clone() {
            self.insert(&call);
        }
    }

    /// The callsign with this 24-bit hash.
    pub fn resolve24(&self, hash: u32) -> Option<&str> {
        self.by24.get(&hash).map(|e| e.call.as_str())
    }

    /// The callsign with this 20-bit hash.
    pub fn resolve20(&self, hash: u32) -> Option<&str> {
        self.by20.get(&hash).map(|e| e.call.as_str())
    }

    /// The callsign of the QSO under way with this 16-bit hash.
    pub fn resolve16(&self, hash: u32) -> Option<&str> {
        self.active.iter().find(|c| hash16(c) == hash).map(String::as_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_the_most_recent_callsign_and_forgets_the_oldest() {
        let mut t = CallTable::with_capacity(2);
        t.insert("9v1ne");
        t.insert("AB4SS");
        assert_eq!(t.resolve24(hash24("9V1NE")), Some("9V1NE"));
        assert_eq!(t.resolve20(hash20("AB4SS")), Some("AB4SS"));
        t.insert("9V1DE");
        assert_eq!(t.len(), 2);
        assert_eq!(t.resolve24(hash24("9V1NE")), None);
        t.insert("<...>");
        assert_eq!(t.len(), 2);
    }

    #[test]
    fn the_16_bit_hash_resolves_only_the_qso_under_way() {
        let mut t = CallTable::new();
        t.insert("OE3OGC");
        assert_eq!(t.resolve16(hash16("OE3OGC")), None);
        t.set_active(&["9V1NE", "OE3OGC"]);
        assert_eq!(t.resolve16(hash16("OE3OGC")), Some("OE3OGC"));
        assert_eq!(t.resolve24(hash24("9V1NE")), Some("9V1NE"));
    }
}
