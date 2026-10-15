//! Random input against the frame decoder, the parser, the frequency format and the simulated
//! radio, with fixed seeds. None may panic, and each keeps its invariants on any input.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use rr73_cat::bcd::{MAX_FREQUENCY_HZ, decode_frequency, encode_frequency};
use rr73_cat::frame::{Decoded, END, FrameDecoder, PREAMBLE};
use rr73_cat::ic705::{Addresses, Event, Filter, MenuItem, Mode, Parser, Request, Vfo};
use rr73_cat::sim::SimIc705;

/// Random bytes, a third of them the bytes that matter to framing (FE, FD) and to the IC-705
/// (A4, E0, FB, FA), so frames start, end and break often.
fn stream(rng: &mut ChaCha8Rng, len: usize) -> Vec<u8> {
    const SPECIAL: [u8; 6] = [PREAMBLE, END, 0xA4, 0xE0, 0xFB, 0xFA];
    (0..len)
        .map(|_| {
            if rng.random_bool(0.33) {
                SPECIAL[rng.random_range(0..SPECIAL.len())]
            } else {
                rng.random()
            }
        })
        .collect()
}

/// A frame-shaped stream from the radio: a preamble, the addresses, a command the parser knows
/// and random data, then the end code.
fn radio_frame(rng: &mut ChaCha8Rng) -> Vec<u8> {
    const COMMANDS: [u8; 12] = [
        0x00, 0x01, 0x03, 0x04, 0x1A, 0x1C, 0x25, 0x26, 0xFB, 0xFA, 0x27, 0x19,
    ];
    let mut out = vec![
        PREAMBLE,
        PREAMBLE,
        0xE0,
        0xA4,
        COMMANDS[rng.random_range(0..COMMANDS.len())],
    ];
    for _ in 0..rng.random_range(0..9) {
        // Mostly small values, as BCD codes are.
        let b = if rng.random_bool(0.7) {
            rng.random_range(0..0x20)
        } else {
            rng.random_range(0..0xFD)
        };
        out.push(b);
    }
    out.push(END);
    out
}

/// Splits `bytes` at random points.
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

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

#[test]
fn the_frame_decoder_takes_any_bytes_in_any_chunks() {
    let mut rng = ChaCha8Rng::seed_from_u64(705);
    for _ in 0..3000 {
        let len = rng.random_range(0..300);
        let input = stream(&mut rng, len);
        let whole = FrameDecoder::new().push(&input);
        let mut d = FrameDecoder::new();
        let parts: Vec<Decoded> = chunks(&mut rng, &input).iter().flat_map(|c| d.push(c)).collect();
        let frames = |x: &[Decoded]| -> Vec<_> {
            x.iter()
                .filter_map(|e| match e {
                    Decoded::Frame(f) => Some(f.clone()),
                    Decoded::Noise(_) => None,
                })
                .collect()
        };
        let noise = |x: &[Decoded]| -> usize {
            x.iter()
                .map(|e| match e {
                    Decoded::Noise(n) => *n,
                    Decoded::Frame(_) => 0,
                })
                .sum()
        };
        assert_eq!(frames(&whole), frames(&parts));
        assert_eq!(noise(&whole), noise(&parts));
        let mut accounted = noise(&whole) + d.pending();
        for f in frames(&whole) {
            let bytes = f.encode().expect("a decoded frame encodes again");
            // A frame may have come with one preamble byte.
            let found = if contains(&input, &bytes) {
                &bytes[..]
            } else {
                &bytes[1..]
            };
            assert!(contains(&input, found), "{bytes:02X?} is in the input");
            accounted += found.len();
        }
        // Extra preamble bytes are part of no count, so the counts never exceed the input.
        assert!(accounted <= input.len(), "{accounted} of {}", input.len());
    }
}

#[test]
fn the_parser_takes_any_bytes() {
    let mut rng = ChaCha8Rng::seed_from_u64(73);
    for _ in 0..3000 {
        let mut input = Vec::new();
        for _ in 0..rng.random_range(1..6) {
            if rng.random_bool(0.6) {
                input.extend(radio_frame(&mut rng));
            } else {
                let len = rng.random_range(0..40);
                input.extend(stream(&mut rng, len));
            }
        }
        let whole = Parser::new(Addresses::default()).push(&input);
        let mut p = Parser::new(Addresses::default());
        let parts: Vec<Event> = chunks(&mut rng, &input).iter().flat_map(|c| p.push(c)).collect();
        // Noise is counted per push, so chunks split it differently; the total stays.
        let framed = |x: &[Event]| -> Vec<Event> {
            x.iter()
                .filter(|e| !matches!(e, Event::Noise { .. }))
                .cloned()
                .collect()
        };
        let noise = |x: &[Event]| -> usize {
            x.iter()
                .map(|e| match e {
                    Event::Noise { bytes } => *bytes,
                    _ => 0,
                })
                .sum()
        };
        assert_eq!(framed(&whole), framed(&parts));
        assert_eq!(noise(&whole), noise(&parts));
        for e in &whole {
            // Every event has a JSON form and reads back.
            let json = serde_json::to_string(e).expect("json");
            let back: Event = serde_json::from_str(&json).expect("reads back");
            assert_eq!(&back, e);
        }
    }
}

#[test]
fn every_frequency_in_the_format_round_trips() {
    let mut rng = ChaCha8Rng::seed_from_u64(14_074);
    for hz in [
        0,
        1,
        9,
        10,
        99,
        100,
        30_000,
        1_840_000,
        199_999_999,
        400_000_000,
        MAX_FREQUENCY_HZ,
    ] {
        assert_eq!(decode_frequency(&encode_frequency(hz).expect("encodes")), Ok(hz));
    }
    for _ in 0..100_000 {
        let hz = rng.random_range(0..=MAX_FREQUENCY_HZ);
        assert_eq!(decode_frequency(&encode_frequency(hz).expect("encodes")), Ok(hz));
        // Any 5 bytes either fail or are the encoding of what they decode to.
        let bytes: [u8; 5] = rng.random();
        if let Ok(hz) = decode_frequency(&bytes) {
            assert_eq!(encode_frequency(hz), Ok(bytes));
        }
    }
    assert!(encode_frequency(MAX_FREQUENCY_HZ + 1).is_err());
}

#[test]
fn the_simulated_radio_takes_any_bytes_and_answers_in_whole_frames() {
    let mut rng = ChaCha8Rng::seed_from_u64(9);
    for _ in 0..2000 {
        let mut radio = SimIc705::new();
        let mut input = Vec::new();
        for _ in 0..rng.random_range(1..6) {
            if rng.random_bool(0.5) {
                let mut f = radio_frame(&mut rng);
                // Addressed to the radio from the controller.
                f[2] = 0xA4;
                f[3] = 0xE0;
                input.extend(f);
            } else {
                let len = rng.random_range(0..40);
                input.extend(stream(&mut rng, len));
            }
        }
        let out = radio.receive(&input);
        for e in Parser::new(Addresses::default()).push(&out) {
            assert!(
                !matches!(
                    e,
                    Event::Noise { .. } | Event::Malformed { .. } | Event::Unknown { .. }
                ),
                "{e:?} from {input:02X?}"
            );
        }
    }
}

/// A random request RR73 might make.
fn request(rng: &mut ChaCha8Rng) -> Request {
    let mode = Mode::ALL[rng.random_range(0..Mode::ALL.len())];
    let filter = [Filter::Fil1, Filter::Fil2, Filter::Fil3][rng.random_range(0..3)];
    let vfo = if rng.random_bool(0.5) {
        Vfo::Selected
    } else {
        Vfo::Unselected
    };
    let hz = rng.random_range(0..=MAX_FREQUENCY_HZ);
    match rng.random_range(0..13) {
        0 => Request::ReadFrequency,
        1 => Request::SetFrequency { hz },
        2 => Request::ReadMode,
        3 => Request::SetMode {
            mode,
            filter: rng.random_bool(0.5).then_some(filter),
        },
        4 => Request::ReadDataMode,
        5 => Request::SetDataMode {
            on: rng.random_bool(0.5),
            filter: Some(filter),
        },
        6 => Request::ReadVfoFrequency { vfo },
        7 => Request::SetVfoFrequency { vfo, hz },
        8 => Request::ReadVfoMode { vfo },
        9 => Request::SetVfoMode {
            vfo,
            mode,
            data: rng.random_bool(0.5),
            filter,
        },
        10 => Request::ReadTransmit,
        11 => Request::SetTransmit {
            on: rng.random_bool(0.5),
        },
        _ => Request::ReadSetting {
            item: MenuItem::ALL[rng.random_range(0..MenuItem::ALL.len())],
        },
    }
}

#[test]
fn the_simulated_radio_answers_every_request_once() {
    let mut rng = ChaCha8Rng::seed_from_u64(1500);
    let mut radio = SimIc705::new();
    let mut parser = Parser::new(Addresses::default());
    for i in 0..5000 {
        if i % 500 == 0 {
            radio.set_setting(MenuItem::CivUsbEchoBack, u16::from(rng.random_bool(0.5)));
        }
        let r = request(&mut rng);
        let json = serde_json::to_string(&r).expect("json");
        assert_eq!(serde_json::from_str::<Request>(&json).expect("reads back"), r);
        let events = parser.push(&radio.receive(&r.encode(Addresses::default()).expect("encodes")));
        let answers = events.iter().filter(|e| r.answered_by(e)).count();
        assert_eq!(answers, 1, "{r:?} gave {events:?}");
        assert!(
            events
                .iter()
                .all(|e| r.answered_by(e) || matches!(e, Event::Echo { .. })),
            "{r:?} gave {events:?}"
        );
    }
}
