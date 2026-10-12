//! WebAssembly bindings for the RR73 app.
//!
//! The app's decoder workers call [`decode_slot`] once per slot. Each worker keeps one
//! decoder context, so FFT plans and buffers are allocated on the first call and callsign
//! hashes learnt from earlier slots resolve hashed callsigns in later ones.

use std::cell::RefCell;

use rr73_decode::{DecodeContext, DecoderConfig, SlotAudio, decode};
use rr73_ft8::Mode;
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
    fn rounding_steps() {
        assert_eq!(round(1234.567, 1), 1234.6);
        assert_eq!(round(-0.126, 2), -0.13);
        assert_eq!(
            serde_json::to_string(&round(1234.567, 1)).ok(),
            Some("1234.6".into())
        );
    }
}
