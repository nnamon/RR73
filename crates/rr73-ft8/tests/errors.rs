//! Error cases of parsing, packing and unpacking.

use rr73_ft8::message::{
    Callsign, Exchange, Field, FieldDayClass, Grid6, HashedCallsign, Message, PackError, Report,
    RoundupExchange, SignalStrength, Station, UnpackError, pack, unpack,
};
use rr73_ft8::{CallHash, CallsignHashes, HashWidth, Payload};

fn call(s: &str) -> Callsign {
    Callsign::new(s).expect("valid callsign")
}

fn parse_err(text: &str) -> PackError {
    match Message::parse(text) {
        Ok(m) => panic!("{text:?} parsed as {m:?}"),
        Err(e) => e,
    }
}

#[test]
fn parse_reports_the_specific_problem() {
    assert_eq!(parse_err(""), PackError::Empty);
    assert_eq!(parse_err(" \t "), PackError::Empty);
    assert_eq!(
        parse_err("THIS TEXT IS FAR TOO LONG"),
        PackError::FreeTextTooLong(25)
    );
    assert_eq!(parse_err("HELLO_WORLD"), PackError::FreeTextCharacter('_'));
    assert_eq!(parse_err("K1ABC W9XYZ -55"), PackError::ReportOutOfRange(-55));
    // "R+100" is no report, so the text falls through to free text, which is too long.
    assert_eq!(parse_err("K1ABC W9XYZ R+100"), PackError::FreeTextTooLong(17));
    assert_eq!(
        parse_err("CQ PJ4/K1ABC FN42"),
        PackError::NonStandardCq(call("PJ4/K1ABC"))
    );
    assert_eq!(
        parse_err("CQ DX PJ4/K1ABC"),
        PackError::NonStandardCq(call("PJ4/K1ABC"))
    );
    assert_eq!(parse_err("K1ABC/R W9XYZ/P -05"), PackError::MixedSuffixes);
    assert_eq!(parse_err("<...> W9XYZ -05"), PackError::UnresolvedHash);
    assert_eq!(
        parse_err("K1ABC <K1> -05"),
        PackError::InvalidCallsign("K1".into())
    );
    assert_eq!(
        parse_err("K1ABC RR73; W9XYZ <KH1/KH7Z> -07"),
        PackError::DxpeditionReport(-7)
    );
    assert_eq!(
        parse_err("K1ABC RR73; W9XYZ <KH1/KH7Z> +34"),
        PackError::DxpeditionReport(34)
    );
    assert_eq!(
        parse_err("K1ABC RR73; W9XYZ <KH1/KH7Z> 08"),
        PackError::Unsupported("08".into())
    );
    assert_eq!(parse_err("K1ABC W9XYZ 33A EMA"), PackError::Transmitters(33));
    assert_eq!(parse_err("K1ABC W9XYZ 0A EMA"), PackError::Transmitters(0));
    assert_eq!(
        parse_err("K1ABC W9XYZ 3J EMA"),
        PackError::InvalidFieldDayClass('J')
    );
    assert_eq!(
        parse_err("K1ABC W9XYZ 3A GTA"),
        PackError::UnknownSection("GTA".into())
    );
    assert_eq!(
        parse_err("K1ABC W9XYZ 3A XYZ"),
        PackError::UnknownSection("XYZ".into())
    );
    assert_eq!(
        parse_err("K1ABC W9XYZ 579 XX"),
        PackError::UnknownStateProvince("XX".into())
    );
    assert_eq!(parse_err("K1ABC W9XYZ 519 MA"), PackError::InvalidStrength(1));
    assert_eq!(
        parse_err("K1ABC W9XYZ 579 8000"),
        PackError::SerialOutOfRange {
            serial: 8000,
            min: 1,
            max: 7999
        }
    );
    assert_eq!(
        parse_err("K1ABC W9XYZ 579 0"),
        PackError::SerialOutOfRange {
            serial: 0,
            min: 1,
            max: 7999
        }
    );
    assert_eq!(parse_err("K1ABC W9XYZ -51"), PackError::ReportOutOfRange(-51));
    assert_eq!(parse_err("K1ABC W9XYZ R+51"), PackError::ReportOutOfRange(51));
    let r15 = rr73_ft8::message::Report::new(-15).expect("report");
    assert_eq!(
        parse_err("CQ DX K1ABC -15"),
        PackError::CqExchange(Exchange::Report {
            report: r15,
            ack: false
        })
    );
    assert_eq!(parse_err("CQ <PJ4/K1ABC> FN42"), PackError::HashedCq);
    assert_eq!(
        parse_err("G4ABC PA9XYZ R 572048 JO22DB"),
        PackError::SerialOutOfRange {
            serial: 2048,
            min: 0,
            max: 2047
        }
    );
    assert_eq!(
        parse_err("G4ABC PA9XYZ R 570001 JO22DZ"),
        PackError::InvalidGrid("JO22DZ".into())
    );
    assert_eq!(
        parse_err("G4ABC PA9XYZ R 510001 JO22DB"),
        PackError::InvalidStrength(1)
    );
    assert_eq!(parse_err("823456789ABCDEF012"), PackError::TelemetryTooLarge);
}

#[test]
fn parse_falls_back_to_free_text_when_it_fits() {
    // A malformed report that still fits 13 characters is sent as free text.
    let m = Message::parse("K1A W9X -55").expect("free text");
    assert!(matches!(m, Message::FreeText { .. }), "{m:?}");
    assert_eq!(m.to_string(), "K1A W9X -55");
}

#[test]
fn field_constructors_reject_bad_values() {
    assert_eq!(Callsign::new("K1"), Err(PackError::InvalidCallsign("K1".into())));
    assert!(Callsign::new("PJ4/K1ABC/QRP").is_err());
    assert_eq!(Report::new(-51), Err(PackError::ReportOutOfRange(-51)));
    assert_eq!(SignalStrength::new(10), Err(PackError::InvalidStrength(10)));
    assert_eq!(
        FieldDayClass::from_letter('Z'),
        Err(PackError::InvalidFieldDayClass('Z'))
    );
    assert!(Grid6::new("SS00AA").is_err());
    assert!(rr73_ft8::message::Grid::new("RR73").is_err());
    assert!(rr73_ft8::message::CqModifier::new("ABCDE").is_err());
    assert!(rr73_ft8::message::CqModifier::new("12").is_err());
    assert!(rr73_ft8::message::Telemetry::from_hex("").is_err());
}

#[test]
fn pack_rejects_messages_the_bits_cannot_carry() {
    let mut hashes = CallsignHashes::new();
    let report = Report::new(-10).expect("report");
    let standard = |to: Station, de: Station| Message::Standard {
        to: rr73_ft8::message::Addressee::Station(to),
        de,
        exchange: Exchange::Report { report, ack: false },
    };
    // A nonstandard callsign cannot travel in full in a 28-bit field.
    let m = standard(Station::Call(call("PJ4/K1ABC")), Station::Call(call("W9XYZ")));
    assert_eq!(
        pack(&m, &mut hashes),
        Err(PackError::NotStandardCallsign(call("PJ4/K1ABC")))
    );
    // /P is not allowed in the 28-bit fields of contest messages.
    let m = Message::RttyRoundup {
        tu: false,
        to: Station::Call(call("K1ABC/P")),
        de: Station::Call(call("W9XYZ")),
        ack: false,
        report: SignalStrength::new(7).expect("strength"),
        exchange: RoundupExchange::Serial(1),
    };
    assert_eq!(
        pack(&m, &mut hashes),
        Err(PackError::NotStandardCallsign(call("K1ABC/P")))
    );
    // An unknown hash must match the width of its field.
    let h12 = CallHash::new(0x123, HashWidth::Bits12).expect("hash");
    let m = standard(
        Station::Hashed(HashedCallsign::Unknown(h12)),
        Station::Call(call("W9XYZ")),
    );
    assert_eq!(
        pack(&m, &mut hashes),
        Err(PackError::HashWidth {
            field_bits: 22,
            hash_bits: 12
        })
    );
    let m = Message::FieldDay {
        to: Station::Call(call("K1ABC")),
        de: Station::Call(call("W9XYZ")),
        ack: false,
        transmitters: 0,
        class: FieldDayClass::A,
        section: rr73_ft8::message::ArrlSection::new("EMA").expect("section"),
    };
    assert_eq!(pack(&m, &mut hashes), Err(PackError::Transmitters(0)));
    let m = Message::Dxpedition {
        rr73_to: Station::Call(call("K1ABC")),
        report_to: Station::Call(call("W9XYZ")),
        fox: HashedCallsign::Known(call("KH1/KH7Z")),
        report: Report::new(33).expect("report"),
    };
    assert_eq!(pack(&m, &mut hashes), Err(PackError::DxpeditionReport(33)));
    let m = Message::EuVhf {
        to: HashedCallsign::Known(call("G4ABC")),
        de: HashedCallsign::Known(call("PA9XYZ")),
        ack: false,
        report: SignalStrength::new(9).expect("strength"),
        serial: 3000,
        grid: Grid6::new("JO22DB").expect("grid"),
    };
    assert_eq!(
        pack(&m, &mut hashes),
        Err(PackError::SerialOutOfRange {
            serial: 3000,
            min: 0,
            max: 2047
        })
    );
    let m = Message::RttyRoundup {
        tu: false,
        to: Station::Call(call("K1ABC")),
        de: Station::Call(call("W9XYZ")),
        ack: false,
        report: SignalStrength::new(9).expect("strength"),
        exchange: RoundupExchange::Serial(9000),
    };
    assert_eq!(
        pack(&m, &mut hashes),
        Err(PackError::SerialOutOfRange {
            serial: 9000,
            min: 1,
            max: 7999
        })
    );
    // Failed packs record nothing.
    assert!(hashes.is_empty());
}

/// Builds a payload field by field, MSB first.
struct Bits(Vec<u8>);

impl Bits {
    fn new() -> Self {
        Bits(Vec::new())
    }

    fn put(mut self, value: u128, n: u32) -> Self {
        for i in (0..n).rev() {
            self.0.push(((value >> i) & 1) as u8);
        }
        self
    }

    fn payload(self) -> Payload {
        assert_eq!(self.0.len(), 77);
        Payload::from_bits(&self.0)
    }
}

const NTOKENS: u128 = 2_063_592;
const MAX22: u128 = 4_194_304;

/// c28 of K1ABC: the standard-callsign index of " K1ABC" above the tokens and hashes.
fn k1abc() -> u128 {
    let probe = pack(
        &Message::parse("K1ABC W9XYZ").expect("message"),
        &mut CallsignHashes::new(),
    )
    .expect("packs");
    (0..28).fold(0u128, |acc, i| (acc << 1) | u128::from(probe.bit(i)))
}

fn std_payload(
    c28a: u128,
    flag_a: u128,
    c28b: u128,
    flag_b: u128,
    ack: u128,
    g15: u128,
    i3: u128,
) -> Payload {
    Bits::new()
        .put(c28a, 28)
        .put(flag_a, 1)
        .put(c28b, 28)
        .put(flag_b, 1)
        .put(ack, 1)
        .put(g15, 15)
        .put(i3, 3)
        .payload()
}

#[test]
fn unpack_rejects_reserved_types_and_bad_fields() {
    let empty = CallsignHashes::new();
    let invalid = |f| Err(UnpackError::InvalidField(f));
    let call = k1abc();
    assert!(call >= NTOKENS + MAX22);

    for (i3, n3) in [(0, 2), (0, 6), (0, 7), (6, 0), (7, 0), (6, 5)] {
        let p = Bits::new().put(0x1234, 71).put(n3, 3).put(i3, 3).payload();
        assert_eq!(
            unpack(&p, &empty),
            Err(UnpackError::InvalidType {
                i3: i3 as u8,
                n3: n3 as u8
            }),
            "{i3}.{n3}"
        );
    }

    let free_text = |v: u128| Bits::new().put(v, 71).put(0, 3).put(0, 3).payload();
    assert_eq!(
        unpack(&free_text(42u128.pow(13)), &empty),
        invalid(Field::FreeText)
    );
    assert_eq!(unpack(&free_text(0), &empty), invalid(Field::FreeText));
    assert!(unpack(&free_text(42u128.pow(13) - 1), &empty).is_ok());

    // Unused token value, a word in the second field, flags on words and hashes.
    assert_eq!(
        unpack(&std_payload(532_444, 0, call, 0, 0, 32_401, 1), &empty),
        invalid(Field::Callsign)
    );
    assert_eq!(
        unpack(&std_payload(1003, 0, call, 0, 0, 32_401, 1), &empty),
        invalid(Field::Callsign)
    );
    assert_eq!(
        unpack(&std_payload(call, 0, 2, 0, 0, 32_401, 1), &empty),
        invalid(Field::Callsign)
    );
    assert_eq!(
        unpack(&std_payload(2, 1, call, 0, 0, 32_401, 1), &empty),
        invalid(Field::SuffixFlag)
    );
    assert_eq!(
        unpack(&std_payload(NTOKENS + 5, 1, call, 0, 0, 32_401, 1), &empty),
        invalid(Field::SuffixFlag)
    );
    assert_eq!(
        unpack(&std_payload(call, 0, NTOKENS + 5, 1, 0, 32_401, 1), &empty),
        invalid(Field::SuffixFlag)
    );
    // A standard-callsign value with a letter after a space in the suffix: " K1 A ".
    let gap = NTOKENS + MAX22 + ((((20 * 10 + 1) * 27) * 27 + 1) * 27);
    assert_eq!(
        unpack(&std_payload(gap, 0, call, 0, 0, 1, 1), &empty),
        invalid(Field::Callsign)
    );
    // WSJT-X shows c28 layouts that are no real callsign as they are: "000A".
    let prefix_00 = NTOKENS + MAX22 + 36 * 10 * 27u128.pow(3) + 27 * 27;
    assert_eq!(
        unpack(&std_payload(prefix_00, 0, call, 0, 0, 1, 1), &empty).map(|m| m.to_string()),
        Ok("000A K1ABC AA01".to_string())
    );

    // g15: 32 400 is unused; R is ignored before RRR and refused before RR73 as 32 403;
    // report codes above 186 are refused.
    let show = |p: Payload| unpack(&p, &empty).map(|m| m.to_string());
    assert_eq!(
        show(std_payload(call, 0, call, 0, 0, 32_400, 1)),
        Err(UnpackError::InvalidField(Field::Grid))
    );
    assert_eq!(
        show(std_payload(call, 0, call, 0, 1, 32_402, 1)),
        Ok("K1ABC K1ABC RRR".into())
    );
    assert_eq!(
        show(std_payload(call, 0, call, 0, 1, 32_401, 1)),
        Ok("K1ABC K1ABC".into())
    );
    assert_eq!(
        show(std_payload(call, 0, call, 0, 1, 32_373, 1)),
        Ok("K1ABC K1ABC R RR73".into())
    );
    assert_eq!(
        show(std_payload(call, 0, call, 0, 1, 32_403, 1)),
        Err(UnpackError::InvalidField(Field::Acknowledgement))
    );
    assert_eq!(
        show(std_payload(call, 0, call, 0, 0, 32_587, 1)),
        Err(UnpackError::InvalidField(Field::Report))
    );
    assert_eq!(
        show(std_payload(call, 0, call, 0, 0, 32_586, 1)),
        Ok("K1ABC K1ABC +50".into())
    );
    assert_eq!(
        show(std_payload(call, 0, call, 0, 0, 32_486, 1)),
        Ok("K1ABC K1ABC -50".into())
    );

    // CQ carries only a locator, RR73 or nothing, from a callsign in full.
    assert_eq!(
        show(std_payload(2, 0, call, 0, 0, 32_420, 1)),
        Err(UnpackError::InvalidField(Field::Cq))
    );
    assert_eq!(
        show(std_payload(2, 0, call, 0, 1, 1, 1)),
        Err(UnpackError::InvalidField(Field::Cq))
    );
    assert_eq!(
        show(std_payload(2, 0, call, 0, 0, 32_402, 1)),
        Err(UnpackError::InvalidField(Field::Cq))
    );
    assert_eq!(
        show(std_payload(2, 0, NTOKENS + 5, 0, 0, 1, 1)),
        Err(UnpackError::InvalidField(Field::Cq))
    );
    assert_eq!(
        show(std_payload(2, 0, call, 0, 0, 32_373, 1)),
        Ok("CQ K1ABC RR73".into())
    );
    assert_eq!(
        show(std_payload(1, 0, call, 0, 0, 32_420, 1)),
        Ok("QRZ K1ABC -15".into())
    );

    // Field Day class 6 (G), sections 0 and 87.
    let fd = |class: u128, section: u128| {
        Bits::new()
            .put(call, 28)
            .put(call, 28)
            .put(0, 1)
            .put(0, 4)
            .put(class, 3)
            .put(section, 7)
            .put(3, 3)
            .put(0, 3)
            .payload()
    };
    assert_eq!(
        unpack(&fd(6, 1), &empty).map(|m| m.to_string()),
        Ok("K1ABC K1ABC 1G AB".to_string())
    );
    assert_eq!(unpack(&fd(0, 0), &empty), invalid(Field::Section));
    assert_eq!(unpack(&fd(0, 87), &empty), invalid(Field::Section));
    assert!(unpack(&fd(7, 86), &empty).is_ok());

    // RTTY Roundup exchange 0, 8000 and 8066.
    let rtty = |s13: u128| {
        Bits::new()
            .put(0, 1)
            .put(call, 28)
            .put(call, 28)
            .put(0, 1)
            .put(0, 3)
            .put(s13, 13)
            .put(3, 3)
            .payload()
    };
    assert_eq!(unpack(&rtty(0), &empty), invalid(Field::RoundupExchange));
    assert_eq!(unpack(&rtty(8000), &empty), invalid(Field::RoundupExchange));
    assert_eq!(unpack(&rtty(8066), &empty), invalid(Field::RoundupExchange));
    assert!(unpack(&rtty(8065), &empty).is_ok());

    // Type 4: c58 beyond 38^11, RRR or h1 in a CQ.
    let t4 = |c58: u128, h1: u128, r2: u128, c1: u128| {
        Bits::new()
            .put(0, 12)
            .put(c58, 58)
            .put(h1, 1)
            .put(r2, 2)
            .put(c1, 1)
            .put(4, 3)
            .payload()
    };
    let c58 = 77_496_702_819; // OR18TRA
    assert_eq!(
        unpack(&t4(38u128.pow(11), 0, 0, 0), &empty),
        invalid(Field::Callsign)
    );
    assert_eq!(unpack(&t4(c58, 0, 1, 1), &empty), invalid(Field::Cq));
    assert_eq!(unpack(&t4(c58, 1, 0, 1), &empty), invalid(Field::Cq));
    assert!(unpack(&t4(c58, 0, 0, 1), &empty).is_ok());

    // Type 5: locator beyond RR99XX.
    let t5 = |g25: u128| {
        Bits::new()
            .put(0, 12)
            .put(0, 22)
            .put(0, 1)
            .put(0, 3)
            .put(0, 11)
            .put(g25, 25)
            .put(5, 3)
            .payload()
    };
    assert_eq!(unpack(&t5(18_662_400), &empty), invalid(Field::Grid6));
    assert!(unpack(&t5(18_662_399), &empty).is_ok());
}

#[test]
fn unpack_error_messages_name_the_field() {
    assert_eq!(
        UnpackError::InvalidType { i3: 0, n3: 2 }.to_string(),
        "invalid message type 0.2"
    );
    assert_eq!(
        UnpackError::InvalidField(Field::Section).to_string(),
        "invalid section field"
    );
    assert_eq!(
        PackError::NotStandardCallsign(call("PJ4/K1ABC")).to_string(),
        "PJ4/K1ABC is not a standard callsign; send it as a hash, written <PJ4/K1ABC>"
    );
}
