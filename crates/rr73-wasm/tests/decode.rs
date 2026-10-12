//! The app entry point on a rendered slot.

use rr73_chansim::{Noise, Scene, SimSignal, render};
use rr73_ft8::Mode;
use rr73_wasm::decode_slot_json;

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
