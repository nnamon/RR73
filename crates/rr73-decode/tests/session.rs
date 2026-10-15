//! Partial slots and staged decoding sessions on slots rendered by the channel simulator.

use rr73_chansim::{Noise, Scene, SimSignal};
use rr73_decode::{DecodeContext, DecodeSession, DecoderConfig, SlotAudio, Stage, decode};
use rr73_ft8::Mode;

fn render(signals: Vec<SimSignal>, seed: u64) -> Vec<f32> {
    let scene = Scene {
        mode: Mode::Ft8,
        signals,
        noise: Noise::Awgn,
    };
    rr73_chansim::render(&scene, seed).expect("render").0
}

fn texts(decodes: &[rr73_decode::Decode]) -> Vec<String> {
    let mut t: Vec<String> = decodes.iter().map(|d| d.text.clone()).collect();
    t.sort();
    t
}

fn crowded() -> Vec<f32> {
    render(
        vec![
            SimSignal::new("CQ K1ABC FN42", 612.3, 0.17, -12.0),
            SimSignal::new("W9XYZ K1ABC -15", 1418.9, -0.33, -8.0),
            SimSignal::new("K1ABC W9XYZ R-08", 2237.0, 0.41, -4.0),
            SimSignal::new("CQ DL1ABC JO62", 1000.0, 0.0, 5.0),
            SimSignal::new("G4ABC DL1ABC -10", 1012.0, 0.3, -12.0),
            SimSignal::new("CQ EA4XYZ IN80", 1750.0, 1.1, -18.0),
        ],
        41,
    )
}

#[test]
fn partial_slot_decodes_signals_missing_their_last_symbols() {
    let audio = render(
        vec![
            SimSignal::new("CQ K1ABC FN42", 612.3, 0.0, -10.0),
            SimSignal::new("W9XYZ K1ABC -15", 1418.9, 0.3, -8.0),
        ],
        42,
    );
    let config = DecoderConfig::preset("subtract-3-osd2").expect("preset");
    let mut ctx = DecodeContext::new();
    // 11.8 s: the signal at DT 0 lacks its last 9 symbols, the one at DT 0.3 its last 12.
    let early = &audio[..(11.8 * 12_000.0) as usize];
    let r = decode(&SlotAudio::partial(early, Mode::Ft8), &config, &mut ctx);
    assert_eq!(texts(&r.decodes), ["CQ K1ABC FN42", "W9XYZ K1ABC -15"]);
    for d in &r.decodes {
        let dt = if d.text.starts_with("CQ") { 0.0 } else { 0.3 };
        assert!((f64::from(d.dt_s) - dt).abs() <= 0.05, "{} dt {}", d.text, d.dt_s);
    }
    // 8 s holds less than half of each signal: nothing decodes, nothing false.
    let r = decode(
        &SlotAudio::partial(&audio[..96_000], Mode::Ft8),
        &config,
        &mut ctx,
    );
    assert!(r.decodes.is_empty(), "{:?}", r.decodes);
}

#[test]
fn hostile_partial_audio_gives_no_decodes() {
    let config = DecoderConfig::preset("subtract-3-osd2").expect("preset");
    let mut ctx = DecodeContext::new();
    let (noise, _) = rr73_chansim::render(&rr73_chansim::noise_only(Mode::Ft8), 43).expect("render");
    let cases: Vec<Vec<f32>> = vec![
        Vec::new(),
        vec![0.0; 10],
        vec![0.0; 3_839],
        vec![f32::NAN; 141_600],
        noise[..141_600].to_vec(),
        noise[..162_000].to_vec(),
    ];
    for mode in [Mode::Ft8, Mode::Ft4] {
        for samples in &cases {
            let r = decode(&SlotAudio::partial(samples, mode), &config, &mut ctx);
            assert!(r.decodes.is_empty(), "{mode:?} {} samples", samples.len());
        }
    }
}

#[test]
fn one_stage_session_matches_decode_step_by_step() {
    let audio = crowded();
    let slot = SlotAudio::new(&audio, Mode::Ft8);
    for preset in ["baseline", "subtract-3", "subtract-3-osd2"] {
        let config = DecoderConfig::preset(preset).expect("preset");
        let whole = decode(&slot, &config, &mut DecodeContext::new());
        assert!(whole.decodes.len() >= 4, "{preset}: {:?}", whole.decodes);

        let mut session = DecodeSession::new(&slot, vec![Stage::preset(preset).expect("stage")]);
        let mut stepped = Vec::new();
        let mut steps = 0;
        loop {
            let out = session.step();
            steps += 1;
            stepped.extend(out.decodes);
            if out.done {
                assert!(out.stage_done);
                break;
            }
        }
        assert!(steps > 10, "{preset}: {steps} steps");
        assert_eq!(stepped, whole.decodes, "{preset}");
        assert_eq!(session.decodes(), &whole.decodes[..]);
        assert_eq!(session.report().stats, whole.stats, "{preset}");
        assert!(session.is_done());
        assert_eq!(session.next_stage(), None);
        let after = session.step();
        assert!(after.done && after.decodes.is_empty());
    }
}

#[test]
fn later_stages_return_only_new_decodes() {
    let audio = crowded();
    let slot = SlotAudio::new(&audio, Mode::Ft8);
    let stages = vec![
        Stage::preset("baseline").expect("stage"),
        Stage::preset("subtract-3-osd2").expect("stage"),
        Stage::preset("subtract-3-osd2").expect("stage"),
    ];
    let mut session = DecodeSession::new(&slot, stages);
    assert_eq!(session.stage_count(), 3);
    let first = session.next_stage().expect("stage 1");
    let second = session.next_stage().expect("stage 2");
    let third = session.next_stage().expect("stage 3");
    assert_eq!(session.next_stage(), None);

    // Stage 1 alone is the baseline; stage 2 adds what subtraction and OSD uncover; stage
    // 3 repeats stage 2 on a residual with nothing left to find.
    let base = decode(&slot, &DecoderConfig::baseline(), &mut DecodeContext::new());
    assert_eq!(first, base.decodes);
    assert!(!second.is_empty(), "{first:?}");
    assert!(third.is_empty(), "{third:?}");
    let all: Vec<_> = first.iter().chain(&second).cloned().collect();
    assert_eq!(texts(session.decodes()), texts(&all));
    let mut unique = texts(&all);
    unique.dedup();
    assert_eq!(unique.len(), all.len(), "a decode repeated across stages");
    assert_eq!(
        session.decode_stages(),
        [vec![0; first.len()], vec![1; second.len()]].concat()
    );
    // Every decode of the single-stage shipped preset is found by the staged session.
    let shipped = decode(
        &slot,
        &DecoderConfig::preset("subtract-3-osd2").expect("preset"),
        &mut DecodeContext::new(),
    );
    for t in texts(&shipped.decodes) {
        assert!(texts(&all).contains(&t), "{t} missing");
    }
    assert_eq!(session.stage_seconds().len(), 3);
}

#[test]
fn session_returns_its_context_for_reuse() {
    let audio = crowded();
    let slot = SlotAudio::new(&audio, Mode::Ft8);
    let config = DecoderConfig::preset("subtract-3").expect("preset");
    let mut ctx = DecodeContext::new();
    let first = decode(&slot, &config, &mut ctx);
    let mut session = DecodeSession::with_context(&slot, vec![Stage::new("s", config.clone())], ctx);
    session.run_to_end();
    let mut ctx = session.into_context();
    let again = decode(&slot, &config, &mut ctx);
    assert_eq!(texts(&first.decodes), texts(&again.decodes));
    // An empty session is done at once.
    let mut empty = DecodeSession::new(&slot, Vec::new());
    assert!(empty.is_done());
    assert_eq!(empty.next_stage(), None);
}

#[test]
fn finer_grids_and_padded_windows_decode_and_report_step_kinds() {
    let audio = crowded();
    let slot = SlotAudio::new(&audio, Mode::Ft8);
    let shipped = decode(
        &slot,
        &DecoderConfig::preset("subtract-3-osd2").expect("preset"),
        &mut DecodeContext::new(),
    );
    for overrides in [
        "spectrogram.time_osr=4",
        "spectrogram.freq_osr=4 spectrogram.window_symbols=2",
        "spectrogram.time_osr=4 spectrogram.freq_osr=4 spectrogram.window_symbols=2",
    ] {
        let stage = Stage::parse(&format!("subtract-3-osd2 {overrides}")).expect("stage");
        let mut session = DecodeSession::new(&slot, vec![stage]);
        let mut kinds = Vec::new();
        while !session.is_done() {
            kinds.push(session.next_step_kind());
            session.step();
        }
        assert_eq!(session.next_step_kind(), "done");
        for k in ["start-stage", "start-pass", "spectrogram", "search", "candidates"] {
            assert!(kinds.contains(&k), "{overrides}: {k} missing");
        }
        // The same messages as the shipped grid; SNR estimates stay within 1.5 dB.
        assert_eq!(texts(session.decodes()), texts(&shipped.decodes), "{overrides}");
        for d in session.decodes() {
            let s = shipped
                .decodes
                .iter()
                .find(|s| s.text == d.text)
                .expect("shipped");
            assert!(
                (d.snr_db - s.snr_db).abs() <= 1.5,
                "{overrides}: {} {} {}",
                d.text,
                d.snr_db,
                s.snr_db
            );
            assert!(
                (d.freq_hz - s.freq_hz).abs() <= 3.2,
                "{overrides}: {} {} {}",
                d.text,
                d.freq_hz,
                s.freq_hz
            );
        }
    }
    // A padded window over partial audio stops at the last whole window.
    let stage =
        Stage::parse("subtract-3-osd2 spectrogram.freq_osr=4 spectrogram.window_symbols=2").expect("stage");
    let early = &audio[..141_600];
    let mut session = DecodeSession::new(&SlotAudio::partial(early, Mode::Ft8), vec![stage]);
    session.run_to_end();
    assert!(texts(session.decodes()).contains(&"CQ DL1ABC JO62".to_string()));
}

#[test]
fn plans_parse_stage_specs() {
    let stages = Stage::plan(" subtract-3-osd2 ; subtract-3-osd2 spectrogram.time_osr=4 ;").expect("plan");
    assert_eq!(stages.len(), 2);
    assert_eq!(stages[1].name, "subtract-3-osd2 spectrogram.time_osr=4");
    assert_eq!(stages[1].config.spectrogram.time_osr, 4);
    assert!(Stage::plan("").expect("empty").is_empty());
    assert!(Stage::plan("baseline; nope").is_err());
    assert!(Stage::parse("baseline passes").is_err());
}

#[test]
fn block_stages_transform_each_pass_and_match_decode() {
    let audio = crowded();
    let slot = SlotAudio::new(&audio, Mode::Ft8);
    let spec = "subtract-3-osd2 demod.kind=block demod.ft8_blocks=[1,3]";
    let stage = Stage::parse(spec).expect("stage");
    let one_shot = decode(&slot, &stage.config, &mut DecodeContext::new());
    let mut session = DecodeSession::new(&slot, vec![stage]);
    let mut kinds = Vec::new();
    while !session.is_done() {
        kinds.push(session.next_step_kind());
        session.step();
    }
    let passes = session.decodes().iter().map(|d| d.pass).max().unwrap_or(0) as usize;
    let transforms = kinds.iter().filter(|&&k| k == "baseband").count();
    assert!(
        transforms >= passes && transforms <= passes + 1,
        "{transforms} for {passes} passes"
    );
    assert_eq!(texts(session.decodes()), texts(&one_shot.decodes));
    // Every message the spectrogram LLRs find, and the -18 dB one they may miss.
    let spectrogram = DecoderConfig::preset("subtract-3-osd2")
        .and_then(|c| c.with_overrides(&["demod.kind=max-log"]))
        .expect("spectrogram");
    let shipped = decode(&slot, &spectrogram, &mut DecodeContext::new());
    for t in texts(&shipped.decodes) {
        assert!(texts(session.decodes()).contains(&t), "{t}");
    }
    assert!(texts(session.decodes()).contains(&"CQ EA4XYZ IN80".to_string()));
}

#[test]
fn trace_records_every_candidate_and_points_at_its_decodes() {
    use rr73_decode::TraceOutcome;
    let audio = crowded();
    let slot = SlotAudio::new(&audio, Mode::Ft8);
    let config = DecoderConfig::preset("subtract-3-osd2").expect("preset");
    let whole = decode(&slot, &config, &mut DecodeContext::new());

    let mut session = DecodeSession::new(&slot, vec![Stage::preset("subtract-3-osd2").expect("stage")]);
    assert!(session.trace().is_empty());
    session.set_trace(true);
    session.run_to_end();
    // Tracing changes nothing the session decodes.
    assert_eq!(session.decodes(), &whole.decodes[..]);
    let trace = session.trace();
    // One entry per candidate tried, whatever number of soft-bit sets it took.
    assert_eq!(trace.len() as u32, whole.stats.candidates);
    let mut pointed = Vec::new();
    for t in trace {
        if let TraceOutcome::Decoded(i) = t.outcome {
            let d = &session.decodes()[i];
            assert_eq!((t.freq_hz, t.dt_s, t.pass), (d.freq_hz, d.dt_s, d.pass));
            pointed.push(i);
        }
    }
    assert_eq!(pointed, (0..whole.decodes.len()).collect::<Vec<_>>());
    assert!(trace.iter().any(|t| t.outcome == TraceOutcome::NoCodeword));
    // The residual holds the slot with the subtracted decodes taken out: less power.
    let power = |x: &[f32]| x.iter().map(|&v| f64::from(v).powi(2)).sum::<f64>();
    assert_eq!(session.residual().len(), audio.len());
    assert!(power(session.residual()) < power(&audio));
    session.set_trace(false);
    assert!(session.trace().is_empty());
}
