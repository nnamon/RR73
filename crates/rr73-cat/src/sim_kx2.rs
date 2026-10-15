//! A simulated Elecraft KX2 behind a Digirig, for tests. It reads the text commands of
//! [`crate::elecraft`], answers the reads in the formats of the Programmer's Reference, and models
//! the Digirig's PTT line on the KX2's MIC jack.
//!
//! The documents give formats, not every behaviour. Where they are silent the simulator makes a
//! choice, and these choices are not facts about the radio:
//!
//! - It answers `?;` to commands it does not model, to sets with data the reference does not list,
//!   to `MD4` (the KX2 has no FM, Programmer's Reference p. 16), and to `FA`, `MD` and `DT` sets
//!   while it transmits. Those sets it does not apply, and keeps in
//!   [`SimKx2::sets_while_transmitting`] for tests that check none arrive. The reference says some
//!   commands answer `?;` while the radio transmits (p. 3) without listing them.
//! - It drops the Hz digit of a frequency set: FINE tuning is off (p. 11).
//! - It keeps its dial for a frequency set outside the KX2's receive range, 500 kHz to 32 MHz
//!   (Owner's Manual p. 69). The reference says the radio moves to the nearest amateur band
//!   (p. 11).
//! - On a band change it sends `IF`, `FA` and `FB` by itself before anything else; p. 11 note 7
//!   lists more answers the radio sends.
//! - `TQ` says transmit at once after `TX`.
//! - `TX` does nothing in DATA or DATA-REV with FSK D or PSK D (p. 28).
//! - With the Digirig's PTT line on the MIC jack's ring ([`SimKx2::digirig_ptt`], as Digirig's KX
//!   cable wires it), MIC BTN with PTT enabled and RTS asserted, it transmits, and `RX` does not end
//!   that transmission. Digirig's PTT grounds the line while RTS is asserted; the Owner's Manual
//!   names the ring PTT/UP/DN (p. 8) and does not give its active level.
//! - `MP` reads and sets only MIC BTN, and answers `?;` outside it.
//! - With auto-info on it reports at once: `IF` in mode 1, `FA` or `MD` in mode 2 (p. 4).

use crate::elecraft::{DataSubMode, MENU_NONE, MIC_BTN_PTT, MIC_BTN_UP_DN, MenuItem, Mode, TERMINATOR};

/// The amateur bands the simulator tells apart, Hz, to know when a frequency set changes band.
const BANDS: [(u64, u64); 11] = [
    (1_800_000, 2_000_000),
    (3_500_000, 4_000_000),
    (5_250_000, 5_450_000),
    (7_000_000, 7_300_000),
    (10_100_000, 10_150_000),
    (14_000_000, 14_350_000),
    (18_068_000, 18_168_000),
    (21_000_000, 21_450_000),
    (24_890_000, 24_990_000),
    (28_000_000, 29_700_000),
    (50_000_000, 54_000_000),
];

/// The band a frequency is in, as an index into the simulator's table.
fn band_of(hz: u64) -> Option<usize> {
    BANDS.iter().position(|&(lo, hi)| (lo..=hi).contains(&hz))
}

/// True inside the KX2's receive range, Hz (Owner's Manual p. 69).
pub fn in_range(hz: u64) -> bool {
    (500_000..=32_000_000).contains(&hz)
}

/// The simulated radio.
#[derive(Debug, Clone)]
pub struct SimKx2 {
    /// VFO A, Hz.
    pub hz: u64,
    /// VFO B, Hz.
    pub vfo_b: u64,
    /// The mode.
    pub mode: Mode,
    /// The data sub-mode last used.
    pub sub: DataSubMode,
    /// True while transmitting on `TX`. [`SimKx2::transmitting`] adds the MIC jack's PTT.
    pub transmit: bool,
    /// The Digirig's DTR line, as the controller set it. Nothing on the radio uses it.
    pub dtr: bool,
    /// The Digirig's RTS line, as the controller set it: asserted, the Digirig grounds its PTT line.
    pub rts: bool,
    /// The Digirig's PTT line reaches the MIC jack's ring, as Digirig's KX cable wires it.
    pub digirig_ptt: bool,
    /// MIC BTN, as `MP` gives it: [`MIC_BTN_PTT`] and [`MIC_BTN_UP_DN`]. Default PTT UP.DN (Owner's
    /// Manual p. 48).
    pub mic_btn: u16,
    /// VOX in DATA A and AFSK A. Default off (Owner's Manual p. 53).
    pub vox_data: bool,
    /// VOX in the voice modes. Default off (p. 53).
    pub vox_voice: bool,
    /// VOX in CW. Default on (p. 53).
    pub vox_cw: bool,
    /// The menu entry on the screen, [`MENU_NONE`] with none.
    pub menu: u16,
    /// Auto-info mode, 0 to 3 (Programmer's Reference p. 4). Default 0.
    pub auto_info: u8,
    /// Sends `IF`, `FA` and `FB` by itself on a band change.
    pub band_reports: bool,
    /// The product number `OM` gives: 1 for the KX2 (p. 21).
    pub product: u8,
    /// Every command received, oldest first, as text without its semicolon.
    pub received: Vec<String>,
    /// `FA`, `MD` and `DT` sets that arrived while transmitting, oldest first.
    pub sets_while_transmitting: Vec<String>,
    input: Vec<u8>,
}

impl Default for SimKx2 {
    fn default() -> Self {
        Self::new()
    }
}

impl SimKx2 {
    /// A KX2 on 14.074 MHz USB, VFO B on 7.074 MHz, data sub-mode DATA A, receiving, with the
    /// menu defaults of the Owner's Manual and a Digirig's PTT line on its MIC jack.
    pub fn new() -> Self {
        Self {
            hz: 14_074_000,
            vfo_b: 7_074_000,
            mode: Mode::Usb,
            sub: DataSubMode::DataA,
            transmit: false,
            dtr: false,
            rts: false,
            digirig_ptt: true,
            mic_btn: MIC_BTN_PTT | MIC_BTN_UP_DN,
            vox_data: false,
            vox_voice: false,
            vox_cw: true,
            menu: MENU_NONE,
            auto_info: 0,
            band_reports: true,
            product: 1,
            received: Vec::new(),
            sets_while_transmitting: Vec::new(),
            input: Vec::new(),
        }
    }

    /// The controller sets the Digirig's DTR and RTS lines, as opening a port and `setSignals` do.
    pub fn set_lines(&mut self, dtr: bool, rts: bool) {
        self.dtr = dtr;
        self.rts = rts;
    }

    /// True while the Digirig's PTT keys the radio through the MIC jack.
    pub fn line_keyed(&self) -> bool {
        self.digirig_ptt && self.rts && self.mic_btn & MIC_BTN_PTT != 0
    }

    /// True while transmitting, on `TX` or on the MIC jack's PTT.
    pub fn transmitting(&self) -> bool {
        self.transmit || self.line_keyed()
    }

    /// VOX in the present mode, as `VX` reads it (Programmer's Reference p. 28).
    pub fn vox(&self) -> bool {
        match self.mode {
            Mode::Cw | Mode::CwRev => self.vox_cw,
            // VOX is always on in FSK D and PSK D (Owner's Manual p. 53).
            Mode::Data | Mode::DataRev if self.sub.ignores_tx() => true,
            Mode::Data | Mode::DataRev => self.vox_data,
            _ => self.vox_voice,
        }
    }

    /// The `IF` answer for the present state (p. 14).
    pub fn info(&self) -> String {
        let t = u8::from(self.transmitting());
        format!("IF{:011}     +000000 00{t}{}000001 ;", self.hz, self.mode.code())
    }

    fn frequency_report(&self) -> String {
        match self.auto_info {
            1 => self.info(),
            2 | 3 => format!("FA{:011};", self.hz),
            _ => String::new(),
        }
    }

    fn mode_report(&self) -> String {
        match self.auto_info {
            1 => self.info(),
            2 | 3 => format!("MD{};", self.mode.code()),
            _ => String::new(),
        }
    }

    /// The operator turns VFO A to `hz`. Returns what auto-info sends, if anything.
    pub fn turn_dial(&mut self, hz: u64) -> Vec<u8> {
        if !in_range(hz) {
            return Vec::new();
        }
        self.hz = hz;
        self.frequency_report().into_bytes()
    }

    /// The operator picks a mode. Returns what auto-info sends, if anything.
    pub fn press_mode(&mut self, mode: Mode) -> Vec<u8> {
        self.mode = mode;
        self.mode_report().into_bytes()
    }

    /// The operator opens a menu entry, or leaves the menu with [`MENU_NONE`].
    pub fn open_menu(&mut self, entry: u16) {
        self.menu = entry;
    }

    /// Reads commands from the controller and returns the radio's answers.
    pub fn receive(&mut self, bytes: &[u8]) -> Vec<u8> {
        let mut out = String::new();
        for &b in bytes {
            if b != TERMINATOR {
                self.input.push(b);
                continue;
            }
            // Upper or lower case (Programmer's Reference p. 3); other bytes become DEL, one
            // byte each, so the command's letters can be split off.
            let text: String = self
                .input
                .drain(..)
                .map(|b| {
                    if b.is_ascii() {
                        char::from(b.to_ascii_uppercase())
                    } else {
                        '\u{7f}'
                    }
                })
                .collect();
            out.push_str(&self.command(&text));
            self.received.push(text);
        }
        out.into_bytes()
    }

    fn busy() -> String {
        "?;".to_string()
    }

    /// One command, without its semicolon. Returns the answer, empty for a set.
    fn command(&mut self, text: &str) -> String {
        let (name, data) = text.split_at(text.len().min(2));
        let tuning = matches!(name, "FA" | "MD" | "DT") && !data.is_empty();
        if tuning && self.transmitting() {
            self.sets_while_transmitting.push(text.to_string());
            return Self::busy();
        }
        match (name, data) {
            ("FA", "") => format!("FA{:011};", self.hz),
            ("FA", d) => self.set_frequency(d),
            ("MD", "") => format!("MD{};", self.mode.code()),
            ("MD", d) => match d.parse::<u8>().ok().and_then(Mode::from_code) {
                Some(Mode::Fm) | None => Self::busy(),
                Some(mode) => {
                    self.mode = mode;
                    self.mode_report()
                }
            },
            ("DT", "") => format!("DT{};", self.sub.code()),
            ("DT", d) => match d.parse::<u8>().ok().and_then(DataSubMode::from_code) {
                Some(sub) => {
                    self.sub = sub;
                    String::new()
                }
                None => Self::busy(),
            },
            ("TQ", "") => format!("TQ{};", u8::from(self.transmitting())),
            ("TX", "") => {
                if !(self.mode.is_data() && self.sub.ignores_tx()) {
                    self.transmit = true;
                }
                String::new()
            }
            ("RX", "") => {
                self.transmit = false;
                String::new()
            }
            ("OM", "") => format!("OM ----------{:02};", self.product),
            ("VX", "") => format!("VX{};", u8::from(self.vox())),
            ("MN", "") => format!("MN{:03};", self.menu),
            ("MN", d) => match d.parse::<u16>() {
                Ok(n) if d.len() == 3 && (n <= 161 || n == MENU_NONE) => {
                    self.menu = n;
                    String::new()
                }
                _ => Self::busy(),
            },
            ("MP", "") if self.menu == MenuItem::MicBtn.entry() => {
                format!("MP{:03};", self.mic_btn & MenuItem::MicBtn.mask())
            }
            ("MP", d) if self.menu == MenuItem::MicBtn.entry() && !d.is_empty() => match d.parse::<u16>() {
                Ok(v) if d.len() == 3 && v <= 255 => {
                    let mask = MenuItem::MicBtn.mask();
                    self.mic_btn = (self.mic_btn & !mask) | (v & mask);
                    String::new()
                }
                _ => Self::busy(),
            },
            ("AI", "") => format!("AI{};", self.auto_info),
            ("AI", d) => match d.parse::<u8>() {
                Ok(n) if n <= 3 && d.len() == 1 => {
                    self.auto_info = n;
                    if n == 1 { self.info() } else { String::new() }
                }
                _ => Self::busy(),
            },
            _ => Self::busy(),
        }
    }

    fn set_frequency(&mut self, d: &str) -> String {
        let Some(hz) = (d.len() == 11 && d.bytes().all(|b| b.is_ascii_digit()))
            .then(|| d.parse::<u64>().ok())
            .flatten()
        else {
            return Self::busy();
        };
        if !in_range(hz) {
            return String::new();
        }
        let before = band_of(self.hz);
        self.hz = hz - hz % 10;
        if self.band_reports && band_of(self.hz) != before {
            return format!("{}FA{:011};FB{:011};", self.info(), self.hz, self.vfo_b);
        }
        self.frequency_report()
    }
}
