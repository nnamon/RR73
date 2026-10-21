//! QSP, the relay RR73 uses for the services a web page on an iPhone cannot reach directly: web
//! SDR receive and reports to PSK Reporter (docs/design/qsp.md). It
//! carries no credentials for other services and reaches only the receivers its settings list.

pub mod api;
pub mod config;
pub mod docs;
pub mod frame;
pub mod kiwi;
pub mod pskreporter;
pub mod resample;
pub mod upstream;

pub use api::{AppState, router};
pub use config::Config;
