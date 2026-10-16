//! Rig control for the app: CI-V frames for the IC-705, from `rr73-cat`.
//!
//! The app's serial link writes the bytes [`cat_encode`] returns and pushes every chunk it reads
//! into one [`CatParser`], which returns the events those bytes complete. Requests and events
//! travel as JSON objects with a `type`, in the form of `rr73_cat::Request` and
//! `rr73_cat::Event`:
//!
//! - in: `{"type": "set_frequency", "hz": 14074000}`, `{"type": "set_mode", "mode": "usb",
//!   "filter": 1}`, `{"type": "set_data_mode", "on": true, "filter": 1}`,
//!   `{"type": "set_transmit", "on": true}`, `{"type": "read_transmit"}` and the rest of
//!   `Request`;
//! - out: `{"type": "ok"}`, `{"type": "ng"}`, `{"type": "frequency", "hz": 14074000,
//!   "transceive": false}`, `{"type": "transmit", "on": true}`, `{"type": "echo", "command": 3}`,
//!   `{"type": "noise", "bytes": 12}` and the rest of `Event`.
//!
//! The radio's CI-V address is `A4` unless the operator changed it; the controller's is `E0`.

use rr73_cat::ic705::{Addresses, CONTROLLER_ADDRESS, Event, Filter, MenuItem, Mode, Parser, Request, Split};
use rr73_cat::sim::SimIc705;
use wasm_bindgen::prelude::*;

fn addresses(radio_address: u8) -> Addresses {
    Addresses {
        radio: radio_address,
        controller: CONTROLLER_ADDRESS,
    }
}

/// [`cat_encode`] without the JavaScript error type, for native callers and tests.
pub fn cat_encode_bytes(request_json: &str, radio_address: u8) -> Result<Vec<u8>, String> {
    let request: Request = serde_json::from_str(request_json).map_err(|e| format!("request: {e}"))?;
    request
        .encode(addresses(radio_address))
        .map_err(|e| e.to_string())
}

/// The bytes of one request (JSON, as `rr73_cat::Request`) to the radio at `radio_address`
/// (`0xA4` for the IC-705's default), as a `Uint8Array` to write to the port. Throws for
/// malformed JSON, a frequency above 499.999999 MHz, data mode on without a filter, or an
/// address of `0xFD` or `0xFE`.
#[wasm_bindgen]
pub fn cat_encode(request_json: &str, radio_address: u8) -> Result<Vec<u8>, JsError> {
    cat_encode_bytes(request_json, radio_address).map_err(|e| JsError::new(&e))
}

/// [`cat_answers`] without the JavaScript error type, for native callers and tests.
pub fn cat_answers_json(request_json: &str, event_json: &str) -> Result<bool, String> {
    let request: Request = serde_json::from_str(request_json).map_err(|e| format!("request: {e}"))?;
    let event: Event = serde_json::from_str(event_json).map_err(|e| format!("event: {e}"))?;
    Ok(request.answered_by(&event))
}

/// True when the event (JSON, as one element of [`CatParser::push`]'s array) answers the
/// request (JSON): OK for a set, the matching data for a read, NG or a garbled reply for either.
/// Transceive frames and echoes answer nothing. Throws for malformed JSON.
#[wasm_bindgen]
pub fn cat_answers(request_json: &str, event_json: &str) -> Result<bool, JsError> {
    cat_answers_json(request_json, event_json).map_err(|e| JsError::new(&e))
}

/// Streaming reader for one serial link to the radio. Push each chunk the port delivers, in any
/// sizes; the same bytes give the same frames whatever the chunk boundaries.
#[wasm_bindgen]
pub struct CatParser {
    parser: Parser,
}

impl CatParser {
    /// [`CatParser::push`] as events, for native callers and tests.
    pub fn push_events(&mut self, bytes: &[u8]) -> Vec<Event> {
        self.parser.push(bytes)
    }
}

#[wasm_bindgen]
impl CatParser {
    /// A parser for frames between the app (`E0`) and the radio at `radio_address`.
    #[wasm_bindgen(constructor)]
    pub fn new(radio_address: u8) -> CatParser {
        CatParser {
            parser: Parser::new(addresses(radio_address)),
        }
    }

    /// Reads bytes from the port and returns the events they complete as a JSON array, oldest
    /// first. Never throws for any bytes.
    pub fn push(&mut self, bytes: &[u8]) -> String {
        serde_json::to_string(&self.parser.push(bytes)).unwrap_or_else(|_| "[]".to_string())
    }

    /// Forgets a frame in progress, as after reopening the port.
    pub fn reset(&mut self) {
        self.parser.reset();
    }

    /// The radio's CI-V address the parser listens for.
    #[wasm_bindgen(getter)]
    pub fn radio_address(&self) -> u8 {
        self.parser.addresses().radio
    }
}

/// The simulated IC-705 of `rr73_cat::sim`, for the app's unit tests: a fake serial port answers
/// the app's frames with [`CatSimForTests::receive`]. The app never uses it. Its choices where
/// the CI-V guide is silent are listed in `rr73_cat::sim`.
#[wasm_bindgen]
pub struct CatSimForTests {
    sim: SimIc705,
}

impl Default for CatSimForTests {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl CatSimForTests {
    /// A radio at `A4` on 14.074 MHz USB, FIL1, data mode off, receiving, with the menu defaults.
    #[wasm_bindgen(constructor)]
    pub fn new() -> CatSimForTests {
        CatSimForTests { sim: SimIc705::new() }
    }

    /// Reads bytes from the app and returns the radio's bytes in reply.
    pub fn receive(&mut self, bytes: &[u8]) -> Vec<u8> {
        self.sim.receive(bytes)
    }

    /// The operator turns the dial to `hz` (Hz). Returns the transceive frame, if any.
    pub fn turn_dial(&mut self, hz: u32) -> Vec<u8> {
        self.sim.turn_dial(u64::from(hz))
    }

    /// The operator picks a mode (JSON string, as `"lsb"`) and filter (1 to 3). Returns the
    /// transceive frame, if any, or nothing for a mode or filter the guide does not list.
    pub fn press_mode(&mut self, mode_json: &str, filter: u8) -> Vec<u8> {
        let mode = serde_json::from_str::<Mode>(mode_json).ok();
        match (mode, Filter::from_code(filter)) {
            (Some(m), Some(f)) => self.sim.press_mode(m, f),
            _ => Vec::new(),
        }
    }

    /// Changes a menu setting (JSON string, as `"usb_send"`) on the radio's screen.
    pub fn set_setting(&mut self, item_json: &str, value: u16) {
        if let Ok(item) = serde_json::from_str::<MenuItem>(item_json) {
            self.sim.set_setting(item, value);
        }
    }

    /// The operator sets split or duplex (JSON string, as `"on"` or `"dup_minus"`) on the radio's
    /// FUNCTION screen. Anything else is ignored.
    pub fn set_split(&mut self, split_json: &str) {
        if let Ok(split) = serde_json::from_str::<Split>(split_json) {
            self.sim.split = split;
        }
    }

    /// The operator turns RIT on or off, ΔTX on or off, and the shared offset (Hz, -9999 to 9999;
    /// anything outside is ignored).
    pub fn set_rit(&mut self, rit: bool, xit: bool, offset_hz: i32) {
        self.sim.rit = rit;
        self.sim.xit = xit;
        if (-rr73_cat::ic705::MAX_RIT_HZ..=rr73_cat::ic705::MAX_RIT_HZ).contains(&offset_hz) {
            self.sim.rit_hz = offset_hz;
        }
    }

    /// True while the radio transmits, by CI-V or by a port A line through USB SEND.
    #[wasm_bindgen(getter)]
    pub fn transmit(&self) -> bool {
        self.sim.transmitting()
    }

    /// Frequency, mode and data mode sets that arrived while the radio transmitted.
    #[wasm_bindgen(getter)]
    pub fn sets_while_transmitting(&self) -> u32 {
        u32::try_from(self.sim.sets_while_transmitting.len()).unwrap_or(u32::MAX)
    }

    /// The app sets port A's DTR and RTS lines, as opening a port and `setSignals` do.
    pub fn set_lines(&mut self, dtr: bool, rts: bool) {
        self.sim.set_lines(dtr, rts);
    }

    /// The operating frequency, Hz.
    #[wasm_bindgen(getter)]
    pub fn frequency(&self) -> u32 {
        u32::try_from(self.sim.selected.hz).unwrap_or(u32::MAX)
    }

    /// The operating mode as JSON, as `"usb"`.
    #[wasm_bindgen(getter)]
    pub fn mode(&self) -> String {
        serde_json::to_string(&self.sim.selected.mode).unwrap_or_default()
    }

    /// True with the data mode on.
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> bool {
        self.sim.selected.data
    }

    /// The filter, 1 to 3.
    #[wasm_bindgen(getter)]
    pub fn filter(&self) -> u8 {
        self.sim.selected.filter.code()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_encode_from_json() {
        assert_eq!(
            cat_encode_bytes(r#"{"type":"set_frequency","hz":14074000}"#, 0xA4),
            Ok(vec![
                0xFE, 0xFE, 0xA4, 0xE0, 0x05, 0x00, 0x40, 0x07, 0x14, 0x00, 0xFD
            ])
        );
        assert_eq!(
            cat_encode_bytes(r#"{"type":"set_transmit","on":true}"#, 0xA4),
            Ok(vec![0xFE, 0xFE, 0xA4, 0xE0, 0x1C, 0x00, 0x01, 0xFD])
        );
        assert_eq!(
            cat_encode_bytes(r#"{"type":"set_data_mode","on":true,"filter":1}"#, 0x94),
            Ok(vec![0xFE, 0xFE, 0x94, 0xE0, 0x1A, 0x06, 0x01, 0x01, 0xFD])
        );
        assert!(cat_encode_bytes(r#"{"type":"set_data_mode","on":true}"#, 0xA4).is_err());
        assert!(cat_encode_bytes(r#"{"type":"set_frequency","hz":500000000}"#, 0xA4).is_err());
        assert!(cat_encode_bytes(r#"{"type":"tune"}"#, 0xA4).is_err());
        assert!(cat_encode_bytes("{", 0xA4).is_err());
        assert!(cat_encode_bytes(r#"{"type":"read_frequency"}"#, 0xFD).is_err());
    }

    #[test]
    fn the_parser_returns_events_as_json() {
        let mut radio = SimIc705::new();
        let mut parser = CatParser::new(0xA4);
        assert_eq!(parser.radio_address(), 0xA4);
        let ask = cat_encode_bytes(r#"{"type":"read_frequency"}"#, 0xA4).expect("encode");
        let reply = radio.receive(&ask);
        // Split mid-frame: the first half completes nothing.
        let (a, b) = reply.split_at(4);
        assert_eq!(parser.push(a), "[]");
        let json = parser.push(b);
        assert_eq!(json, r#"[{"type":"frequency","hz":14074000,"transceive":false}]"#);
        let events: Vec<serde_json::Value> = serde_json::from_str(&json).expect("json");
        let one = serde_json::to_string(&events[0]).expect("json");
        assert_eq!(cat_answers_json(r#"{"type":"read_frequency"}"#, &one), Ok(true));
        assert_eq!(cat_answers_json(r#"{"type":"read_mode"}"#, &one), Ok(false));
        assert_eq!(
            cat_answers_json(r#"{"type":"set_transmit","on":false}"#, r#"{"type":"ok"}"#),
            Ok(true)
        );
        assert!(cat_answers_json(r#"{"type":"read_mode"}"#, "{}").is_err());
        assert_eq!(
            parser.push(&[0x00, 0x01, 0x02]),
            r#"[{"type":"noise","bytes":3}]"#
        );
        parser.push(&[0xFE, 0xFE, 0xE0]);
        parser.reset();
        assert_eq!(
            parser.push(&[0xA4, 0xFB, 0xFD]),
            r#"[{"type":"noise","bytes":3}]"#
        );
    }
    #[test]
    fn the_test_simulator_answers_like_the_crate_simulator() {
        let mut radio = CatSimForTests::new();
        assert_eq!(radio.frequency(), 14_074_000);
        assert_eq!(radio.mode(), r#""usb""#);
        assert!(!radio.data());
        let key = cat_encode_bytes(r#"{"type":"set_transmit","on":true}"#, 0xA4).expect("encode");
        assert_eq!(radio.receive(&key), [0xFE, 0xFE, 0xE0, 0xA4, 0xFB, 0xFD]);
        assert!(radio.transmit());
        assert_eq!(
            radio.turn_dial(7_074_000),
            [0xFE, 0xFE, 0x00, 0xA4, 0x00, 0x00, 0x40, 0x07, 0x07, 0x00, 0xFD]
        );
        assert_eq!(radio.frequency(), 7_074_000);
        assert_eq!(
            radio.press_mode(r#""lsb""#, 2),
            [0xFE, 0xFE, 0x00, 0xA4, 0x01, 0x00, 0x02, 0xFD]
        );
        assert_eq!(radio.filter(), 2);
        assert!(radio.press_mode(r#""ssb""#, 1).is_empty());
        radio.set_setting(r#""usb_send""#, 1);
        let off = cat_encode_bytes(r#"{"type":"set_transmit","on":false}"#, 0xA4).expect("encode");
        radio.receive(&off);
        radio.set_lines(true, false);
        assert!(radio.transmit());
        radio.set_lines(false, false);
        assert!(!radio.transmit());
        let read = cat_encode_bytes(r#"{"type":"read_setting","item":"usb_send"}"#, 0xA4).expect("encode");
        let mut parser = CatParser::new(0xA4);
        assert_eq!(
            parser.push(&radio.receive(&read)),
            r#"[{"type":"setting","item":"usb_send","value":1}]"#
        );
    }

    #[test]
    fn split_rit_and_delta_tx_read_as_json() {
        let mut radio = CatSimForTests::new();
        let mut parser = CatParser::new(0xA4);
        let mut ask = |radio: &mut CatSimForTests, json: &str| {
            let bytes = cat_encode_bytes(json, 0xA4).expect("encode");
            parser.push(&radio.receive(&bytes))
        };
        assert_eq!(
            ask(&mut radio, r#"{"type":"read_split"}"#),
            r#"[{"type":"split","split":"off"}]"#
        );
        radio.set_split(r#""dup_minus""#);
        radio.set_split(r#""sideways""#);
        assert_eq!(
            ask(&mut radio, r#"{"type":"read_split"}"#),
            r#"[{"type":"split","split":"dup_minus"}]"#
        );
        radio.set_rit(true, false, -120);
        assert_eq!(
            ask(&mut radio, r#"{"type":"read_rit"}"#),
            r#"[{"type":"rit","on":true}]"#
        );
        assert_eq!(
            ask(&mut radio, r#"{"type":"read_xit"}"#),
            r#"[{"type":"xit","on":false}]"#
        );
        assert_eq!(
            ask(&mut radio, r#"{"type":"read_rit_offset"}"#),
            r#"[{"type":"rit_offset","hz":-120}]"#
        );
        radio.set_rit(false, true, 20_000);
        assert_eq!(
            ask(&mut radio, r#"{"type":"read_rit_offset"}"#),
            r#"[{"type":"rit_offset","hz":-120}]"#
        );
        assert_eq!(
            cat_answers_json(r#"{"type":"read_xit"}"#, r#"{"type":"xit","on":true}"#),
            Ok(true)
        );
        assert_eq!(
            cat_answers_json(r#"{"type":"read_rit"}"#, r#"{"type":"xit","on":true}"#),
            Ok(false)
        );
    }
}
