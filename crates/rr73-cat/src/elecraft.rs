//! The Elecraft KX2 commands RR73 uses, as typed requests and parsed events.
//!
//! Elecraft's protocol is text: a command of 2 or 3 letters, optional data, and a semicolon
//! (Programmer's Reference p. 3). A read ("GET") is the letters and the semicolon alone; the
//! answer repeats the letters with the data. A set ("SET") has no answer, so each set RR73 sends is
//! followed by the read of the same command, and the read's answer says whether the radio took it.
//!
//! | Request | Sent | Answer | Programmer's Reference |
//! | --- | --- | --- | --- |
//! | Read VFO A | `FA;` | `FA` and 11 digits, Hz | p. 11 |
//! | Set VFO A | `FA00014074000;FA;` | as the read | p. 11 |
//! | Read the mode | `MD;` | `MD` and the mode's digit | p. 16 |
//! | Set the mode | `MD6;MD;` | as the read | p. 16 |
//! | Read the data sub-mode | `DT;` | `DT` and the sub-mode's digit | p. 11 |
//! | Set the data sub-mode | `DT0;DT;` | as the read | p. 11 |
//! | Read transmit or receive | `TQ;` | `TQ0;` receive, `TQ1;` transmit | p. 27 |
//! | Transmit, receive | `TX;TQ;`, `RX;TQ;` | as the read | p. 28, p. 23, p. 27 |
//! | Read the option modules and the product | `OM;` | `OM`, a space, 12 characters | p. 21 |
//! | Read VOX in the present mode | `VX;` | `VX0;` off, `VX1;` on | p. 28 |
//! | Read the menu entry shown | `MN;` | `MN` and 3 digits, `MN255;` with no menu | p. 17 |
//! | Read a menu setting | `MN082;MP;MN255;` | `MP` and 3 digits | pp. 17, 19, 20 |
//! | Leave the menu | `MN255;MN;` | `MN255;` | p. 17 |
//! | Read general information | `IF;` | `IF`, 35 characters | p. 14 |
//! | Read the filter bandwidth | `BW;` | `BW` and 4 digits, 10 Hz units | p. 8 |
//! | Read the K2 command mode | `K2;` | `K2` and a digit, 0 to 3 | pp. 4, 14 |
//!
//! The radio answers `?;` to a command it cannot handle in its present state, such as some
//! commands while it transmits (p. 3): [`Event::Busy`]. With auto-info on (`AI1`, or the AUTOINF
//! menu entry, p. 4 and Owner's Manual p. 35) it sends `IF` answers by itself when the dial or the
//! mode changes: [`Event::Info`]. On a band change it reports the new values of several commands by
//! itself (p. 11, note 7), which the parser reads as answers of their commands.
//!
//! Sources, cited by printed page:
//!
//! - Elecraft K3S/K3/KX3/KX2 Programmer's Reference, Rev. G5, 20 February 2019 ("Programmer's
//!   Reference").
//! - Elecraft KX2 Owner's Manual, Rev. B2, 22 March 2023 ("Owner's Manual").
//!
//! The documents give no character format for the serial port, only its rate (Owner's Manual
//! p. 49), and no complete `IF` answer: the parser follows the field layout on p. 14.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The end of every command and answer (Programmer's Reference p. 3).
pub const TERMINATOR: u8 = b';';

/// The longest answer the parser holds before it drops the bytes as noise. The longest RR73 reads
/// is `IF`, 38 bytes with its letters and semicolon (p. 14).
pub const MAX_ANSWER: usize = 64;

/// The highest frequency the 11-digit format carries, Hz (p. 11).
pub const MAX_FREQUENCY_HZ: u64 = 99_999_999_999;

/// The answer to `MN;` when no menu entry is shown (p. 17).
pub const MENU_NONE: u16 = 255;

/// Operating modes and their digits (Programmer's Reference p. 16, `MD`). There is no 8.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    /// 1.
    Lsb,
    /// 2.
    Usb,
    /// 3.
    Cw,
    /// 4. Not on the KX2 (p. 16, note 4).
    Fm,
    /// 5.
    Am,
    /// 6, DATA: the data sub-mode last used on the band (p. 16, note 2; `DT`, p. 11).
    Data,
    /// 7.
    CwRev,
    /// 9, DATA-REV: the data sub-mode on the other sideband.
    DataRev,
}

impl Mode {
    /// Every mode, in digit order.
    pub const ALL: [Mode; 8] = [
        Mode::Lsb,
        Mode::Usb,
        Mode::Cw,
        Mode::Fm,
        Mode::Am,
        Mode::Data,
        Mode::CwRev,
        Mode::DataRev,
    ];

    /// The mode's digit, 1 to 9.
    pub fn code(self) -> u8 {
        match self {
            Mode::Lsb => 1,
            Mode::Usb => 2,
            Mode::Cw => 3,
            Mode::Fm => 4,
            Mode::Am => 5,
            Mode::Data => 6,
            Mode::CwRev => 7,
            Mode::DataRev => 9,
        }
    }

    /// The mode a digit names, or `None` for 0, 8 and anything above 9.
    pub fn from_code(code: u8) -> Option<Mode> {
        Mode::ALL.into_iter().find(|m| m.code() == code)
    }

    /// True for DATA and DATA-REV, where the data sub-mode applies (p. 11).
    pub fn is_data(self) -> bool {
        matches!(self, Mode::Data | Mode::DataRev)
    }
}

/// Data sub-modes and their digits (Programmer's Reference p. 11, `DT`). DATA A carries audio from
/// the computer on USB; AFSK A is audio RTTY on LSB; FSK D and PSK D are the radio's own RTTY and
/// PSK31, which ignore `TX` (p. 28) (Owner's Manual pp. 28 and 43).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DataSubMode {
    /// 0.
    DataA,
    /// 1.
    AfskA,
    /// 2.
    FskD,
    /// 3.
    PskD,
}

impl DataSubMode {
    /// Every sub-mode, in digit order.
    pub const ALL: [DataSubMode; 4] = [
        DataSubMode::DataA,
        DataSubMode::AfskA,
        DataSubMode::FskD,
        DataSubMode::PskD,
    ];

    /// The sub-mode's digit, 0 to 3.
    pub fn code(self) -> u8 {
        match self {
            DataSubMode::DataA => 0,
            DataSubMode::AfskA => 1,
            DataSubMode::FskD => 2,
            DataSubMode::PskD => 3,
        }
    }

    /// The sub-mode a digit names.
    pub fn from_code(code: u8) -> Option<DataSubMode> {
        DataSubMode::ALL.into_iter().find(|s| s.code() == code)
    }

    /// True for FSK D and PSK D, where the radio ignores `TX` (Programmer's Reference p. 28).
    pub fn ignores_tx(self) -> bool {
        matches!(self, DataSubMode::FskD | DataSubMode::PskD)
    }
}

/// Menu settings RR73 reads with `MN` and `MP` (Programmer's Reference pp. 17 to 20). Table 6A
/// numbers the KX2's entries; the KX3 and K3 have their own tables, so these numbers hold only on
/// a KX2 (`OM` names the product, p. 21).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MenuItem {
    /// MIC BTN, entry 082 (p. 19). `MP` gives bit 0 for PTT on the MIC jack's ring and bit 2 for
    /// its UP and DN buttons, each 0 disabled and 1 enabled (p. 20). Default PTT UP.DN (Owner's
    /// Manual p. 48).
    MicBtn,
}

impl MenuItem {
    /// The entry's number in the KX2's table (p. 19).
    pub fn entry(self) -> u16 {
        match self {
            MenuItem::MicBtn => 82,
        }
    }

    /// The bits `MP` gives for the entry; the radio masks the others to 0 (p. 20).
    pub fn mask(self) -> u16 {
        match self {
            MenuItem::MicBtn => 0b101,
        }
    }
}

/// `MIC BTN` with PTT enabled: the MIC jack's ring keys the radio (p. 20, bit 0).
pub const MIC_BTN_PTT: u16 = 0b001;
/// `MIC BTN` with the UP and DN buttons enabled (p. 20, bit 2).
pub const MIC_BTN_UP_DN: u16 = 0b100;

/// A request to the radio. JSON form: `{"type": "set_frequency", "hz": 14074000}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Request {
    /// Read VFO A: `FA;`.
    ReadFrequency,
    /// Set VFO A and read it back: `FA` with 11 digits, then `FA;`.
    SetFrequency {
        /// Frequency, Hz, 0 to 99 999 999 999.
        hz: u64,
    },
    /// Read the mode: `MD;`.
    ReadMode,
    /// Set the mode and read it back: `MD` and the digit, then `MD;`.
    SetMode {
        /// Mode.
        mode: Mode,
    },
    /// Read the data sub-mode: `DT;`. Valid only in DATA and DATA-REV (p. 11).
    ReadDataSubMode,
    /// Set the data sub-mode and read it back: `DT` and the digit, then `DT;`.
    SetDataSubMode {
        /// Sub-mode.
        sub: DataSubMode,
    },
    /// Read transmit or receive: `TQ;`.
    ReadTransmit,
    /// Transmit (`TX;`) or receive (`RX;`), then `TQ;`.
    SetTransmit {
        /// True to transmit.
        on: bool,
    },
    /// Read the option modules and the product: `OM;`.
    ReadOptions,
    /// Read VOX in the present mode: `VX;`.
    ReadVox,
    /// Read the menu entry on the radio's screen: `MN;`.
    ReadMenuEntry,
    /// Read a menu setting: `MN` and the entry, `MP;`, then `MN255;` to leave the menu.
    ReadSetting {
        /// The item.
        item: MenuItem,
    },
    /// Leave the menu and read that it is left: `MN255;MN;`.
    LeaveMenu,
    /// Read general information: `IF;`. VFO A, RIT and XIT, transmit, the mode and split.
    ReadInfo,
    /// Read the receive filter's bandwidth: `BW;`.
    ReadBandwidth,
    /// Read the K2 command mode: `K2;`. In 1 and 3, `MD` and `IF` report DATA as LSB or USB.
    ReadK2Mode,
    /// Read the auto-info mode: `AI;` (p. 7). In 1 and 2 the radio sends `FA`, `MD` and others by
    /// itself on every change, which can be taken for answers.
    ReadAutoInfo,
}

/// Why a request cannot be written.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum RequestError {
    /// The frequency has more than the format's 11 digits (p. 11).
    #[error("{0} Hz has more than the 11 digits an Elecraft frequency carries")]
    Frequency(u64),
}

impl Request {
    /// The letters of the read whose answer answers this request: `FA`, `MD`, `DT`, `TQ`, `OM`,
    /// `VX`, `MN` or `MP`.
    pub fn answer_command(&self) -> &'static str {
        match self {
            Request::ReadFrequency | Request::SetFrequency { .. } => "FA",
            Request::ReadMode | Request::SetMode { .. } => "MD",
            Request::ReadDataSubMode | Request::SetDataSubMode { .. } => "DT",
            Request::ReadTransmit | Request::SetTransmit { .. } => "TQ",
            Request::ReadOptions => "OM",
            Request::ReadVox => "VX",
            Request::ReadMenuEntry | Request::LeaveMenu => "MN",
            Request::ReadSetting { .. } => "MP",
            Request::ReadInfo => "IF",
            Request::ReadBandwidth => "BW",
            Request::ReadK2Mode => "K2",
            Request::ReadAutoInfo => "AI",
        }
    }

    /// True for requests that change the radio: they carry a set and the read that checks it.
    pub fn is_set(&self) -> bool {
        matches!(
            self,
            Request::SetFrequency { .. }
                | Request::SetMode { .. }
                | Request::SetDataSubMode { .. }
                | Request::SetTransmit { .. }
                | Request::LeaveMenu
        )
    }

    /// The request as text.
    pub fn text(&self) -> Result<String, RequestError> {
        Ok(match *self {
            Request::ReadFrequency => "FA;".to_string(),
            Request::SetFrequency { hz } => {
                if hz > MAX_FREQUENCY_HZ {
                    return Err(RequestError::Frequency(hz));
                }
                format!("FA{hz:011};FA;")
            }
            Request::ReadMode => "MD;".to_string(),
            Request::SetMode { mode } => format!("MD{};MD;", mode.code()),
            Request::ReadDataSubMode => "DT;".to_string(),
            Request::SetDataSubMode { sub } => format!("DT{};DT;", sub.code()),
            Request::ReadTransmit => "TQ;".to_string(),
            Request::SetTransmit { on: true } => "TX;TQ;".to_string(),
            Request::SetTransmit { on: false } => "RX;TQ;".to_string(),
            Request::ReadOptions => "OM;".to_string(),
            Request::ReadVox => "VX;".to_string(),
            Request::ReadMenuEntry => "MN;".to_string(),
            Request::ReadSetting { item } => format!("MN{:03};MP;MN{MENU_NONE};", item.entry()),
            Request::LeaveMenu => format!("MN{MENU_NONE};MN;"),
            Request::ReadInfo => "IF;".to_string(),
            Request::ReadBandwidth => "BW;".to_string(),
            Request::ReadK2Mode => "K2;".to_string(),
            Request::ReadAutoInfo => "AI;".to_string(),
        })
    }

    /// The request's bytes on the wire.
    pub fn encode(&self) -> Result<Vec<u8>, RequestError> {
        self.text().map(String::into_bytes)
    }

    /// True when `event` is the radio's answer to this request: the read of its command, `?;`, or
    /// a garbled answer of its command. Answers of other commands, `IF` and noise answer nothing.
    pub fn answered_by(&self, event: &Event) -> bool {
        match (self, event) {
            (_, Event::Busy) => true,
            (Request::ReadFrequency | Request::SetFrequency { .. }, Event::Frequency { .. }) => true,
            (Request::ReadMode | Request::SetMode { .. }, Event::Mode { .. }) => true,
            (Request::ReadDataSubMode | Request::SetDataSubMode { .. }, Event::DataSubMode { .. }) => true,
            (Request::ReadTransmit | Request::SetTransmit { .. }, Event::Transmit { .. }) => true,
            (Request::ReadOptions, Event::Options { .. }) => true,
            (Request::ReadVox, Event::Vox { .. }) => true,
            (Request::ReadMenuEntry | Request::LeaveMenu, Event::MenuEntry { .. }) => true,
            (Request::ReadSetting { .. }, Event::MenuValue { .. }) => true,
            (Request::ReadInfo, Event::Info { .. }) => true,
            (Request::ReadBandwidth, Event::Bandwidth { .. }) => true,
            (Request::ReadK2Mode, Event::K2Mode { .. }) => true,
            (Request::ReadAutoInfo, Event::AutoInfo { .. }) => true,
            (r, Event::Malformed { command, .. }) => r.answer_command() == command,
            _ => false,
        }
    }

    /// True when `event` answers this request and says the radio did what it asked: the read's
    /// data for a read, and for a set a read-back equal to what was set. The Hz digit of VFO A is
    /// ignored outside FINE tuning (p. 11), so a frequency set counts as taken when the read-back
    /// matches to 10 Hz. `?;` and a garbled answer accept nothing.
    pub fn accepted_by(&self, event: &Event) -> bool {
        if !self.answered_by(event) {
            return false;
        }
        match (self, event) {
            (_, Event::Busy | Event::Malformed { .. }) => false,
            (Request::SetFrequency { hz }, Event::Frequency { hz: got, .. }) => got / 10 == hz / 10,
            (Request::SetMode { mode }, Event::Mode { mode: got, .. }) => got == mode,
            (Request::SetDataSubMode { sub }, Event::DataSubMode { sub: got }) => got == sub,
            (Request::SetTransmit { on }, Event::Transmit { on: got }) => got == on,
            (Request::LeaveMenu, Event::MenuEntry { entry }) => *entry == MENU_NONE,
            _ => true,
        }
    }
}

/// Why an answer from the radio did not parse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Fault {
    /// The data has the wrong number of characters for the command.
    Length,
    /// A character that should be a digit is not.
    Digits,
    /// A digit or code the reference does not list for the command.
    Code,
}

/// What an answer from the radio says. JSON form: `{"type": "frequency", "hz": 14074000,
/// "transceive": false}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// VFO A, Hz: `FA`. The radio sends the same answer by itself on a band change and with
    /// auto-info mode 2, so an `FA` cannot be told from an answer: `transceive` is always false.
    Frequency {
        /// Frequency, Hz.
        hz: u64,
        /// Always false.
        transceive: bool,
    },
    /// The mode: `MD`. Always `transceive: false`, as for [`Event::Frequency`].
    Mode {
        /// Mode.
        mode: Mode,
        /// Always false.
        transceive: bool,
    },
    /// The data sub-mode: `DT`.
    DataSubMode {
        /// Sub-mode.
        sub: DataSubMode,
    },
    /// Transmit or receive: `TQ`. `TQ1` also covers TX TEST and the radio armed to transmit
    /// (p. 27).
    Transmit {
        /// True while transmitting.
        on: bool,
    },
    /// General information: `IF` (p. 14), as an answer to `IF;` or sent by the radio itself with
    /// auto-info on.
    Info {
        /// VFO A without any RIT or XIT offset, Hz.
        hz: u64,
        /// The mode, when its digit is one p. 16 lists.
        mode: Option<Mode>,
        /// The transmit flag.
        transmit: bool,
        /// RIT on.
        rit: bool,
        /// XIT on: the radio transmits `offset_hz` from VFO A.
        xit: bool,
        /// The RIT and XIT offset, Hz, -9999 to 9999.
        offset_hz: i32,
        /// Split on: the radio transmits on VFO B.
        split: bool,
    },
    /// The option modules and the product: `OM` (p. 21).
    Options {
        /// The product number in the last two characters: 1 for the KX2, 2 for the KX3. `None`
        /// where they are not digits, as in the K3's answer.
        product: Option<u8>,
        /// The module letters and dashes before it.
        modules: String,
    },
    /// VOX in the present mode: `VX` (p. 28).
    Vox {
        /// True with VOX on.
        on: bool,
    },
    /// The menu entry shown: `MN`, 255 with none (p. 17).
    MenuEntry {
        /// Entry number.
        entry: u16,
    },
    /// The shown menu entry's value: `MP`, 0 to 255 (p. 20).
    MenuValue {
        /// Value.
        value: u16,
    },
    /// The receive filter's bandwidth: `BW` (p. 8).
    Bandwidth {
        /// Bandwidth, Hz, in steps of 10 Hz.
        hz: u32,
    },
    /// The K2 command mode: `K2` (p. 14). 1 and 3 make `MD` and `IF` report DATA as LSB or USB
    /// (p. 4; p. 16, note 2).
    K2Mode {
        /// 0 to 3.
        mode: u8,
    },
    /// The auto-info mode: `AI` (p. 7), 0 to 3. 0 sends nothing unasked.
    AutoInfo {
        /// 0 to 3.
        mode: u8,
    },
    /// `?;`: the radio could not handle a command in its present state (p. 3).
    Busy,
    /// A well-formed answer of a command RR73 does not use, such as `FB` after a band change.
    Unknown {
        /// Its letters.
        command: String,
    },
    /// An answer of a command RR73 uses whose data does not parse.
    Malformed {
        /// Its letters.
        command: String,
        /// What is wrong.
        fault: Fault,
    },
    /// Bytes that were not part of an answer: control characters, bytes above 7E, text that does
    /// not start with a letter, or more than [`MAX_ANSWER`] bytes without a semicolon. A port at
    /// another baud rate than the radio's sends these.
    Noise {
        /// Bytes dropped.
        bytes: usize,
    },
}

fn digits(s: &str) -> Option<u64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// One digit, as `MD`, `DT`, `TQ` and `VX` carry.
fn digit(command: &str, data: &str) -> Result<u8, Event> {
    let bad = |fault| Event::Malformed {
        command: command.to_string(),
        fault,
    };
    match data.as_bytes() {
        [d] if d.is_ascii_digit() => Ok(d - b'0'),
        [_] => Err(bad(Fault::Digits)),
        _ => Err(bad(Fault::Length)),
    }
}

fn flag(command: &str, data: &str) -> Result<bool, Event> {
    match digit(command, data)? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(Event::Malformed {
            command: command.to_string(),
            fault: Fault::Code,
        }),
    }
}

fn three_digits(command: &str, data: &str) -> Result<u16, Event> {
    let bad = |fault| Event::Malformed {
        command: command.to_string(),
        fault,
    };
    if data.len() != 3 {
        return Err(bad(Fault::Length));
    }
    match digits(data) {
        Some(v) => Ok(v as u16),
        None => Err(bad(Fault::Digits)),
    }
}

/// `IF` (p. 14): the 11 frequency digits, 5 spaces, the RIT/XIT sign and 4 digits, RIT, XIT, a
/// space, `00`, then the transmit flag, the mode, the receive VFO, scan and split at characters 27
/// to 31 of the data.
fn info(data: &str) -> Event {
    let bad = |fault| Event::Malformed {
        command: "IF".to_string(),
        fault,
    };
    let b = data.as_bytes();
    if b.len() < 31 {
        return bad(Fault::Length);
    }
    let Some(hz) = data.get(..11).and_then(digits) else {
        return bad(Fault::Digits);
    };
    let sign = match b[16] {
        b'+' | b' ' => 1,
        b'-' => -1,
        _ => return bad(Fault::Code),
    };
    let Some(offset) = data.get(17..21).and_then(digits) else {
        return bad(Fault::Digits);
    };
    let transmit = match b[26] {
        b'0' => false,
        b'1' => true,
        _ => return bad(Fault::Code),
    };
    let mode = if b[27].is_ascii_digit() {
        Mode::from_code(b[27] - b'0')
    } else {
        None
    };
    Event::Info {
        hz,
        mode,
        transmit,
        rit: b[21] == b'1',
        xit: b[22] == b'1',
        offset_hz: sign * offset as i32,
        split: b[30] == b'1',
    }
}

/// `OM` (p. 21): a space, then the module letters and dashes, the last two characters the product
/// number on the KX2 and KX3.
fn options(data: &str) -> Event {
    let body = data.trim();
    let product = body
        .len()
        .checked_sub(2)
        .and_then(|i| body.get(i..))
        .and_then(digits)
        .map(|p| p as u8);
    let modules = match product {
        Some(_) => body.get(..body.len() - 2).unwrap_or_default(),
        None => body,
    };
    Event::Options {
        product,
        modules: modules.to_string(),
    }
}

/// The letters an answer starts with: up to 3 upper-case letters, and a `$` for VFO B (p. 2).
fn command_of(text: &str) -> &str {
    let n = text
        .bytes()
        .take(3)
        .take_while(|b| b.is_ascii_uppercase())
        .count();
    let n = if text.as_bytes().get(n) == Some(&b'$') {
        n + 1
    } else {
        n
    };
    &text[..n]
}

/// Parses one answer, the text before its semicolon.
pub fn parse_answer(text: &str) -> Event {
    if text == "?" {
        return Event::Busy;
    }
    // The answers RR73 uses have 2 letters; the others are named by their letters only.
    let known = |c: &str| text.starts_with(c) && text.as_bytes().get(2) != Some(&b'$');
    let data = text.get(2..).unwrap_or_default();
    let result = if known("FA") {
        match (data.len(), digits(data)) {
            (11, Some(hz)) => Ok(Event::Frequency {
                hz,
                transceive: false,
            }),
            (11, None) => Err(Fault::Digits),
            _ => Err(Fault::Length),
        }
        .map_err(|fault| Event::Malformed {
            command: "FA".to_string(),
            fault,
        })
    } else if known("IF") {
        Ok(info(data))
    } else if known("MD") {
        digit("MD", data).and_then(|d| {
            Mode::from_code(d)
                .map(|mode| Event::Mode {
                    mode,
                    transceive: false,
                })
                .ok_or(Event::Malformed {
                    command: "MD".to_string(),
                    fault: Fault::Code,
                })
        })
    } else if known("DT") {
        digit("DT", data).and_then(|d| {
            DataSubMode::from_code(d)
                .map(|sub| Event::DataSubMode { sub })
                .ok_or(Event::Malformed {
                    command: "DT".to_string(),
                    fault: Fault::Code,
                })
        })
    } else if known("TQ") {
        flag("TQ", data).map(|on| Event::Transmit { on })
    } else if known("OM") {
        Ok(options(data))
    } else if known("VX") {
        flag("VX", data).map(|on| Event::Vox { on })
    } else if known("MN") {
        three_digits("MN", data).map(|entry| Event::MenuEntry { entry })
    } else if known("MP") {
        three_digits("MP", data).map(|value| Event::MenuValue { value })
    } else if known("BW") {
        match (data.len(), digits(data)) {
            (4, Some(v)) => Ok(Event::Bandwidth { hz: v as u32 * 10 }),
            (4, None) => Err(Fault::Digits),
            _ => Err(Fault::Length),
        }
        .map_err(|fault| Event::Malformed {
            command: "BW".to_string(),
            fault,
        })
    } else if known("AI") {
        digit("AI", data).and_then(|mode| {
            if mode <= 3 {
                Ok(Event::AutoInfo { mode })
            } else {
                Err(Event::Malformed {
                    command: "AI".to_string(),
                    fault: Fault::Code,
                })
            }
        })
    } else if known("K2") {
        digit("K2", data).and_then(|mode| {
            if mode <= 3 {
                Ok(Event::K2Mode { mode })
            } else {
                Err(Event::Malformed {
                    command: "K2".to_string(),
                    fault: Fault::Code,
                })
            }
        })
    } else {
        Ok(Event::Unknown {
            command: command_of(text).to_string(),
        })
    };
    match result {
        Ok(e) | Err(e) => e,
    }
}

/// Streaming reader of the radio's answers. Push the bytes of a port in any chunks; the same
/// bytes give the same events whatever the chunk boundaries.
#[derive(Debug, Clone, Default)]
pub struct Parser {
    answer: Vec<u8>,
}

impl Parser {
    /// A parser with nothing held.
    pub fn new() -> Self {
        Self::default()
    }

    /// Forgets an answer in progress, as after reopening the port.
    pub fn reset(&mut self) {
        self.answer.clear();
    }

    /// Reads bytes and returns the events they complete, oldest first. Never panics.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Event> {
        let mut out = Vec::new();
        let mut noise = 0usize;
        let flush_noise = |noise: &mut usize, out: &mut Vec<Event>| {
            if *noise > 0 {
                out.push(Event::Noise { bytes: *noise });
                *noise = 0;
            }
        };
        for &b in bytes {
            if b == TERMINATOR {
                if self.answer.is_empty() {
                    noise += 1;
                    continue;
                }
                let text = String::from_utf8_lossy(&self.answer).into_owned();
                self.answer.clear();
                flush_noise(&mut noise, &mut out);
                out.push(parse_answer(&text));
                continue;
            }
            let printable = (0x20..=0x7E).contains(&b);
            let starts = b.is_ascii_uppercase() || b == b'?';
            if !printable || (self.answer.is_empty() && !starts) {
                noise += self.answer.len() + 1;
                self.answer.clear();
                continue;
            }
            if self.answer.len() >= MAX_ANSWER {
                noise += self.answer.len();
                self.answer.clear();
                if !starts {
                    noise += 1;
                    continue;
                }
            }
            self.answer.push(b);
        }
        flush_noise(&mut noise, &mut out);
        out
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_the_auto_info_mode() {
        let mut p = Parser::default();
        assert_eq!(p.push(b"AI2;"), vec![Event::AutoInfo { mode: 2 }]);
        assert_eq!(Request::ReadAutoInfo.encode(), Ok(b"AI;".to_vec()));
    }

    use super::*;

    fn events(text: &str) -> Vec<Event> {
        Parser::new().push(text.as_bytes())
    }

    #[test]
    fn mode_digits_match_page_16() {
        let digits: Vec<u8> = Mode::ALL.iter().map(|m| m.code()).collect();
        assert_eq!(digits, [1, 2, 3, 4, 5, 6, 7, 9]);
        assert_eq!(Mode::from_code(8), None);
        assert_eq!(Mode::from_code(0), None);
        assert!(Mode::Data.is_data() && Mode::DataRev.is_data() && !Mode::Usb.is_data());
    }

    #[test]
    fn data_sub_modes_match_page_11() {
        let digits: Vec<u8> = DataSubMode::ALL.iter().map(|s| s.code()).collect();
        assert_eq!(digits, [0, 1, 2, 3]);
        assert!(DataSubMode::FskD.ignores_tx() && DataSubMode::PskD.ignores_tx());
        assert!(!DataSubMode::DataA.ignores_tx() && !DataSubMode::AfskA.ignores_tx());
    }

    #[test]
    fn requests_as_text() {
        let t = |r: Request| r.text().expect("text");
        assert_eq!(t(Request::ReadFrequency), "FA;");
        assert_eq!(t(Request::SetFrequency { hz: 14_074_000 }), "FA00014074000;FA;");
        assert_eq!(t(Request::SetMode { mode: Mode::Data }), "MD6;MD;");
        assert_eq!(
            t(Request::SetDataSubMode {
                sub: DataSubMode::DataA
            }),
            "DT0;DT;"
        );
        assert_eq!(t(Request::SetTransmit { on: true }), "TX;TQ;");
        assert_eq!(t(Request::SetTransmit { on: false }), "RX;TQ;");
        assert_eq!(
            t(Request::ReadSetting {
                item: MenuItem::MicBtn
            }),
            "MN082;MP;MN255;"
        );
        assert_eq!(
            Request::SetFrequency {
                hz: MAX_FREQUENCY_HZ + 1
            }
            .text(),
            Err(RequestError::Frequency(MAX_FREQUENCY_HZ + 1))
        );
    }

    #[test]
    fn answers_and_their_faults() {
        assert_eq!(
            events("FA00014074000;"),
            [Event::Frequency {
                hz: 14_074_000,
                transceive: false
            }]
        );
        let malformed = |command: &str, fault| Event::Malformed {
            command: command.to_string(),
            fault,
        };
        assert_eq!(events("FA1407400;"), [malformed("FA", Fault::Length)]);
        assert_eq!(events("FA0001407400X;"), [malformed("FA", Fault::Digits)]);
        assert_eq!(events("MD8;"), [malformed("MD", Fault::Code)]);
        assert_eq!(events("MD12;"), [malformed("MD", Fault::Length)]);
        assert_eq!(events("DT4;"), [malformed("DT", Fault::Code)]);
        assert_eq!(events("TQ2;"), [malformed("TQ", Fault::Code)]);
        assert_eq!(events("MN82;"), [malformed("MN", Fault::Length)]);
        assert_eq!(events("MPabc;"), [malformed("MP", Fault::Digits)]);
        assert_eq!(events("?;"), [Event::Busy]);
        assert_eq!(
            events("MD$2;"),
            [Event::Unknown {
                command: "MD$".into()
            }]
        );
        assert_eq!(events("FR0;"), [Event::Unknown { command: "FR".into() }]);
        assert_eq!(
            events("SWT16;"),
            [Event::Unknown {
                command: "SWT".into()
            }]
        );
    }

    #[test]
    fn noise_is_counted_and_answers_resume_after_it() {
        assert_eq!(
            events("\u{1}\u{2}TQ1;"),
            [Event::Noise { bytes: 2 }, Event::Transmit { on: true }]
        );
        // Bytes above 7E drop the answer they fall in.
        assert_eq!(
            Parser::new().push(b"FA00\xC3\x81TQ0;"),
            [Event::Noise { bytes: 6 }, Event::Transmit { on: false }]
        );
        // A stray semicolon, and text that starts with a digit.
        assert_eq!(
            events(";12TQ0;"),
            [Event::Noise { bytes: 3 }, Event::Transmit { on: false }]
        );
        // Too long without a semicolon.
        let long = "A".repeat(MAX_ANSWER + 3);
        assert_eq!(events(&long), [Event::Noise { bytes: MAX_ANSWER }]);
    }

    #[test]
    fn sets_are_accepted_only_by_a_matching_read_back() {
        let set = Request::SetFrequency { hz: 14_074_005 };
        let fa = |hz| Event::Frequency {
            hz,
            transceive: false,
        };
        assert!(set.accepted_by(&fa(14_074_000)));
        assert!(set.accepted_by(&fa(14_074_005)));
        assert!(!set.accepted_by(&fa(14_074_010)));
        assert!(set.answered_by(&fa(7_074_000)) && !set.accepted_by(&fa(7_074_000)));
        assert!(set.answered_by(&Event::Busy) && !set.accepted_by(&Event::Busy));
        let tx = Request::SetTransmit { on: true };
        assert!(tx.accepted_by(&Event::Transmit { on: true }));
        assert!(tx.answered_by(&Event::Transmit { on: false }));
        assert!(!tx.accepted_by(&Event::Transmit { on: false }));
        assert!(!tx.answered_by(&Event::Vox { on: true }));
        assert!(Request::ReadTransmit.accepted_by(&Event::Transmit { on: false }));
        let garbled = Event::Malformed {
            command: "TQ".into(),
            fault: Fault::Code,
        };
        assert!(tx.answered_by(&garbled) && !tx.accepted_by(&garbled));
        assert!(!Request::ReadMode.answered_by(&garbled));
        let info = Event::Info {
            hz: 14_074_000,
            mode: Some(Mode::Data),
            transmit: false,
            rit: false,
            xit: false,
            offset_hz: 0,
            split: false,
        };
        assert!(Request::ReadInfo.answered_by(&info));
        assert!(!Request::ReadFrequency.answered_by(&info));
    }

    #[test]
    fn requests_and_events_have_a_json_form() {
        let r: Request = serde_json::from_str(r#"{"type":"set_mode","mode":"data-rev"}"#).expect("json");
        assert_eq!(r, Request::SetMode { mode: Mode::DataRev });
        let r: Request =
            serde_json::from_str(r#"{"type":"set_data_sub_mode","sub":"data_a"}"#).expect("json");
        assert_eq!(
            r,
            Request::SetDataSubMode {
                sub: DataSubMode::DataA
            }
        );
        let r: Request = serde_json::from_str(r#"{"type":"read_setting","item":"mic_btn"}"#).expect("json");
        assert_eq!(
            r,
            Request::ReadSetting {
                item: MenuItem::MicBtn
            }
        );
        assert_eq!(
            serde_json::to_string(&Event::Mode {
                mode: Mode::CwRev,
                transceive: false
            })
            .expect("json"),
            r#"{"type":"mode","mode":"cw-rev","transceive":false}"#
        );
        assert_eq!(
            serde_json::to_string(&Event::Busy).expect("json"),
            r#"{"type":"busy"}"#
        );
    }
}
