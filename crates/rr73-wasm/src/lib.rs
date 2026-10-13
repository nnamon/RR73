//! WebAssembly bindings for the RR73 app.
//!
//! The app's decoder workers call [`decode_slot`] once per slot. Each worker keeps one
//! decoder context, so FFT plans and buffers are allocated on the first call and callsign
//! hashes learnt from earlier slots resolve hashed callsigns in later ones.
//!
//! For transmitting, [`pack_message`] checks operator text and gives its canonical form, and
//! [`synthesize`] renders a message as GFSK audio at the audio output's sample rate.

use std::cell::RefCell;

use rr73_decode::{DecodeContext, DecoderConfig, SlotAudio, decode};
use rr73_ft8::{CallsignHashes, Message, Mode, message, synth, tones};
use serde::Serialize;
use wasm_bindgen::prelude::*;

thread_local! {
    static CONTEXT: RefCell<DecodeContext> = RefCell::new(DecodeContext::new());
}

/// One decode as the app receives it.
#[derive(Debug, Serialize)]
struct AppDecode<'a> {
    /// Message text.
    text: &'a str,
    /// Base-tone frequency, in Hz, to 0.1 Hz.
    freq_hz: f64,
    /// DT from the nominal start, in seconds, to 0.01 s.
    dt_s: f64,
    /// SNR in 2500 Hz, in dB, to 0.1 dB.
    snr_db: f64,
}

/// Rounds to `digits` decimal places; dividing by a power of ten keeps the JSON short.
fn round(x: f32, digits: i32) -> f64 {
    let scale = 10f64.powi(digits);
    (f64::from(x) * scale).round() / scale
}

/// Parses `FT8` or `FT4` (any case).
pub fn parse_mode(mode: &str) -> Result<Mode, String> {
    match mode.trim().to_ascii_uppercase().as_str() {
        "FT8" => Ok(Mode::Ft8),
        "FT4" => Ok(Mode::Ft4),
        other => Err(format!("unknown mode {other:?}; use FT8 or FT4")),
    }
}

/// [`decode_slot`] without the JavaScript error type, for native callers and tests.
pub fn decode_slot_json(samples: &[f32], mode: &str, preset: &str) -> Result<String, String> {
    let mode = parse_mode(mode)?;
    let config = DecoderConfig::preset(preset).map_err(|e| e.to_string())?;
    let report = CONTEXT.with(|ctx| {
        let mut ctx = ctx.borrow_mut();
        decode(&SlotAudio::new(samples, mode), &config, &mut ctx)
    });
    let out: Vec<AppDecode<'_>> = report
        .decodes
        .iter()
        .map(|d| AppDecode {
            text: &d.text,
            freq_hz: round(d.freq_hz, 1),
            dt_s: round(d.dt_s, 2),
            snr_db: round(d.snr_db, 1),
        })
        .collect();
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// Decodes one slot of mono audio at 12 kHz (sample 0 at the slot start) with a decoder
/// preset such as `baseline`. Returns a JSON array of
/// `{ "text", "freq_hz", "dt_s", "snr_db" }` objects in decode order. Throws for an unknown
/// mode or preset; never throws for sample values.
#[wasm_bindgen]
pub fn decode_slot(samples: &[f32], mode: &str, preset: &str) -> Result<String, JsError> {
    decode_slot_json(samples, mode, preset).map_err(|e| JsError::new(&e))
}

/// The result of checking operator text for transmission.
#[derive(Debug, Serialize, PartialEq)]
pub struct Packed {
    /// True when the text packs into a 77-bit message.
    pub ok: bool,
    /// The message as it will be decoded at the other end, or the input when `ok` is false.
    pub text: String,
    /// Message type as `i3.n3`, such as `1.0` for a standard message; empty when `ok` is false.
    pub i3n3: String,
    /// Why the text cannot be sent; `None` when `ok` is true.
    pub error: Option<String>,
}

/// [`pack_message`] as a struct, for native callers and tests.
pub fn pack(text: &str, mode: &str) -> Packed {
    let checked = parse_mode(mode).and_then(|_| {
        let msg = Message::parse(text).map_err(|e| e.to_string())?;
        message::pack(&msg, &mut CallsignHashes::new()).map_err(|e| e.to_string())?;
        Ok(msg)
    });
    match checked {
        Ok(msg) => {
            let (i3, n3) = msg.i3_n3();
            Packed {
                ok: true,
                text: msg.to_string(),
                i3n3: format!("{i3}.{n3}"),
                error: None,
            }
        }
        Err(e) => Packed {
            ok: false,
            text: text.to_string(),
            i3n3: String::new(),
            error: Some(e),
        },
    }
}

/// Checks operator text for transmission in `mode` (`FT8` or `FT4`). Returns JSON
/// `{ "ok", "text", "i3n3", "error" }`: the canonical text and message type when it packs,
/// otherwise the reason it cannot be sent.
#[wasm_bindgen]
pub fn pack_message(text: &str, mode: &str) -> String {
    serde_json::to_string(&pack(text, mode)).unwrap_or_else(|_| "{}".to_string())
}

/// [`synthesize`] without the JavaScript error type, for native callers and tests.
pub fn synthesize_samples(text: &str, mode: &str, f0_hz: f32, sample_rate: u32) -> Result<Vec<f32>, String> {
    let mode = parse_mode(mode)?;
    if !(f0_hz.is_finite() && (100.0..=3000.0).contains(&f0_hz)) {
        return Err(format!("base tone {f0_hz} Hz is outside 100 to 3000 Hz"));
    }
    if !(8_000..=192_000).contains(&sample_rate) {
        return Err(format!(
            "sample rate {sample_rate} Hz is outside 8000 to 192000 Hz"
        ));
    }
    let msg = Message::parse(text).map_err(|e| e.to_string())?;
    let payload = message::pack(&msg, &mut CallsignHashes::new()).map_err(|e| e.to_string())?;
    let symbols = tones::from_payload(mode, &payload);
    Ok(synth::gfsk(mode, &symbols, f0_hz, sample_rate, 1.0))
}

/// Renders `text` as a transmission in `mode`: phase-continuous GFSK with the base tone at
/// `f0_hz` (100 to 3000 Hz), at `sample_rate` Hz (the AudioContext rate, so no resampling
/// is needed), peak amplitude 1. FT8 lasts 12.64 s, FT4 5.04 s, with the protocol's ramps.
/// Throws for text that does not pack or parameters out of range.
#[wasm_bindgen]
pub fn synthesize(text: &str, mode: &str, f0_hz: f32, sample_rate: u32) -> Result<Vec<f32>, JsError> {
    synthesize_samples(text, mode, f0_hz, sample_rate).map_err(|e| JsError::new(&e))
}

/// The decoder version, from the crate version (`0.1.0`).
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_and_presets_are_checked() {
        assert_eq!(parse_mode("ft8"), Ok(Mode::Ft8));
        assert_eq!(parse_mode(" FT4 "), Ok(Mode::Ft4));
        assert!(parse_mode("JT65").is_err());
        assert!(decode_slot_json(&[], "FT8", "no-such-preset").is_err());
        assert!(decode_slot_json(&[], "WSPR", "baseline").is_err());
        assert_eq!(version(), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn packs_operator_text() {
        assert_eq!(
            pack("cq 9v1ne oj11", "FT8"),
            Packed {
                ok: true,
                text: "CQ 9V1NE OJ11".into(),
                i3n3: "1.0".into(),
                error: None
            }
        );
        assert_eq!(pack("JA1KXM 9V1NE R-14", "FT4").text, "JA1KXM 9V1NE R-14");
        let bad = pack("", "FT8");
        assert!(!bad.ok);
        assert!(bad.error.is_some());
        assert!(!pack("CQ 9V1NE OJ11", "JT65").ok);
        let json: serde_json::Value =
            serde_json::from_str(&pack_message("JA1KXM 9V1NE RR73", "FT8")).expect("json");
        assert_eq!(json["ok"], true);
        assert_eq!(json["error"], serde_json::Value::Null);
    }

    #[test]
    fn synthesis_checks_its_inputs() {
        let ft8 = synthesize_samples("CQ 9V1NE OJ11", "FT8", 1500.0, 48_000).expect("ft8");
        assert_eq!(ft8.len(), 79 * 7680);
        let ft4 = synthesize_samples("CQ 9V1NE OJ11", "FT4", 1500.0, 48_000).expect("ft4");
        assert_eq!(ft4.len(), 105 * 2304);
        assert!(ft8.iter().all(|x| x.abs() <= 1.0));
        assert!(synthesize_samples("CQ 9V1NE OJ11", "FT8", 50.0, 48_000).is_err());
        assert!(synthesize_samples("CQ 9V1NE OJ11", "FT8", 1500.0, 1_000).is_err());
        assert!(synthesize_samples("", "FT8", 1500.0, 48_000).is_err());
    }

    #[test]
    fn rounding_steps() {
        assert_eq!(round(1234.567, 1), 1234.6);
        assert_eq!(round(-0.126, 2), -0.13);
        assert_eq!(
            serde_json::to_string(&round(1234.567, 1)).ok(),
            Some("1234.6".into())
        );
    }
}
