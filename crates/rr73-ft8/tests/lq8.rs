//! LQ8 against every LQ8 golden vector of the reference implementation, lq_lib by Luis
//! Quesada HB9IPH (MIT licence, commit 00f3bcf), copied to `fixtures/lq8/golden_vectors.json`.
//!
//! For each vector, as the reference's README asks of other implementations: the plain text
//! packs to the payload, the payload unpacks to the canonical text, the CRC-14 and the LDPC
//! codeword match, the tones match, and the tones decode back to the payload.

use rr73_ft8::lq8::{self, CallTable, Kind, Message};
use rr73_ft8::tones::{self, FT8_COSTAS_STARTS, FT8_GRAY, LQ8_COSTAS};
use rr73_ft8::{Mode, Payload, crc, ldpc};
use serde::Deserialize;

#[derive(Deserialize)]
struct Vector {
    id: String,
    message_type: String,
    type_id: u8,
    plaintext: String,
    canonical_text: String,
    payload_hex: String,
    payload_bits: String,
    crc14: u16,
    codeword_hex: String,
    tones: String,
}

#[derive(Deserialize)]
struct Fixture {
    known_calls: Vec<String>,
    vectors: Vec<Vector>,
}

fn fixture() -> Fixture {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/lq8/golden_vectors.json"
    );
    let text = std::fs::read_to_string(path).expect("fixture");
    serde_json::from_str(&text).expect("json")
}

fn hex_bytes(hex: &str) -> Vec<u8> {
    hex.split_whitespace()
        .map(|b| u8::from_str_radix(b, 16).expect("hex"))
        .collect()
}

fn packed_bits(bits: &[u8]) -> Vec<u8> {
    bits.chunks(8)
        .map(|c| {
            c.iter()
                .enumerate()
                .fold(0u8, |acc, (i, &b)| acc | ((b & 1) << (7 - i)))
        })
        .collect()
}

#[test]
fn every_lq8_golden_vector_round_trips() {
    let f = fixture();
    assert_eq!(f.vectors.len(), 49, "the reference publishes 49 LQ8 vectors");
    let mut table = CallTable::new();
    let known: Vec<&str> = f.known_calls.iter().map(String::as_str).collect();
    table.set_active(&known);
    let mut kinds = std::collections::HashSet::new();
    for v in &f.vectors {
        let id = &v.id;
        // Text to payload.
        let m = Message::parse(&v.plaintext).unwrap_or_else(|e| panic!("{id}: {e}"));
        assert_eq!(m.kind.name(), v.message_type, "{id}");
        assert_eq!(m.kind.id(), v.type_id, "{id}");
        kinds.insert(m.kind);
        let payload = lq8::pack(&m).unwrap_or_else(|e| panic!("{id}: {e}"));
        assert_eq!(payload.0.to_vec(), hex_bytes(&v.payload_hex), "{id}: payload");
        let bits: String = (0..77).map(|i| char::from(b'0' + payload.bit(i))).collect();
        assert_eq!(bits, v.payload_bits, "{id}: payload bits");
        assert!(lq8::padding_is_zero(&payload), "{id}: padding");
        // Payload to text: resolved where the reference resolves, else in hexadecimal.
        let mut back = lq8::unpack(&payload).unwrap_or_else(|e| panic!("{id}: {e}"));
        let resolve = f
            .known_calls
            .iter()
            .any(|c| v.canonical_text.contains(&format!("<{c}>")));
        if resolve {
            back.resolve(&table);
        }
        assert_eq!(back.to_string(), v.canonical_text, "{id}: text");
        // CRC-14, LDPC codeword and tones.
        let m91 = crc::message91(Mode::Lq8, &payload);
        assert_eq!(crc::crc14(&payload.0, 82), v.crc14, "{id}: CRC");
        let codeword = ldpc::encode(&m91);
        assert_eq!(
            packed_bits(&codeword),
            hex_bytes(&v.codeword_hex),
            "{id}: codeword"
        );
        let symbols = tones::from_payload(Mode::Lq8, &payload);
        let expected: Vec<u8> = v.tones.bytes().map(|b| b - b'0').collect();
        assert_eq!(symbols, expected, "{id}: tones");
        // Tones back to the payload.
        assert_eq!(from_tones(&symbols), Some(payload), "{id}: demodulated");
    }
    // The vectors cover 12 of the 16 types: every type but 3 (CQ non-standard with a
    // modifier) and the reserved 14 to 16, which the next test covers.
    assert_eq!(kinds.len(), 12);
}

/// Hard-decision demodulation of an LQ8 tone sequence: sync check, inverse Gray map, the
/// parity checks and the CRC.
fn from_tones(symbols: &[u8]) -> Option<Payload> {
    for start in FT8_COSTAS_STARTS {
        if symbols[start..start + 7] != LQ8_COSTAS {
            return None;
        }
    }
    let mut codeword = [0u8; ldpc::N];
    for (k, s) in tones::data_symbols(Mode::Lq8).into_iter().enumerate() {
        let value = FT8_GRAY.iter().position(|&t| t == symbols[s])?;
        for b in 0..3 {
            codeword[3 * k + b] = ((value >> (2 - b)) & 1) as u8;
        }
    }
    if ldpc::check(&codeword) != 0 {
        return None;
    }
    crc::payload_from_message91(Mode::Lq8, &ldpc::message_bits(&codeword))
}

#[test]
fn the_types_without_vectors_round_trip() {
    let mut cq = Message::parse("CQ POTA VP8/OE3OGC").expect("parse");
    assert_eq!(cq.kind, Kind::CqNonstd3, "longer than 9 characters");
    cq = Message::parse("CQ POTA 3DA0RU").expect("parse");
    assert_eq!(cq.kind, Kind::CqNonstd2);
    let back = lq8::unpack(&lq8::pack(&cq).expect("pack")).expect("unpack");
    assert_eq!(back.to_string(), "CQ POTA 3DA0RU");
    for kind in [Kind::ReservedA, Kind::ReservedB, Kind::ReservedC] {
        let mut m = Message::new(kind);
        m.raw = vec![0xA5; 10];
        let p = lq8::pack(&m).expect("pack");
        let back = lq8::unpack(&p).expect("unpack");
        assert_eq!(back.kind, kind);
        assert_eq!(back.to_string(), "[RESERVED]");
        let n = 77 - kind.prefix().1 as usize;
        for i in 0..n {
            assert_eq!(
                back.raw[i / 8] >> (7 - i % 8) & 1,
                m.raw[i / 8] >> (7 - i % 8) & 1
            );
        }
    }
}

#[test]
fn every_payload_unpacks_or_fails_without_panicking() {
    // A deterministic sweep of payload patterns, each of the 16 prefixes followed by
    // pseudo-random bits.
    let mut x = 0x9E37_79B9_7F4A_7C15u64;
    for _ in 0..20_000 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        let mut bytes = [0u8; 10];
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = (x.rotate_left(8 * i as u32) & 0xFF) as u8;
        }
        bytes[9] &= 0xF8;
        let p = Payload(bytes);
        if let Ok(mut m) = lq8::unpack(&p) {
            m.resolve(&CallTable::new());
            let _ = m.render();
            assert_eq!(lq8::kind_of(&p), Some(m.kind));
        }
    }
}
