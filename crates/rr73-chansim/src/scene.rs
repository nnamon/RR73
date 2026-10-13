//! Scenes and rendering.
//!
//! SNR follows the WSJT-X convention: signal power against the power of the noise in a
//! 2500 Hz bandwidth. Rendered noise is white over 0 to 6000 Hz with standard deviation
//! [`NOISE_RMS`] per sample, so a signal at `snr_db` has power
//! `10^(snr_db / 10) * NOISE_RMS^2 * 2500 / 6000`. Scenes without noise use the same
//! reference level, so a signal's amplitude depends only on its SNR.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use rr73_dsp::FftPlans;
use rr73_ft8::message::{self, Message};
use rr73_ft8::{CallsignHashes, Mode, synth, tones};
use serde::{Deserialize, Serialize};

use crate::channel::{self, Watterson};
use crate::messages;

/// Noise standard deviation per sample at the reference level (about -34 dBFS).
pub const NOISE_RMS: f64 = 0.02;

/// Largest sample magnitude after rendering; louder scenes are scaled down as a whole,
/// which keeps every SNR.
pub const PEAK_LIMIT: f32 = 0.98;

/// Background noise of a scene.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Noise {
    /// No noise: signals only, at the levels their SNRs give against the reference noise.
    None,
    /// White Gaussian noise at the reference level.
    Awgn,
}

/// One simulated transmission.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SimSignal {
    /// Message text as an operator types it.
    pub message: String,
    /// Base-tone (tone 0) frequency, in Hz. With drift, the frequency at the middle of the
    /// transmission.
    pub freq_hz: f64,
    /// Start offset from the nominal start (0.5 s into the slot), in seconds.
    pub dt_s: f64,
    /// SNR in 2500 Hz, in dB. With fading, the average over the fading process.
    pub snr_db: f64,
    /// Watterson fading, or `None` for a steady signal.
    pub fading: Option<Watterson>,
    /// Linear frequency drift, in Hz per second.
    pub drift_hz_per_s: f64,
}

impl SimSignal {
    /// A steady signal without fading or drift.
    pub fn new(message: impl Into<String>, freq_hz: f64, dt_s: f64, snr_db: f64) -> Self {
        Self {
            message: message.into(),
            freq_hz,
            dt_s,
            snr_db,
            fading: None,
            drift_hz_per_s: 0.0,
        }
    }
}

/// A slot to render.
#[derive(Clone, Debug, PartialEq)]
pub struct Scene {
    /// Mode of every signal and the slot length.
    pub mode: Mode,
    /// The transmissions.
    pub signals: Vec<SimSignal>,
    /// Background noise.
    pub noise: Noise,
}

/// What was rendered for one signal: the decoder's expected output.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Truth {
    /// Canonical message text, as the decoder prints it.
    pub text: String,
    /// Base-tone frequency, in Hz.
    pub freq_hz: f64,
    /// Start offset from the nominal start, in seconds.
    pub dt_s: f64,
    /// SNR in 2500 Hz, in dB.
    pub snr_db: f64,
}

/// Errors from rendering.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum RenderError {
    /// The message text does not fit an FT8 message format.
    #[error("message {0:?} cannot be packed: {1}")]
    Message(String, String),
    /// A signal parameter is not finite.
    #[error("signal {0} has a non-finite parameter")]
    NotFinite(usize),
}

/// Renders `scene` with randomness from `seed`: one slot of 12 kHz audio and the truth for
/// each signal. The same scene and seed give the same samples on every run. Signal `i`
/// takes its fading from random stream `i + 1`, so adding a signal leaves the others
/// unchanged; the noise uses stream 0. Parts of a signal outside the slot are cut.
pub fn render(scene: &Scene, seed: u64) -> Result<(Vec<f32>, Vec<Truth>), RenderError> {
    render_placed(scene, seed, false)
}

/// Renders `scene` as a loop: as [`render`], but a signal that runs past the end of the
/// slot continues at its start, and one that starts before the slot ends at its end. Played
/// back to back, the audio carries every signal whole whatever sample playback starts at.
/// DT may take any value; a start position wraps modulo the slot length (15 s for FT8).
pub fn render_loop(scene: &Scene, seed: u64) -> Result<(Vec<f32>, Vec<Truth>), RenderError> {
    render_placed(scene, seed, true)
}

fn render_placed(scene: &Scene, seed: u64, wrap: bool) -> Result<(Vec<f32>, Vec<Truth>), RenderError> {
    let params = scene.mode.params();
    let len = (f64::from(params.slot_s) * channel::SAMPLE_RATE).round() as usize;
    let mut audio = vec![0.0f32; len];
    let mut truth = Vec::with_capacity(scene.signals.len());
    let mut hashes = CallsignHashes::new();
    let mut plans = FftPlans::new();

    for (i, s) in scene.signals.iter().enumerate() {
        if !(s.freq_hz.is_finite()
            && s.dt_s.is_finite()
            && s.snr_db.is_finite()
            && s.drift_hz_per_s.is_finite())
        {
            return Err(RenderError::NotFinite(i));
        }
        let parsed =
            Message::parse(&s.message).map_err(|e| RenderError::Message(s.message.clone(), e.to_string()))?;
        let payload = message::pack(&parsed, &mut hashes)
            .map_err(|e| RenderError::Message(s.message.clone(), e.to_string()))?;
        let text = message::unpack(&payload, &hashes)
            .map(|m| m.to_string())
            .unwrap_or_else(|_| parsed.to_string());
        let symbols = tones::from_payload(scene.mode, &payload);
        let amplitude = (2.0 * 10f64.powf(s.snr_db / 10.0) * NOISE_RMS * NOISE_RMS * 2500.0 / 6000.0).sqrt();
        let wave = synth::gfsk(scene.mode, &symbols, s.freq_hz as f32, 12_000, amplitude as f32);
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        rng.set_stream(i as u64 + 1);
        let wave = channel::apply(&wave, s.drift_hz_per_s, s.fading, &mut rng, &mut plans);
        let start = ((f64::from(params.start_offset_s) + s.dt_s) * channel::SAMPLE_RATE).round() as i64;
        let slot_len = len as i64;
        for (k, &v) in wave.iter().enumerate() {
            let n = start + k as i64;
            let n = if wrap { n.rem_euclid(slot_len.max(1)) } else { n };
            if n >= 0
                && let Some(x) = audio.get_mut(n as usize)
            {
                *x += v;
            }
        }
        truth.push(Truth {
            text,
            freq_hz: s.freq_hz,
            dt_s: s.dt_s,
            snr_db: s.snr_db,
        });
    }

    if scene.noise == Noise::Awgn {
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        rng.set_stream(0);
        channel::add_awgn(&mut audio, NOISE_RMS, &mut rng);
    }
    let peak = audio.iter().fold(0.0f32, |m, &v| m.max(v.abs()));
    if peak > PEAK_LIMIT {
        let g = PEAK_LIMIT / peak;
        for v in &mut audio {
            *v *= g;
        }
    }
    Ok((audio, truth))
}

/// Base-tone frequency range used for random placement, in Hz.
pub const FREQ_RANGE_HZ: (f64, f64) = (300.0, 2700.0);

/// A scene with one random message at `snr_db`, random frequency in [`FREQ_RANGE_HZ`] and
/// DT uniform in [-0.5, 0.5] s, drawn from `rng`.
pub fn single<R: Rng>(mode: Mode, snr_db: f64, fading: Option<Watterson>, rng: &mut R) -> Scene {
    let signal = SimSignal {
        message: messages::message(rng),
        freq_hz: rng.random_range(FREQ_RANGE_HZ.0..FREQ_RANGE_HZ.1),
        dt_s: rng.random_range(-0.5..0.5),
        snr_db,
        fading,
        drift_hz_per_s: 0.0,
    };
    Scene {
        mode,
        signals: vec![signal],
        noise: Noise::Awgn,
    }
}

/// A crowded band: `count` random messages with SNR uniform in `snr_range_db` and DT
/// uniform in [-0.5, 0.5] s. Without `overlap`, base tones sit on a shuffled grid with at
/// least `spacing_hz` between neighbours (signal bandwidth plus a guard); with `overlap`,
/// frequencies are uniform in [`FREQ_RANGE_HZ`] and signals may share spectrum.
pub fn crowded<R: Rng>(
    mode: Mode,
    count: usize,
    overlap: bool,
    snr_range_db: (f64, f64),
    spacing_hz: f64,
    rng: &mut R,
) -> Scene {
    let (lo, hi) = FREQ_RANGE_HZ;
    let freqs: Vec<f64> = if overlap {
        (0..count).map(|_| rng.random_range(lo..hi)).collect()
    } else {
        let slots = (((hi - lo) / spacing_hz).floor() as usize).max(1);
        let mut order: Vec<usize> = (0..slots).collect();
        for i in (1..order.len()).rev() {
            let j = rng.random_range(0..=i);
            order.swap(i, j);
        }
        // Leftover width is shared out as a random offset per slot.
        let slack = (hi - lo) - slots as f64 * spacing_hz;
        let jitter = (spacing_hz * 0.1).min(slack.max(0.0) / slots as f64);
        order
            .into_iter()
            .take(count)
            .map(|k| {
                lo + k as f64 * spacing_hz
                    + if jitter > 0.0 {
                        rng.random_range(0.0..jitter)
                    } else {
                        0.0
                    }
            })
            .collect()
    };
    let signals = freqs
        .into_iter()
        .map(|freq_hz| SimSignal {
            message: messages::message(rng),
            freq_hz,
            dt_s: rng.random_range(-0.5..0.5),
            snr_db: rng.random_range(snr_range_db.0..=snr_range_db.1),
            fading: None,
            drift_hz_per_s: 0.0,
        })
        .collect();
    Scene {
        mode,
        signals,
        noise: Noise::Awgn,
    }
}

/// A slot of noise only.
pub fn noise_only(mode: Mode) -> Scene {
    Scene {
        mode,
        signals: Vec::new(),
        noise: Noise::Awgn,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crowded_without_overlap_keeps_the_spacing() {
        let mut rng = ChaCha8Rng::seed_from_u64(4);
        for count in [10, 20, 40] {
            let scene = crowded(Mode::Ft8, count, false, (-20.0, 0.0), 60.0, &mut rng);
            assert_eq!(scene.signals.len(), count);
            let mut f: Vec<f64> = scene.signals.iter().map(|s| s.freq_hz).collect();
            f.sort_by(f64::total_cmp);
            assert!(f.windows(2).all(|w| w[1] - w[0] >= 60.0 - 1e-9), "{f:?}");
            assert!(f.iter().all(|&x| (FREQ_RANGE_HZ.0..FREQ_RANGE_HZ.1).contains(&x)));
            assert!(scene.signals.iter().all(|s| (-20.0..=0.0).contains(&s.snr_db)));
        }
    }

    #[test]
    fn crowded_is_capped_by_the_band_and_overlap_is_uniform() {
        let mut rng = ChaCha8Rng::seed_from_u64(5);
        let scene = crowded(Mode::Ft8, 100, false, (-10.0, -10.0), 60.0, &mut rng);
        assert_eq!(scene.signals.len(), 40);
        let scene = crowded(Mode::Ft8, 100, true, (-10.0, -10.0), 60.0, &mut rng);
        assert_eq!(scene.signals.len(), 100);
    }

    #[test]
    fn single_draws_within_ranges() {
        let mut rng = ChaCha8Rng::seed_from_u64(6);
        for _ in 0..100 {
            let s = &single(Mode::Ft8, -15.0, Some(Watterson::MODERATE), &mut rng).signals[0];
            assert!((-0.5..0.5).contains(&s.dt_s));
            assert!((FREQ_RANGE_HZ.0..FREQ_RANGE_HZ.1).contains(&s.freq_hz));
            assert_eq!(s.fading, Some(Watterson::MODERATE));
        }
    }
}
