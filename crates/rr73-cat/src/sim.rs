//! A simulated IC-705 for tests. It reads CI-V frames, answers the commands in [`crate::ic705`]
//! in the formats the CI-V guide gives, sends transceive frames when its front panel changes,
//! and sends back what it receives when CI-V USB Echo Back is on.
//!
//! The guide gives formats, not every behaviour. Where it is silent the simulator makes a
//! choice, and these choices are not facts about the radio:
//!
//! - It answers NG to a frequency outside the receiver's coverage, 0.030000 to 199.999999 MHz
//!   and 400.000000 to 470.000000 MHz (Basic Manual p. 11-1), to data mode on in a mode without
//!   one (Basic Manual p. 3-2), to codes the guide does not list, to data of the wrong length,
//!   and to commands it does not model.
//! - Setting a mode without a data mode turns the data mode off.
//! - Each VFO keeps one filter, shared by the mode and the data mode.
//! - A mode set without a filter selects FIL1. The guide says the mode's default filter (p. 17).
//! - It answers a read of the data mode while off with `00 00`.
//! - Transceive frames go to the controller's address, `E0`.
//! - Echo Back sends back every byte received at once, ahead of the answer.
//! - It accepts transmit on at any frequency.

use std::collections::BTreeMap;

use crate::bcd;
use crate::frame::{Decoded, Frame, FrameDecoder, NG, OK};
use crate::ic705::{
    CMD_READ_FREQUENCY, CMD_READ_MODE, CMD_SET_FREQUENCY, CMD_SET_MODE, CMD_SETTINGS, CMD_STATUS,
    CMD_TRANSCEIVE_FREQUENCY, CMD_TRANSCEIVE_MODE, CMD_VFO_FREQUENCY, CMD_VFO_MODE, CONTROLLER_ADDRESS,
    DEFAULT_RADIO_ADDRESS, Filter, MenuItem, Mode, SUB_DATA_MODE, SUB_MENU, SUB_TRANSMIT, Vfo,
};

/// What one VFO holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VfoState {
    /// Frequency, Hz.
    pub hz: u64,
    /// Mode.
    pub mode: Mode,
    /// Data mode on.
    pub data: bool,
    /// Filter.
    pub filter: Filter,
}

/// True inside the receiver's coverage, Hz (Basic Manual p. 11-1).
pub fn in_coverage(hz: u64) -> bool {
    (30_000..=199_999_999).contains(&hz) || (400_000_000..=470_000_000).contains(&hz)
}

/// The simulated radio.
#[derive(Debug, Clone)]
pub struct SimIc705 {
    /// Its CI-V address, `A4` by default.
    pub address: u8,
    /// The VFO in use.
    pub selected: VfoState,
    /// The other VFO.
    pub unselected: VfoState,
    /// True while transmitting.
    pub transmit: bool,
    /// Every frame addressed to the radio, oldest first.
    pub received: Vec<Frame>,
    settings: BTreeMap<MenuItem, u16>,
    decoder: FrameDecoder,
}

impl Default for SimIc705 {
    fn default() -> Self {
        Self::new()
    }
}

impl SimIc705 {
    /// A radio at address `A4` on 14.074 MHz USB, FIL1, data mode off, the other VFO on
    /// 7.074 MHz, receiving, with the menu defaults of the Basic Manual: Time-Out Timer 5 min
    /// (p. 8-4), DATA OFF MOD MIC,USB and DATA MOD USB (p. 8-15), USB SEND off, CI-V Transceive
    /// on and CI-V USB Echo Back off (p. 8-16).
    pub fn new() -> Self {
        let settings = BTreeMap::from([
            (MenuItem::TimeOutTimer, 2),
            (MenuItem::DataOffMod, 2),
            (MenuItem::DataMod, 1),
            (MenuItem::UsbSend, 0),
            (MenuItem::CivTransceive, 1),
            (MenuItem::CivUsbEchoBack, 0),
        ]);
        let vfo = |hz| VfoState {
            hz,
            mode: Mode::Usb,
            data: false,
            filter: Filter::Fil1,
        };
        Self {
            address: DEFAULT_RADIO_ADDRESS,
            selected: vfo(14_074_000),
            unselected: vfo(7_074_000),
            transmit: false,
            received: Vec::new(),
            settings,
            decoder: FrameDecoder::new(),
        }
    }

    /// A menu setting's code.
    pub fn setting(&self, item: MenuItem) -> u16 {
        self.settings.get(&item).copied().unwrap_or(0)
    }

    /// Changes a menu setting on the radio's screen. Values above the item's highest code are
    /// ignored.
    pub fn set_setting(&mut self, item: MenuItem, value: u16) {
        if value <= item.max_value() {
            self.settings.insert(item, value);
        }
    }

    /// Reads bytes from the controller and returns the radio's bytes in reply: the echo, if on,
    /// then one answer per frame addressed to the radio.
    pub fn receive(&mut self, bytes: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        if self.setting(MenuItem::CivUsbEchoBack) == 1 {
            out.extend_from_slice(bytes);
        }
        for d in self.decoder.push(bytes) {
            let Decoded::Frame(f) = d else { continue };
            if f.to != self.address {
                continue;
            }
            let reply = self.answer(&f);
            self.received.push(f);
            if let Ok(b) = reply.encode() {
                out.extend(b);
            }
        }
        out
    }

    /// The operator turns the dial to `hz`. Returns the transceive frame, if Transceive is on
    /// and the frequency is in coverage.
    pub fn turn_dial(&mut self, hz: u64) -> Vec<u8> {
        if !in_coverage(hz) {
            return Vec::new();
        }
        self.selected.hz = hz;
        match bcd::encode_frequency(hz) {
            Ok(f) => self.transceive(CMD_TRANSCEIVE_FREQUENCY, &f),
            Err(_) => Vec::new(),
        }
    }

    /// The operator picks a mode and filter. Returns the transceive frame, if Transceive is on.
    pub fn press_mode(&mut self, mode: Mode, filter: Filter) -> Vec<u8> {
        self.selected.mode = mode;
        self.selected.filter = filter;
        if !mode.has_data_mode() {
            self.selected.data = false;
        }
        self.transceive(CMD_TRANSCEIVE_MODE, &[mode.code(), filter.code()])
    }

    /// The operator turns the data mode on or off. The guide gives no transceive frame for it,
    /// so none is sent.
    pub fn press_data(&mut self, on: bool) {
        if !on || self.selected.mode.has_data_mode() {
            self.selected.data = on;
        }
    }

    fn transceive(&self, command: u8, data: &[u8]) -> Vec<u8> {
        if self.setting(MenuItem::CivTransceive) != 1 {
            return Vec::new();
        }
        Frame::new(CONTROLLER_ADDRESS, self.address, command, data)
            .encode()
            .unwrap_or_default()
    }

    fn vfo_mut(&mut self, vfo: Vfo) -> &mut VfoState {
        match vfo {
            Vfo::Selected => &mut self.selected,
            Vfo::Unselected => &mut self.unselected,
        }
    }

    fn vfo(&self, vfo: Vfo) -> &VfoState {
        match vfo {
            Vfo::Selected => &self.selected,
            Vfo::Unselected => &self.unselected,
        }
    }

    /// Sets a VFO's frequency; false when out of coverage or not BCD.
    fn tune(&mut self, vfo: Vfo, data: &[u8]) -> bool {
        match bcd::decode_frequency(data) {
            Ok(hz) if in_coverage(hz) => {
                self.vfo_mut(vfo).hz = hz;
                true
            }
            _ => false,
        }
    }

    /// Sets a VFO's mode, data mode and filter; false for codes the guide does not list or data
    /// mode on in a mode without one.
    fn set_mode(&mut self, vfo: Vfo, mode: u8, data: u8, filter: u8) -> bool {
        let (Some(mode), Some(filter)) = (Mode::from_code(mode), Filter::from_code(filter)) else {
            return false;
        };
        let data = match data {
            0 => false,
            1 if mode.has_data_mode() => true,
            _ => return false,
        };
        *self.vfo_mut(vfo) = VfoState {
            hz: self.vfo(vfo).hz,
            mode,
            data,
            filter,
        };
        true
    }

    fn answer(&mut self, f: &Frame) -> Frame {
        let (to, me, command) = (f.from, self.address, f.command);
        let reply = move |data: Vec<u8>| Frame::new(to, me, command, data);
        let ack = move |ok: bool| Frame::new(to, me, if ok { OK } else { NG }, []);
        let s = self.selected;
        let freq = |hz: u64| bcd::encode_frequency(hz).map(|b| b.to_vec()).unwrap_or_default();
        // A new mode with a data mode keeps the data mode on; one without turns it off.
        let keep_data = |m: u8| u8::from(s.data && Mode::from_code(m).is_some_and(Mode::has_data_mode));
        match (f.command, f.data.as_slice()) {
            (CMD_READ_FREQUENCY, []) => reply(freq(s.hz)),
            (CMD_READ_MODE, []) => reply(vec![s.mode.code(), s.filter.code()]),
            (CMD_SET_FREQUENCY, d) => ack(self.tune(Vfo::Selected, d)),
            (CMD_SET_MODE, [m]) => ack(self.set_mode(Vfo::Selected, *m, keep_data(*m), 1)),
            (CMD_SET_MODE, [m, fil]) => ack(self.set_mode(Vfo::Selected, *m, keep_data(*m), *fil)),
            (CMD_SETTINGS, [SUB_DATA_MODE]) => {
                let (on, fil) = if s.data { (1, s.filter.code()) } else { (0, 0) };
                reply(vec![SUB_DATA_MODE, on, fil])
            }
            (CMD_SETTINGS, [SUB_DATA_MODE, 0x00, 0x00]) => {
                self.selected.data = false;
                ack(true)
            }
            (CMD_SETTINGS, [SUB_DATA_MODE, 0x01, fil]) => {
                ack(self.set_mode(Vfo::Selected, s.mode.code(), 1, *fil))
            }
            (CMD_SETTINGS, [SUB_MENU, a, b]) => match MenuItem::from_bytes([*a, *b]) {
                Some(item) => match bcd::encode_byte(self.setting(item) as u8) {
                    Ok(v) => reply(vec![SUB_MENU, *a, *b, v]),
                    Err(_) => ack(false),
                },
                None => ack(false),
            },
            (CMD_SETTINGS, [SUB_MENU, a, b, v]) => {
                let item = MenuItem::from_bytes([*a, *b]);
                match (item, bcd::decode_byte(*v)) {
                    (Some(item), Ok(v)) if u16::from(v) <= item.max_value() => {
                        self.settings.insert(item, u16::from(v));
                        ack(true)
                    }
                    _ => ack(false),
                }
            }
            (CMD_STATUS, [SUB_TRANSMIT]) => reply(vec![SUB_TRANSMIT, u8::from(self.transmit)]),
            (CMD_STATUS, [SUB_TRANSMIT, on @ (0x00 | 0x01)]) => {
                self.transmit = *on == 0x01;
                ack(true)
            }
            (CMD_VFO_FREQUENCY, [v]) => match Vfo::from_code(*v) {
                Some(vfo) => {
                    let mut d = vec![*v];
                    d.extend(freq(self.vfo(vfo).hz));
                    reply(d)
                }
                None => ack(false),
            },
            (CMD_VFO_FREQUENCY, [v, d @ ..]) => match Vfo::from_code(*v) {
                Some(vfo) => ack(self.tune(vfo, d)),
                None => ack(false),
            },
            (CMD_VFO_MODE, [v]) => match Vfo::from_code(*v) {
                Some(vfo) => {
                    let st = self.vfo(vfo);
                    reply(vec![*v, st.mode.code(), u8::from(st.data), st.filter.code()])
                }
                None => ack(false),
            },
            // Data mode and filter may be left out: data off and the mode's default filter (p. 27).
            (CMD_VFO_MODE, [v, m]) => ack(self.vfo_mode(*v, *m, 0, 1)),
            (CMD_VFO_MODE, [v, m, d]) => ack(self.vfo_mode(*v, *m, *d, 1)),
            (CMD_VFO_MODE, [v, m, d, fil]) => ack(self.vfo_mode(*v, *m, *d, *fil)),
            _ => ack(false),
        }
    }

    fn vfo_mode(&mut self, v: u8, mode: u8, data: u8, filter: u8) -> bool {
        Vfo::from_code(v).is_some_and(|vfo| self.set_mode(vfo, mode, data, filter))
    }
}
