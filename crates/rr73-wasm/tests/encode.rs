//! Transmit path: text synthesised by the app's binding decodes back to the same text.

use rr73_wasm::{decode_slot_json, pack, set_qso_context, synthesize_samples};

/// Places a transmission 0.5 s plus `dt_s` into a silent slot of `len` samples at 12 kHz.
fn slot_with(tx: &[f32], len: usize, dt_s: f64) -> Vec<f32> {
    let mut slot = vec![0.0f32; len];
    let at = ((0.5 + dt_s) * 12_000.0).round() as usize;
    for (i, x) in tx.iter().enumerate() {
        if at + i < len {
            slot[at + i] = 0.5 * x;
        }
    }
    slot
}

#[test]
fn synthesised_messages_decode_back() {
    let messages = [
        "CQ 9V1NE OJ11",
        "JA1KXM 9V1NE OJ11",
        "JA1KXM 9V1NE -14",
        "JA1KXM 9V1NE R-09",
        "JA1KXM 9V1NE RR73",
        "JA1KXM 9V1NE 73",
        "CQ POTA 9V1NE OJ11",
    ];
    for (mode, len) in [("FT8", 180_000), ("FT4", 90_000)] {
        for text in messages {
            let tx = synthesize_samples(text, mode, 1180.0, 12_000).expect("synthesize");
            let json = decode_slot_json(&slot_with(&tx, len, 0.0), mode, "baseline").expect("decode");
            let decodes: serde_json::Value = serde_json::from_str(&json).expect("json");
            let texts: Vec<&str> = decodes
                .as_array()
                .expect("array")
                .iter()
                .filter_map(|d| d["text"].as_str())
                .collect();
            assert_eq!(
                texts,
                vec![pack(text, mode).text.as_str()],
                "{mode} {text}: {json}"
            );
        }
    }
}

fn decoded_texts(tx: &[f32], mode: &str) -> Vec<String> {
    let json = decode_slot_json(&slot_with(tx, 180_000, 0.0), mode, "subtract-3-osd2").expect("decode");
    let decodes: serde_json::Value = serde_json::from_str(&json).expect("json");
    decodes
        .as_array()
        .expect("array")
        .iter()
        .filter_map(|d| d["text"].as_str().map(String::from))
        .collect()
}

#[test]
fn lq8_messages_decode_back_and_only_in_lq8() {
    set_qso_context("9V1NE", "AB4SS", 1180.0);
    for (text, shown) in [
        ("CQ 9V1NE OJ11", "CQ 9V1NE OJ11"),
        ("AB4SS 9V1NE OJ11 -03", "AB4SS 9V1NE OJ11 -03"),
        ("9V1NE AB4SS R+05", "9V1NE AB4SS R+05"),
        ("AB4SS 9V1NE 73", "AB4SS 9V1NE 73"),
        ("TNX FER QSO", "TNX FER QSO"),
        // The QSO context names AB4SS for the 16-bit hash; OE3OGC is unknown here.
        (
            "<9V1NE> R+05 <OE3OGC> R-03 <AB4SS>",
            "<9V1NE> R+05 <...> R-03 <AB4SS>",
        ),
        ("<9V1NE> <OE3OGC> <AB4SS> 73", "<9V1NE> <...> <AB4SS> 73"),
    ] {
        let tx = synthesize_samples(text, "LQ8", 1180.0, 12_000).expect("synthesize");
        assert_eq!(decoded_texts(&tx, "LQ8"), vec![shown.to_string()], "{text}");
        assert!(decoded_texts(&tx, "FT8").is_empty(), "{text} in FT8");
    }
    set_qso_context("", "", 0.0);
}

#[test]
fn a_late_start_decodes_with_its_delay_as_dt() {
    let tx = synthesize_samples("CQ 9V1NE OJ11", "FT8", 1500.0, 12_000).expect("synthesize");
    let json = decode_slot_json(&slot_with(&tx, 180_000, 1.5), "FT8", "baseline").expect("decode");
    let decodes: serde_json::Value = serde_json::from_str(&json).expect("json");
    let d = &decodes.as_array().expect("array")[0];
    assert_eq!(d["text"], "CQ 9V1NE OJ11");
    assert!((d["dt_s"].as_f64().unwrap_or(0.0) - 1.5).abs() < 0.05, "{json}");
}
