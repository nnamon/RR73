//! RTTY for the app: a streaming receiver, a keyboard transmitter and one-shot encoding.
//!
//! RTTY is continuous, so the receiver keeps its state between calls: the app's RTTY worker
//! creates one [`RttyReceiver`], pushes each 12 kHz capture chunk into it and gets back the
//! characters and status events that chunk completed. Settings travel as JSON in the form of
//! `rr73_rtty::DecoderConfig` and `rr73_rtty::TxConfig`; missing fields take their defaults
//! (45.45 baud, 170 Hz shift, 1.5 stop bits, mark 1585 Hz, US figures, unshift on space).

use rr73_rtty::ita2::{code_for, other_case};
use rr73_rtty::{DecoderConfig, Figures, Modulator, RttyDecoder, RttyEvent, TxConfig, encode};
use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;

/// Parses settings JSON; an empty string gives the defaults.
fn parse<T: DeserializeOwned + Default>(json: &str) -> Result<T, String> {
    if json.trim().is_empty() {
        return Ok(T::default());
    }
    serde_json::from_str(json).map_err(|e| format!("settings: {e}"))
}

fn to_json<T: Serialize + ?Sized>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "[]".to_string())
}

/// Streaming RTTY receiver for 12 kHz mono audio.
///
/// `push` returns a JSON array of events, oldest first, each an object with a `type`:
///
/// - `char`: `{ ch, sample, snr_db, quality, framing_error }`, a received character. CR is
///   `"\r"`, LF `"\n"`, BELL `"\u0007"` and WRU `"\u0005"`.
/// - `case`: `{ sample, case }` with `case` `"letters"` or `"figures"`.
/// - `afc`: `{ sample, mark_hz, space_hz }`, the pair moved or a search found one.
/// - `tone_shift`: `{ sample, shift_hz }`, a search found a pair with another shift.
/// - `signal`: `{ sample, snr_db, squelch_open }`, every 0.51 s.
///
/// `sample` counts input samples at 12 kHz since creation or `reset`; SNR is in dB in
/// 3000 Hz. The same audio gives the same events whatever the block sizes.
#[wasm_bindgen]
pub struct RttyReceiver {
    decoder: RttyDecoder,
}

impl RttyReceiver {
    /// [`RttyReceiver::new`] without the JavaScript error type, for native callers and tests.
    pub fn create(config_json: &str) -> Result<Self, String> {
        let cfg: DecoderConfig = parse(config_json)?;
        let decoder = RttyDecoder::new(cfg).map_err(|e| e.to_string())?;
        Ok(Self { decoder })
    }

    /// [`RttyReceiver::push`] as events, for native callers and tests.
    pub fn push_events(&mut self, samples: &[f32]) -> Vec<RttyEvent> {
        self.decoder.push(samples)
    }
}

#[wasm_bindgen]
impl RttyReceiver {
    /// A receiver with settings as JSON (`DecoderConfig`; `""` or `"{}"` for the defaults).
    /// Throws for malformed JSON or values out of range.
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str) -> Result<RttyReceiver, JsError> {
        Self::create(config_json).map_err(|e| JsError::new(&e))
    }

    /// Decodes a block of mono audio at 12 kHz, of any length, and returns the events it
    /// completed as a JSON array. Non-finite samples count as 0.
    pub fn push(&mut self, samples: &[f32]) -> String {
        to_json(&self.decoder.push(samples))
    }

    /// Returns the characters the framer still holds for its output delay (about 0.33 s), as
    /// a JSON array of events, for the end of a recording or before retuning.
    pub fn flush(&mut self) -> String {
        to_json(&self.decoder.flush())
    }

    /// Moves to the pair with mark at `mark_hz` (a tap on the waterfall's mark line) and
    /// restarts framing. Out-of-range tones are ignored.
    pub fn tune(&mut self, mark_hz: f64) {
        self.decoder.tune(mark_hz);
    }

    /// Searches the last second of audio for the strongest pair centred within `range_hz` of
    /// `near_hz`, in Hz. An `afc` event reports the pair found; without one the receiver stays.
    pub fn find(&mut self, near_hz: f64, range_hz: f64) {
        self.decoder.find(near_hz, range_hz);
    }

    /// Turns frequency tracking on or off.
    pub fn set_afc_tracking(&mut self, on: bool) {
        self.decoder.set_afc_tracking(on);
    }

    /// Clears all state and the sample count; keeps the current tones.
    pub fn reset(&mut self) {
        self.decoder.reset();
    }

    /// Mark tone now, in Hz.
    #[wasm_bindgen(getter)]
    pub fn mark_hz(&self) -> f64 {
        self.decoder.mark_hz()
    }

    /// Space tone now, in Hz.
    #[wasm_bindgen(getter)]
    pub fn space_hz(&self) -> f64 {
        self.decoder.space_hz()
    }

    /// Shift now, in Hz.
    #[wasm_bindgen(getter)]
    pub fn shift_hz(&self) -> f64 {
        self.decoder.shift_hz()
    }

    /// Latest SNR of the pair, in dB in 3000 Hz.
    #[wasm_bindgen(getter)]
    pub fn snr_db(&self) -> f64 {
        self.decoder.snr_db()
    }

    /// Input samples taken since creation or the last reset, at 12 kHz.
    #[wasm_bindgen(getter)]
    pub fn samples(&self) -> f64 {
        self.decoder.samples() as f64
    }

    /// The settings the receiver was created with, as JSON.
    pub fn config(&self) -> String {
        to_json(self.decoder.config())
    }
}

/// Keyboard RTTY transmitter: queue text while the audio plays, idle with the diddle when the
/// queue runs dry, and end with `finish`.
#[wasm_bindgen]
pub struct RttyTransmitter {
    modulator: Modulator,
}

impl RttyTransmitter {
    /// [`RttyTransmitter::new`] without the JavaScript error type, for native callers and tests.
    pub fn create(config_json: &str) -> Result<Self, String> {
        let cfg: TxConfig = parse(config_json)?;
        let modulator = Modulator::new(cfg).map_err(|e| e.to_string())?;
        Ok(Self { modulator })
    }
}

#[wasm_bindgen]
impl RttyTransmitter {
    /// A transmitter with settings as JSON (`TxConfig`); set `sample_rate` to the
    /// AudioContext rate, in Hz. Throws for malformed JSON or values out of range.
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str) -> Result<RttyTransmitter, JsError> {
        Self::create(config_json).map_err(|e| JsError::new(&e))
    }

    /// Queues `text`: lower case goes out as upper case, a newline as CR LF. Returns the
    /// number of characters skipped because the figures table has no code for them.
    pub fn push_text(&mut self, text: &str) -> u32 {
        u32::try_from(self.modulator.push_text(text)).unwrap_or(u32::MAX)
    }

    /// Renders up to `max_samples` samples at the configured rate. Fewer come back only when
    /// the transmission has ended.
    pub fn render(&mut self, max_samples: u32) -> Vec<f32> {
        let mut out = vec![0.0f32; max_samples.min(1 << 22) as usize];
        let n = self.modulator.render(&mut out);
        out.truncate(n);
        out
    }

    /// Sends the queued text and the postamble, then ramps down and stops.
    pub fn finish(&mut self) {
        self.modulator.finish();
    }

    /// True once the transmission has ramped down after `finish`.
    #[wasm_bindgen(getter)]
    pub fn is_done(&self) -> bool {
        self.modulator.is_done()
    }

    /// Audio still queued, in seconds.
    #[wasm_bindgen(getter)]
    pub fn queued_s(&self) -> f64 {
        self.modulator.queued_s()
    }
}

/// [`rtty_encode`] without the JavaScript error type, for native callers and tests.
pub fn rtty_encode_samples(text: &str, config_json: &str) -> Result<Vec<f32>, String> {
    let cfg: TxConfig = parse(config_json)?;
    encode(text, &cfg).map_err(|e| e.to_string())
}

/// Renders `text` as one transmission (mark lead, LTRS preamble, text, postamble, ramps) at
/// the configured `sample_rate`, with settings as JSON (`TxConfig`). Characters without a code
/// are skipped. Throws for malformed JSON or values out of range.
#[wasm_bindgen]
pub fn rtty_encode(text: &str, config_json: &str) -> Result<Vec<f32>, JsError> {
    rtty_encode_samples(text, config_json).map_err(|e| JsError::new(&e))
}

/// The characters in `text` that RTTY cannot send with the `figures` table (`"us"` or
/// `"ita2"`; anything else means US), each once, in order of appearance.
#[wasm_bindgen]
pub fn rtty_unsendable(text: &str, figures: &str) -> String {
    let table = figures_of(figures);
    let mut out = String::new();
    for ch in text.chars() {
        if code_for(ch, table).is_none() && !out.contains(ch) {
            out.push(ch);
        }
    }
    out
}

/// `text` read in the other case with the `figures` table (`"us"` or `"ita2"`; anything else
/// means US): letters as figures and figures as letters, so "QWU" gives "127". Space, CR, LF and
/// characters with no reading in the other case are kept.
#[wasm_bindgen]
pub fn rtty_other_case(text: &str, figures: &str) -> String {
    other_case(text, figures_of(figures))
}

fn figures_of(figures: &str) -> Figures {
    if figures.eq_ignore_ascii_case("ita2") {
        Figures::Ita2
    } else {
        Figures::Us
    }
}

/// Default receiver and transmitter settings as JSON: `{ "decoder": {...}, "tx": {...} }`.
#[wasm_bindgen]
pub fn rtty_defaults() -> String {
    #[derive(Serialize)]
    struct Defaults {
        decoder: DecoderConfig,
        tx: TxConfig,
    }
    to_json(&Defaults {
        decoder: DecoderConfig::default(),
        tx: TxConfig::default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chars(events: &[RttyEvent]) -> String {
        events
            .iter()
            .filter_map(|e| match e {
                RttyEvent::Char { ch, .. } => Some(*ch),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn transmitter_and_receiver_round_trip_in_chunks() {
        let mut tx = RttyTransmitter::create(r#"{"sample_rate": 12000}"#).expect("tx");
        assert_eq!(tx.push_text("cq test 9v1ne 599 001\n"), 0);
        tx.finish();
        let mut audio = Vec::new();
        while !tx.is_done() {
            audio.extend(tx.render(4096));
        }
        assert!(tx.render(4096).is_empty());
        let mut rx = RttyReceiver::create("{}").expect("rx");
        let mut events = Vec::new();
        for chunk in audio.chunks(512) {
            events.extend(rx.push_events(chunk));
        }
        events.extend(rx.decoder.flush());
        assert_eq!(chars(&events), "CQ TEST 9V1NE 599 001\r\n");
        assert!((rx.mark_hz() - 1585.0).abs() < 1.0, "{}", rx.mark_hz());
        assert_eq!(rx.samples(), audio.len() as f64);
    }

    #[test]
    fn events_are_json_objects_with_a_type() {
        let audio = rtty_encode_samples("RYRY\n", "").expect("encode");
        let mut rx = RttyReceiver::create("").expect("rx");
        let mut json: Vec<serde_json::Value> = serde_json::from_str(&rx.push(&audio)).expect("json");
        json.extend(serde_json::from_str::<Vec<serde_json::Value>>(&rx.flush()).expect("json"));
        let text: String = json
            .iter()
            .filter(|e| e["type"] == "char")
            .filter_map(|e| e["ch"].as_str())
            .collect();
        assert_eq!(text, "RYRY\r\n");
        assert!(json.iter().all(|e| e["sample"].is_u64()));
        assert_eq!(rx.push(&[]), "[]");
    }

    #[test]
    fn settings_are_checked() {
        assert!(RttyReceiver::create(r#"{"params":{"baud":1000}}"#).is_err());
        assert!(RttyReceiver::create("{nope").is_err());
        let rx = RttyReceiver::create(r#"{"params":{"shift_hz":850},"mark_hz":2125}"#).expect("rx");
        assert_eq!(rx.space_hz(), 1275.0);
        assert!(rx.config().contains("850"));
        assert!(RttyTransmitter::create(r#"{"sample_rate":4000}"#).is_err());
        assert!(rtty_encode_samples("CQ", r#"{"amplitude":2}"#).is_err());
        let at_48k = rtty_encode_samples("CQ", r#"{"sample_rate":48000}"#).expect("encode");
        let at_12k = rtty_encode_samples("CQ", "").expect("encode");
        assert!((at_48k.len() as f64 / at_12k.len() as f64 - 4.0).abs() < 0.01);
        let defaults: serde_json::Value = serde_json::from_str(&rtty_defaults()).expect("json");
        assert_eq!(defaults["decoder"]["mark_hz"], 1585.0);
        assert_eq!(defaults["tx"]["params"]["baud"], 45.45);
    }

    #[test]
    fn other_case_follows_the_figures_table() {
        assert_eq!(rtty_other_case("TOO QWU", "us"), "599 127");
        assert_eq!(rtty_other_case("F", "us"), "!");
        assert_eq!(rtty_other_case("F", "ITA2"), "F");
        assert_eq!(rtty_other_case("S", "ita2"), "'");
    }

    #[test]
    fn unsendable_characters_depend_on_the_figures_table() {
        assert_eq!(rtty_unsendable("cq de 9v1ne\n", "us"), "");
        assert_eq!(rtty_unsendable("5 + 5 = 10 @ 3% @", "us"), "+=@%");
        assert_eq!(rtty_unsendable("5 + 5 = 10 @ 3% @", "ita2"), "@%");
        assert_eq!(rtty_unsendable("$1 & #2", "ITA2"), "$&#");
    }
}
