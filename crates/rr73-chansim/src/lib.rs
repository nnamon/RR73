//! Channel simulator: renders FT8, FT4 and WSPR scenes with AWGN, Watterson fading, drift
//! and DT offsets. SNR follows the WSJT-X convention: signal power against noise power in
//! 2500 Hz.
//!
//! Signals come from the codecs (`rr73_ft8::tones::from_payload` and `rr73_ft8::synth::gfsk`;
//! `rr73_wspr::channel_symbols` and `rr73_wspr::synth::fsk`); this crate adds the channel. Rendering is deterministic: the
//! same scene and seed give the same samples.

pub mod channel;
pub mod continuous;
pub mod messages;
pub mod passband;
pub mod scene;
pub mod wspr;

pub use channel::Watterson;
pub use passband::Passband;
pub use scene::{
    NOISE_RMS, Noise, RenderError, Scene, SimSignal, Truth, crowded, noise_only, render, render_loop, single,
};
pub use wspr::{WsprScene, WsprSignal, render_wspr, wspr_band, wspr_noise_only, wspr_single};
