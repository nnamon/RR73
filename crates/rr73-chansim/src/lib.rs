//! Channel simulator: renders FT8 and FT4 scenes with AWGN, Watterson fading, drift and DT
//! offsets. SNR follows the WSJT-X convention: signal power against noise power in 2500 Hz.
//!
//! Signals come from the codec (`rr73_ft8::tones::from_payload` and
//! `rr73_ft8::synth::gfsk`); this crate adds the channel. Rendering is deterministic: the
//! same scene and seed give the same samples.

pub mod channel;
pub mod continuous;
pub mod messages;
pub mod scene;

pub use channel::Watterson;
pub use scene::{
    NOISE_RMS, Noise, RenderError, Scene, SimSignal, Truth, crowded, noise_only, render, render_loop, single,
};
