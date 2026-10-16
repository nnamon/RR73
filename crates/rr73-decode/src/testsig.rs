//! Test signals built from tone sequences, without the codec: continuous-phase FSK with
//! rectangular frequency pulses, white Gaussian noise from a fixed-seed generator, and the
//! baseline spectrogram.

use rr73_dsp::{FftPlans, Spectrogram, SpectrogramConfig, SpectrogramPlan};

use crate::layout::FrameLayout;

/// SplitMix64: a small deterministic generator for test data.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed ^ 0x9E37_79B9_7F4A_7C15)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in [0, 1).
    pub fn uniform(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Standard normal (Box-Muller).
    pub fn normal(&mut self) -> f64 {
        let u1 = self.uniform().max(1e-300);
        let u2 = self.uniform();
        (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    }
}

/// A full channel-symbol sequence: sync tones at sync positions, random tones at data
/// positions, tone 0 elsewhere (FT4 ramps).
pub fn random_tones(layout: &FrameLayout, seed: u64) -> Vec<u8> {
    let mut rng = Rng::new(seed);
    let mut tones = vec![0u8; layout.symbols];
    for g in &layout.sync {
        for (k, &t) in g.tones.iter().enumerate() {
            tones[g.start + k] = t;
        }
    }
    for &d in &layout.data {
        tones[d] = (rng.next_u64() % layout.tones as u64) as u8;
    }
    tones
}

/// White Gaussian noise with unit variance.
pub fn noise(len: usize, seed: u64) -> Vec<f32> {
    let mut rng = Rng::new(seed);
    (0..len).map(|_| rng.normal() as f32).collect()
}

/// One slot of audio: CPFSK carrying `tones` with tone 0 at `f0_hz`, starting at the
/// nominal start plus `dt_s`, at `snr_db` (2500 Hz reference) against unit-variance noise.
/// With `noise_seed` `None` the noise is left out but the signal level is the same.
pub fn render(
    layout: &FrameLayout,
    tones: &[u8],
    f0_hz: f64,
    dt_s: f64,
    snr_db: f64,
    noise_seed: Option<u64>,
) -> Vec<f32> {
    let len = layout.slot_samples();
    let mut out = match noise_seed {
        Some(seed) => noise(len, seed),
        None => vec![0.0; len],
    };
    let snr = 10f64.powf(snr_db / 10.0);
    let amp = (2.0 * snr * 2500.0 / 6000.0).sqrt();
    let start = ((f64::from(layout.start_offset_s) + dt_s) * 12_000.0).round() as isize;
    let sps = layout.samples_per_symbol;
    let mut phase = 0.0f64;
    for (k, &tone) in tones.iter().enumerate() {
        let f = f0_hz + f64::from(tone) * f64::from(layout.tone_spacing_hz);
        let dphi = 2.0 * std::f64::consts::PI * f / 12_000.0;
        for i in 0..sps {
            let n = start + (k * sps + i) as isize;
            if n >= 0
                && let Some(x) = out.get_mut(n as usize)
            {
                *x += (amp * phase.sin()) as f32;
            }
            phase += dphi;
        }
    }
    out
}

/// The baseline spectrogram (2x time, 2x frequency, Hann, 200 to 3000 Hz, dB).
pub fn spectrogram(layout: &FrameLayout, audio: &[f32]) -> Spectrogram {
    let config = SpectrogramConfig::oversampled(layout.samples_per_symbol, 2, 2, 200.0, 3000.0, 12_000)
        .expect("spectrogram config");
    let frames = config.frames_for(audio.len());
    let mut plans = FftPlans::new();
    let mut plan = SpectrogramPlan::new(config, &mut plans).expect("spectrogram plan");
    let mut spec = Spectrogram::new();
    plan.compute(audio, frames, &mut spec);
    spec
}

/// Code bits (MSB first per symbol) that the data tones of `tones` carry.
pub fn data_bits(layout: &FrameLayout, tones: &[u8]) -> Vec<u8> {
    let mut bits = Vec::new();
    for &d in &layout.data {
        let tone = tones[d];
        let value = layout
            .gray
            .iter()
            .position(|&g| g == tone)
            .expect("tone in Gray map");
        for b in (0..layout.bits_per_symbol).rev() {
            bits.push(((value >> b) & 1) as u8);
        }
    }
    bits
}

/// `audio` through a receiver passband from 100 Hz to `edge_hz` (the -6 dB points), with
/// raised-cosine skirts `skirt_hz` wide and 70 dB down beyond them.
pub fn passband(audio: &[f32], edge_hz: f64, skirt_hz: f64) -> Vec<f32> {
    let mut out = audio.to_vec();
    rr73_chansim::Passband {
        low_hz: 100.0,
        high_hz: edge_hz,
        skirt_hz,
        stop_db: -70.0,
    }
    .apply(&mut out, 12_000.0);
    out
}
