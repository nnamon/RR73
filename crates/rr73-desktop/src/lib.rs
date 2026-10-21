//! The native parts of RR73's desktop app that need no window, so they test on any machine.
//!
//! - [`serial`] keeps the serial ports the app has open: it opens a port and lowers DTR and RTS
//!   before anything else, reads on a thread of its own and hands each chunk to a sink, writes in
//!   order, and reports a port that went away once. The system's ports come in through the
//!   [`serial::Backend`] trait; the desktop app implements it on the `serialport` crate, and the
//!   tests on a fake.
//! - [`sntp`] asks an NTP server for the time (SNTP, RFC 4330) and gives the offset of the
//!   system clock from it.

pub mod serial;
pub mod sntp;
