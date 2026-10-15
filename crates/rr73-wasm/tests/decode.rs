//! The app entry point on a rendered slot.

use rr73_chansim::{Noise, Scene, SimSignal, render};
use rr73_ft8::Mode;
use rr73_wasm::{DecoderSession, decode_partial_json, decode_slot_json};

#[test]
fn decodes_a_rendered_slot_to_json() {
    for (mode, name) in [(Mode::Ft8, "FT8"), (Mode::Ft4, "ft4")] {
        let scene = Scene {
            mode,
            signals: vec![SimSignal::new("CQ K1ABC FN42", 1234.0, 0.12, -8.0)],
            noise: Noise::Awgn,
        };
        let (audio, _) = render(&scene, 21).expect("render");
        let json = decode_slot_json(&audio, name, "baseline").expect("decode");
        let decodes: serde_json::Value = serde_json::from_str(&json).expect("json");
        let list = decodes.as_array().expect("array");
        assert_eq!(list.len(), 1, "{json}");
        let d = &list[0];
        assert_eq!(d["text"], "CQ K1ABC FN42");
        assert!(
            (d["freq_hz"].as_f64().unwrap_or(0.0) - 1234.0).abs() < 6.0,
            "{json}"
        );
        assert!((d["dt_s"].as_f64().unwrap_or(9.0) - 0.12).abs() < 0.05, "{json}");
        assert!(d["snr_db"].as_f64().is_some());
    }
}

#[test]
fn empty_and_hostile_buffers_give_an_empty_array() {
    for samples in [Vec::new(), vec![f32::NAN; 180_000], vec![0.0; 100]] {
        assert_eq!(decode_slot_json(&samples, "FT8", "baseline").as_deref(), Ok("[]"));
    }
}

fn two_signals() -> Vec<f32> {
    let scene = Scene {
        mode: Mode::Ft8,
        signals: vec![
            SimSignal::new("CQ DL1ABC JO62", 1000.0, 0.0, 5.0),
            SimSignal::new("G4ABC DL1ABC -10", 1012.0, 0.3, -12.0),
        ],
        noise: Noise::Awgn,
    };
    render(&scene, 22).expect("render").0
}

#[test]
fn partial_slots_decode_to_json() {
    let audio = two_signals();
    let early = &audio[..141_600];
    let json = decode_partial_json(early, "FT8", "subtract-3-osd2").expect("decode");
    let list: serde_json::Value = serde_json::from_str(&json).expect("json");
    let texts: Vec<&str> = list
        .as_array()
        .expect("array")
        .iter()
        .filter_map(|d| d["text"].as_str())
        .collect();
    assert!(texts.contains(&"CQ DL1ABC JO62"), "{json}");
    for samples in [Vec::new(), vec![f32::NAN; 141_600], vec![0.0; 100]] {
        assert_eq!(
            decode_partial_json(&samples, "FT8", "subtract-3-osd2").as_deref(),
            Ok("[]")
        );
    }
    assert!(decode_partial_json(early, "FT8", "nope").is_err());
}

#[test]
fn partial_sessions_decode_as_decode_partial() {
    let audio = two_signals();
    for len in [60_000usize, 120_000, 141_600, 162_000] {
        let early = &audio[..len];
        let want = decode_partial_json(early, "FT8", "subtract-3-osd2").expect("decode");
        let mut session = DecoderSession::create_partial(early, "FT8", "subtract-3-osd2").expect("session");
        let got = session.next_stage_json().expect("stage").expect("decodes");
        assert_eq!(got, want, "length {len}");
        assert_eq!(session.next_stage_json(), Ok(None));
    }
    assert!(DecoderSession::create_partial(&audio, "FT8", "nope").is_err());
}

#[test]
fn sessions_return_each_stage_once_and_stop_anywhere() {
    let audio = two_signals();
    // Stage by stage: the baseline finds the strong signal, the second stage the weak one
    // under it, the third nothing new.
    let mut session =
        DecoderSession::create(&audio, "FT8", "baseline; subtract-3-osd2; subtract-3-osd2").expect("session");
    assert_eq!(session.stage_count(), 3);
    let mut stages = Vec::new();
    while let Some(json) = session.next_stage_json().expect("stage") {
        let list: serde_json::Value = serde_json::from_str(&json).expect("json");
        stages.push(
            list.as_array()
                .expect("array")
                .iter()
                .filter_map(|d| d["text"].as_str().map(str::to_string))
                .collect::<Vec<_>>(),
        );
    }
    assert_eq!(
        stages,
        vec![
            vec!["CQ DL1ABC JO62".to_string()],
            vec!["G4ABC DL1ABC -10".to_string()],
            vec![]
        ]
    );
    assert!(session.done());
    assert_eq!(session.stage(), 3);
    assert_eq!(session.next_stage_json(), Ok(None));
    // The timings outlive the session's context: natively the stopwatch always runs.
    let timings: serde_json::Value = serde_json::from_str(&session.timings_json()).expect("json");
    let stage_s = timings["stage_s"].as_array().expect("stage_s");
    assert_eq!(stage_s.len(), 3);
    let total = timings["stages"]["total_s"].as_f64().expect("total_s");
    let sum: f64 = stage_s.iter().filter_map(serde_json::Value::as_f64).sum();
    assert!(total > 0.0 && (total - sum).abs() < 1e-9, "{timings}");
    assert!(
        timings["stages"]["spectrogram_s"].as_f64() > Some(0.0),
        "{timings}"
    );

    // Step by step, stopping after the first step that finds something: the session can be
    // dropped there and a new one created at once.
    let mut session = DecoderSession::create(&audio, "FT8", "baseline; subtract-3-osd2").expect("session");
    let mut steps = 0;
    loop {
        let json = session.step_json().expect("step");
        steps += 1;
        let out: serde_json::Value = serde_json::from_str(&json).expect("json");
        assert!(out["done"].is_boolean() && out["stage"].is_u64(), "{json}");
        if !out["decodes"].as_array().expect("decodes").is_empty() {
            assert_eq!(out["stage"], 0);
            break;
        }
        assert!(steps < 1000, "no decode in {steps} steps");
    }
    drop(session);
    let mut again = DecoderSession::create(&audio, "FT8", "subtract-3-osd2").expect("session");
    assert!(again.next_stage_json().expect("stage").is_some());

    // Plans are checked up front.
    assert!(DecoderSession::create(&audio, "FT8", "").is_err());
    assert!(DecoderSession::create(&audio, "FT8", "baseline; nope").is_err());
    assert!(DecoderSession::create(&audio, "FT8", "baseline passes=x").is_err());
    assert!(DecoderSession::create(&audio, "JT65", "baseline").is_err());
}

#[test]
fn decodes_a_rendered_wspr_slot_to_json() {
    use rr73_chansim::{WsprScene, WsprSignal, render_wspr};
    let scene = WsprScene {
        signals: vec![WsprSignal::new("K1ABC FN42 37", 1488.2, 0.3, -24.0)],
        noise: Noise::Awgn,
    };
    let (audio, _) = render_wspr(&scene, 5).expect("render");
    let json = rr73_wasm::decode_wspr_json(&audio, "wspr").expect("decode");
    let decodes: serde_json::Value = serde_json::from_str(&json).expect("json");
    let list = decodes.as_array().expect("array");
    assert_eq!(list.len(), 1, "{json}");
    let d = &list[0];
    assert_eq!(d["text"], "K1ABC FN42 37");
    assert!(
        (d["freq_hz"].as_f64().unwrap_or(0.0) - 1488.2).abs() < 0.3,
        "{json}"
    );
    assert!((d["dt_s"].as_f64().unwrap_or(9.0) - 0.3).abs() < 0.05, "{json}");
    assert!(d["drift_hz_per_s"].as_f64().is_some() && d["snr_db"].as_f64().is_some());
}
