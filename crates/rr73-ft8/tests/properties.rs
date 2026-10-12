//! Property tests over seeded random payloads, messages and text.

mod common;

use common::{Rng, noncanonical};
use rr73_ft8::message::{
    Addressee, ArrlSection, Callsign, CqModifier, Exchange, FieldDayClass, FreeText, Grid, Grid6,
    HashedCallsign, Message, Reply, Report, RoundupExchange, SignalStrength, StateProvince, Station,
    Telemetry, pack, unpack,
};
use rr73_ft8::{CallsignHashes, Mode, Payload, crc, ldpc, tones};
use std::collections::BTreeMap;

const LETTERS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"0123456789";

/// Sets i3 (and n3 when i3 is 0) so every message type is drawn equally often.
fn spread_types(rng: &mut Rng, mut p: Payload) -> Payload {
    let i3 = rng.below(8) as u8;
    p.0[9] = (p.0[9] & 0xC7) | (i3 << 3);
    if i3 == 0 {
        let n3 = rng.below(8) as u8;
        p.0[8] = (p.0[8] & 0xFE) | (n3 >> 2);
        p.0[9] = (p.0[9] & 0x3F) | ((n3 & 3) << 6);
    }
    p
}

fn collapse_spaces(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn random_payloads_unpack_and_repack() {
    let mut rng = Rng::new(0x5EED_0001);
    let empty = CallsignHashes::new();
    let mut accepted: BTreeMap<(u8, u8), usize> = BTreeMap::new();
    let mut rejected: BTreeMap<(u8, u8), usize> = BTreeMap::new();
    let mut reasons: BTreeMap<&str, usize> = BTreeMap::new();
    let mut texts = 0;
    for _ in 0..120_000 {
        let raw = rng.payload();
        let p = spread_types(&mut rng, raw);
        let key = (p.i3(), if p.i3() == 0 { p.n3() } else { 0 });
        let Ok(m) = unpack(&p, &empty) else {
            *rejected.entry(key).or_default() += 1;
            continue;
        };
        *accepted.entry(key).or_default() += 1;
        let q = pack(&m, &mut CallsignHashes::new()).unwrap_or_else(|e| panic!("{m:?}: {e}"));
        assert_eq!(unpack(&q, &empty), Ok(m), "{p:?}");
        assert_eq!(
            noncanonical(&q),
            None,
            "pack wrote a non-canonical form for {m:?}"
        );
        match noncanonical(&p) {
            None => assert_eq!(q, p, "{m}"),
            Some(reason) => {
                assert_ne!(q, p, "{m}");
                *reasons.entry(reason).or_default() += 1;
            }
        }
        let text = m.to_string();
        if text.contains("<...>") {
            continue;
        }
        let parsed = Message::parse(&text).unwrap_or_else(|e| panic!("{text}: {e}"));
        texts += 1;
        match m {
            Message::FreeText { .. } => {
                if let Message::FreeText { text: t } = parsed {
                    assert_eq!(t.as_str(), collapse_spaces(&text));
                }
            }
            Message::NonStandard { call, .. } | Message::NonStandardCq { call } if call.is_standard() => {
                assert_eq!(parsed.to_string(), text);
            }
            _ => assert_eq!(parsed, m, "{text}"),
        }
    }
    eprintln!("accepted {accepted:?}\nrejected {rejected:?}\nnon-canonical {reasons:?}");
    // Every defined type unpacks from some random payloads; reserved types never do. Each type
    // 0 subtype gets 1/64 of the draws.
    for t in [
        (0, 0),
        (0, 1),
        (0, 3),
        (0, 4),
        (0, 5),
        (1, 0),
        (2, 0),
        (3, 0),
        (4, 0),
        (5, 0),
    ] {
        assert!(
            accepted.get(&t).copied().unwrap_or(0) > 300,
            "{t:?}: {accepted:?}"
        );
    }
    for t in [(0, 2), (0, 6), (0, 7), (6, 0), (7, 0)] {
        assert_eq!(accepted.get(&t), None, "{t:?}");
    }
    assert!(texts > 30_000, "{texts}");
}

#[test]
fn unpack_ignores_bits_after_the_payload_and_never_panics() {
    let mut rng = Rng::new(0x5EED_0002);
    let empty = CallsignHashes::new();
    for _ in 0..50_000 {
        let mut bytes = [0u8; 10];
        for b in &mut bytes {
            *b = rng.next_u64() as u8;
        }
        let p = Payload(bytes);
        assert_eq!(unpack(&p, &empty), unpack(&p.masked(), &empty));
    }
}

// Random messages built field by field.

fn letter(rng: &mut Rng) -> char {
    char::from(*rng.pick(LETTERS))
}

fn digit(rng: &mut Rng) -> char {
    char::from(*rng.pick(DIGITS))
}

fn standard_base(rng: &mut Rng) -> Callsign {
    loop {
        let mut s = String::new();
        match rng.below(6) {
            0 => s.push(letter(rng)),
            1 | 2 => {
                s.push(letter(rng));
                s.push(letter(rng));
            }
            3 => {
                s.push(letter(rng));
                s.push(digit(rng));
            }
            4 => {
                s.push(digit(rng));
                s.push(letter(rng));
            }
            _ => s.push_str(if rng.coin() { "3DA" } else { "3X" }),
        }
        if s == "3X" {
            s.push(letter(rng));
        }
        s.push(digit(rng));
        for _ in 0..=rng.below(3) {
            s.push(letter(rng));
        }
        if let Ok(c) = Callsign::new(&s)
            && c.is_standard_base()
        {
            return c;
        }
    }
}

fn nonstandard(rng: &mut Rng) -> Callsign {
    loop {
        let base = standard_base(rng).to_string();
        let s = match rng.below(4) {
            0 => format!("{}{}/{base}", letter(rng), digit(rng)),
            1 => format!("{base}/{}", rng.pick(&["QRP", "MM", "AM", "M", "1", "7", "A"])),
            2 => format!(
                "{}{}{}{}{}{}{}",
                letter(rng),
                letter(rng),
                digit(rng),
                digit(rng),
                digit(rng),
                letter(rng),
                letter(rng)
            ),
            _ => format!(
                "{}{}{}{}{}{}",
                letter(rng),
                letter(rng),
                digit(rng),
                digit(rng),
                letter(rng),
                letter(rng)
            ),
        };
        if let Ok(c) = Callsign::new(&s)
            && !c.is_standard()
        {
            return c;
        }
    }
}

fn any_call(rng: &mut Rng) -> Callsign {
    if rng.coin() {
        standard_base(rng)
    } else {
        nonstandard(rng)
    }
}

fn known(rng: &mut Rng) -> HashedCallsign {
    HashedCallsign::Known(any_call(rng))
}

fn station28(rng: &mut Rng) -> Station {
    if rng.below(3) == 0 {
        Station::Hashed(known(rng))
    } else {
        Station::Call(standard_base(rng))
    }
}

fn station_flagged(rng: &mut Rng, suffix: &str) -> Station {
    match rng.below(4) {
        0 => Station::Hashed(known(rng)),
        1 if !suffix.is_empty() => {
            let c = Callsign::new(&format!("{}{suffix}", standard_base(rng))).expect("suffix fits");
            Station::Call(c)
        }
        _ => Station::Call(standard_base(rng)),
    }
}

fn grid(rng: &mut Rng) -> Grid {
    loop {
        let s = format!(
            "{}{}{}{}",
            char::from(b'A' + rng.below(18) as u8),
            char::from(b'A' + rng.below(18) as u8),
            digit(rng),
            digit(rng)
        );
        if let Ok(g) = Grid::new(&s) {
            return g;
        }
    }
}

fn report(rng: &mut Rng) -> Report {
    Report::new(rng.below(101) as i32 - 50).expect("in range")
}

fn strength(rng: &mut Rng) -> SignalStrength {
    SignalStrength::new(2 + rng.below(8) as u8).expect("in range")
}

fn free_text(rng: &mut Rng) -> FreeText {
    const CHARS: &[u8] = b" 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-./?";
    loop {
        let len = 1 + rng.below(13) as usize;
        let s: String = (0..len).map(|_| char::from(*rng.pick(CHARS))).collect();
        if let Ok(t) = FreeText::new(&s) {
            return t;
        }
    }
}

fn random_message(rng: &mut Rng) -> Message {
    match rng.below(10) {
        0 => Message::FreeText { text: free_text(rng) },
        1 => Message::Dxpedition {
            rr73_to: station28(rng),
            report_to: station28(rng),
            fox: known(rng),
            report: Report::new(rng.below(32) as i32 * 2 - 30).expect("in range"),
        },
        2 => Message::FieldDay {
            to: station28(rng),
            de: station28(rng),
            ack: rng.coin(),
            transmitters: 1 + rng.below(32) as u8,
            class: FieldDayClass::from_letter(char::from(b'A' + rng.below(8) as u8)).expect("A to H"),
            section: ArrlSection::new(rng.pick(&["AB", "EMA", "DX", "SCV", "WWA", "ONE", "PR", "VI"]))
                .expect("listed"),
        },
        3 => Message::Telemetry {
            data: Telemetry::new(u128::from(rng.next_u64()) << 7 ^ u128::from(rng.next_u64() >> 57))
                .expect("71 bits"),
        },
        4 | 5 => {
            let suffix = *rng.pick(&["", "", "/R", "/P"]);
            let to = match rng.below(6) {
                0 => Addressee::Cq { modifier: None },
                1 => {
                    let m = if rng.coin() {
                        format!("{:03}", rng.below(1000))
                    } else {
                        (0..=rng.below(4)).map(|_| letter(rng)).collect()
                    };
                    Addressee::Cq {
                        modifier: Some(CqModifier::new(&m).expect("modifier")),
                    }
                }
                2 => *rng.pick(&[Addressee::Qrz, Addressee::De]),
                _ => Addressee::Station(station_flagged(rng, suffix)),
            };
            if let Addressee::Cq { .. } = to {
                // CQ carries a locator, RR73 or nothing, from a callsign in full.
                let exchange = match rng.below(3) {
                    0 => Exchange::Blank,
                    1 => Exchange::Grid {
                        grid: grid(rng),
                        ack: false,
                    },
                    _ => Exchange::Rr73,
                };
                let de = loop {
                    if let Station::Call(c) = station_flagged(rng, suffix) {
                        break Station::Call(c);
                    }
                };
                return Message::Standard { to, de, exchange };
            }
            let exchange = match rng.below(7) {
                0 => Exchange::Blank,
                1 => Exchange::Grid {
                    grid: grid(rng),
                    ack: rng.coin(),
                },
                2 => Exchange::Report {
                    report: report(rng),
                    ack: rng.coin(),
                },
                3 => Exchange::Rrr,
                4 => Exchange::Rr73,
                5 => Exchange::AckRr73,
                _ => Exchange::SeventyThree,
            };
            Message::Standard {
                to,
                de: station_flagged(rng, suffix),
                exchange,
            }
        }
        6 => Message::RttyRoundup {
            tu: rng.coin(),
            to: station28(rng),
            de: station28(rng),
            ack: rng.coin(),
            report: strength(rng),
            exchange: if rng.coin() {
                RoundupExchange::Serial(1 + rng.below(7999) as u16)
            } else {
                RoundupExchange::State(
                    StateProvince::new(rng.pick(&["AL", "DC", "PEI", "NWT", "MA", "QC"])).expect("listed"),
                )
            },
        },
        7 => Message::NonStandardCq {
            call: nonstandard(rng),
        },
        8 => Message::NonStandard {
            call: nonstandard(rng),
            hashed: known(rng),
            hashed_second: rng.coin(),
            reply: *rng.pick(&[
                None,
                Some(Reply::Rrr),
                Some(Reply::Rr73),
                Some(Reply::SeventyThree),
            ]),
        },
        _ => {
            let g6 = format!(
                "{}{}{}{}{}{}",
                char::from(b'A' + rng.below(18) as u8),
                char::from(b'A' + rng.below(18) as u8),
                digit(rng),
                digit(rng),
                char::from(b'A' + rng.below(24) as u8),
                char::from(b'A' + rng.below(24) as u8)
            );
            Message::EuVhf {
                to: known(rng),
                de: known(rng),
                ack: rng.coin(),
                report: strength(rng),
                serial: rng.below(2048) as u16,
                grid: Grid6::new(&g6).expect("valid locator"),
            }
        }
    }
}

#[test]
fn random_messages_round_trip_through_bits_and_text() {
    let mut rng = Rng::new(0x5EED_0003);
    // A small shared table: narrow hashes collide often, and each lookup must still find the
    // callsign that pack recorded last.
    let mut hashes = CallsignHashes::with_capacity(512);
    let mut by_type: BTreeMap<(u8, u8), usize> = BTreeMap::new();
    for _ in 0..60_000 {
        let m = random_message(&mut rng);
        let p = pack(&m, &mut hashes).unwrap_or_else(|e| panic!("{m:?}: {e}"));
        assert_eq!(noncanonical(&p), None, "{m}");
        assert_eq!(unpack(&p, &hashes), Ok(m), "{m}");
        *by_type.entry(m.i3_n3()).or_default() += 1;
        assert_eq!((p.i3(), if p.i3() == 0 { p.n3() } else { 0 }), m.i3_n3(), "{m}");

        let text = m.to_string();
        let parsed = Message::parse(&text).unwrap_or_else(|e| panic!("{text}: {e}"));
        match m {
            Message::FreeText { text: t } if parsed != m => {
                // Free text with runs of spaces, or text shaped like another message.
                assert!(
                    t.as_str().contains("  ") || !matches!(parsed, Message::FreeText { .. }),
                    "{text}"
                );
            }
            _ => assert_eq!(parsed, m, "{text}"),
        }
    }
    assert_eq!(by_type.len(), 10, "{by_type:?}");
}

#[test]
fn ldpc_codewords_satisfy_all_checks_and_single_errors_break_three() {
    let mut rng = Rng::new(0x5EED_0004);
    for _ in 0..5_000 {
        let p = rng.payload();
        let mode = if rng.coin() { Mode::Ft8 } else { Mode::Ft4 };
        let m91 = crc::message91(mode, &p);
        let codeword = ldpc::encode(&m91);
        assert_eq!(ldpc::check(&codeword), 0);
        assert_eq!(
            crc::payload_from_message91(mode, &ldpc::message_bits(&codeword)),
            Some(p)
        );
        let mut bad = codeword;
        let bit = rng.below(ldpc::N as u64) as usize;
        bad[bit] ^= 1;
        assert_eq!(ldpc::check(&bad), 3);
        assert_eq!(
            tones::from_codeword(mode, &codeword),
            tones::from_payload(mode, &p)
        );
    }
}

#[test]
fn parse_never_panics_on_arbitrary_text() {
    let mut rng = Rng::new(0x5EED_0005);
    let pieces = [
        "CQ",
        "DX",
        "K1ABC",
        "W9XYZ",
        "<",
        ">",
        "<...>",
        "/",
        "R",
        "RR73;",
        "TU;",
        "73",
        "RRR",
        "RR73",
        "-",
        "+",
        "-15",
        "R+05",
        "FN42",
        "JO22DB",
        "579",
        "590003",
        "6A",
        "EMA",
        "MA",
        " ",
        "  ",
        "\t",
        "é",
        "中",
        "_",
        ",",
        "0",
        "999",
        "PJ4/K1ABC",
        "123456789ABCDEF012",
        "?",
        ".",
        "",
        "<K1ABC",
        "K1ABC>",
        "<<K1>>",
        "3DA0XYZ",
        "QA0XYZ",
    ];
    let mut parsed = 0;
    for _ in 0..60_000 {
        let n = rng.below(8) as usize;
        let text: String = (0..n)
            .map(|_| *rng.pick(&pieces))
            .collect::<Vec<_>>()
            .join(if rng.coin() { " " } else { "" });
        if let Ok(m) = Message::parse(&text) {
            let mut hashes = CallsignHashes::new();
            let p = pack(&m, &mut hashes)
                .unwrap_or_else(|e| panic!("{text:?} parsed to {m:?}, which does not pack: {e}"));
            assert_eq!(unpack(&p, &hashes), Ok(m), "{text:?}");
            parsed += 1;
        }
    }
    for _ in 0..20_000 {
        let len = rng.below(40) as usize;
        let text: String = (0..len)
            .map(|_| char::from_u32(rng.below(0x3000) as u32).unwrap_or('?'))
            .collect();
        if let Ok(m) = Message::parse(&text) {
            assert!(pack(&m, &mut CallsignHashes::new()).is_ok(), "{text:?}");
        }
    }
    assert!(parsed > 5_000, "{parsed}");
}
