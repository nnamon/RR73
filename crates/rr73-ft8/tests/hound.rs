//! The messages of a Hound's QSO with a Fox in FT8 DXpedition mode (K1JT, "FT8 DXpedition
//! Mode User Guide"), against WSJT-X 2.7.0-rc3's ft8sim (`fixtures/ft8/wsjtx.json`).
//!
//! A Hound calls the Fox's base callsign with its grid, receives a report, sends an R-report
//! and logs on the Fox's RR73. The Fox sends RR73 alone or in its multi-call message (type
//! 0.1), which carries RR73 to one Hound and a report to the next, with the Fox's callsign as
//! a 10-bit hash. A Hound that has not heard the Fox's callsign in full sees `<...>` there.

mod common;

use rr73_ft8::message::{Callsign, HashedCallsign, Message, Report, Station, pack, unpack};
use rr73_ft8::{CallsignHashes, Payload};
use serde::Deserialize;

#[derive(Deserialize)]
struct File {
    vectors: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    input: String,
    text: String,
    i3: u8,
    n3: Option<u8>,
    bits: String,
}

/// One QSO with a Fox signing KH1/KH7Z, and the forms a Fox with a standard callsign and a
/// Hound with a compound callsign send, with WSJT-X's i3.n3.
const QSO: &[(&str, u8, u8)] = &[
    ("CQ KH1/KH7Z", 4, 0),
    ("CQ KH7Z AJ10", 1, 0),
    ("KH7Z K1ABC FN42", 1, 0),
    ("K1ABC KH7Z -13", 1, 0),
    ("K1ABC <KH1/KH7Z> -14", 1, 0),
    ("KH7Z K1ABC R-11", 1, 0),
    ("K1ABC KH7Z RR73", 1, 0),
    ("K1ABC <KH1/KH7Z> RR73", 1, 0),
    ("KH7Z W9XYZ R-16", 1, 0),
    ("W9XYZ RR73; G4AAA <KH1/KH7Z> -10", 0, 1),
    ("K1ABC RR73; W9XYZ <KH7Z> -16", 0, 1),
    ("<KH7Z> W2/G4XYZ", 4, 0),
    ("KH7Z <W2/G4XYZ> R-11", 1, 0),
];

fn payload(bits: &str) -> Payload {
    Payload::from_bits(&bits.bytes().map(|b| b - b'0').collect::<Vec<_>>())
}

fn case<'a>(file: &'a File, input: &str) -> &'a Case {
    file.vectors
        .iter()
        .find(|c| c.input == input)
        .unwrap_or_else(|| panic!("{input} is not in tools/wsjtx/cases.txt"))
}

fn call(text: &str) -> Callsign {
    Callsign::new(text).unwrap_or_else(|e| panic!("{text}: {e}"))
}

#[test]
fn every_hound_message_packs_to_wsjtx_bits() {
    let file: File = common::load("wsjtx.json");
    for &(input, i3, n3) in QSO {
        let c = case(&file, input);
        assert_eq!(c.text, input, "WSJT-X shows {input} as {}", c.text);
        assert_eq!((c.i3, c.n3), (i3, Some(n3)), "{input}");
        let m = Message::parse(input).unwrap_or_else(|e| panic!("{input}: {e}"));
        assert_eq!(m.i3_n3(), (i3, n3), "{input}");
        let p = pack(&m, &mut CallsignHashes::new()).unwrap_or_else(|e| panic!("{input}: {e}"));
        assert_eq!(p, payload(&c.bits), "{input}");
    }
}

#[test]
fn a_hound_that_heard_the_fox_cq_reads_the_multi_call_message() {
    let file: File = common::load("wsjtx.json");
    // The Hound's decoder learns KH1/KH7Z from the Fox's CQ, which carries it in full.
    let mut heard = CallsignHashes::new();
    heard.learn(
        &unpack(&payload(&case(&file, "CQ KH1/KH7Z").bits), &CallsignHashes::new())
            .expect("WSJT-X\'s bits unpack"),
    );
    let input = "W9XYZ RR73; G4AAA <KH1/KH7Z> -10";
    let m = unpack(&payload(&case(&file, input).bits), &heard).expect("WSJT-X\'s bits unpack");
    assert_eq!(m.to_string(), input);
    assert_eq!(
        m,
        Message::Dxpedition {
            rr73_to: Station::Call(call("W9XYZ")),
            report_to: Station::Call(call("G4AAA")),
            fox: HashedCallsign::Known(call("KH1/KH7Z")),
            report: Report::new(-10).expect("an even report"),
        }
    );
}

#[test]
fn a_hound_that_has_not_heard_the_fox_sees_a_hash_but_both_hounds_and_the_report() {
    let file: File = common::load("wsjtx.json");
    for (input, shown) in [
        ("W9XYZ RR73; G4AAA <KH1/KH7Z> -10", "W9XYZ RR73; G4AAA <...> -10"),
        ("K1ABC RR73; W9XYZ <KH7Z> -16", "K1ABC RR73; W9XYZ <...> -16"),
    ] {
        let m = unpack(&payload(&case(&file, input).bits), &CallsignHashes::new())
            .expect("WSJT-X\'s bits unpack");
        assert_eq!(m.to_string(), shown, "{input}");
        let Message::Dxpedition { fox, .. } = m else {
            panic!("{input} unpacks as {m:?}");
        };
        assert_eq!(fox.callsign(), None, "{input}");
    }
}

#[test]
fn the_fox_hash_of_a_standard_callsign_resolves_from_its_cq() {
    let file: File = common::load("wsjtx.json");
    let mut heard = CallsignHashes::new();
    heard.learn(
        &unpack(
            &payload(&case(&file, "CQ KH7Z AJ10").bits),
            &CallsignHashes::new(),
        )
        .expect("WSJT-X\'s bits unpack"),
    );
    let input = "K1ABC RR73; W9XYZ <KH7Z> -16";
    let m = unpack(&payload(&case(&file, input).bits), &heard).expect("WSJT-X\'s bits unpack");
    assert_eq!(m.to_string(), input);
}

#[test]
fn multi_call_reports_are_even_from_minus_30_to_plus_32() {
    for db in (-30i32..=32).step_by(2) {
        let text = format!(
            "K1ABC RR73; W9XYZ <KH7Z> {}{:02}",
            if db < 0 { '-' } else { '+' },
            db.abs()
        );
        let m = Message::parse(&text).unwrap_or_else(|e| panic!("{text}: {e}"));
        let p = pack(&m, &mut CallsignHashes::new()).expect("an even report packs");
        let mut heard = CallsignHashes::new();
        heard.insert(&call("KH7Z"));
        assert_eq!(
            unpack(&p, &heard).expect("WSJT-X\'s bits unpack").to_string(),
            text
        );
    }
    for text in [
        "K1ABC RR73; W9XYZ <KH7Z> -31",
        "K1ABC RR73; W9XYZ <KH7Z> +34",
        "K1ABC RR73; W9XYZ <KH7Z> -32",
    ] {
        let sent = Message::parse(text).and_then(|m| pack(&m, &mut CallsignHashes::new()));
        assert!(sent.is_err(), "{text}");
    }
}
