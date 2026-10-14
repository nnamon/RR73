//! End-to-end checks: encoder to decoder, clean and through the channel simulator.

use rr73_chansim::continuous::{CCIR_MODERATE, ContinuousChannel, render_continuous};
use rr73_rtty::score::char_errors;
use rr73_rtty::{
    AfcConfig, DecoderConfig, Framer, Polarity, RttyDecoder, RttyEvent, RttyParams, STANDARD_BAUD,
    STANDARD_SHIFTS_HZ, TxConfig, encode,
};

const TEXT: &str = "CQ TEST 9V1NE 9V1NE TEST\nUR 599 015 TU (73) -?:,./ RYRY QUICK BROWN FOX\n";
const SHORT: &str = "CQ 9V1NE 599 015 (73)?/ ZX\n";

fn decode_all(audio: &[f32], cfg: DecoderConfig) -> (String, Vec<RttyEvent>) {
    let mut d = RttyDecoder::new(cfg).expect("decoder");
    let mut events = d.push(audio);
    events.extend(d.flush());
    let text = events
        .iter()
        .filter_map(|e| match e {
            RttyEvent::Char { ch, .. } => Some(*ch),
            _ => None,
        })
        .collect();
    (text, events)
}

fn cer(sent: &str, received: &str) -> f64 {
    let (e, n) = char_errors(sent, received);
    e as f64 / n as f64
}

#[test]
fn clean_round_trip_at_every_rate_shift_polarity_and_stop_length() {
    for baud in STANDARD_BAUD {
        for shift_hz in STANDARD_SHIFTS_HZ {
            for polarity in [Polarity::Normal, Polarity::Reverse] {
                for stop_bits in [1.0, 1.5, 2.0] {
                    for framer in [Framer::Viterbi, Framer::Uart] {
                        let params = RttyParams {
                            baud,
                            shift_hz,
                            polarity,
                            stop_bits,
                            ..RttyParams::default()
                        };
                        let mark_hz = params.mark_for_center(1500.0);
                        let tx = TxConfig {
                            params,
                            mark_hz,
                            ..TxConfig::default()
                        };
                        let audio = encode(SHORT, &tx).expect("encode");
                        let rx = DecoderConfig {
                            params,
                            mark_hz,
                            framer,
                            ..DecoderConfig::default()
                        };
                        let (text, _) = decode_all(&audio, rx);
                        assert_eq!(
                            text,
                            SHORT.replace('\n', "\r\n"),
                            "{baud} Bd {shift_hz} Hz {polarity:?} {stop_bits} stop {framer:?}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn block_size_does_not_change_the_events() {
    let tx = TxConfig::default();
    let clean = encode(TEXT, &tx).expect("encode");
    let audio = render_continuous(
        &clean,
        &ContinuousChannel {
            snr_db: -8.0,
            lead_s: 0.5,
            tail_s: 0.5,
            ..ContinuousChannel::default()
        },
        5,
    );
    let cfg = DecoderConfig {
        squelch_db: Some(-20.0),
        afc: AfcConfig {
            search_hz: 100.0,
            ..AfcConfig::default()
        },
        ..DecoderConfig::default()
    };
    let mut reference = None;
    for block in [1usize, 7, 480, 4096, audio.len()] {
        let mut d = RttyDecoder::new(cfg).expect("decoder");
        let mut events = Vec::new();
        for chunk in audio.chunks(block) {
            events.extend(d.push(chunk));
        }
        events.extend(d.flush());
        match &reference {
            None => reference = Some(events),
            Some(r) => assert_eq!(r, &events, "block {block}"),
        }
    }
}

#[test]
fn awgn_at_minus_5_db_copies_cleanly() {
    let tx = TxConfig::default();
    let clean = encode(&TEXT.repeat(4), &tx).expect("encode");
    for framer in [Framer::Viterbi, Framer::Uart] {
        let mut total = 0.0;
        for seed in 0..3 {
            let audio = render_continuous(
                &clean,
                &ContinuousChannel {
                    snr_db: -5.0,
                    lead_s: 0.3,
                    ..ContinuousChannel::default()
                },
                seed,
            );
            let (text, _) = decode_all(
                &audio,
                DecoderConfig {
                    framer,
                    ..DecoderConfig::default()
                },
            );
            total += cer(&TEXT.repeat(4), &text);
        }
        // The UART loses a character now and then when noise moves an edge.
        let limit = if framer == Framer::Viterbi { 0.01 } else { 0.05 };
        assert!(total / 3.0 < limit, "{framer:?} CER {}", total / 3.0);
    }
}

#[test]
fn afc_finds_an_offset_pair_and_follows_drift() {
    let tx = TxConfig::default();
    let text = TEXT.repeat(6);
    let clean = encode(&text, &tx).expect("encode");
    let audio = render_continuous(
        &clean,
        &ContinuousChannel {
            snr_db: 0.0,
            offset_hz: 70.0,
            drift_hz_per_s: 1.0,
            lead_s: 0.2,
            ..ContinuousChannel::default()
        },
        11,
    );
    let seconds = clean.len() as f64 / 12_000.0;
    let cfg = DecoderConfig {
        afc: AfcConfig {
            search_hz: 150.0,
            ..AfcConfig::default()
        },
        ..DecoderConfig::default()
    };
    let mut d = RttyDecoder::new(cfg).expect("decoder");
    let mut events = d.push(&audio);
    events.extend(d.flush());
    let text_out: String = events
        .iter()
        .filter_map(|e| match e {
            RttyEvent::Char { ch, .. } => Some(*ch),
            _ => None,
        })
        .collect();
    assert!(cer(&text, &text_out) < 0.03, "CER {}", cer(&text, &text_out));
    // At the end the mark sits at 1585 + 70 + 1 Hz/s times the duration.
    let expected = 1585.0 + 70.0 + seconds;
    assert!((d.mark_hz() - expected).abs() < 3.0, "{} {expected}", d.mark_hz());
    assert!(events.iter().any(|e| matches!(e, RttyEvent::Afc { .. })));
}

#[test]
fn search_finds_another_shift() {
    let params = RttyParams {
        shift_hz: 425.0,
        ..RttyParams::default()
    };
    let tx = TxConfig {
        params,
        mark_hz: 1712.5,
        ..TxConfig::default()
    };
    let clean = encode(&TEXT.repeat(2), &tx).expect("encode");
    let audio = render_continuous(
        &clean,
        &ContinuousChannel {
            snr_db: 5.0,
            ..ContinuousChannel::default()
        },
        3,
    );
    let cfg = DecoderConfig {
        afc: AfcConfig {
            search_hz: 100.0,
            auto_shift: true,
            ..AfcConfig::default()
        },
        ..DecoderConfig::default()
    };
    let (text, events) = decode_all(&audio, cfg);
    assert!(
        events
            .iter()
            .any(|e| matches!(e, RttyEvent::ToneShift { shift_hz, .. } if *shift_hz == 425.0))
    );
    assert!(cer(&TEXT.repeat(2), &text) < 0.2, "{text}");
}

#[test]
fn moderate_fading_at_plus_5_db_mostly_copies() {
    let tx = TxConfig::default();
    let text = TEXT.repeat(6);
    let clean = encode(&text, &tx).expect("encode");
    let mut total = 0.0;
    for seed in 0..3 {
        let audio = render_continuous(
            &clean,
            &ContinuousChannel {
                snr_db: 5.0,
                fading: Some(CCIR_MODERATE),
                ..ContinuousChannel::default()
            },
            seed,
        );
        let (out, _) = decode_all(&audio, DecoderConfig::default());
        total += cer(&text, &out);
    }
    assert!(total / 3.0 < 0.1, "CER {}", total / 3.0);
}

#[test]
fn squelch_keeps_noise_quiet_and_snr_reads_true() {
    let noise = render_continuous(
        &[0.0; 12_000],
        &ContinuousChannel {
            lead_s: 5.0,
            ..ContinuousChannel::default()
        },
        2,
    );
    let cfg = DecoderConfig {
        squelch_db: Some(-12.0),
        ..DecoderConfig::default()
    };
    let (text, _) = decode_all(&noise, cfg);
    assert!(text.is_empty(), "{text:?}");

    let clean = encode(&TEXT.repeat(3), &TxConfig::default()).expect("encode");
    for snr in [-10.0f64, 0.0, 10.0] {
        let audio = render_continuous(
            &clean,
            &ContinuousChannel {
                snr_db: snr,
                ..ContinuousChannel::default()
            },
            4,
        );
        let mut d = RttyDecoder::new(cfg).expect("decoder");
        let events = d.push(&audio);
        let readings: Vec<f32> = events
            .iter()
            .filter_map(|e| match e {
                RttyEvent::Signal { snr_db, .. } => Some(*snr_db),
                _ => None,
            })
            .skip(3)
            .collect();
        let mean = readings.iter().sum::<f32>() / readings.len() as f32;
        assert!((f64::from(mean) - snr).abs() < 1.5, "{snr}: {mean}");
    }
}

#[test]
fn squelch_cuts_the_noise_around_a_transmission() {
    let clean = encode(TEXT, &TxConfig::default()).expect("encode");
    let cfg = DecoderConfig {
        squelch_db: Some(-14.0),
        ..DecoderConfig::default()
    };
    for seed in 0..6 {
        let audio = render_continuous(
            &clean,
            &ContinuousChannel {
                snr_db: -3.0,
                lead_s: 1.5,
                tail_s: 1.5,
                ..ContinuousChannel::default()
            },
            seed,
        );
        let (text, _) = decode_all(&audio, cfg);
        assert_eq!(text, TEXT.replace('\n', "\r\n"), "seed {seed}");
    }
}

#[test]
fn bad_settings_are_refused() {
    let mut cfg = DecoderConfig::default();
    cfg.params.baud = 1000.0;
    assert!(RttyDecoder::new(cfg).is_err());
    let cfg = DecoderConfig {
        mark_hz: 20.0,
        ..DecoderConfig::default()
    };
    assert!(RttyDecoder::new(cfg).is_err());
    let json: DecoderConfig =
        serde_json::from_str(r#"{"params":{"shift_hz":850},"framer":"uart"}"#).expect("json");
    assert_eq!(json.params.shift_hz, 850.0);
    assert_eq!(json.params.baud, 45.45);
    assert_eq!(json.framer, Framer::Uart);
}
