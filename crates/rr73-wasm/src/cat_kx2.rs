//! Rig control for the app: Elecraft's text commands for the KX2, from `rr73-cat`.
//!
//! As with the IC-705's exports in [`crate::cat`], the app's serial link writes the bytes
//! [`cat_kx2_encode`] returns and pushes every chunk it reads into one [`CatKx2Parser`]. Requests
//! and events travel as JSON objects with a `type`, in the form of `rr73_cat::elecraft::Request`
//! and `rr73_cat::elecraft::Event`:
//!
//! - in: `{"type": "set_frequency", "hz": 14074000}`, `{"type": "set_mode", "mode": "data"}`,
//!   `{"type": "set_data_sub_mode", "sub": "data_a"}`, `{"type": "set_transmit", "on": true}`,
//!   `{"type": "read_setting", "item": "mic_btn"}` and the rest of `Request`;
//! - out: `{"type": "frequency", "hz": 14074000, "transceive": false}`, `{"type": "transmit",
//!   "on": true}`, `{"type": "busy"}`, `{"type": "info", ...}`, `{"type": "noise", "bytes": 12}`
//!   and the rest of `Event`.
//!
//! A set has no answer of its own on the KX2, so each set request carries the read that checks
//! it, and [`cat_kx2_accepts`] says whether the read-back shows the set taken.

use rr73_cat::elecraft::{DataSubMode, Event, Mode, Parser, Request};
use rr73_cat::sim_kx2::SimKx2;
use wasm_bindgen::prelude::*;

fn request(json: &str) -> Result<Request, String> {
    serde_json::from_str(json).map_err(|e| format!("request: {e}"))
}

fn event(json: &str) -> Result<Event, String> {
    serde_json::from_str(json).map_err(|e| format!("event: {e}"))
}

/// [`cat_kx2_encode`] without the JavaScript error type, for native callers and tests.
pub fn cat_kx2_encode_bytes(request_json: &str) -> Result<Vec<u8>, String> {
    request(request_json)?.encode().map_err(|e| e.to_string())
}

/// The bytes of one request (JSON, as `rr73_cat::elecraft::Request`), as a `Uint8Array` to write
/// to the port. Throws for malformed JSON or a frequency of more than 11 digits.
#[wasm_bindgen]
pub fn cat_kx2_encode(request_json: &str) -> Result<Vec<u8>, JsError> {
    cat_kx2_encode_bytes(request_json).map_err(|e| JsError::new(&e))
}

/// [`cat_kx2_answers`] without the JavaScript error type, for native callers and tests.
pub fn cat_kx2_answers_json(request_json: &str, event_json: &str) -> Result<bool, String> {
    Ok(request(request_json)?.answered_by(&event(event_json)?))
}

/// True when the event (JSON, as one element of [`CatKx2Parser::push`]'s array) answers the
/// request (JSON): the read of its command, `?;`, or a garbled answer of its command. Throws for
/// malformed JSON.
#[wasm_bindgen]
pub fn cat_kx2_answers(request_json: &str, event_json: &str) -> Result<bool, JsError> {
    cat_kx2_answers_json(request_json, event_json).map_err(|e| JsError::new(&e))
}

/// [`cat_kx2_accepts`] without the JavaScript error type, for native callers and tests.
pub fn cat_kx2_accepts_json(request_json: &str, event_json: &str) -> Result<bool, String> {
    Ok(request(request_json)?.accepted_by(&event(event_json)?))
}

/// True when the event answers the request and the radio did what it asked: the data for a read,
/// a read-back equal to the set for a set (VFO A to 10 Hz). False for `?;` and garbled answers.
/// Throws for malformed JSON.
#[wasm_bindgen]
pub fn cat_kx2_accepts(request_json: &str, event_json: &str) -> Result<bool, JsError> {
    cat_kx2_accepts_json(request_json, event_json).map_err(|e| JsError::new(&e))
}

/// Streaming reader for one serial link to a KX2. Push each chunk the port delivers, in any sizes.
#[wasm_bindgen]
pub struct CatKx2Parser {
    parser: Parser,
}

impl Default for CatKx2Parser {
    fn default() -> Self {
        Self::new()
    }
}

impl CatKx2Parser {
    /// [`CatKx2Parser::push`] as events, for native callers and tests.
    pub fn push_events(&mut self, bytes: &[u8]) -> Vec<Event> {
        self.parser.push(bytes)
    }
}

#[wasm_bindgen]
impl CatKx2Parser {
    /// A parser with nothing held.
    #[wasm_bindgen(constructor)]
    pub fn new() -> CatKx2Parser {
        CatKx2Parser {
            parser: Parser::new(),
        }
    }

    /// Reads bytes from the port and returns the events they complete as a JSON array, oldest
    /// first. Never throws for any bytes.
    pub fn push(&mut self, bytes: &[u8]) -> String {
        serde_json::to_string(&self.parser.push(bytes)).unwrap_or_else(|_| "[]".to_string())
    }

    /// Forgets an answer in progress, as after reopening the port.
    pub fn reset(&mut self) {
        self.parser.reset();
    }
}

/// The simulated KX2 of `rr73_cat::sim_kx2`, behind a Digirig, for the app's unit tests: a fake
/// serial port answers the app's commands with [`CatKx2SimForTests::receive`]. The app never uses
/// it. Its choices where the documents are silent are listed in `rr73_cat::sim_kx2`.
#[wasm_bindgen]
pub struct CatKx2SimForTests {
    sim: SimKx2,
}

impl Default for CatKx2SimForTests {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl CatKx2SimForTests {
    /// A KX2 on 14.074 MHz USB, data sub-mode DATA A, receiving, MIC BTN PTT UP.DN, with the
    /// Digirig's PTT line on its MIC jack.
    #[wasm_bindgen(constructor)]
    pub fn new() -> CatKx2SimForTests {
        CatKx2SimForTests { sim: SimKx2::new() }
    }

    /// Reads bytes from the app and returns the radio's answers.
    pub fn receive(&mut self, bytes: &[u8]) -> Vec<u8> {
        self.sim.receive(bytes)
    }

    /// The operator turns VFO A to `hz` (Hz). Returns what auto-info sends, if anything.
    pub fn turn_dial(&mut self, hz: u32) -> Vec<u8> {
        self.sim.turn_dial(u64::from(hz))
    }

    /// The operator picks a mode (JSON string, as `"data"`). Returns what auto-info sends, or
    /// nothing for a mode the reference does not list.
    pub fn press_mode(&mut self, mode_json: &str) -> Vec<u8> {
        match serde_json::from_str::<Mode>(mode_json) {
            Ok(m) => self.sim.press_mode(m),
            Err(_) => Vec::new(),
        }
    }

    /// The operator picks a data sub-mode (JSON string, as `"fsk_d"`).
    pub fn press_sub(&mut self, sub_json: &str) {
        if let Ok(s) = serde_json::from_str::<DataSubMode>(sub_json) {
            self.sim.sub = s;
        }
    }

    /// The operator opens a menu entry, or leaves the menu with 255.
    pub fn open_menu(&mut self, entry: u16) {
        self.sim.open_menu(entry);
    }

    /// MIC BTN as `MP` gives it: bit 0 PTT, bit 2 UP and DN.
    #[wasm_bindgen(getter)]
    pub fn mic_btn(&self) -> u16 {
        self.sim.mic_btn
    }

    /// Sets MIC BTN on the radio's screen.
    #[wasm_bindgen(setter)]
    pub fn set_mic_btn(&mut self, v: u16) {
        self.sim.mic_btn = v & 0xFF;
    }

    /// VOX in DATA A and AFSK A.
    pub fn set_vox_data(&mut self, on: bool) {
        self.sim.vox_data = on;
    }

    /// Auto-info mode, 0 to 3, as the AUTOINF menu entry or `AI` sets it.
    pub fn set_auto_info(&mut self, n: u8) {
        self.sim.auto_info = n.min(3);
    }

    /// The product number `OM` gives: 1 for the KX2, 2 for the KX3.
    pub fn set_product(&mut self, n: u8) {
        self.sim.product = n.min(99);
    }

    /// The Digirig's PTT line reaches the MIC jack's ring, as Digirig's KX cable wires it.
    pub fn set_digirig_ptt(&mut self, on: bool) {
        self.sim.digirig_ptt = on;
    }

    /// The app sets the Digirig's DTR and RTS lines, as opening a port and `setSignals` do.
    pub fn set_lines(&mut self, dtr: bool, rts: bool) {
        self.sim.set_lines(dtr, rts);
    }

    /// True while the radio transmits, on `TX` or on the Digirig's PTT through the MIC jack.
    #[wasm_bindgen(getter)]
    pub fn transmit(&self) -> bool {
        self.sim.transmitting()
    }

    /// The operator keys or unkeys the radio with its own XMIT switch.
    pub fn press_xmit(&mut self, on: bool) {
        self.sim.transmit = on;
    }

    /// `FA`, `MD` and `DT` sets that arrived while the radio transmitted.
    #[wasm_bindgen(getter)]
    pub fn sets_while_transmitting(&self) -> u32 {
        u32::try_from(self.sim.sets_while_transmitting.len()).unwrap_or(u32::MAX)
    }

    /// VFO A, Hz.
    #[wasm_bindgen(getter)]
    pub fn frequency(&self) -> u32 {
        u32::try_from(self.sim.hz).unwrap_or(u32::MAX)
    }

    /// The mode as `MD` reports it, as JSON: `"data"`, or `"data-rev"` with the present pair
    /// reversed.
    #[wasm_bindgen(getter)]
    pub fn mode(&self) -> String {
        serde_json::to_string(&self.sim.reported_mode()).unwrap_or_default()
    }

    /// Puts DATA A and PSK D on the reverse sideband, or back.
    pub fn set_rev_data_a(&mut self, on: bool) {
        self.sim.rev_data_a = on;
    }

    /// Sets the K2 command mode, 0 to 3, as another program may leave it.
    pub fn set_k2_mode(&mut self, n: u8) {
        self.sim.k2_mode = n.min(3);
    }

    /// Sets the receive filter's bandwidth, Hz.
    pub fn set_bandwidth(&mut self, hz: u32) {
        self.sim.bandwidth_hz = hz - hz % 10;
    }

    /// Turns split on or off.
    pub fn set_split(&mut self, on: bool) {
        self.sim.split = on;
    }

    /// Turns XIT on or off at `offset_hz`.
    pub fn set_xit(&mut self, on: bool, offset_hz: i32) {
        self.sim.xit = on;
        self.sim.offset_hz = offset_hz.clamp(-9999, 9999);
    }

    /// Turns RIT on or off. RIT and XIT share the offset `set_xit` sets.
    pub fn set_rit(&mut self, on: bool) {
        self.sim.rit = on;
    }

    /// The data sub-mode as JSON, as `"data_a"`.
    #[wasm_bindgen(getter)]
    pub fn sub(&self) -> String {
        serde_json::to_string(&self.sim.sub).unwrap_or_default()
    }

    /// The menu entry on the radio's screen, 255 with none.
    #[wasm_bindgen(getter)]
    pub fn menu(&self) -> u16 {
        self.sim.menu
    }

    /// Every command received, as text without semicolons, joined by `;`.
    #[wasm_bindgen(getter)]
    pub fn received(&self) -> String {
        self.sim.received.join(";")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_encode_from_json() {
        assert_eq!(
            cat_kx2_encode_bytes(r#"{"type":"set_frequency","hz":14074000}"#),
            Ok(b"FA00014074000;FA;".to_vec())
        );
        assert_eq!(
            cat_kx2_encode_bytes(r#"{"type":"set_transmit","on":true}"#),
            Ok(b"TX;TQ;".to_vec())
        );
        assert_eq!(
            cat_kx2_encode_bytes(r#"{"type":"set_data_sub_mode","sub":"data_a"}"#),
            Ok(b"DT0;DT;".to_vec())
        );
        assert_eq!(
            cat_kx2_encode_bytes(r#"{"type":"read_setting","item":"mic_btn"}"#),
            Ok(b"MN082;MP;MN255;".to_vec())
        );
        assert!(cat_kx2_encode_bytes(r#"{"type":"set_frequency","hz":100000000000}"#).is_err());
        assert!(cat_kx2_encode_bytes(r#"{"type":"set_mode","mode":"rtty"}"#).is_err());
        assert!(cat_kx2_encode_bytes("{").is_err());
    }

    #[test]
    fn the_parser_returns_events_as_json_and_answers_are_matched() {
        let mut radio = SimKx2::new();
        let mut parser = CatKx2Parser::new();
        let reply = radio.receive(b"TX;TQ;");
        let (a, b) = reply.split_at(2);
        assert_eq!(parser.push(a), "[]");
        assert_eq!(parser.push(b), r#"[{"type":"transmit","on":true}]"#);
        let on = r#"{"type":"set_transmit","on":true}"#;
        let off = r#"{"type":"set_transmit","on":false}"#;
        let tq1 = r#"{"type":"transmit","on":true}"#;
        assert_eq!(cat_kx2_answers_json(on, tq1), Ok(true));
        assert_eq!(cat_kx2_accepts_json(on, tq1), Ok(true));
        assert_eq!(cat_kx2_answers_json(off, tq1), Ok(true));
        assert_eq!(cat_kx2_accepts_json(off, tq1), Ok(false));
        assert_eq!(cat_kx2_accepts_json(on, r#"{"type":"busy"}"#), Ok(false));
        assert_eq!(cat_kx2_answers_json(r#"{"type":"read_mode"}"#, tq1), Ok(false));
        assert!(cat_kx2_answers_json(on, "{}").is_err());
        assert_eq!(parser.push(&[0x80, 0x81]), r#"[{"type":"noise","bytes":2}]"#);
        parser.push(b"FA0001");
        parser.reset();
        assert_eq!(parser.push(b"4074000;"), r#"[{"type":"noise","bytes":8}]"#);
    }

    #[test]
    fn the_test_simulator_answers_like_the_crate_simulator() {
        let mut radio = CatKx2SimForTests::new();
        assert_eq!(radio.frequency(), 14_074_000);
        assert_eq!(radio.mode(), r#""usb""#);
        assert_eq!(radio.sub(), r#""data_a""#);
        assert_eq!(radio.mic_btn(), 5);
        radio.set_lines(true, true);
        assert!(radio.transmit());
        radio.set_mic_btn(0);
        assert!(!radio.transmit());
        assert_eq!(radio.receive(b"MD6;MD;"), b"MD6;");
        radio.press_sub(r#""fsk_d""#);
        assert_eq!(radio.receive(b"TX;TQ;"), b"TQ0;");
        assert_eq!(radio.received(), "MD6;MD;TX;TQ");
        radio.set_auto_info(2);
        assert_eq!(radio.turn_dial(7_074_000), b"FA00007074000;");
        radio.open_menu(82);
        assert_eq!(radio.menu(), 82);
        radio.press_xmit(true);
        assert_eq!(radio.receive(b"FA00014074000;"), b"?;");
        assert_eq!(radio.sets_while_transmitting(), 1);
    }
}
