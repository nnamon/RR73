//! Random input against the Elecraft parser and the simulated KX2, with fixed seeds. None may
//! panic, and each keeps its invariants on any input.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use rr73_cat::elecraft::{DataSubMode, Event, MAX_FREQUENCY_HZ, MenuItem, Mode, Parser, Request};
use rr73_cat::sim_kx2::SimKx2;

/// Random bytes, half of them the characters answers are made of, so answers start, end and
/// break often.
fn stream(rng: &mut ChaCha8Rng, len: usize) -> Vec<u8> {
    const TEXT: &[u8] = b"FAIFMDTQOMVXMNP?;0123456789 +-$";
    (0..len)
        .map(|_| {
            if rng.random_bool(0.5) {
                TEXT[rng.random_range(0..TEXT.len())]
            } else {
                rng.random()
            }
        })
        .collect()
}

/// A plausible answer: a command RR73 reads, random digits and spaces, a semicolon.
fn answer_like(rng: &mut ChaCha8Rng) -> Vec<u8> {
    const NAMES: [&str; 10] = ["FA", "IF", "MD", "DT", "TQ", "OM", "VX", "MN", "MP", "?"];
    let mut out = NAMES[rng.random_range(0..NAMES.len())].as_bytes().to_vec();
    for _ in 0..rng.random_range(0..40) {
        out.push(if rng.random_bool(0.85) {
            b'0' + rng.random_range(0..10)
        } else {
            b' '
        });
    }
    out.push(b';');
    out
}

fn chunks(rng: &mut ChaCha8Rng, bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let n = rng.random_range(1..=8).min(bytes.len() - i);
        out.push(bytes[i..i + n].to_vec());
        i += n;
    }
    out
}

/// The events without their noise counts, which may split differently across chunks.
fn answers(events: &[Event]) -> Vec<Event> {
    events
        .iter()
        .filter(|e| !matches!(e, Event::Noise { .. }))
        .cloned()
        .collect()
}

fn noise(events: &[Event]) -> usize {
    events
        .iter()
        .map(|e| match e {
            Event::Noise { bytes } => *bytes,
            _ => 0,
        })
        .sum()
}

#[test]
fn the_parser_takes_any_bytes_in_any_chunks() {
    let mut rng = ChaCha8Rng::seed_from_u64(2);
    for _ in 0..3000 {
        let len = rng.random_range(0..300);
        let input = stream(&mut rng, len);
        let whole = Parser::new().push(&input);
        let mut p = Parser::new();
        let parts: Vec<Event> = chunks(&mut rng, &input).iter().flat_map(|c| p.push(c)).collect();
        assert_eq!(answers(&whole), answers(&parts));
        assert_eq!(noise(&whole), noise(&parts));
        // Every byte is in an answer, in noise, or held for the next push.
        assert!(noise(&whole) <= input.len());
    }
}

#[test]
fn answer_shaped_input_never_panics_and_parses_each_answer() {
    let mut rng = ChaCha8Rng::seed_from_u64(22);
    for _ in 0..3000 {
        let n = rng.random_range(1..6);
        let mut input = Vec::new();
        for _ in 0..n {
            input.extend(answer_like(&mut rng));
        }
        let events = Parser::new().push(&input);
        // Each semicolon ends one answer, none of which is noise: they start with letters or ?.
        assert_eq!(answers(&events).len(), n, "{}", String::from_utf8_lossy(&input));
    }
}

#[test]
fn frequencies_round_trip_through_the_format() {
    let mut rng = ChaCha8Rng::seed_from_u64(11);
    for _ in 0..3000 {
        let hz = rng.random_range(0..=MAX_FREQUENCY_HZ);
        let text = Request::SetFrequency { hz }.text().expect("text");
        assert_eq!(text.len(), 2 + 11 + 1 + 3);
        let echo = text.split(';').next().expect("set").to_string() + ";";
        assert_eq!(
            Parser::new().push(echo.as_bytes()),
            [Event::Frequency {
                hz,
                transceive: false
            }]
        );
    }
}

fn random_request(rng: &mut ChaCha8Rng) -> Request {
    match rng.random_range(0..12) {
        0 => Request::ReadFrequency,
        1 => Request::SetFrequency {
            hz: if rng.random_bool(0.8) {
                rng.random_range(500_000..=32_000_000)
            } else {
                rng.random_range(0..=MAX_FREQUENCY_HZ)
            },
        },
        2 => Request::ReadMode,
        3 => Request::SetMode {
            mode: Mode::ALL[rng.random_range(0..Mode::ALL.len())],
        },
        4 => Request::ReadDataSubMode,
        5 => Request::SetDataSubMode {
            sub: DataSubMode::ALL[rng.random_range(0..DataSubMode::ALL.len())],
        },
        6 => Request::ReadTransmit,
        7 => Request::SetTransmit {
            on: rng.random_bool(0.5),
        },
        8 => Request::ReadOptions,
        9 => Request::ReadVox,
        10 => Request::ReadMenuEntry,
        _ => Request::ReadSetting {
            item: MenuItem::MicBtn,
        },
    }
}

#[test]
fn the_simulator_answers_every_request_once_in_any_state() {
    let mut rng = ChaCha8Rng::seed_from_u64(2016);
    let mut radio = SimKx2::new();
    radio.band_reports = false;
    let mut parser = Parser::new();
    for _ in 0..5000 {
        if rng.random_bool(0.05) {
            radio.set_lines(rng.random_bool(0.5), rng.random_bool(0.3));
        }
        if rng.random_bool(0.03) {
            radio.mic_btn = rng.random_range(0..8);
        }
        let r = random_request(&mut rng);
        let events = parser.push(&radio.receive(&r.encode().expect("encode")));
        let mine = events.iter().filter(|e| r.answered_by(e)).count();
        // A set's own `?;` comes before its read-back's answer.
        let expected = if r.is_set() && events.first() == Some(&Event::Busy) {
            2
        } else {
            1
        };
        assert_eq!(mine, expected, "{r:?}: {events:?}");
        assert!(
            events
                .iter()
                .all(|e| !matches!(e, Event::Noise { .. } | Event::Malformed { .. }))
        );
    }
}

#[test]
fn the_simulator_takes_any_bytes() {
    let mut rng = ChaCha8Rng::seed_from_u64(73);
    let mut radio = SimKx2::new();
    for _ in 0..3000 {
        let len = rng.random_range(0..200);
        let input = stream(&mut rng, len);
        let out = radio.receive(&input);
        // It answers only in its own format: every answer parses.
        let events = Parser::new().push(&out);
        assert!(
            events
                .iter()
                .all(|e| !matches!(e, Event::Noise { .. } | Event::Malformed { .. })),
            "{events:?}"
        );
    }
}
