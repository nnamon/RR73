//! Rig control for RR73: Icom's CI-V protocol and the IC-705 commands the app uses, and Elecraft's
//! text protocol and the KX2 commands it uses.
//!
//! - [`frame`] writes and reads CI-V frames: the preamble `FE FE`, the receiving and sending
//!   addresses, the command, the sub-command and data, and the end code `FD`.
//! - [`bcd`] carries frequencies and codes in binary-coded decimal.
//! - [`ic705`] turns typed requests (read and set the operating frequency, the mode and the data
//!   mode, transmit on and off, read menu settings, split, RIT and ΔTX) into frames, and the
//!   radio's frames into events.
//! - [`sim`] is a simulated IC-705 that answers frames in the formats the reference guide
//!   gives, for tests.
//! - [`elecraft`] turns typed requests for the KX2 (VFO A, the mode, the data sub-mode, transmit
//!   and receive, the option modules, VOX and a menu setting) into Elecraft's semicolon-terminated
//!   commands, and the radio's answers into events.
//! - [`sim_kx2`] is a simulated KX2 behind a Digirig, for tests.
//!
//! A request and its answer, against the simulated radio:
//!
//! ```
//! use rr73_cat::ic705::{Addresses, Event, Parser, Request};
//! use rr73_cat::sim::SimIc705;
//!
//! let mut radio = SimIc705::new();
//! let mut parser = Parser::new(Addresses::default());
//! let set = Request::SetFrequency { hz: 14_074_000 };
//! let bytes = set.encode(Addresses::default()).unwrap();
//! assert_eq!(bytes, [0xFE, 0xFE, 0xA4, 0xE0, 0x05, 0x00, 0x40, 0x07, 0x14, 0x00, 0xFD]);
//! let events = parser.push(&radio.receive(&bytes));
//! assert_eq!(events, [Event::Ok]);
//! assert!(set.answered_by(&events[0]));
//! ```
//!
//! Units: frequencies in Hz. Bytes are written in hexadecimal, as the guide prints them.
//!
//! Every protocol fact comes from Icom's published documents, cited by printed page:
//!
//! - IC-705 CI-V Reference Guide, A7560-8EX-6, January 2023 ("CI-V guide").
//! - IC-705 Basic Manual, A7560D-1EX-9, December 2025.
//! - IC-705 Advanced Manual, A7560-7EX-5, April 2026.
//!
//! The KX2's facts come from Elecraft's published documents, also cited by printed page:
//!
//! - Elecraft K3S/K3/KX3/KX2 Programmer's Reference, Rev. G5, 20 February 2019.
//! - Elecraft KX2 Owner's Manual, Rev. B2, 22 March 2023.
//!
//! The Digirig's PTT line comes from Digirig's documentation (digirig.net).
//!
//! Where the documents are silent, the code says so and `docs/design/cat.md` lists the point as
//! unverified. No other rig-control program's source was read.

pub mod bcd;
pub mod elecraft;
pub mod frame;
pub mod ic705;
pub mod sim;
pub mod sim_kx2;

pub use frame::{Decoded, Frame, FrameDecoder, FrameError};
pub use ic705::{Addresses, Event, Fault, Filter, MenuItem, Mode, Parser, Request, RequestError, Split, Vfo};
