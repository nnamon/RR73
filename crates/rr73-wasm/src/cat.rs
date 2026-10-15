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

use rr73_cat::ic705::{Addresses, CONTROLLER_ADDRESS, Event, Parser, Request};
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

#[cfg(test)]
mod tests {
    use super::*;
    use rr73_cat::sim::SimIc705;

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
}
