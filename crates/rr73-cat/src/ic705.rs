//! The IC-705 commands RR73 uses, as typed requests and parsed events.
//!
//! | Request | Frame data | CI-V guide |
//! | --- | --- | --- |
//! | Read the operating frequency | `03` | p. 3 (command table), p. 17 (format) |
//! | Set the operating frequency | `05` + 5 frequency bytes | p. 3, p. 17 |
//! | Read the operating mode | `04` | p. 3, p. 17 |
//! | Set the operating mode | `06` + mode [+ filter] | p. 3, p. 17 |
//! | Read the data mode | `1A 06` | p. 14, p. 22 |
//! | Set the data mode | `1A 06` + `00 00`, or `01` + filter | p. 14, p. 22 |
//! | Read a VFO's frequency | `25` + VFO | p. 15, p. 27 |
//! | Set a VFO's frequency | `25` + VFO + 5 frequency bytes | p. 15, p. 27 |
//! | Read a VFO's mode, data mode and filter | `26` + VFO | p. 15, p. 27 |
//! | Set a VFO's mode, data mode and filter | `26` + VFO + mode + data + filter | p. 15, p. 27 |
//! | Read transmit or receive | `1C 00` | p. 14 |
//! | Transmit on or off | `1C 00 01`, `1C 00 00` | p. 14 |
//! | Read a menu setting | `1A 05` + item | pp. 6 to 8 |
//! | Read split or duplex | `0F` | p. 3 |
//! | Read the RIT and ΔTX offset | `21 00` | p. 15, p. 27 |
//! | Read RIT on or off | `21 01` | p. 15 |
//! | Read ΔTX (XIT) on or off | `21 02` | p. 15 |
//!
//! The radio answers a read with the same command and sub-command followed by the data, and a
//! set with OK (`FB`) or NG (`FA`) (p. 2). With CI-V Transceive on, its default (Basic Manual
//! p. 8-16), it also sends `00` (frequency) and `01` (mode) when they change (p. 3). With CI-V
//! USB Echo Back on (default off, p. 8-16) it sends back what it receives, so frames from the
//! controller to the radio come back as [`Event::Echo`].
//!
//! The guide does not say which address the radio's transceive frames carry. The parser takes
//! every frame from the radio's address, whatever its receiving address.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::bcd::{self, BcdError};
use crate::frame::{Decoded, Frame, FrameDecoder, FrameError, NG, OK};

/// The IC-705's default CI-V address (CI-V guide p. 2; Basic Manual p. 8-16, SET > Connectors >
/// CI-V > CI-V Address).
pub const DEFAULT_RADIO_ADDRESS: u8 = 0xA4;
/// The controller's default address (CI-V guide p. 2). The IC-705 has no setting for it.
pub const CONTROLLER_ADDRESS: u8 = 0xE0;

/// Transceive: the operating frequency changed (p. 3).
pub const CMD_TRANSCEIVE_FREQUENCY: u8 = 0x00;
/// Transceive: the operating mode changed (p. 3).
pub const CMD_TRANSCEIVE_MODE: u8 = 0x01;
/// Read the operating frequency (p. 3).
pub const CMD_READ_FREQUENCY: u8 = 0x03;
/// Read the operating mode (p. 3).
pub const CMD_READ_MODE: u8 = 0x04;
/// Set the operating frequency (p. 3).
pub const CMD_SET_FREQUENCY: u8 = 0x05;
/// Set the operating mode (p. 3).
pub const CMD_SET_MODE: u8 = 0x06;
/// Settings: sub-command `05` for menu items, `06` for the data mode (pp. 5 to 14).
pub const CMD_SETTINGS: u8 = 0x1A;
/// Sub-command of `1A`: a menu item follows (pp. 5 to 14).
pub const SUB_MENU: u8 = 0x05;
/// Sub-command of `1A`: the data mode (p. 14).
pub const SUB_DATA_MODE: u8 = 0x06;
/// Status: sub-command `00` is transmit or receive (p. 14).
pub const CMD_STATUS: u8 = 0x1C;
/// Sub-command of `1C`: the transceiver's status, `00` receive and `01` transmit (p. 14).
pub const SUB_TRANSMIT: u8 = 0x00;
/// Split and duplex: read with no data, set with a code (p. 3).
pub const CMD_SPLIT: u8 = 0x0F;
/// RIT and ΔTX: sub-command `00` the offset, `01` RIT on or off, `02` ΔTX on or off (p. 15).
pub const CMD_RIT: u8 = 0x21;
/// Sub-command of `21`: the RIT frequency, which RIT and ΔTX share (p. 15, p. 27).
pub const SUB_RIT_OFFSET: u8 = 0x00;
/// Sub-command of `21`: RIT on or off (p. 15).
pub const SUB_RIT: u8 = 0x01;
/// Sub-command of `21`: ΔTX on or off (p. 15). ΔTX is Icom's name for XIT.
pub const SUB_XIT: u8 = 0x02;
/// The largest RIT or ΔTX offset the 4 digits of p. 27 carry, Hz. The radio shifts up to 9.99 kHz
/// (Basic Manual p. 4-2; Advanced Manual p. 2-3).
pub const MAX_RIT_HZ: i32 = 9_999;
/// The selected or unselected VFO's frequency (p. 15).
pub const CMD_VFO_FREQUENCY: u8 = 0x25;
/// The selected or unselected VFO's mode, data mode and filter (p. 15).
pub const CMD_VFO_MODE: u8 = 0x26;

/// The two addresses of a link.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Addresses {
    /// The radio's CI-V address, `A4` unless changed in SET > Connectors > CI-V.
    pub radio: u8,
    /// The controller's address, `E0`.
    pub controller: u8,
}

impl Default for Addresses {
    fn default() -> Self {
        Self {
            radio: DEFAULT_RADIO_ADDRESS,
            controller: CONTROLLER_ADDRESS,
        }
    }
}

/// Operating modes and their codes (CI-V guide p. 17, "Operating mode").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    /// `00`.
    Lsb,
    /// `01`.
    Usb,
    /// `02`.
    Am,
    /// `03`.
    Cw,
    /// `04`.
    Rtty,
    /// `05`.
    Fm,
    /// `06`, receive only (Basic Manual p. 11-1).
    Wfm,
    /// `07`.
    CwR,
    /// `08`.
    RttyR,
    /// `17`.
    Dv,
}

impl Mode {
    /// Every mode, in code order.
    pub const ALL: [Mode; 10] = [
        Mode::Lsb,
        Mode::Usb,
        Mode::Am,
        Mode::Cw,
        Mode::Rtty,
        Mode::Fm,
        Mode::Wfm,
        Mode::CwR,
        Mode::RttyR,
        Mode::Dv,
    ];

    /// The mode's byte.
    pub fn code(self) -> u8 {
        match self {
            Mode::Lsb => 0x00,
            Mode::Usb => 0x01,
            Mode::Am => 0x02,
            Mode::Cw => 0x03,
            Mode::Rtty => 0x04,
            Mode::Fm => 0x05,
            Mode::Wfm => 0x06,
            Mode::CwR => 0x07,
            Mode::RttyR => 0x08,
            Mode::Dv => 0x17,
        }
    }

    /// The mode a byte names, or `None` for a code p. 17 does not list.
    pub fn from_code(code: u8) -> Option<Mode> {
        Mode::ALL.into_iter().find(|m| m.code() == code)
    }

    /// True for the modes with a data mode: SSB, AM and FM (Basic Manual p. 3-2).
    pub fn has_data_mode(self) -> bool {
        matches!(self, Mode::Lsb | Mode::Usb | Mode::Am | Mode::Fm)
    }
}

/// IF filter: FIL1 (wide), FIL2 (mid) or FIL3 (narrow) (CI-V guide p. 17; Basic Manual p. 4-5).
/// In USB-D the defaults are 3.0 kHz, 1.2 kHz and 500 Hz (Basic Manual p. 4-5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub enum Filter {
    /// `01`.
    Fil1,
    /// `02`.
    Fil2,
    /// `03`.
    Fil3,
}

impl Filter {
    /// The filter's byte, 1 to 3.
    pub fn code(self) -> u8 {
        match self {
            Filter::Fil1 => 1,
            Filter::Fil2 => 2,
            Filter::Fil3 => 3,
        }
    }

    /// The filter a byte names, or `None` for anything but 1 to 3.
    pub fn from_code(code: u8) -> Option<Filter> {
        match code {
            1 => Some(Filter::Fil1),
            2 => Some(Filter::Fil2),
            3 => Some(Filter::Fil3),
            _ => None,
        }
    }
}

impl TryFrom<u8> for Filter {
    type Error = String;
    fn try_from(v: u8) -> Result<Self, Self::Error> {
        Filter::from_code(v).ok_or_else(|| format!("filter {v} is not 1, 2 or 3"))
    }
}

impl From<Filter> for u8 {
    fn from(f: Filter) -> u8 {
        f.code()
    }
}

/// Which VFO commands `25` and `26` act on (CI-V guide p. 27).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Vfo {
    /// `00`: the VFO in use.
    Selected,
    /// `01`: the other VFO. In the DR function the radio answers NG (p. 27).
    Unselected,
}

impl Vfo {
    /// The VFO's byte.
    pub fn code(self) -> u8 {
        match self {
            Vfo::Selected => 0x00,
            Vfo::Unselected => 0x01,
        }
    }

    /// The VFO a byte names.
    pub fn from_code(code: u8) -> Option<Vfo> {
        match code {
            0x00 => Some(Vfo::Selected),
            0x01 => Some(Vfo::Unselected),
            _ => None,
        }
    }
}

/// Split and duplex as `0F` reads them (p. 3). With split on the radio transmits on the other VFO
/// (Basic Manual p. 4-10); with duplex on it transmits the duplex offset below or above the
/// receive frequency (Advanced Manual p. 2-18).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Split {
    /// `00`: split off, simplex.
    Off,
    /// `01`: split on.
    On,
    /// `11`: duplex, the transmit frequency below the receive frequency.
    DupMinus,
    /// `12`: duplex, the transmit frequency above the receive frequency.
    DupPlus,
}

impl Split {
    /// Every state, in code order.
    pub const ALL: [Split; 4] = [Split::Off, Split::On, Split::DupMinus, Split::DupPlus];

    /// The state's byte, as `0F` reads it.
    pub fn code(self) -> u8 {
        match self {
            Split::Off => 0x00,
            Split::On => 0x01,
            Split::DupMinus => 0x11,
            Split::DupPlus => 0x12,
        }
    }

    /// The state a byte names, or `None` for a code p. 3 does not list. `10`, simplex, reads as
    /// [`Split::Off`]: neither split nor duplex.
    pub fn from_code(code: u8) -> Option<Split> {
        if code == 0x10 {
            return Some(Split::Off);
        }
        Split::ALL.into_iter().find(|s| s.code() == code)
    }
}

/// The RIT or ΔTX offset, Hz, from -9999 to 9999, as the 3 bytes of p. 27: 10 Hz and 1 Hz, then
/// 1 kHz and 100 Hz, then `00` for plus or `01` for minus. 1230 Hz is `30 12 00`.
pub fn encode_rit_offset(hz: i32) -> Option<[u8; 3]> {
    if !(-MAX_RIT_HZ..=MAX_RIT_HZ).contains(&hz) {
        return None;
    }
    let n = hz.unsigned_abs();
    let low = bcd::encode_byte((n % 100) as u8).ok()?;
    let high = bcd::encode_byte((n / 100) as u8).ok()?;
    Some([low, high, u8::from(hz < 0)])
}

/// The offset 3 bytes of p. 27 carry, Hz.
pub fn decode_rit_offset(data: &[u8]) -> Result<i32, Fault> {
    let [low, high, sign] = data else {
        return Err(Fault::Length);
    };
    let value = i32::from(bcd::decode_byte(*high)?) * 100 + i32::from(bcd::decode_byte(*low)?);
    match sign {
        0x00 => Ok(value),
        0x01 => Ok(-value),
        _ => Err(Fault::Code),
    }
}

/// Menu settings RR73 reads to check the radio is set up for it, with command `1A 05` and the
/// item number. Values are the codes the guide lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MenuItem {
    /// `0043`, SET > Function > Time-Out Timer: 0 off, 1 3 min, 2 5 min, 3 10 min, 4 20 min,
    /// 5 30 min (CI-V guide p. 6). Default 5 min (Basic Manual p. 8-4).
    TimeOutTimer,
    /// `0118`, SET > Connectors > MOD Input > DATA OFF MOD: 0 MIC, 1 USB, 2 MIC and USB, 3 WLAN
    /// (p. 8). Default MIC,USB (Basic Manual p. 8-15).
    DataOffMod,
    /// `0119`, SET > Connectors > MOD Input > DATA MOD: 0 MIC, 1 USB, 2 MIC and USB, 3 WLAN
    /// (p. 8). Default USB (Basic Manual p. 8-15).
    DataMod,
    /// `0125`, SET > Connectors > USB SEND/Keying > USB SEND: 0 off, 1 USB (A) DTR, 2 USB (A)
    /// RTS, 3 USB (B) DTR, 4 USB (B) RTS (p. 8). Default off (Basic Manual p. 8-16).
    UsbSend,
    /// `0131`, SET > Connectors > CI-V > CI-V Transceive: 0 off, 1 on (p. 8). Default on (Basic
    /// Manual p. 8-16).
    CivTransceive,
    /// `0132`, SET > Connectors > CI-V > CI-V USB Echo Back: 0 off, 1 on (p. 8). Default off
    /// (Basic Manual p. 8-16).
    CivUsbEchoBack,
}

impl MenuItem {
    /// Every item.
    pub const ALL: [MenuItem; 6] = [
        MenuItem::TimeOutTimer,
        MenuItem::DataOffMod,
        MenuItem::DataMod,
        MenuItem::UsbSend,
        MenuItem::CivTransceive,
        MenuItem::CivUsbEchoBack,
    ];

    /// The item's two bytes after `1A 05`.
    pub fn bytes(self) -> [u8; 2] {
        match self {
            MenuItem::TimeOutTimer => [0x00, 0x43],
            MenuItem::DataOffMod => [0x01, 0x18],
            MenuItem::DataMod => [0x01, 0x19],
            MenuItem::UsbSend => [0x01, 0x25],
            MenuItem::CivTransceive => [0x01, 0x31],
            MenuItem::CivUsbEchoBack => [0x01, 0x32],
        }
    }

    /// The item two bytes name, among those RR73 reads.
    pub fn from_bytes(b: [u8; 2]) -> Option<MenuItem> {
        MenuItem::ALL.into_iter().find(|i| i.bytes() == b)
    }

    /// Highest code the guide lists for the item.
    pub fn max_value(self) -> u16 {
        match self {
            MenuItem::TimeOutTimer => 5,
            MenuItem::DataOffMod | MenuItem::DataMod => 3,
            MenuItem::UsbSend => 4,
            MenuItem::CivTransceive | MenuItem::CivUsbEchoBack => 1,
        }
    }
}

/// A request to the radio. JSON form: `{"type": "set_frequency", "hz": 14074000}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Request {
    /// Read the operating frequency: `03`.
    ReadFrequency,
    /// Set the operating frequency: `05` and the frequency.
    SetFrequency {
        /// Frequency, Hz, 0 to 499 999 999.
        hz: u64,
    },
    /// Read the operating mode and filter: `04`.
    ReadMode,
    /// Set the operating mode: `06`, the mode and the filter. Without a filter the radio
    /// selects the mode's default filter (p. 17).
    SetMode {
        /// Mode.
        mode: Mode,
        /// Filter, or `None` for the mode's default.
        #[serde(default)]
        filter: Option<Filter>,
    },
    /// Read the data mode: `1A 06`.
    ReadDataMode,
    /// Data mode on with a filter, or off: `1A 06 01` and the filter, or `1A 06 00 00` (p. 22).
    SetDataMode {
        /// Data mode on.
        on: bool,
        /// The data mode's filter. Needed when `on`; ignored when off.
        #[serde(default)]
        filter: Option<Filter>,
    },
    /// Read a VFO's frequency: `25` and the VFO.
    ReadVfoFrequency {
        /// Which VFO.
        vfo: Vfo,
    },
    /// Set a VFO's frequency: `25`, the VFO and the frequency.
    SetVfoFrequency {
        /// Which VFO.
        vfo: Vfo,
        /// Frequency, Hz, 0 to 499 999 999.
        hz: u64,
    },
    /// Read a VFO's mode, data mode and filter: `26` and the VFO.
    ReadVfoMode {
        /// Which VFO.
        vfo: Vfo,
    },
    /// Set a VFO's mode, data mode and filter in one command: `26`, the VFO, the mode, `00` or
    /// `01` for the data mode and the filter (p. 27).
    SetVfoMode {
        /// Which VFO.
        vfo: Vfo,
        /// Mode.
        mode: Mode,
        /// Data mode on.
        data: bool,
        /// Filter.
        filter: Filter,
    },
    /// Read whether the radio transmits: `1C 00`.
    ReadTransmit,
    /// Transmit or receive: `1C 00 01` or `1C 00 00`.
    SetTransmit {
        /// True to transmit.
        on: bool,
    },
    /// Read a menu setting: `1A 05` and the item.
    ReadSetting {
        /// The item.
        item: MenuItem,
    },
    /// Read split and duplex: `0F`.
    ReadSplit,
    /// Read the RIT and ΔTX offset: `21 00`.
    ReadRitOffset,
    /// Read whether RIT is on: `21 01`.
    ReadRit,
    /// Read whether ΔTX (XIT) is on: `21 02`.
    ReadXit,
}

/// Why a request cannot be written.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum RequestError {
    /// The frequency is above 499.999999 MHz, the most the format carries (p. 17).
    #[error("{0} Hz is above 499.999999 MHz, the most a CI-V frequency carries")]
    Frequency(u64),
    /// Data mode on without a filter.
    #[error("data mode on needs a filter, 1 to 3")]
    DataFilter,
    /// The radio address cannot appear in a frame.
    #[error(transparent)]
    Frame(#[from] FrameError),
}

impl Request {
    /// The command byte the request starts with.
    pub fn command(&self) -> u8 {
        match self {
            Request::ReadFrequency => CMD_READ_FREQUENCY,
            Request::SetFrequency { .. } => CMD_SET_FREQUENCY,
            Request::ReadMode => CMD_READ_MODE,
            Request::SetMode { .. } => CMD_SET_MODE,
            Request::ReadDataMode | Request::SetDataMode { .. } | Request::ReadSetting { .. } => CMD_SETTINGS,
            Request::ReadVfoFrequency { .. } | Request::SetVfoFrequency { .. } => CMD_VFO_FREQUENCY,
            Request::ReadVfoMode { .. } | Request::SetVfoMode { .. } => CMD_VFO_MODE,
            Request::ReadTransmit | Request::SetTransmit { .. } => CMD_STATUS,
            Request::ReadSplit => CMD_SPLIT,
            Request::ReadRitOffset | Request::ReadRit | Request::ReadXit => CMD_RIT,
        }
    }

    /// True for requests that change the radio, which it answers with OK or NG.
    pub fn is_set(&self) -> bool {
        matches!(
            self,
            Request::SetFrequency { .. }
                | Request::SetMode { .. }
                | Request::SetDataMode { .. }
                | Request::SetVfoFrequency { .. }
                | Request::SetVfoMode { .. }
                | Request::SetTransmit { .. }
        )
    }

    /// The sub-command and data bytes after the command.
    fn data(&self) -> Result<Vec<u8>, RequestError> {
        let freq = |hz: u64| bcd::encode_frequency(hz).map_err(|_| RequestError::Frequency(hz));
        Ok(match *self {
            Request::ReadFrequency | Request::ReadMode => Vec::new(),
            Request::SetFrequency { hz } => freq(hz)?.to_vec(),
            Request::SetMode { mode, filter } => {
                let mut d = vec![mode.code()];
                d.extend(filter.map(Filter::code));
                d
            }
            Request::ReadDataMode => vec![SUB_DATA_MODE],
            Request::SetDataMode { on: false, .. } => vec![SUB_DATA_MODE, 0x00, 0x00],
            Request::SetDataMode { on: true, filter } => {
                vec![
                    SUB_DATA_MODE,
                    0x01,
                    filter.ok_or(RequestError::DataFilter)?.code(),
                ]
            }
            Request::ReadVfoFrequency { vfo } | Request::ReadVfoMode { vfo } => vec![vfo.code()],
            Request::SetVfoFrequency { vfo, hz } => {
                let mut d = vec![vfo.code()];
                d.extend(freq(hz)?);
                d
            }
            Request::SetVfoMode {
                vfo,
                mode,
                data,
                filter,
            } => vec![vfo.code(), mode.code(), u8::from(data), filter.code()],
            Request::ReadTransmit => vec![SUB_TRANSMIT],
            Request::SetTransmit { on } => vec![SUB_TRANSMIT, u8::from(on)],
            Request::ReadSetting { item } => {
                let [a, b] = item.bytes();
                vec![SUB_MENU, a, b]
            }
            Request::ReadSplit => Vec::new(),
            Request::ReadRitOffset => vec![SUB_RIT_OFFSET],
            Request::ReadRit => vec![SUB_RIT],
            Request::ReadXit => vec![SUB_XIT],
        })
    }

    /// The request as a frame from the controller to the radio.
    pub fn frame(&self, a: Addresses) -> Result<Frame, RequestError> {
        Ok(Frame::new(a.radio, a.controller, self.command(), self.data()?))
    }

    /// The request's bytes on the wire.
    pub fn encode(&self, a: Addresses) -> Result<Vec<u8>, RequestError> {
        Ok(self.frame(a)?.encode()?)
    }

    /// True when `event` is the radio's answer to this request: OK for a set, the matching data
    /// for a read, NG or a garbled reply for either. Transceive frames and echoes answer nothing.
    pub fn answered_by(&self, event: &Event) -> bool {
        match (self, event) {
            (_, Event::Ng) => true,
            (r, Event::Ok) => r.is_set(),
            (Request::ReadFrequency, Event::Frequency { transceive, .. }) => !transceive,
            (Request::ReadMode, Event::Mode { transceive, .. }) => !transceive,
            (Request::ReadDataMode, Event::DataMode { .. }) => true,
            (Request::ReadVfoFrequency { vfo }, Event::VfoFrequency { vfo: v, .. }) => vfo == v,
            (Request::ReadVfoMode { vfo }, Event::VfoMode { vfo: v, .. }) => vfo == v,
            (Request::ReadTransmit, Event::Transmit { .. }) => true,
            (Request::ReadSetting { item }, Event::Setting { item: i, .. }) => item == i,
            (Request::ReadSplit, Event::Split { .. }) => true,
            (Request::ReadRitOffset, Event::RitOffset { .. }) => true,
            (Request::ReadRit, Event::Rit { .. }) => true,
            (Request::ReadXit, Event::Xit { .. }) => true,
            (r, Event::Malformed { command, .. }) => !r.is_set() && r.command() == *command,
            _ => false,
        }
    }
}

/// Why a frame from the radio did not parse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Fault {
    /// The data has the wrong number of bytes for the command.
    Length,
    /// A byte that should hold two decimal digits does not.
    NotBcd,
    /// A value outside the range the guide gives.
    Range,
    /// A mode, filter, VFO or flag code the guide does not list.
    Code,
}

impl From<BcdError> for Fault {
    fn from(e: BcdError) -> Self {
        match e {
            BcdError::NotBcd(_) => Fault::NotBcd,
            BcdError::Length { .. } => Fault::Length,
            BcdError::Range(_) => Fault::Range,
        }
    }
}

/// What a frame from the radio says. JSON form: `{"type": "frequency", "hz": 14074000,
/// "transceive": false}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// OK: the radio accepted a set command (`FB`).
    Ok,
    /// NG: the radio refused a command (`FA`).
    Ng,
    /// The operating frequency: an answer to `03`, or a transceive `00` when the dial moved.
    Frequency {
        /// Frequency, Hz.
        hz: u64,
        /// True for a transceive frame (`00`).
        transceive: bool,
    },
    /// The operating mode: an answer to `04`, or a transceive `01`.
    Mode {
        /// Mode.
        mode: Mode,
        /// Filter, when the frame carries one.
        filter: Option<Filter>,
        /// True for a transceive frame (`01`).
        transceive: bool,
    },
    /// The data mode: an answer to `1A 06`.
    DataMode {
        /// Data mode on.
        on: bool,
        /// The data mode's filter; `None` when the radio sends `00`.
        filter: Option<Filter>,
    },
    /// A VFO's frequency: an answer to `25`.
    VfoFrequency {
        /// Which VFO.
        vfo: Vfo,
        /// Frequency, Hz.
        hz: u64,
    },
    /// A VFO's mode, data mode and filter: an answer to `26`.
    VfoMode {
        /// Which VFO.
        vfo: Vfo,
        /// Mode.
        mode: Mode,
        /// Data mode, when the frame carries it.
        data: Option<bool>,
        /// Filter, when the frame carries it.
        filter: Option<Filter>,
    },
    /// Transmit or receive: an answer to `1C 00`.
    Transmit {
        /// True while transmitting.
        on: bool,
    },
    /// A menu setting: an answer to `1A 05`.
    Setting {
        /// The item.
        item: MenuItem,
        /// Its code, as [`MenuItem`] lists them.
        value: u16,
    },
    /// Split and duplex: an answer to `0F`.
    Split {
        /// The state.
        split: Split,
    },
    /// The RIT and ΔTX offset: an answer to `21 00`.
    RitOffset {
        /// Offset, Hz, from -9999 to 9999.
        hz: i32,
    },
    /// RIT on or off: an answer to `21 01`.
    Rit {
        /// True with RIT on.
        on: bool,
    },
    /// ΔTX (XIT) on or off: an answer to `21 02`.
    Xit {
        /// True with ΔTX on.
        on: bool,
    },
    /// A frame from the controller to the radio sent back by CI-V USB Echo Back.
    Echo {
        /// Its command.
        command: u8,
    },
    /// A frame between other addresses.
    OtherAddress {
        /// Receiving address.
        to: u8,
        /// Sending address.
        from: u8,
        /// Command.
        command: u8,
    },
    /// A frame from the radio with a command RR73 does not use, such as scope data (`27 00`).
    Unknown {
        /// Command.
        command: u8,
        /// Sub-command and data.
        data: Vec<u8>,
    },
    /// A frame from the radio with a known command whose data does not parse.
    Malformed {
        /// Command.
        command: u8,
        /// What is wrong.
        fault: Fault,
    },
    /// Bytes that were not part of a frame. A port that sends only noise is not a CI-V port,
    /// such as the IC-705's USB (B) port.
    Noise {
        /// Bytes dropped.
        bytes: usize,
    },
}

fn frequency(command: u8, data: &[u8], transceive: bool) -> Event {
    match bcd::decode_frequency(data) {
        Ok(hz) => Event::Frequency { hz, transceive },
        Err(e) => Event::Malformed {
            command,
            fault: e.into(),
        },
    }
}

fn mode(command: u8, data: &[u8], transceive: bool) -> Event {
    let bad = |fault| Event::Malformed { command, fault };
    let (m, f) = match data {
        [m] => (*m, None),
        [m, f] => (*m, Some(*f)),
        _ => return bad(Fault::Length),
    };
    let Some(mode) = Mode::from_code(m) else {
        return bad(Fault::Code);
    };
    let filter = match f.map(Filter::from_code) {
        None => None,
        Some(Some(filter)) => Some(filter),
        Some(None) => return bad(Fault::Code),
    };
    Event::Mode {
        mode,
        filter,
        transceive,
    }
}

fn flag(b: u8) -> Option<bool> {
    match b {
        0x00 => Some(false),
        0x01 => Some(true),
        _ => None,
    }
}

fn settings(data: &[u8]) -> Event {
    let bad = |fault| Event::Malformed {
        command: CMD_SETTINGS,
        fault,
    };
    match data {
        [SUB_DATA_MODE, on, f] => {
            let Some(on) = flag(*on) else {
                return bad(Fault::Code);
            };
            let filter = match (*f, Filter::from_code(*f)) {
                (0, _) => None,
                (_, Some(filter)) => Some(filter),
                (_, None) => return bad(Fault::Code),
            };
            Event::DataMode { on, filter }
        }
        // The guide gives the data mode and its filter (p. 22). An answer with the data mode
        // alone is read too, with no filter.
        [SUB_DATA_MODE, on] => match flag(*on) {
            Some(on) => Event::DataMode { on, filter: None },
            None => bad(Fault::Code),
        },
        [SUB_DATA_MODE, ..] => bad(Fault::Length),
        [SUB_MENU, a, b, value @ ..] => {
            let Some(item) = MenuItem::from_bytes([*a, *b]) else {
                return Event::Unknown {
                    command: CMD_SETTINGS,
                    data: data.to_vec(),
                };
            };
            if value.is_empty() || value.len() > 2 {
                return bad(Fault::Length);
            }
            match bcd::decode_be(value) {
                Ok(v) if v <= u32::from(item.max_value()) => Event::Setting {
                    item,
                    value: v as u16,
                },
                Ok(_) => bad(Fault::Range),
                Err(e) => bad(e.into()),
            }
        }
        _ => Event::Unknown {
            command: CMD_SETTINGS,
            data: data.to_vec(),
        },
    }
}

fn status(data: &[u8]) -> Event {
    match data {
        [SUB_TRANSMIT, b] => match flag(*b) {
            Some(on) => Event::Transmit { on },
            None => Event::Malformed {
                command: CMD_STATUS,
                fault: Fault::Code,
            },
        },
        [SUB_TRANSMIT, ..] => Event::Malformed {
            command: CMD_STATUS,
            fault: Fault::Length,
        },
        _ => Event::Unknown {
            command: CMD_STATUS,
            data: data.to_vec(),
        },
    }
}

fn split(data: &[u8]) -> Event {
    let bad = |fault| Event::Malformed {
        command: CMD_SPLIT,
        fault,
    };
    match data {
        [code] => Split::from_code(*code).map_or_else(|| bad(Fault::Code), |split| Event::Split { split }),
        _ => bad(Fault::Length),
    }
}

fn rit(data: &[u8]) -> Event {
    let bad = |fault| Event::Malformed {
        command: CMD_RIT,
        fault,
    };
    let on = |b: &[u8]| match b {
        [v] => flag(*v).ok_or(Fault::Code),
        _ => Err(Fault::Length),
    };
    match data {
        [SUB_RIT_OFFSET, offset @ ..] => {
            decode_rit_offset(offset).map_or_else(bad, |hz| Event::RitOffset { hz })
        }
        [SUB_RIT, v @ ..] => on(v).map_or_else(bad, |on| Event::Rit { on }),
        [SUB_XIT, v @ ..] => on(v).map_or_else(bad, |on| Event::Xit { on }),
        _ => Event::Unknown {
            command: CMD_RIT,
            data: data.to_vec(),
        },
    }
}

fn vfo_frequency(data: &[u8]) -> Event {
    let bad = |fault| Event::Malformed {
        command: CMD_VFO_FREQUENCY,
        fault,
    };
    let [v, f @ ..] = data else {
        return bad(Fault::Length);
    };
    let Some(vfo) = Vfo::from_code(*v) else {
        return bad(Fault::Code);
    };
    match bcd::decode_frequency(f) {
        Ok(hz) => Event::VfoFrequency { vfo, hz },
        Err(e) => bad(e.into()),
    }
}

fn vfo_mode(data: &[u8]) -> Event {
    let bad = |fault| Event::Malformed {
        command: CMD_VFO_MODE,
        fault,
    };
    let (v, m, d, f) = match data {
        [v, m] => (*v, *m, None, None),
        [v, m, d] => (*v, *m, Some(*d), None),
        [v, m, d, f] => (*v, *m, Some(*d), Some(*f)),
        _ => return bad(Fault::Length),
    };
    let (Some(vfo), Some(mode)) = (Vfo::from_code(v), Mode::from_code(m)) else {
        return bad(Fault::Code);
    };
    let data = match d.map(flag) {
        None => None,
        Some(Some(on)) => Some(on),
        Some(None) => return bad(Fault::Code),
    };
    let filter = match f.map(Filter::from_code) {
        None => None,
        Some(Some(filter)) => Some(filter),
        Some(None) => return bad(Fault::Code),
    };
    Event::VfoMode {
        vfo,
        mode,
        data,
        filter,
    }
}

/// What one frame says, for a link with addresses `a`. Never panics.
pub fn parse_frame(frame: &Frame, a: Addresses) -> Event {
    if frame.from == a.controller && frame.to == a.radio {
        return Event::Echo {
            command: frame.command,
        };
    }
    // From the radio, only frames to this controller answer it, and transceive frames to any
    // controller (`00`) report the dial: an OK or NG to another controller on the same bus is not
    // an answer to RR73.
    let transceive = frame.command == CMD_TRANSCEIVE_FREQUENCY || frame.command == CMD_TRANSCEIVE_MODE;
    let ours = frame.to == a.controller || (transceive && frame.to == 0x00);
    if frame.from != a.radio || !ours {
        return Event::OtherAddress {
            to: frame.to,
            from: frame.from,
            command: frame.command,
        };
    }
    let data = frame.data.as_slice();
    match frame.command {
        OK | NG if !data.is_empty() => Event::Malformed {
            command: frame.command,
            fault: Fault::Length,
        },
        OK => Event::Ok,
        NG => Event::Ng,
        CMD_TRANSCEIVE_FREQUENCY => frequency(frame.command, data, true),
        CMD_READ_FREQUENCY => frequency(frame.command, data, false),
        CMD_TRANSCEIVE_MODE => mode(frame.command, data, true),
        CMD_READ_MODE => mode(frame.command, data, false),
        CMD_SETTINGS => settings(data),
        CMD_STATUS => status(data),
        CMD_VFO_FREQUENCY => vfo_frequency(data),
        CMD_VFO_MODE => vfo_mode(data),
        CMD_SPLIT => split(data),
        CMD_RIT => rit(data),
        command => Event::Unknown {
            command,
            data: data.to_vec(),
        },
    }
}

/// Streaming reader for one link: push the bytes the port delivers and get back events in
/// order. Never panics on input.
#[derive(Debug, Clone)]
pub struct Parser {
    addresses: Addresses,
    frames: FrameDecoder,
}

impl Parser {
    /// A parser for frames between the controller and the radio at `addresses`.
    pub fn new(addresses: Addresses) -> Self {
        Self {
            addresses,
            frames: FrameDecoder::new(),
        }
    }

    /// The addresses the parser was made with.
    pub fn addresses(&self) -> Addresses {
        self.addresses
    }

    /// Reads bytes in chunks of any size and returns the events they complete.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Event> {
        self.frames
            .push(bytes)
            .into_iter()
            .map(|d| match d {
                Decoded::Frame(f) => parse_frame(&f, self.addresses),
                Decoded::Noise(bytes) => Event::Noise { bytes },
            })
            .collect()
    }

    /// Forgets a frame in progress, as after reopening the port.
    pub fn reset(&mut self) {
        self.frames.reset();
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn answers_to_another_controller_are_not_ours() {
        let a = Addresses::default();
        let ok_to_other = Frame {
            to: 0xE1,
            from: a.radio,
            command: OK,
            data: vec![],
        };
        assert!(matches!(parse_frame(&ok_to_other, a), Event::OtherAddress { .. }));
        let ok_to_us = Frame {
            to: a.controller,
            from: a.radio,
            command: OK,
            data: vec![],
        };
        assert!(matches!(parse_frame(&ok_to_us, a), Event::Ok));
    }

    #[test]
    fn simplex_reads_as_split_off() {
        assert_eq!(Split::from_code(0x10), Some(Split::Off));
        assert_eq!(Split::from_code(0x02), None);
    }

    use super::*;
    use crate::bcd::MAX_FREQUENCY_HZ;

    const A: Addresses = Addresses {
        radio: 0xA4,
        controller: 0xE0,
    };

    fn from_radio(command: u8, data: &[u8]) -> Event {
        parse_frame(&Frame::new(0xE0, 0xA4, command, data), A)
    }

    #[test]
    fn mode_codes_match_page_17() {
        let codes: Vec<u8> = Mode::ALL.iter().map(|m| m.code()).collect();
        assert_eq!(
            codes,
            [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x17]
        );
        for m in Mode::ALL {
            assert_eq!(Mode::from_code(m.code()), Some(m));
        }
        assert_eq!(Mode::from_code(0x09), None);
        assert_eq!(Mode::from_code(0x11), None);
        assert!(Mode::Usb.has_data_mode() && !Mode::Cw.has_data_mode());
    }

    #[test]
    fn menu_items_match_pages_6_and_8() {
        let bytes: Vec<[u8; 2]> = MenuItem::ALL.iter().map(|i| i.bytes()).collect();
        assert_eq!(
            bytes,
            [
                [0x00, 0x43],
                [0x01, 0x18],
                [0x01, 0x19],
                [0x01, 0x25],
                [0x01, 0x31],
                [0x01, 0x32]
            ]
        );
        for i in MenuItem::ALL {
            assert_eq!(MenuItem::from_bytes(i.bytes()), Some(i));
        }
    }

    #[test]
    fn data_mode_on_needs_a_filter() {
        assert_eq!(
            Request::SetDataMode {
                on: true,
                filter: None
            }
            .encode(A),
            Err(RequestError::DataFilter)
        );
        // Off sends 00 for the filter whatever the request says (p. 22).
        assert_eq!(
            Request::SetDataMode {
                on: false,
                filter: Some(Filter::Fil2)
            }
            .encode(A),
            Ok(vec![0xFE, 0xFE, 0xA4, 0xE0, 0x1A, 0x06, 0x00, 0x00, 0xFD])
        );
    }

    #[test]
    fn frequencies_above_the_format_are_refused() {
        assert_eq!(
            Request::SetFrequency { hz: 500_000_000 }.encode(A),
            Err(RequestError::Frequency(500_000_000))
        );
        assert!(Request::SetFrequency { hz: MAX_FREQUENCY_HZ }.encode(A).is_ok());
    }

    #[test]
    fn a_reserved_radio_address_is_refused() {
        let a = Addresses {
            radio: 0xFD,
            controller: 0xE0,
        };
        assert!(matches!(
            Request::ReadFrequency.encode(a),
            Err(RequestError::Frame(FrameError::Reserved { index: 0, .. }))
        ));
    }

    #[test]
    fn bad_replies_are_malformed() {
        assert_eq!(
            from_radio(0x03, &[0x00, 0x40, 0x07, 0x14]),
            Event::Malformed {
                command: 0x03,
                fault: Fault::Length
            }
        );
        assert_eq!(
            from_radio(0x03, &[0x0A, 0x40, 0x07, 0x14, 0x00]),
            Event::Malformed {
                command: 0x03,
                fault: Fault::NotBcd
            }
        );
        assert_eq!(
            from_radio(0x04, &[0x09, 0x01]),
            Event::Malformed {
                command: 0x04,
                fault: Fault::Code
            }
        );
        assert_eq!(
            from_radio(0x04, &[0x01, 0x04]),
            Event::Malformed {
                command: 0x04,
                fault: Fault::Code
            }
        );
        assert_eq!(
            from_radio(0x1C, &[0x00, 0x02]),
            Event::Malformed {
                command: 0x1C,
                fault: Fault::Code
            }
        );
        assert_eq!(
            from_radio(0x1A, &[0x05, 0x01, 0x19, 0x04]),
            Event::Malformed {
                command: 0x1A,
                fault: Fault::Range
            }
        );
        assert_eq!(
            from_radio(0xFB, &[0x00]),
            Event::Malformed {
                command: 0xFB,
                fault: Fault::Length
            }
        );
        assert_eq!(
            from_radio(0x27, &[0x00, 0x01]),
            Event::Unknown {
                command: 0x27,
                data: vec![0x00, 0x01]
            }
        );
    }

    #[test]
    fn echoes_and_other_addresses_are_told_apart() {
        let echo = Frame::new(0xA4, 0xE0, 0x03, []);
        assert_eq!(parse_frame(&echo, A), Event::Echo { command: 0x03 });
        let other = Frame::new(0xE0, 0x94, 0x03, []);
        assert_eq!(
            parse_frame(&other, A),
            Event::OtherAddress {
                to: 0xE0,
                from: 0x94,
                command: 0x03
            }
        );
        // A frame from the radio to another address still counts: transceive frames may carry one.
        assert_eq!(
            parse_frame(&Frame::new(0x00, 0xA4, 0x00, [0x00, 0x40, 0x07, 0x14, 0x00]), A),
            Event::Frequency {
                hz: 14_074_000,
                transceive: true
            }
        );
    }

    #[test]
    fn requests_and_events_have_a_json_form() {
        let r: Request =
            serde_json::from_str(r#"{"type":"set_mode","mode":"usb","filter":1}"#).expect("json");
        assert_eq!(
            r,
            Request::SetMode {
                mode: Mode::Usb,
                filter: Some(Filter::Fil1)
            }
        );
        let r: Request = serde_json::from_str(r#"{"type":"set_mode","mode":"rtty-r"}"#).expect("json");
        assert_eq!(
            r,
            Request::SetMode {
                mode: Mode::RttyR,
                filter: None
            }
        );
        assert!(serde_json::from_str::<Request>(r#"{"type":"set_mode","mode":"usb","filter":4}"#).is_err());
        let e = serde_json::to_string(&Event::Mode {
            mode: Mode::Usb,
            filter: Some(Filter::Fil1),
            transceive: true,
        })
        .expect("json");
        assert_eq!(e, r#"{"type":"mode","mode":"usb","filter":1,"transceive":true}"#);
        let back: Event = serde_json::from_str(&e).expect("json");
        assert!(matches!(back, Event::Mode { transceive: true, .. }));
        assert_eq!(
            serde_json::to_string(&Request::ReadSetting {
                item: MenuItem::DataMod
            })
            .expect("json"),
            r#"{"type":"read_setting","item":"data_mod"}"#
        );
    }
}
