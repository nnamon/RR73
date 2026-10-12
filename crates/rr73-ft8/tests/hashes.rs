//! Hashed callsigns: 22-bit hashes in c28 fields, 12-bit in types 4 and 5, 10-bit in type
//! 0.1, resolved from callsigns seen in full.

use rr73_ft8::message::{Callsign, HashedCallsign, Message, Station, pack, unpack};
use rr73_ft8::{CallHash, CallsignHashes, HashWidth, Payload};

/// Packs `text` as the sender would (with its own table), returning the payload.
fn send(text: &str) -> Payload {
    let message = Message::parse(text).unwrap_or_else(|e| panic!("{text}: {e}"));
    pack(&message, &mut CallsignHashes::new()).unwrap_or_else(|e| panic!("{text}: {e}"))
}

/// Unpacks at the receiver, records the callsigns sent in full and returns the text.
fn receive(payload: &Payload, table: &mut CallsignHashes) -> String {
    let message = unpack(payload, table).unwrap_or_else(|e| panic!("{payload:?}: {e}"));
    table.learn(&message);
    message.to_string()
}

#[test]
fn a_nonstandard_qso_resolves_once_the_full_callsigns_are_heard() {
    let mut rx = CallsignHashes::new();
    // Heard out of order: the report arrives before the CQ that carries the full callsign.
    assert_eq!(
        receive(&send("W9XYZ <PJ4/K1ABC> +03"), &mut rx),
        "W9XYZ <...> +03"
    );
    assert_eq!(receive(&send("CQ PJ4/K1ABC"), &mut rx), "CQ PJ4/K1ABC");
    assert_eq!(
        receive(&send("W9XYZ <PJ4/K1ABC> +03"), &mut rx),
        "W9XYZ <PJ4/K1ABC> +03"
    );
    assert_eq!(
        receive(&send("<PJ4/K1ABC> W9XYZ R-08"), &mut rx),
        "<PJ4/K1ABC> W9XYZ R-08"
    );
    // W9XYZ was heard in full above, so its 12-bit hash resolves too.
    assert_eq!(
        receive(&send("<W9XYZ> PJ4/K1ABC RRR"), &mut rx),
        "<W9XYZ> PJ4/K1ABC RRR"
    );
    assert_eq!(
        receive(&send("PJ4/K1ABC <W9XYZ> 73"), &mut rx),
        "PJ4/K1ABC <W9XYZ> 73"
    );
}

#[test]
fn twelve_bit_hashes_resolve_after_a_standard_message() {
    let mut rx = CallsignHashes::new();
    assert_eq!(
        receive(&send("<OK1AWC> LZ365BM RR73"), &mut rx),
        "<...> LZ365BM RR73"
    );
    // LZ365BM came in full in the type 4 message, so its 22-bit hash resolves here, and this
    // message carries OK1AWC in full.
    assert_eq!(
        receive(&send("LZ365BM OK1AWC -10"), &mut rx),
        "<LZ365BM> OK1AWC -10"
    );
    assert_eq!(
        receive(&send("<OK1AWC> LZ365BM RR73"), &mut rx),
        "<OK1AWC> LZ365BM RR73"
    );
}

#[test]
fn ten_bit_dxpedition_hash_resolves() {
    let mut rx = CallsignHashes::new();
    let fox = send("K1ABC RR73; W9XYZ <KH1/KH7Z> -08");
    assert_eq!(receive(&fox, &mut rx), "K1ABC RR73; W9XYZ <...> -08");
    receive(&send("CQ KH1/KH7Z"), &mut rx);
    assert_eq!(receive(&fox, &mut rx), "K1ABC RR73; W9XYZ <KH1/KH7Z> -08");
}

#[test]
fn eu_vhf_hashes_resolve_at_both_widths() {
    let mut rx = CallsignHashes::new();
    let p = send("<G4ABC/P> <PA9XYZ> R 570007 JO22DB");
    assert_eq!(receive(&p, &mut rx), "<...> <...> R 570007 JO22DB");
    receive(&send("CQ G4ABC/P IO91"), &mut rx);
    receive(&send("CQ PA9XYZ JO22"), &mut rx);
    assert_eq!(receive(&p, &mut rx), "<G4ABC/P> <PA9XYZ> R 570007 JO22DB");
}

#[test]
fn unknown_hashes_repack_to_the_same_bits() {
    let empty = CallsignHashes::new();
    for text in [
        "W9XYZ <PJ4/K1ABC> +03",
        "<W9XYZ> PJ4/K1ABC RRR",
        "K1ABC RR73; W9XYZ <KH1/KH7Z> -08",
        "<G4ABC> <PA9XYZ> R 570007 JO22DB",
        "K1ABC <PJ4/W9XYZ> 6A WI",
    ] {
        let p = send(text);
        let message = unpack(&p, &empty).unwrap_or_else(|e| panic!("{text}: {e}"));
        assert!(message.to_string().contains("<...>"), "{text}");
        assert_eq!(pack(&message, &mut CallsignHashes::new()), Ok(p), "{text}");
        assert!(
            Message::parse(&message.to_string()).is_err(),
            "{text}: <...> cannot be sent"
        );
    }
}

#[test]
fn pack_records_callsigns_for_its_own_messages() {
    let mut table = CallsignHashes::new();
    let message = Message::parse("<PJ4/K1ABC> W9XYZ R-08").expect("message");
    let p = pack(&message, &mut table).expect("packs");
    assert_eq!(table.len(), 2);
    assert_eq!(unpack(&p, &table), Ok(message));
}

#[test]
fn learn_records_only_callsigns_sent_in_full() {
    let mut table = CallsignHashes::new();
    let message = Message::parse("W9XYZ <PJ4/K1ABC> +03").expect("message");
    table.learn(&message);
    let w9xyz = Callsign::new("W9XYZ").expect("callsign");
    let pj4 = Callsign::new("PJ4/K1ABC").expect("callsign");
    assert_eq!(
        table.resolve(CallHash::of(&w9xyz, HashWidth::Bits22)),
        Some(w9xyz)
    );
    assert_eq!(table.resolve(CallHash::of(&pj4, HashWidth::Bits22)), None);
    assert!(
        matches!(message, Message::Standard { de: Station::Hashed(HashedCallsign::Known(c)), .. } if c == pj4)
    );
}
