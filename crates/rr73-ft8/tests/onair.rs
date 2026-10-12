//! Agreement with on-air transmissions: payloads that ft8_lib decoded from the recordings in
//! its test set, paired with the text of the reference decode lists shipped with them, which
//! are in WSJT-X's output format (`fixtures/ft8/onair.json`).

mod common;

use common::{OnAir, noncanonical, payload, to_hex};
use rr73_ft8::CallsignHashes;
use rr73_ft8::message::{Message, pack, unpack};
use std::collections::BTreeMap;

/// Replaces every `<...>` or `<CALL>` token with `<...>`: the reference decoder resolved
/// hashes from its own history, the test starts with an empty table.
fn normalise(text: &str) -> String {
    text.split(' ')
        .map(|w| {
            if w.starts_with('<') && w.ends_with('>') {
                "<...>"
            } else {
                w
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn unpack_shows_the_reference_text_and_repacks_exactly() {
    let entries: Vec<OnAir> = common::load("onair.json");
    assert!(entries.len() > 500, "{}", entries.len());
    let empty = CallsignHashes::new();
    let mut by_type: BTreeMap<(u8, u8), usize> = BTreeMap::new();
    let mut reasons: BTreeMap<&str, usize> = BTreeMap::new();
    for e in &entries {
        let p = payload(&e.payload);
        let message =
            unpack(&p, &empty).unwrap_or_else(|err| panic!("{} {}: {err}", e.file, e.reference_text));
        assert_eq!(
            message.to_string(),
            normalise(&e.reference_text),
            "{} {}",
            e.file,
            e.payload
        );
        // Packing gives back the same bits, except for the documented non-canonical forms.
        let repacked = pack(&message, &mut CallsignHashes::new())
            .unwrap_or_else(|err| panic!("{}: {err}", e.reference_text));
        match noncanonical(&p) {
            None => assert_eq!(to_hex(&repacked.0), e.payload, "{}", e.reference_text),
            Some(reason) => {
                assert_ne!(to_hex(&repacked.0), e.payload, "{}", e.reference_text);
                assert_eq!(unpack(&repacked, &empty), Ok(message), "{}", e.reference_text);
                *reasons.entry(reason).or_default() += 1;
            }
        }
        let (i3, n3) = (p.i3(), if p.i3() == 0 { p.n3() } else { 0 });
        *by_type.entry((i3, n3)).or_default() += 1;
    }
    // The recordings hold standard messages, /P messages, free text and nonstandard calls.
    for t in [(0, 0), (1, 0), (2, 0), (4, 0)] {
        assert!(by_type.contains_key(&t), "{by_type:?}");
    }
    // One station (LZ365BM) sends its callsign left-justified in c58: 4 distinct payloads.
    // Every other payload in the recordings is in canonical form.
    assert_eq!(
        reasons.into_iter().collect::<Vec<_>>(),
        vec![("c58 not right-justified", 4)]
    );
}

#[test]
fn reference_text_parses_to_the_same_message() {
    let entries: Vec<OnAir> = common::load("onair.json");
    let mut checked = 0;
    for e in entries
        .iter()
        .filter(|e| !e.reference_text.contains("<...>") && noncanonical(&payload(&e.payload)).is_none())
    {
        let mut hashes = CallsignHashes::new();
        let parsed =
            Message::parse(&e.reference_text).unwrap_or_else(|err| panic!("{}: {err}", e.reference_text));
        let packed = pack(&parsed, &mut hashes).unwrap_or_else(|err| panic!("{}: {err}", e.reference_text));
        // A callsign the reference decoder resolved hashes to the bits it received.
        assert_eq!(to_hex(&packed.0), e.payload, "{}", e.reference_text);
        assert_eq!(parsed.to_string(), e.reference_text);
        checked += 1;
    }
    assert!(checked > 400, "{checked}");
}
