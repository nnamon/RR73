//! Shared DSP for RR73: FFT plans, windows, spectrograms, analytic signals and resampling.
//!
//! Units: frequencies in Hz, times in seconds, sample counts at 12 kHz unless stated.
//!
//! The crate allocates when plans and output buffers are created. Repeated calls with the
//! same plan and buffers do not allocate.

pub mod analytic;
pub mod fft;
pub mod resample;
pub mod spectrogram;
pub mod window;

pub use fft::{Complex32, Complex64, FftPlans};
pub use resample::Resampler;
pub use spectrogram::{Scale, Spectrogram, SpectrogramConfig, SpectrogramPlan};
pub use window::WindowKind;

/// Sample rate used throughout RR73 for slot audio, in Hz.
pub const SAMPLE_RATE: u32 = 12_000;

/// Errors from plan construction. Processing functions never fail on sample values.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DspError {
    /// A size or rate parameter is zero or inconsistent with the others.
    #[error("invalid DSP parameter: {0}")]
    InvalidParameter(&'static str),
}
