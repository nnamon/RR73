//! Callsign hashes and the table that resolves them.
//!
//! A callsign hashes by writing it left-justified in 11 characters of
//! `" 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/"`, reading that as a base-38 number `n`, and
//! keeping the top `m` bits of the 64-bit product `47 055 833 459 × n` (QEX, Appendix A,
//! program hashcodes). The 10- and 12-bit hashes are therefore the top bits of the 22-bit
//! hash. The same algorithm is in `save_callsign()` of ft8_lib's `ft8/message.c`
//! (Kārlis Goba, MIT licence).
//!
//! [`CallsignHashes`] remembers callsigns seen in full and resolves a hash to the most
//! recently recorded callsign with that hash, as WSJT-X does (QEX, section 2). It holds at
//! most [`CallsignHashes::capacity`] callsigns and forgets the least recently recorded first.

use crate::message::Callsign;
use crate::message::Message;
use std::collections::{HashMap, VecDeque};

/// Width of a hash field.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum HashWidth {
    /// 10 bits: the DXpedition callsign in message type 0.1.
    Bits10,
    /// 12 bits: message types 4 and 5.
    Bits12,
    /// 22 bits: c28 fields and message type 5.
    Bits22,
}

impl HashWidth {
    /// Number of bits.
    pub const fn bits(self) -> u32 {
        match self {
            HashWidth::Bits10 => 10,
            HashWidth::Bits12 => 12,
            HashWidth::Bits22 => 22,
        }
    }
}

/// A callsign hash of a given width.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct CallHash {
    value: u32,
    width: HashWidth,
}

impl CallHash {
    /// A hash value of `width` bits; `None` if `value` does not fit.
    pub fn new(value: u32, width: HashWidth) -> Option<CallHash> {
        (value >> width.bits() == 0).then_some(CallHash { value, width })
    }

    /// The hash of `call` at `width`.
    pub fn of(call: &Callsign, width: HashWidth) -> CallHash {
        CallHash {
            value: hash22(call) >> (22 - width.bits()),
            width,
        }
    }

    /// A value read from a field of `width` bits; higher bits are dropped.
    pub(crate) fn from_field(value: u32, width: HashWidth) -> CallHash {
        CallHash {
            value: value & ((1 << width.bits()) - 1),
            width,
        }
    }

    /// The hash value.
    pub fn value(&self) -> u32 {
        self.value
    }

    /// The width.
    pub fn width(&self) -> HashWidth {
        self.width
    }
}

/// The 22-bit hash of a callsign.
fn hash22(call: &Callsign) -> u32 {
    let text = call.as_str().as_bytes();
    let n = (0..Callsign::MAX_LEN).fold(0u64, |acc, i| {
        acc * 38
            + text
                .get(i)
                .map_or(0, |&c| crate::message::callsign_alphabet_index(c))
    });
    (47_055_833_459u64.wrapping_mul(n) >> 42) as u32
}

#[derive(Clone, Debug)]
struct Entry {
    call: Callsign,
    /// Insertion order; higher is more recent.
    seen: u64,
}

/// Remembers callsigns seen in full so hashed references (10, 12 and 22 bits) can be resolved.
#[derive(Clone, Debug)]
pub struct CallsignHashes {
    /// Keyed by the 22-bit hash; one callsign per hash, the most recent.
    entries: HashMap<u32, Entry>,
    /// Inserts in order, oldest first, as (22-bit hash, insert number). Entries whose number
    /// no longer matches `entries` are stale and skipped.
    order: VecDeque<(u32, u64)>,
    counter: u64,
    capacity: usize,
}

impl Default for CallsignHashes {
    fn default() -> Self {
        Self::with_capacity(Self::DEFAULT_CAPACITY)
    }
}

impl CallsignHashes {
    /// Callsigns held by [`CallsignHashes::new`].
    pub const DEFAULT_CAPACITY: usize = 4096;

    /// Creates an empty table.
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates an empty table that holds up to `capacity` callsigns (at least 1).
    pub fn with_capacity(capacity: usize) -> Self {
        CallsignHashes {
            entries: HashMap::new(),
            order: VecDeque::new(),
            counter: 0,
            capacity: capacity.max(1),
        }
    }

    /// Maximum number of callsigns held.
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Number of callsigns held.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when no callsign is held.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Forgets every callsign.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
    }

    /// Records a callsign as the most recent one for its hashes. Takes amortised constant
    /// time.
    pub fn insert(&mut self, call: &Callsign) {
        self.counter += 1;
        let key = hash22(call);
        self.entries.insert(
            key,
            Entry {
                call: *call,
                seen: self.counter,
            },
        );
        self.order.push_back((key, self.counter));
        while self.entries.len() > self.capacity {
            let Some((key, seen)) = self.order.pop_front() else {
                break;
            };
            if self.entries.get(&key).is_some_and(|e| e.seen == seen) {
                self.entries.remove(&key);
            }
        }
        if self.order.len() > 2 * self.capacity {
            let entries = &self.entries;
            self.order
                .retain(|(key, seen)| entries.get(key).is_some_and(|e| e.seen == *seen));
        }
    }

    /// Records every callsign that `message` carries in full. Call this for each decoded
    /// message so later hashes of those callsigns resolve.
    pub fn learn(&mut self, message: &Message) {
        for call in message.full_callsigns().into_iter().flatten() {
            self.insert(&call);
        }
    }

    /// Returns the most recently recorded callsign with this hash.
    pub fn resolve(&self, hash: CallHash) -> Option<Callsign> {
        let shift = 22 - hash.width.bits();
        if shift == 0 {
            return self.entries.get(&hash.value).map(|e| e.call);
        }
        self.entries
            .iter()
            .filter(|(k, _)| *k >> shift == hash.value)
            .max_by_key(|(_, e)| e.seen)
            .map(|(_, e)| e.call)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(s: &str) -> Callsign {
        Callsign::new(s).expect("valid callsign")
    }

    #[test]
    fn hashes_follow_the_public_description() {
        // OR18TRA: the 12-bit hash its sender put in h12 of `CQ OR18TRA` (payload
        // 77300000482ca75d8c60 in fixtures/ft8/onair.json) is 0x773.
        assert_eq!(CallHash::of(&call("OR18TRA"), HashWidth::Bits12).value(), 0x773);
        let h22 = CallHash::of(&call("PJ4/K1ABC"), HashWidth::Bits22).value();
        assert_eq!(
            CallHash::of(&call("PJ4/K1ABC"), HashWidth::Bits12).value(),
            h22 >> 10
        );
        assert_eq!(
            CallHash::of(&call("PJ4/K1ABC"), HashWidth::Bits10).value(),
            h22 >> 12
        );
        assert!(h22 < 1 << 22);
    }

    #[test]
    fn resolves_all_widths_and_prefers_the_most_recent() {
        let mut table = CallsignHashes::new();
        let a = call("PJ4/K1ABC");
        table.insert(&a);
        for width in [HashWidth::Bits10, HashWidth::Bits12, HashWidth::Bits22] {
            assert_eq!(table.resolve(CallHash::of(&a, width)), Some(a));
        }
        // Find a callsign with the same 10-bit hash but a different 22-bit hash.
        let target = CallHash::of(&a, HashWidth::Bits10);
        let b = (0..100_000)
            .map(|i| call(&format!("K{}AB{}", i % 10, i / 10)))
            .find(|c| CallHash::of(c, HashWidth::Bits10) == target && c != &a)
            .expect("a 10-bit collision exists among 100 000 callsigns");
        table.insert(&b);
        assert_eq!(table.resolve(target), Some(b));
        assert_eq!(table.resolve(CallHash::of(&a, HashWidth::Bits22)), Some(a));
        table.insert(&a);
        assert_eq!(table.resolve(target), Some(a));
        assert_eq!(table.len(), 2);
    }

    #[test]
    fn evicts_least_recent_beyond_capacity() {
        let mut table = CallsignHashes::with_capacity(2);
        let (a, b, c) = (call("K1ABC"), call("W9XYZ"), call("G4ABC"));
        table.insert(&a);
        table.insert(&b);
        table.insert(&a);
        table.insert(&c);
        assert_eq!(table.len(), 2);
        assert_eq!(table.resolve(CallHash::of(&b, HashWidth::Bits22)), None);
        assert_eq!(table.resolve(CallHash::of(&a, HashWidth::Bits22)), Some(a));
        assert_eq!(table.resolve(CallHash::of(&c, HashWidth::Bits22)), Some(c));
        table.clear();
        assert!(table.is_empty());
    }

    #[test]
    fn call_hash_checks_width() {
        assert!(CallHash::new(1023, HashWidth::Bits10).is_some());
        assert!(CallHash::new(1024, HashWidth::Bits10).is_none());
        assert!(CallHash::new((1 << 22) - 1, HashWidth::Bits22).is_some());
    }
}
