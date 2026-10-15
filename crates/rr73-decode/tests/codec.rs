//! Decoder tests that use the codec: protocol tables, the real LDPC code, and whole slots
//! rendered by the channel simulator.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use rand_distr::StandardNormal;
use rr73_chansim::{Noise, Scene, SimSignal, Watterson, messages};
use rr73_decode::layout::CODEWORD_BITS;
use rr73_decode::ldpc::{LdpcDecoder, LdpcOutcome, LdpcScratch, MinSum, ParityGraph, SumProduct};
use rr73_decode::validate::{CrcUnpack, Rejection, Validator};
use rr73_decode::{DecodeContext, DecoderConfig, FrameLayout, SlotAudio, decode};
use rr73_ft8::message::{self, Message};
use rr73_ft8::tones::FT4_XOR;
use rr73_ft8::{CallsignHashes, Mode, Payload, crc, ldpc};

fn payload_of(text: &str) -> Payload {
    let msg = Message::parse(text).expect("parse");
    message::pack(&msg, &mut CallsignHashes::new()).expect("pack")
}

fn codeword_of(payload: &Payload) -> [u8; CODEWORD_BITS] {
    ldpc::encode(&crc::append(payload))
}

#[test]
fn layouts_match_the_protocol() {
    let ft8 = FrameLayout::new(Mode::Ft8);
    ft8.check().expect("ft8 layout");
    assert_eq!((ft8.tones, ft8.symbols, ft8.samples_per_symbol), (8, 79, 1920));
    assert!((ft8.tone_spacing_hz - 6.25).abs() < 1e-6);
    assert!((ft8.start_offset_s - 0.5).abs() < 1e-6);
    let expected: Vec<usize> = (7..36).chain(43..72).collect();
    assert_eq!(ft8.data, expected);

    let ft4 = FrameLayout::new(Mode::Ft4);
    ft4.check().expect("ft4 layout");
    assert_eq!((ft4.tones, ft4.symbols, ft4.samples_per_symbol), (4, 105, 576));
    // Every symbol is data, sync or one of the two ramp symbols.
    let mut used = vec![false; ft4.symbols];
    for &d in &ft4.data {
        used[d] = true;
    }
    for g in &ft4.sync {
        for k in 0..g.tones.len() {
            used[g.start + k] = true;
        }
    }
    let free: Vec<usize> = (0..ft4.symbols).filter(|&s| !used[s]).collect();
    assert_eq!(free, vec![0, 104]);
}

#[test]
fn parity_graph_agrees_with_the_codec() {
    let graph = ParityGraph::ft8();
    assert_eq!((graph.bits(), graph.checks(), graph.edges()), (174, 83, 522));
    let mut rng = ChaCha8Rng::seed_from_u64(1);
    for _ in 0..50 {
        let cw = codeword_of(&payload_of(&messages::message(&mut rng)));
        assert_eq!(graph.unsatisfied(&cw), 0);
        assert_eq!(ldpc::check(&cw), 0);
        let mut bad = cw;
        for _ in 0..rng.random_range(1..6) {
            bad[rng.random_range(0..174)] ^= 1;
        }
        assert_eq!(graph.unsatisfied(&bad), ldpc::check(&bad));
    }
}

#[test]
fn ldpc_decoders_correct_noisy_codewords() {
    let graph = ParityGraph::ft8();
    let decoders: Vec<Box<dyn LdpcDecoder>> = vec![
        Box::new(SumProduct { max_iterations: 25 }),
        Box::new(MinSum {
            max_iterations: 25,
            scale: 0.75,
        }),
    ];
    for d in decoders {
        let mut rng = ChaCha8Rng::seed_from_u64(2);
        let mut scratch = LdpcScratch::default();
        let (mut ok, mut corrected) = (0, 0);
        for _ in 0..100 {
            let cw = codeword_of(&payload_of(&messages::message(&mut rng)));
            // BPSK-like LLRs at about 7 % raw bit errors.
            let llr: Vec<f32> = cw
                .iter()
                .map(|&b| {
                    let n: f64 = rng.sample(StandardNormal);
                    ((if b == 1 { 1.0 } else { -1.0 }) + 0.68 * n) as f32 * 4.0
                })
                .collect();
            let mut out = [0u8; CODEWORD_BITS];
            let r = d.decode(graph, &llr, &mut scratch, &mut out);
            if r.converged {
                assert_eq!(out, cw, "{} converged to a wrong codeword", d.name());
                ok += 1;
                corrected += r.hard_errors;
            }
        }
        assert!(ok >= 95, "{}: {ok} of 100", d.name());
        assert!(corrected > 500, "{}: {corrected} bits corrected", d.name());
    }
}

#[test]
fn validator_checks_crc_and_descrambles_ft4() {
    let v = CrcUnpack::default();
    let bp = LdpcOutcome::default();
    let mut hashes = CallsignHashes::new();
    let payload = payload_of("CQ K1ABC FN42");
    let cw = codeword_of(&payload);
    let ok = v.validate(Mode::Ft8, &cw, &bp, &mut hashes).expect("valid");
    assert_eq!(ok.payload, payload);
    assert_eq!(ok.text, "CQ K1ABC FN42");
    assert!(v.is_duplicate(&ok, &[payload]));

    let mut bad = cw;
    bad[3] ^= 1;
    assert_eq!(
        v.validate(Mode::Ft8, &bad, &bp, &mut hashes).err(),
        Some(Rejection::Crc)
    );

    // FT4 sends the payload XORed with FT4_XOR; the validator undoes it.
    let mut scrambled = payload;
    for (p, x) in scrambled.0.iter_mut().zip(FT4_XOR.iter()) {
        *p ^= x;
    }
    assert_eq!(
        codeword_of(&scrambled),
        rr73_ft8::tones::codeword(Mode::Ft4, &payload)
    );
    let ft4 = v
        .validate(Mode::Ft4, &codeword_of(&scrambled), &bp, &mut hashes)
        .expect("ft4");
    assert_eq!(ft4.payload, payload);
    // Read as FT8, the same codeword passes its CRC (computed over the scrambled bits) and
    // carries the scrambled payload, if that unpacks at all.
    if let Ok(as_ft8) = v.validate(Mode::Ft8, &codeword_of(&scrambled), &bp, &mut hashes) {
        assert_eq!(as_ft8.payload, scrambled);
    }
}

fn scene(mode: Mode, signals: Vec<SimSignal>) -> Scene {
    Scene {
        mode,
        signals,
        noise: Noise::Awgn,
    }
}

#[test]
fn ft8_signals_decode_with_correct_parameters() {
    let signals = vec![
        SimSignal::new("CQ K1ABC FN42", 612.3, 0.17, -12.0),
        SimSignal::new("W9XYZ K1ABC -15", 1418.9, -0.33, -8.0),
        SimSignal::new("K1ABC W9XYZ R-08", 2237.0, 0.41, -4.0),
    ];
    let (audio, truth) = rr73_chansim::render(&scene(Mode::Ft8, signals), 11).expect("render");
    let report = decode(
        &SlotAudio::new(&audio, Mode::Ft8),
        &DecoderConfig::baseline(),
        &mut DecodeContext::new(),
    );
    assert_eq!(report.decodes.len(), 3, "{:?}", report.decodes);
    for t in &truth {
        let d = report.decodes.iter().find(|d| d.text == t.text).expect(&t.text);
        assert!(
            (f64::from(d.freq_hz) - t.freq_hz).abs() <= 1.6,
            "{} freq {}",
            t.text,
            d.freq_hz
        );
        assert!(
            (f64::from(d.dt_s) - t.dt_s).abs() <= 0.05,
            "{} dt {}",
            t.text,
            d.dt_s
        );
        assert!(
            (f64::from(d.snr_db) - t.snr_db).abs() <= 2.0,
            "{} snr {}",
            t.text,
            d.snr_db
        );
        assert_eq!(d.pass, 1);
    }
    assert!(
        report.stats.duplicates > 0,
        "neighbouring candidates repeat strong signals"
    );
}

#[test]
fn ft4_signals_decode() {
    let signals = vec![
        SimSignal::new("CQ K1ABC FN42", 800.0, 0.05, -10.0),
        SimSignal::new("W9XYZ K1ABC RR73", 1900.0, -0.2, -6.0),
    ];
    let (audio, truth) = rr73_chansim::render(&scene(Mode::Ft4, signals), 12).expect("render");
    assert_eq!(audio.len(), 90_000);
    let report = decode(
        &SlotAudio::new(&audio, Mode::Ft4),
        &DecoderConfig::baseline(),
        &mut DecodeContext::new(),
    );
    for t in &truth {
        let d = report.decodes.iter().find(|d| d.text == t.text).expect(&t.text);
        assert!(
            (f64::from(d.freq_hz) - t.freq_hz).abs() <= 5.3,
            "{} freq {}",
            t.text,
            d.freq_hz
        );
        assert!(
            (f64::from(d.dt_s) - t.dt_s).abs() <= 0.02,
            "{} dt {}",
            t.text,
            d.dt_s
        );
    }
}

#[test]
fn faded_and_drifting_signals_decode() {
    let mut faded = SimSignal::new("CQ W9XYZ EN37", 1000.0, 0.0, -6.0);
    faded.fading = Some(Watterson::MODERATE);
    let mut drifting = SimSignal::new("CQ K1ABC FN42", 2000.0, 0.0, -6.0);
    drifting.drift_hz_per_s = 0.2;
    let (audio, _) = rr73_chansim::render(&scene(Mode::Ft8, vec![faded, drifting]), 13).expect("render");
    let report = decode(
        &SlotAudio::new(&audio, Mode::Ft8),
        &DecoderConfig::baseline(),
        &mut DecodeContext::new(),
    );
    let texts: Vec<&str> = report.decodes.iter().map(|d| d.text.as_str()).collect();
    assert!(texts.contains(&"CQ K1ABC FN42"), "{texts:?}");
    assert!(texts.contains(&"CQ W9XYZ EN37"), "{texts:?}");
}

#[test]
fn hostile_audio_gives_no_decodes() {
    let config = DecoderConfig::baseline();
    let mut ctx = DecodeContext::new();
    let (noise, _) = rr73_chansim::render(&rr73_chansim::noise_only(Mode::Ft8), 14).expect("render");
    let cases: Vec<Vec<f32>> = vec![
        Vec::new(),
        vec![0.0; 10],
        vec![0.0; 180_000],
        vec![f32::NAN; 180_000],
        vec![f32::INFINITY; 180_000],
        noise.iter().map(|x| x.signum()).collect(),
        noise,
    ];
    for mode in [Mode::Ft8, Mode::Ft4] {
        for samples in &cases {
            let r = decode(&SlotAudio::new(samples, mode), &config, &mut ctx);
            assert!(r.decodes.is_empty(), "{mode:?} {} samples", samples.len());
        }
    }
}

#[test]
fn snr_estimate_is_calibrated_for_gfsk_signals() {
    let config = DecoderConfig::baseline();
    let mut ctx = DecodeContext::new();
    let mut rng = ChaCha8Rng::seed_from_u64(15);
    for snr in [-16.0, -10.0, -4.0] {
        let (mut sum, mut n) = (0.0, 0);
        for seed in 0..12 {
            let s = rr73_chansim::single(Mode::Ft8, snr, None, &mut rng);
            let (audio, truth) = rr73_chansim::render(&s, 100 + seed).expect("render");
            let r = decode(&SlotAudio::new(&audio, Mode::Ft8), &config, &mut ctx);
            if let Some(d) = r.decodes.iter().find(|d| d.text == truth[0].text) {
                sum += f64::from(d.snr_db);
                n += 1;
            }
        }
        assert!(n >= 10, "{snr} dB: {n} of 12 decoded");
        let mean = sum / f64::from(n);
        assert!((mean - snr).abs() <= 1.0, "{snr} dB: mean estimate {mean:.2}");
    }
}

#[test]
fn partly_silent_slots_report_the_snr_of_the_audio_they_hold() {
    // The app zero-fills a slot up to the moment audio arrived and decodes it once half is
    // filled. Every decode keeps the SNR of the full slot within 1.5 dB. Counting the zeros
    // as noise read 8 to 10 dB high with 2 s (FT8) or 1 s (FT4) silent, and 44 to 50 dB high
    // from 3 s (FT8) or 2 s (FT4).
    let cases = [
        (Mode::Ft8, vec![2.0, 4.0, 7.0], 41),
        (Mode::Ft4, vec![1.0, 2.0, 3.5], 42),
    ];
    for (mode, silent, seed) in cases {
        let dt = if mode == Mode::Ft8 { 2.2 } else { 1.0 };
        let signals = vec![
            SimSignal::new("CQ K1ABC FN42", 1000.0, dt, 0.0),
            SimSignal::new("W9XYZ K1ABC -15", 1800.0, dt - 0.2, -8.0),
        ];
        let (audio, _) = rr73_chansim::render(&scene(mode, signals), seed).expect("render");
        for preset in ["baseline", "subtract-3-osd2"] {
            let config = DecoderConfig::preset(preset).expect("preset");
            let full = decode(&SlotAudio::new(&audio, mode), &config, &mut DecodeContext::new());
            assert_eq!(full.decodes.len(), 2, "{mode:?} {preset}: {:?}", full.decodes);
            for &s in &silent {
                let mut part = audio.clone();
                part[..(s * 12_000.0) as usize].fill(0.0);
                let r = decode(&SlotAudio::new(&part, mode), &config, &mut DecodeContext::new());
                assert!(
                    r.decodes.iter().any(|d| d.text == "CQ K1ABC FN42"),
                    "{mode:?} {preset}, first {s} s silent: {:?}",
                    r.decodes
                );
                for d in &r.decodes {
                    let f = full.decodes.iter().find(|f| f.text == d.text).expect(&d.text);
                    assert!(
                        (d.snr_db - f.snr_db).abs() <= 1.5,
                        "{mode:?} {preset}, first {s} s silent, {}: full slot {} dB, now {} dB",
                        d.text,
                        f.snr_db,
                        d.snr_db
                    );
                }
            }
        }
    }
}

#[test]
fn subtraction_uncovers_an_overlapped_signal() {
    let signals = vec![
        SimSignal::new("CQ K1ABC FN42", 1000.0, 0.0, 5.0),
        SimSignal::new("W9XYZ K1ABC -15", 1012.0, 0.3, -12.0),
    ];
    let (audio, _) = rr73_chansim::render(&scene(Mode::Ft8, signals), 21).expect("render");
    let texts = |preset: &str| {
        let config = DecoderConfig::preset(preset).expect("preset");
        let r = decode(
            &SlotAudio::new(&audio, Mode::Ft8),
            &config,
            &mut DecodeContext::new(),
        );
        r.decodes
            .iter()
            .map(|d| (d.text.clone(), d.pass))
            .collect::<Vec<_>>()
    };
    let base = texts("baseline");
    assert_eq!(base, vec![("CQ K1ABC FN42".to_string(), 1)]);
    let sub = texts("subtract-3");
    assert_eq!(
        sub,
        vec![
            ("CQ K1ABC FN42".to_string(), 1),
            ("W9XYZ K1ABC -15".to_string(), 2)
        ]
    );
}

#[test]
fn subtraction_stops_when_a_pass_finds_nothing() {
    let (noise, _) = rr73_chansim::render(&rr73_chansim::noise_only(Mode::Ft8), 22).expect("render");
    let run = |preset: &str| {
        let config = DecoderConfig::preset(preset).expect("preset");
        decode(
            &SlotAudio::new(&noise, Mode::Ft8),
            &config,
            &mut DecodeContext::new(),
        )
    };
    let (base, sub) = (run("baseline"), run("subtract-3"));
    assert!(sub.decodes.is_empty());
    assert_eq!(sub.stats.candidates, base.stats.candidates);
    assert_eq!(sub.timings.subtract_s, 0.0);
}

#[test]
fn bp_osd_recovers_codewords_belief_propagation_misses() {
    use rr73_decode::osd::{BpOsd, OsdParams, OsdSource};
    let graph = ParityGraph::ft8();
    let bp = SumProduct { max_iterations: 25 };
    let osd = BpOsd {
        bp: bp.clone(),
        osd: OsdParams {
            order: 2,
            window: 40,
            source: OsdSource::Channel,
            max_hard_errors: 30,
            max_distance: 0.07,
            erasures_as_errors: false,
        },
    };
    let mut rng = ChaCha8Rng::seed_from_u64(31);
    let mut scratch = LdpcScratch::default();
    let (mut bp_ok, mut osd_ok, mut osd_used) = (0, 0, 0);
    for _ in 0..300 {
        let cw = codeword_of(&payload_of(&messages::message(&mut rng)));
        // About 11 % raw bit errors: belief propagation fails on a good share.
        let llr: Vec<f32> = cw
            .iter()
            .map(|&b| {
                let n: f64 = rng.sample(StandardNormal);
                ((if b == 1 { 1.0 } else { -1.0 }) + 0.82 * n) as f32 * 3.0
            })
            .collect();
        let mut out = [0u8; CODEWORD_BITS];
        if bp.decode(graph, &llr, &mut scratch, &mut out).converged {
            assert_eq!(out, cw);
            bp_ok += 1;
        }
        let r = osd.decode(graph, &llr, &mut scratch, &mut out);
        if r.converged {
            assert_eq!(out, cw, "OSD returned a wrong codeword");
            osd_ok += 1;
            osd_used += usize::from(r.osd);
            assert!(!r.osd || (r.hard_errors <= 30 && r.distance <= 0.07));
        }
    }
    assert!(
        osd_used > 0 && osd_ok == bp_ok + osd_used,
        "bp {bp_ok} osd {osd_ok} via osd {osd_used}"
    );
}

#[test]
fn osd_presets_decode_nothing_from_noise_even_with_every_candidate() {
    let (noise, _) = rr73_chansim::render(&rr73_chansim::noise_only(Mode::Ft8), 23).expect("render");
    for preset in ["subtract-3-osd1", "subtract-3-osd2"] {
        let config = DecoderConfig::preset(preset)
            .and_then(|c| c.with_overrides(&["search.min_score_db=0"]))
            .expect("config");
        let r = decode(
            &SlotAudio::new(&noise, Mode::Ft8),
            &config,
            &mut DecodeContext::new(),
        );
        assert!(r.decodes.is_empty(), "{preset}: {:?}", r.decodes);
        assert!(
            r.stats.ldpc_attempts >= 100,
            "{preset}: {}",
            r.stats.ldpc_attempts
        );
    }
}

/// A priori decoding: weak messages from the QSO partner decode with the context and not
/// without it, nothing changes without a context, and noise gives nothing with one.
#[test]
fn a_priori_decoding_finds_weak_qso_messages_and_nothing_in_noise() {
    let config = DecoderConfig::preset("subtract-3-osd2").expect("preset");
    let qso = |dx_hz: f32| rr73_decode::ApContext {
        my_call: "9V1NE".into(),
        dx_call: Some("K1ABC".into()),
        dx_hz: Some(dx_hz),
    };
    let (mut with_ap, mut without, mut wrong) = (0, 0, 0);
    for (i, end) in ["RR73", "RRR", "73", "R-24", "-24"]
        .iter()
        .cycle()
        .take(20)
        .enumerate()
    {
        let text = format!("9V1NE K1ABC {end}");
        let hz = 600.0 + 90.0 * i as f64;
        let scene = Scene {
            mode: Mode::Ft8,
            signals: vec![SimSignal::new(&text, hz, 0.1, -21.0)],
            noise: Noise::Awgn,
        };
        let (audio, _) = rr73_chansim::render(&scene, 500 + i as u64).expect("render");
        let mut plain = DecodeContext::new();
        let off = decode(&SlotAudio::new(&audio, Mode::Ft8), &config, &mut plain);
        let mut ctx = DecodeContext::new();
        ctx.ap = Some(qso(hz as f32));
        let on = decode(&SlotAudio::new(&audio, Mode::Ft8), &config, &mut ctx);
        without += off.decodes.iter().filter(|d| d.text == text).count();
        with_ap += on.decodes.iter().filter(|d| d.text == text).count();
        wrong += on.decodes.iter().filter(|d| d.text != text).count();
        assert!(off.decodes.iter().all(|d| d.ap.is_none()));
        assert!(
            on.decodes
                .iter()
                .filter(|d| d.text == text)
                .all(|d| d.ap.is_some() || off.decodes.iter().any(|o| o.text == text))
        );
    }
    assert!(
        with_ap >= without + 6,
        "with AP {with_ap} of 20, without {without}"
    );
    assert_eq!(wrong, 0);

    // Noise with the full context, the partner anywhere: no decodes at all.
    for seed in 0..40u64 {
        let (noise, _) =
            rr73_chansim::render(&rr73_chansim::noise_only(Mode::Ft8), 900 + seed).expect("render");
        let mut ctx = DecodeContext::new();
        ctx.ap = Some(qso(300.0 + 60.0 * seed as f32));
        let r = decode(&SlotAudio::new(&noise, Mode::Ft8), &config, &mut ctx);
        assert!(
            r.decodes.is_empty(),
            "seed {seed}: {:?}",
            r.decodes.iter().map(|d| &d.text).collect::<Vec<_>>()
        );
    }
}

/// Block soft bits (experiment 0008) decode weak FT8 and FT4 signals that the spectrogram's
/// single-symbol LLRs miss, mark those decodes with the block length, and decode nothing from
/// noise with every candidate sent to the decoder.
#[test]
fn block_soft_bits_decode_weak_signals_and_nothing_from_noise() {
    let preset = DecoderConfig::preset("subtract-3-osd2").expect("preset");
    let shipped = preset
        .with_overrides(&["demod.kind=max-log"])
        .expect("spectrogram");
    let block = preset
        .with_overrides(&[
            "demod.kind=block",
            "demod.ft8_blocks=[1,3]",
            "demod.ft4_blocks=[1,4]",
            "demod.ft8_min_sync=0",
            "demod.ft4_min_sync=0",
        ])
        .expect("block");
    let texts = [
        "CQ K1ABC FN42",
        "W9XYZ K1ABC -15",
        "K1ABC W9XYZ R-08",
        "9V1NE JA1KXM PM95",
        "JH1RRT YB0AZK RR73",
    ];
    for (mode, snr) in [(Mode::Ft8, -20.5), (Mode::Ft4, -16.0)] {
        let (mut before, mut after) = (0, 0);
        for i in 0..10u64 {
            let text = texts[i as usize % texts.len()];
            let scene = scene(
                mode,
                vec![SimSignal::new(text, 700.0 + 150.0 * i as f64, 0.1, snr)],
            );
            let (audio, _) = rr73_chansim::render(&scene, 700 + i).expect("render");
            let slot = SlotAudio::new(&audio, mode);
            let old = decode(&slot, &shipped, &mut DecodeContext::new());
            let new = decode(&slot, &block, &mut DecodeContext::new());
            before += old.decodes.iter().filter(|d| d.text == text).count();
            after += new.decodes.iter().filter(|d| d.text == text).count();
            assert!(
                new.decodes.iter().all(|d| d.text == text),
                "{mode:?}: {:?}",
                new.decodes
            );
            assert!(
                new.decodes
                    .iter()
                    .all(|d| matches!(d.block, Some(1) | Some(3) | Some(4)))
            );
            assert!(old.decodes.iter().all(|d| d.block.is_none()));
        }
        assert!(
            after >= before + 3,
            "{mode:?} at {snr} dB: {before} of 10 before, {after} after"
        );

        let (noise, _) = rr73_chansim::render(&rr73_chansim::noise_only(mode), 31).expect("render");
        let stress = block.with_overrides(&["search.min_score_db=0"]).expect("stress");
        let r = decode(&SlotAudio::new(&noise, mode), &stress, &mut DecodeContext::new());
        assert!(r.decodes.is_empty(), "{mode:?}: {:?}", r.decodes);
        assert!(
            r.stats.ldpc_attempts >= 2 * r.stats.candidates && r.stats.candidates >= 100,
            "{mode:?}: {} attempts for {} candidates",
            r.stats.ldpc_attempts,
            r.stats.candidates
        );
        // The sync gate sends few noise candidates to the decoder.
        let gated = stress
            .with_overrides(&["demod.ft8_min_sync=6", "demod.ft4_min_sync=7"])
            .expect("gate");
        let g = decode(&SlotAudio::new(&noise, mode), &gated, &mut DecodeContext::new());
        assert!(g.decodes.is_empty(), "{mode:?}: {:?}", g.decodes);
        assert!(
            g.stats.candidates == r.stats.candidates && g.stats.ldpc_attempts < r.stats.ldpc_attempts / 2,
            "{mode:?}: {} attempts gated, {} without",
            g.stats.ldpc_attempts,
            r.stats.ldpc_attempts
        );
    }
}
