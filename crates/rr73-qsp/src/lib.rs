//! QSP, the relay RR73 uses for what a web page on an iPhone cannot do by itself: receive from a
//! web SDR now; report to PSK Reporter and upload to WSPRnet later (docs/design/qsp.md). It
//! carries no credentials for other services and reaches only the receivers its settings list.

pub mod api;
pub mod config;
pub mod docs;
pub mod frame;
pub mod kiwi;

pub use api::{AppState, router};
pub use config::Config;
