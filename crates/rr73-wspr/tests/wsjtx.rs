//! The codec against WSJT-X: `fixtures/wspr/wsjtx.json` holds, for 314 messages, the packed
//! bytes and channel symbols printed by `wsprsim -cd` and the text `wsprcode` decodes, from
//! `tools/wsjtx/wspr_vectors.py` (WSJT-X 2.7.0-rc3).

use rr73_wspr::{CallsignHashes, Message, channel_symbols, pack, unpack};

#[derive(serde::Deserialize)]
struct Vector {
    message: String,
    decoded: String,
    ntype: i32,
    data: String,
    symbols: String,
}

#[derive(serde::Deserialize)]
struct Fixture {
    vectors: Vec<Vector>,
}

fn fixture() -> Fixture {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/wspr/wsjtx.json");
    let text = std::fs::read_to_string(path).expect("fixtures/wspr/wsjtx.json");
    serde_json::from_str(&text).expect("fixture JSON")
}

/// Where `wsprcode` prints a different text from the one that was packed, and why.
const WSPRCODE_DISPLAY: &[(&str, &str)] = &[
    // wsprcode blanks the digits of some locators in the R column (shared JT65 display code,
    // unverified). The bytes and symbols still match.
    ("0M0DRQ RO04 10", "0M0DRQ RO   10"),
];

#[test]
fn bytes_and_symbols_match_wsprsim_for_every_vector() {
    let fixture = fixture();
    assert_eq!(fixture.vectors.len(), 314);
    let mut types = [0usize; 4];
    for v in &fixture.vectors {
        let msg = Message::parse(&v.message).unwrap_or_else(|e| panic!("{}: {e}", v.message));
        types[usize::from(msg.message_type())] += 1;
        let packed = pack(&msg).expect("pack");
        let hex: Vec<String> = packed.bytes().iter().map(|b| format!("{b:02X}")).collect();
        assert_eq!(hex.join(" "), v.data, "{}: bytes", v.message);
        assert_eq!(packed.power_field(), v.ntype, "{}: power field", v.message);
        let symbols: String = channel_symbols(&msg)
            .expect("symbols")
            .iter()
            .map(|s| char::from(b'0' + s))
            .collect();
        assert_eq!(symbols, v.symbols, "{}: channel symbols", v.message);
    }
    assert_eq!(types, [0, 236, 47, 31]);
}

#[test]
fn unpacked_text_matches_wsprcode() {
    let mut differ = 0;
    for v in &fixture().vectors {
        let msg = Message::parse(&v.message).expect("parse");
        let packed = pack(&msg).expect("pack");
        // wsprcode starts without a hash table, so type 3 callsigns print as <...>.
        let text = unpack(&packed, &CallsignHashes::new())
            .expect("unpack")
            .to_string();
        match WSPRCODE_DISPLAY.iter().find(|(m, _)| *m == v.message) {
            Some((_, shown)) => {
                assert_eq!(v.decoded, *shown, "{}", v.message);
                assert_eq!(text, v.message);
                differ += 1;
            }
            None => assert_eq!(text, v.decoded, "{}", v.message),
        }
        // With the callsign known, every message unpacks to the text that was packed.
        let mut hashes = CallsignHashes::new();
        if let Message::Hashed { call: Some(call), .. } = &msg {
            hashes.insert(call);
        }
        assert_eq!(unpack(&packed, &hashes).expect("unpack"), msg, "{}", v.message);
    }
    assert_eq!(differ, WSPRCODE_DISPLAY.len());
}
