//! WebAssembly bindings for the RR73 app.
//!
//! The app's decoder workers call [`decode_slot`] once per slot. Each worker keeps one
//! decoder context, so FFT plans and buffers are allocated on the first call and callsign
//! hashes learnt from earlier slots resolve hashed callsigns in later ones.
//!
//! [`decode_partial`] decodes the start of a slot still being received (early decoding).
//! [`DecoderSession`] decodes a slot stage by stage in small steps, so a worker can run
//! deeper stages after the slot ends and stop between steps when the next slot needs it.
//!
//! For transmitting, [`pack_message`] checks operator text and gives its canonical form, and
//! [`synthesize`] renders a message as GFSK audio at the audio output's sample rate.
//!
//! WSPR has its own entry points: [`decode_wspr`] for a 120 s slot, [`pack_wspr`] and
//! [`synthesize_wspr`]. The WSPR decoder keeps its own context per worker, so callsigns from
//! type 1 and type 2 messages resolve the hashed callsigns of type 3 messages in later slots.
//!
//! RTTY, a continuous mode, has its own streaming exports in [`rtty`].
//!
//! Rig control has its own exports in [`cat`]: CI-V requests to bytes, and bytes from the radio
//! to events.

use std::cell::RefCell;

use rr73_decode::wspr::{WsprConfig, WsprContext, decode_wspr as run_wspr};
use rr73_decode::{Decode, DecodeContext, DecodeSession, DecoderConfig, SlotAudio, Stage, decode};
use rr73_ft8::{CallsignHashes, Message, Mode, message, synth, tones};
use serde::Serialize;
use wasm_bindgen::prelude::*;

pub mod cat;
pub mod rtty;

thread_local! {
    static CONTEXT: RefCell<DecodeContext> = RefCell::new(DecodeContext::new());
    static WSPR_CONTEXT: RefCell<WsprContext> = RefCell::new(WsprContext::new());
}

#[wasm_bindgen]
extern "C" {
    /// `performance.now()`: milliseconds since the worker's time origin.
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

/// Times the decoder's stages with `performance.now()`, for measurement tools
/// (`tools/wasm-cost`). Without this call the stage timings read zero. Each timed step reads
/// the clock a few times, which adds to the decoding time, so the app does not call it.
#[wasm_bindgen]
pub fn enable_stage_timings() {
    rr73_decode::set_clock(|| performance_now() / 1000.0);
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
    /// For a priori decodes, the knowledge that found it (`my`, `my_dx`, `rrr`, `rr73`,
    /// `seventy_three`).
    #[serde(skip_serializing_if = "Option::is_none")]
    ap: Option<rr73_decode::ApKind>,
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
            ap: d.ap,
        }
    }
}

/// Sets the QSO under way for a priori decoding of the slots decoded after it: the operator's
/// callsign, and the other station's callsign and audio frequency (tone 0, Hz) during a QSO.
/// An empty `my_call` turns a priori decoding off; an empty `dx_call` or a `dx_hz` that is not
/// a positive number leaves those out.
#[wasm_bindgen]
pub fn set_qso_context(my_call: &str, dx_call: &str, dx_hz: f32) {
    let ap = (!my_call.trim().is_empty()).then(|| rr73_decode::ApContext {
        my_call: my_call.trim().to_string(),
        dx_call: (!dx_call.trim().is_empty()).then(|| dx_call.trim().to_string()),
        dx_hz: (dx_hz.is_finite() && dx_hz > 0.0).then_some(dx_hz),
    });
    CONTEXT.with(|c| c.borrow_mut().ap = ap);
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
    /// The timings as JSON when the session finished, kept for [`DecoderSession::timings`].
    finished: Option<String>,
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
        Self::create_with(samples, mode, plan, false)
    }

    /// [`DecoderSession::partial`] without the JavaScript error type.
    pub fn create_partial(samples: &[f32], mode: &str, plan: &str) -> Result<Self, String> {
        Self::create_with(samples, mode, plan, true)
    }

    fn create_with(samples: &[f32], mode: &str, plan: &str, partial: bool) -> Result<Self, String> {
        let mode = parse_mode(mode)?;
        let stages = Stage::plan(plan).map_err(|e| e.to_string())?;
        if stages.is_empty() {
            return Err("the plan names no stage".into());
        }
        let audio = if partial {
            SlotAudio::partial(samples, mode)
        } else {
            SlotAudio::new(samples, mode)
        };
        let ctx = CONTEXT.with(|c| std::mem::take(&mut *c.borrow_mut()));
        let session = DecodeSession::with_context(&audio, stages, ctx);
        Ok(Self {
            stages: session.stage_count(),
            inner: Some(session),
            finished: None,
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
            self.finished = Some(timings_of(&session));
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

    /// As [`DecoderSession::new`] for the start of a slot still being received, as
    /// [`decode_partial`] reads it: symbols after the last sample count as missing. For
    /// measurement tools (`tools/wasm-cost`), which time the early pass stage by stage.
    pub fn partial(samples: &[f32], mode: &str, plan: &str) -> Result<DecoderSession, JsError> {
        Self::create_partial(samples, mode, plan).map_err(|e| JsError::new(&e))
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

    /// Time so far as JSON `{ "stages": { "spectrogram_s", "search_s", "refine_s", "demod_s",
    /// "ldpc_s", "validate_s", "subtract_s", "total_s" }, "stage_s": [...] }`, in seconds, by
    /// pipeline stage and by plan stage. All zero unless [`enable_stage_timings`] was called.
    pub fn timings(&self) -> String {
        self.timings_json()
    }
}

impl DecoderSession {
    /// [`DecoderSession::timings`] for native callers and tests.
    pub fn timings_json(&self) -> String {
        match (&self.inner, &self.finished) {
            (Some(session), _) => timings_of(session),
            (None, Some(json)) => json.clone(),
            (None, None) => "{}".into(),
        }
    }
}

fn timings_of(session: &DecodeSession) -> String {
    serde_json::json!({
        "stages": session.report().timings,
        "stage_s": session.stage_seconds(),
    })
    .to_string()
}

impl Drop for DecoderSession {
    fn drop(&mut self) {
        self.release();
    }
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

/// One WSPR decode as the app receives it.
#[derive(Debug, Serialize)]
struct WsprAppDecode<'a> {
    /// Message text as WSJT-X shows it.
    text: &'a str,
    /// Signal centre (midway between tones 1 and 2), in Hz of audio, to 0.1 Hz.
    freq_hz: f64,
    /// DT from the nominal start (1 s into the slot), in seconds, to 0.01 s.
    dt_s: f64,
    /// Drift, in Hz per second, to 0.001 Hz/s.
    drift_hz_per_s: f64,
    /// SNR in 2500 Hz, in dB, to 0.1 dB.
    snr_db: f64,
}

/// [`decode_wspr`] without the JavaScript error type, for native callers and tests.
pub fn decode_wspr_json(samples: &[f32], preset: &str) -> Result<String, String> {
    let config = WsprConfig::preset(preset).map_err(|e| e.to_string())?;
    let report = WSPR_CONTEXT.with(|ctx| run_wspr(samples, &config, &mut ctx.borrow_mut()));
    let out: Vec<WsprAppDecode<'_>> = report
        .decodes
        .iter()
        .map(|d| WsprAppDecode {
            text: &d.text,
            freq_hz: round(d.freq_hz, 1),
            dt_s: round(d.dt_s, 2),
            drift_hz_per_s: round(d.drift_hz_per_s, 3),
            snr_db: round(d.snr_db, 1),
        })
        .collect();
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// Decodes one WSPR slot: 120 s of mono audio at 12 kHz (1 440 000 samples), sample 0 at the
/// start of an even UTC minute, with a WSPR preset (`wspr` or `wspr-deep`). Shorter audio is
/// padded with silence. Returns a JSON array of `{ "text", "freq_hz", "dt_s",
/// "drift_hz_per_s", "snr_db" }` objects in decode order; `freq_hz` is the signal centre.
/// Throws for an unknown preset; never throws for sample values.
#[wasm_bindgen]
pub fn decode_wspr(samples: &[f32], preset: &str) -> Result<String, JsError> {
    decode_wspr_json(samples, preset).map_err(|e| JsError::new(&e))
}

/// The result of checking WSPR text for transmission.
#[derive(Debug, Serialize, PartialEq)]
pub struct WsprPacked {
    /// True when the text packs into a WSPR message.
    pub ok: bool,
    /// The message as it will be decoded at the other end, or the input when `ok` is false.
    pub text: String,
    /// Message type: 1 (callsign, 4-character locator, power), 2 (compound callsign and
    /// power) or 3 (hashed callsign, 6-character locator, power); 0 when `ok` is false.
    pub message_type: u8,
    /// Why the text cannot be sent; `None` when `ok` is true.
    pub error: Option<String>,
}

/// [`pack_wspr`] as a struct, for native callers and tests.
pub fn wspr_pack(text: &str) -> WsprPacked {
    match rr73_wspr::Message::parse(text) {
        Ok(msg) => WsprPacked {
            ok: true,
            text: msg.to_string(),
            message_type: msg.message_type(),
            error: None,
        },
        Err(e) => WsprPacked {
            ok: false,
            text: text.to_string(),
            message_type: 0,
            error: Some(e.to_string()),
        },
    }
}

/// Checks WSPR text for transmission: `K1ABC FN42 37`, `PJ4/K1ABC 33`, `K1ABC/P 33` or
/// `<K1ABC> FN42AB 37` (power in dBm: 0 to 60 ending in 0, 3 or 7). Returns JSON
/// `{ "ok", "text", "message_type", "error" }`.
#[wasm_bindgen]
pub fn pack_wspr(text: &str) -> String {
    serde_json::to_string(&wspr_pack(text)).unwrap_or_else(|_| "{}".to_string())
}

/// Lowest and highest signal centre [`synthesize_wspr`] accepts, in Hz: the 200 Hz WSPR
/// window around 1500 Hz of audio.
pub const WSPR_TX_RANGE_HZ: (f32, f32) = (1400.0, 1600.0);

/// [`synthesize_wspr`] without the JavaScript error type, for native callers and tests.
pub fn synthesize_wspr_samples(text: &str, freq_hz: f32, sample_rate: u32) -> Result<Vec<f32>, String> {
    if !(freq_hz.is_finite() && (WSPR_TX_RANGE_HZ.0..=WSPR_TX_RANGE_HZ.1).contains(&freq_hz)) {
        return Err(format!(
            "signal centre {freq_hz} Hz is outside the WSPR window, 1400 to 1600 Hz"
        ));
    }
    if !(8_000..=192_000).contains(&sample_rate) {
        return Err(format!(
            "sample rate {sample_rate} Hz is outside 8000 to 192000 Hz"
        ));
    }
    let msg = rr73_wspr::Message::parse(text).map_err(|e| e.to_string())?;
    let symbols = rr73_wspr::channel_symbols(&msg).map_err(|e| e.to_string())?;
    Ok(rr73_wspr::synth::fsk(
        &symbols,
        f64::from(freq_hz),
        0.0,
        sample_rate,
        1.0,
    ))
}

/// Renders WSPR `text` as one transmission: phase-continuous 4-FSK, 1.4648 Hz tone spacing,
/// 162 symbols, 110.6 s, with the signal centre at `freq_hz` (1400 to 1600 Hz), at
/// `sample_rate` Hz (the AudioContext rate), peak amplitude 1 and 20 ms ramps. Transmission
/// starts 1 s into an even UTC minute. Throws for text that does not pack or parameters out
/// of range.
#[wasm_bindgen]
pub fn synthesize_wspr(text: &str, freq_hz: f32, sample_rate: u32) -> Result<Vec<f32>, JsError> {
    synthesize_wspr_samples(text, freq_hz, sample_rate).map_err(|e| JsError::new(&e))
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
    fn wspr_pack_and_synthesis_check_their_inputs() {
        assert_eq!(
            wspr_pack("k1abc fn42 37"),
            WsprPacked {
                ok: true,
                text: "K1ABC FN42 37".into(),
                message_type: 1,
                error: None
            }
        );
        assert_eq!(wspr_pack("PJ4/K1ABC 33").message_type, 2);
        assert_eq!(wspr_pack("<K1ABC> FN42AB 37").message_type, 3);
        let bad = wspr_pack("K1ABC FN42 31");
        assert!(!bad.ok && bad.error.is_some());
        let json: serde_json::Value = serde_json::from_str(&pack_wspr("K1ABC FN42 37")).expect("json");
        assert_eq!(json["ok"], true);
        let audio = synthesize_wspr_samples("K1ABC FN42 37", 1500.0, 48_000).expect("audio");
        assert_eq!(audio.len(), 4 * 1_327_104);
        assert!(audio.iter().all(|x| x.abs() <= 1.0));
        assert!(synthesize_wspr_samples("K1ABC FN42 37", 1700.0, 48_000).is_err());
        assert!(synthesize_wspr_samples("K1ABC FN42 37", 1500.0, 1_000).is_err());
        assert!(synthesize_wspr_samples("K1ABC FN42 31", 1500.0, 48_000).is_err());
        assert!(decode_wspr_json(&[], "baseline").is_err());
        assert_eq!(decode_wspr_json(&[], "wspr").as_deref(), Ok("[]"));
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
