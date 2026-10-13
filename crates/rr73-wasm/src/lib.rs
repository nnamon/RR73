//! WebAssembly bindings for the RR73 app.
//!
//! The app's decoder workers call [`decode_slot`] once per slot. Each worker keeps one
//! decoder context, so FFT plans and buffers are allocated on the first call and callsign
//! hashes learnt from earlier slots resolve hashed callsigns in later ones.
//!
//! [`decode_partial`] decodes the start of a slot still being received (early decoding).
//! [`DecoderSession`] decodes a slot stage by stage in small steps, so a worker can run
//! deeper stages after the slot ends and stop between steps when the next slot needs it.

use std::cell::RefCell;

use rr73_decode::{Decode, DecodeContext, DecodeSession, DecoderConfig, SlotAudio, Stage, decode};
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

impl<'a> AppDecode<'a> {
    fn new(d: &'a Decode) -> Self {
        Self {
            text: &d.text,
            freq_hz: round(d.freq_hz, 1),
            dt_s: round(d.dt_s, 2),
            snr_db: round(d.snr_db, 1),
        }
    }
}

fn decodes_json(decodes: &[Decode]) -> Result<String, String> {
    let out: Vec<AppDecode<'_>> = decodes.iter().map(AppDecode::new).collect();
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

fn decode_json(samples: &[f32], mode: &str, preset: &str, partial: bool) -> Result<String, String> {
    let mode = parse_mode(mode)?;
    let config = DecoderConfig::preset(preset).map_err(|e| e.to_string())?;
    let audio = if partial {
        SlotAudio::partial(samples, mode)
    } else {
        SlotAudio::new(samples, mode)
    };
    let report = CONTEXT.with(|ctx| decode(&audio, &config, &mut ctx.borrow_mut()));
    decodes_json(&report.decodes)
}

/// [`decode_slot`] without the JavaScript error type, for native callers and tests.
pub fn decode_slot_json(samples: &[f32], mode: &str, preset: &str) -> Result<String, String> {
    decode_json(samples, mode, preset, false)
}

/// [`decode_partial`] without the JavaScript error type, for native callers and tests.
pub fn decode_partial_json(samples: &[f32], mode: &str, preset: &str) -> Result<String, String> {
    decode_json(samples, mode, preset, true)
}

/// Decodes one slot of mono audio at 12 kHz (sample 0 at the slot start) with a decoder
/// preset such as `baseline`. Returns a JSON array of
/// `{ "text", "freq_hz", "dt_s", "snr_db" }` objects in decode order. Throws for an unknown
/// mode or preset; never throws for sample values.
#[wasm_bindgen]
pub fn decode_slot(samples: &[f32], mode: &str, preset: &str) -> Result<String, JsError> {
    decode_slot_json(samples, mode, preset).map_err(|e| JsError::new(&e))
}

/// Decodes the start of a slot still being received: `samples` run from the slot start to
/// now (for example the first 11.8 s of an FT8 slot), at 12 kHz. Symbols after the last
/// sample count as missing. Returns the same JSON as [`decode_slot`]. A later full-slot
/// decode finds these messages again; the app matches them by text.
#[wasm_bindgen]
pub fn decode_partial(samples: &[f32], mode: &str, preset: &str) -> Result<String, JsError> {
    decode_partial_json(samples, mode, preset).map_err(|e| JsError::new(&e))
}

/// One slot decoded stage by stage. Create it when the slot ends, call [`DecoderSession::step`]
/// or [`DecoderSession::next_stage`] while there is time, and free it when the next slot
/// needs the worker. Every stage returns only messages that earlier stages did not.
///
/// The session borrows the worker's decoder context (callsign hashes and buffers) and gives
/// it back when it finishes or is freed, so free it (`session.free()` in JavaScript) when
/// done with it.
#[wasm_bindgen]
pub struct DecoderSession {
    /// `None` once every stage has run and the context went back to the worker.
    inner: Option<DecodeSession>,
    stages: usize,
}

/// What one [`DecoderSession::step`] did, as JSON.
#[derive(Debug, Serialize)]
struct AppStep<'a> {
    /// New decodes found by the step.
    decodes: Vec<AppDecode<'a>>,
    /// Stage the step worked on, from 0.
    stage: usize,
    /// `true` when the step finished its stage.
    stage_done: bool,
    /// `true` when every stage has run.
    done: bool,
}

impl DecoderSession {
    /// [`DecoderSession::new`] without the JavaScript error type.
    pub fn create(samples: &[f32], mode: &str, plan: &str) -> Result<Self, String> {
        let mode = parse_mode(mode)?;
        let stages = Stage::plan(plan).map_err(|e| e.to_string())?;
        if stages.is_empty() {
            return Err("the plan names no stage".into());
        }
        let ctx = CONTEXT.with(|c| std::mem::take(&mut *c.borrow_mut()));
        let session = DecodeSession::with_context(&SlotAudio::new(samples, mode), stages, ctx);
        Ok(Self {
            stages: session.stage_count(),
            inner: Some(session),
        })
    }

    /// [`DecoderSession::step`] without the JavaScript error type.
    pub fn step_json(&mut self) -> Result<String, String> {
        let Some(session) = self.inner.as_mut() else {
            return serde_json::to_string(&AppStep {
                decodes: Vec::new(),
                stage: self.stages,
                stage_done: true,
                done: true,
            })
            .map_err(|e| e.to_string());
        };
        let out = session.step();
        let json = serde_json::to_string(&AppStep {
            decodes: out.decodes.iter().map(AppDecode::new).collect(),
            stage: out.stage,
            stage_done: out.stage_done,
            done: out.done,
        })
        .map_err(|e| e.to_string());
        if out.done {
            self.release();
        }
        json
    }

    /// [`DecoderSession::next_stage`] without the JavaScript error type.
    pub fn next_stage_json(&mut self) -> Result<Option<String>, String> {
        let Some(found) = self.inner.as_mut().and_then(DecodeSession::next_stage) else {
            self.release();
            return Ok(None);
        };
        if self.inner.as_ref().is_some_and(DecodeSession::is_done) {
            self.release();
        }
        decodes_json(&found).map(Some)
    }

    /// Gives the decoder context back to the worker.
    fn release(&mut self) {
        if let Some(session) = self.inner.take() {
            let ctx = session.into_context();
            CONTEXT.with(|c| *c.borrow_mut() = ctx);
        }
    }
}

#[wasm_bindgen]
impl DecoderSession {
    /// A session over one slot of mono audio at 12 kHz (sample 0 at the slot start).
    /// `plan` lists the stages, separated by `;`: each is a preset name followed by
    /// `key=value` overrides, such as `"subtract-3-osd2; subtract-3-osd2
    /// spectrogram.time_osr=4"`. Throws for an unknown mode, preset or key, or an empty plan.
    #[wasm_bindgen(constructor)]
    pub fn new(samples: &[f32], mode: &str, plan: &str) -> Result<DecoderSession, JsError> {
        Self::create(samples, mode, plan).map_err(|e| JsError::new(&e))
    }

    /// Does one bounded unit of work and returns JSON
    /// `{ "decodes": [...], "stage", "stage_done", "done" }`, with decodes as in
    /// [`decode_slot`].
    pub fn step(&mut self) -> Result<String, JsError> {
        self.step_json().map_err(|e| JsError::new(&e))
    }

    /// Runs the current stage to its end and returns its new decodes as JSON (as in
    /// [`decode_slot`]), or `undefined` when every stage has run.
    pub fn next_stage(&mut self) -> Result<Option<String>, JsError> {
        self.next_stage_json().map_err(|e| JsError::new(&e))
    }

    /// `true` when every stage has run.
    #[wasm_bindgen(getter)]
    pub fn done(&self) -> bool {
        self.inner.as_ref().is_none_or(DecodeSession::is_done)
    }

    /// Index of the stage the next step works on, from 0 (the stage count when done).
    #[wasm_bindgen(getter)]
    pub fn stage(&self) -> usize {
        self.inner.as_ref().map_or(self.stages, DecodeSession::stage)
    }

    /// Number of stages in the plan.
    #[wasm_bindgen(getter)]
    pub fn stage_count(&self) -> usize {
        self.stages
    }
}

impl Drop for DecoderSession {
    fn drop(&mut self) {
        self.release();
    }
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
