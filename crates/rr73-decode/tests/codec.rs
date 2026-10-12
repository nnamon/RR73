//! Decoder tests that use the codec: protocol tables, the real LDPC code, and whole slots
//! rendered by the channel simulator.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use rand_distr::StandardNormal;
use rr73_chansim::{Noise, Scene, SimSignal, Watterson, messages};
use rr73_decode::layout::CODEWORD_BITS;
use rr73_decode::ldpc::{LdpcDecoder, LdpcScratch, MinSum, ParityGraph, SumProduct};
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
    let v = CrcUnpack;
    let mut hashes = CallsignHashes::new();
    let payload = payload_of("CQ K1ABC FN42");
    let cw = codeword_of(&payload);
    let ok = v.validate(Mode::Ft8, &cw, &mut hashes).expect("valid");
    assert_eq!(ok.payload, payload);
    assert_eq!(ok.text, "CQ K1ABC FN42");
    assert!(v.is_duplicate(&ok, &[payload]));

    let mut bad = cw;
    bad[3] ^= 1;
    assert_eq!(
        v.validate(Mode::Ft8, &bad, &mut hashes).err(),
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
        .validate(Mode::Ft4, &codeword_of(&scrambled), &mut hashes)
        .expect("ft4");
    assert_eq!(ft4.payload, payload);
    // Read as FT8, the same codeword passes its CRC (computed over the scrambled bits) and
    // carries the scrambled payload, if that unpacks at all.
    if let Ok(as_ft8) = v.validate(Mode::Ft8, &codeword_of(&scrambled), &mut hashes) {
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
