//! Operator text: what `Message::parse` accepts and what `Display` writes.

use rr73_ft8::message::{
    Addressee, Callsign, CqModifier, Exchange, Grid, HashedCallsign, Message, Reply, Report, Station,
};

fn canonical(text: &str) -> String {
    Message::parse(text)
        .unwrap_or_else(|e| panic!("{text:?}: {e}"))
        .to_string()
}

fn call(s: &str) -> Callsign {
    Callsign::new(s).expect("valid callsign")
}

#[test]
fn case_and_spacing_do_not_matter() {
    assert_eq!(canonical("cq k1abc fn42"), "CQ K1ABC FN42");
    assert_eq!(canonical("  CQ   K1ABC\tFN42 \n"), "CQ K1ABC FN42");
    assert_eq!(canonical("cq pota w1aw fn31"), "CQ POTA W1AW FN31");
    assert_eq!(canonical("k1abc w9xyz 6a wi"), "K1ABC W9XYZ 6A WI");
    assert_eq!(canonical("tnx  bob 73   gl"), "TNX BOB 73 GL");
    assert_eq!(canonical("123456789abcdef012"), "123456789ABCDEF012");
}

#[test]
fn reports_and_acknowledgements() {
    assert_eq!(canonical("K1ABC W9XYZ -5"), "K1ABC W9XYZ -05");
    assert_eq!(canonical("K1ABC W9XYZ +5"), "K1ABC W9XYZ +05");
    assert_eq!(canonical("K1ABC W9XYZ R -15"), "K1ABC W9XYZ R-15");
    assert_eq!(canonical("K1ABC W9XYZ R-15"), "K1ABC W9XYZ R-15");
    assert_eq!(canonical("K1ABC W9XYZ R FN42"), "K1ABC W9XYZ R FN42");
    assert_eq!(canonical("K1ABC W9XYZ -00"), "K1ABC W9XYZ +00");
}

#[test]
fn hashing_follows_the_fields() {
    // A nonstandard callsign with a report travels as a 22-bit hash in type 1.
    assert_eq!(canonical("PJ4/K1ABC W9XYZ -05"), "<PJ4/K1ABC> W9XYZ -05");
    assert_eq!(canonical("W9XYZ PJ4/K1ABC R-05"), "W9XYZ <PJ4/K1ABC> R-05");
    // With RRR, RR73, 73 or nothing, type 4 carries it in full and hashes the other.
    assert_eq!(canonical("W9XYZ PJ4/K1ABC RRR"), "<W9XYZ> PJ4/K1ABC RRR");
    assert_eq!(canonical("PJ4/K1ABC W9XYZ 73"), "PJ4/K1ABC <W9XYZ> 73");
    assert_eq!(canonical("W9XYZ PJ4/K1ABC"), "<W9XYZ> PJ4/K1ABC");
    // Brackets choose explicitly.
    assert_eq!(canonical("<PJ4/K1ABC> W9XYZ RR73"), "<PJ4/K1ABC> W9XYZ RR73");
    assert_eq!(canonical("<K1ABC> W9XYZ 73"), "<K1ABC> W9XYZ 73");
    assert_eq!(canonical("CQ PJ4/K1ABC"), "CQ PJ4/K1ABC");
    assert_eq!(canonical("QRZ <PJ4/K1ABC> FN42"), "QRZ <PJ4/K1ABC> FN42");
    // Contest fields without suffix flags hash /P calls; EU VHF and the Fox call are always hashed.
    assert_eq!(canonical("K1ABC W9XYZ/P 579 MA"), "K1ABC <W9XYZ/P> 579 MA");
    assert_eq!(
        canonical("G4ABC PA9XYZ R 570007 jo22db"),
        "<G4ABC> <PA9XYZ> R 570007 JO22DB"
    );
    assert_eq!(
        canonical("K1ABC RR73; W9XYZ KH1/KH7Z -08"),
        "K1ABC RR73; W9XYZ <KH1/KH7Z> -08"
    );
}

#[test]
fn contest_exchanges() {
    assert_eq!(canonical("K1ABC W9XYZ 579 13"), "K1ABC W9XYZ 579 0013");
    assert_eq!(canonical("tu; k1abc w9xyz r 589 ma"), "TU; K1ABC W9XYZ R 589 MA");
    assert_eq!(canonical("W9XYZ K1ABC R 17B EMA"), "W9XYZ K1ABC R 17B EMA");
}

#[test]
fn words_that_are_not_callsigns_make_free_text() {
    for text in [
        "TNX 73",
        "RR73",
        "QRT",
        "CQ",
        "CQ DX",
        "K1ABC 73",
        "5W DIPOLE",
        "R FN42",
        "GL OM",
        "FN42 FN43",
    ] {
        let m = Message::parse(text).unwrap_or_else(|e| panic!("{text}: {e}"));
        assert!(matches!(m, Message::FreeText { .. }), "{text}: {m:?}");
        assert_eq!(m.to_string(), text);
    }
}

#[test]
fn single_hex_words_are_telemetry_as_in_wsjtx() {
    for (text, shown) in [
        ("73", "73"),
        ("cafe", "CAFE"),
        ("0123456789ABC", "123456789ABC"),
        ("0", "0"),
    ] {
        let m = Message::parse(text).unwrap_or_else(|e| panic!("{text}: {e}"));
        assert!(matches!(m, Message::Telemetry { .. }), "{text}: {m:?}");
        assert_eq!(m.to_string(), shown);
    }
    assert!(matches!(Message::parse("DE"), Ok(Message::FreeText { .. })));
}

#[test]
fn parse_builds_the_expected_fields() {
    assert_eq!(
        Message::parse("CQ DX K1ABC FN42"),
        Ok(Message::Standard {
            to: Addressee::Cq {
                modifier: Some(CqModifier::new("DX").expect("modifier"))
            },
            de: Station::Call(call("K1ABC")),
            exchange: Exchange::Grid {
                grid: Grid::new("FN42").expect("grid"),
                ack: false
            },
        })
    );
    assert_eq!(
        Message::parse("JA1KXM 9V1NE R-14"),
        Ok(Message::Standard {
            to: Addressee::Station(Station::Call(call("JA1KXM"))),
            de: Station::Call(call("9V1NE")),
            exchange: Exchange::Report {
                report: Report::new(-14).expect("report"),
                ack: true
            },
        })
    );
    assert_eq!(
        Message::parse("PJ4/K1ABC <W9XYZ> 73"),
        Ok(Message::NonStandard {
            call: call("PJ4/K1ABC"),
            hashed: HashedCallsign::Known(call("W9XYZ")),
            hashed_second: true,
            reply: Some(Reply::SeventyThree),
        })
    );
    assert_eq!(Message::parse("CQ 123 K1ABC").map(|m| m.i3_n3()), Ok((1, 0)));
    assert_eq!(Message::parse("CQ G4ABC/P IO91").map(|m| m.i3_n3()), Ok((2, 0)));
    assert_eq!(
        Message::parse("W9XYZ K1ABC 32D WWA").map(|m| m.i3_n3()),
        Ok((0, 4))
    );
}

#[test]
fn display_writes_exactly_what_unpack_returns() {
    // Messages built in code display the same way as parsed ones.
    let m = Message::NonStandardCq {
        call: call("yw18fifa"),
    };
    assert_eq!(m.to_string(), "CQ YW18FIFA");
    let m = Message::Standard {
        to: Addressee::Qrz,
        de: Station::Hashed(HashedCallsign::Known(call("PJ4/K1ABC"))),
        exchange: Exchange::Blank,
    };
    assert_eq!(m.to_string(), "QRZ <PJ4/K1ABC>");
}
