//! WSPR scenes: 120 s slots of 4-FSK transmissions from `rr73_wspr` with the same channel as
//! FT8 scenes (AWGN at a given SNR in 2500 Hz, Watterson fading, linear drift).
//!
//! A transmission starts 1 s after the slot boundary plus its DT and lasts 110.592 s. The
//! frequency of a signal is its centre, midway between tones 1 and 2, as WSPR reports it.
//! Drift comes from the synthesiser (`rr73_wspr::synth::fsk`), linear and zero at the middle
//! of the transmission; fading acts on the drifted signal.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use rr73_dsp::FftPlans;
use rr73_wspr::{
    BAND_CENTRE_HZ, BAND_HALF_WIDTH_HZ, CallsignHashes, Message, SLOT_SAMPLES, START_OFFSET_S,
    channel_symbols, pack, synth, unpack,
};
use serde::{Deserialize, Serialize};

use crate::channel::{self, Watterson};
use crate::messages;
use crate::scene::{NOISE_RMS, Noise, PEAK_LIMIT, RenderError, Truth};

/// One simulated WSPR transmission.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WsprSignal {
    /// Message text as an operator types it, such as `K1ABC FN42 37`.
    pub message: String,
    /// Centre frequency (midway between tones 1 and 2), in Hz. With drift, the frequency at
    /// the middle of the transmission.
    pub freq_hz: f64,
    /// Start offset from the nominal start (1 s into the slot), in seconds.
    pub dt_s: f64,
    /// SNR in 2500 Hz, in dB. With fading, the average over the fading process.
    pub snr_db: f64,
    /// Watterson fading, or `None` for a steady signal.
    pub fading: Option<Watterson>,
    /// Linear frequency drift, in Hz per second (0.01 Hz/s is 1.1 Hz over a transmission).
    pub drift_hz_per_s: f64,
}

impl WsprSignal {
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

/// A 120 s WSPR slot to render.
#[derive(Clone, Debug, PartialEq)]
pub struct WsprScene {
    /// The transmissions.
    pub signals: Vec<WsprSignal>,
    /// Background noise.
    pub noise: Noise,
}

/// Renders `scene` with randomness from `seed`: 1 440 000 samples at 12 kHz (120 s) and the
/// truth for each signal. Deterministic in the scene and seed; signal `i` takes its fading
/// from random stream `i + 1` and the noise uses stream 0, as in [`crate::render`]. Truth
/// text is what a decoder prints from this slot alone: type 3 callsigns show as `<...>`.
pub fn render_wspr(scene: &WsprScene, seed: u64) -> Result<(Vec<f32>, Vec<Truth>), RenderError> {
    let mut audio = vec![0.0f32; SLOT_SAMPLES];
    let mut truth = Vec::with_capacity(scene.signals.len());
    let mut plans = FftPlans::new();
    let empty = CallsignHashes::new();
    for (i, s) in scene.signals.iter().enumerate() {
        if !(s.freq_hz.is_finite()
            && s.dt_s.is_finite()
            && s.snr_db.is_finite()
            && s.drift_hz_per_s.is_finite())
        {
            return Err(RenderError::NotFinite(i));
        }
        let msg =
            Message::parse(&s.message).map_err(|e| RenderError::Message(s.message.clone(), e.to_string()))?;
        let symbols =
            channel_symbols(&msg).map_err(|e| RenderError::Message(s.message.clone(), e.to_string()))?;
        let text = pack(&msg)
            .ok()
            .and_then(|p| unpack(&p, &empty).ok())
            .map_or_else(|| msg.to_string(), |m| m.to_string());
        let amplitude = (2.0 * 10f64.powf(s.snr_db / 10.0) * NOISE_RMS * NOISE_RMS * 2500.0 / 6000.0).sqrt();
        let wave = synth::fsk(&symbols, s.freq_hz, s.drift_hz_per_s, 12_000, amplitude as f32);
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        rng.set_stream(i as u64 + 1);
        let wave = channel::apply(&wave, 0.0, s.fading, &mut rng, &mut plans);
        let start = ((START_OFFSET_S + s.dt_s) * channel::SAMPLE_RATE).round() as i64;
        for (k, &v) in wave.iter().enumerate() {
            let n = start + k as i64;
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

/// Range of random centre frequencies, in Hz: the 200 Hz WSPR window less 5 Hz at each edge,
/// so all 4 tones stay inside 1400 to 1600 Hz.
pub const WSPR_FREQ_RANGE_HZ: (f64, f64) = (
    BAND_CENTRE_HZ - BAND_HALF_WIDTH_HZ + 5.0,
    BAND_CENTRE_HZ + BAND_HALF_WIDTH_HZ - 5.0,
);

/// Range of random DT, in seconds.
pub const WSPR_DT_RANGE_S: (f64, f64) = (-1.0, 2.0);

/// A random type 1 WSPR message: a standard callsign, a 4-character locator and one of the
/// 19 power levels.
pub fn wspr_message<R: Rng>(rng: &mut R) -> String {
    const POWERS: [u8; 19] = [
        0, 3, 7, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40, 43, 47, 50, 53, 57, 60,
    ];
    format!(
        "{} {} {}",
        messages::callsign(rng),
        messages::grid(rng),
        POWERS[rng.random_range(0..POWERS.len())]
    )
}

/// One random type 1 message at `snr_db`, centre uniform in [`WSPR_FREQ_RANGE_HZ`], DT
/// uniform in [`WSPR_DT_RANGE_S`], no drift.
pub fn wspr_single<R: Rng>(snr_db: f64, fading: Option<Watterson>, rng: &mut R) -> WsprScene {
    let signal = WsprSignal {
        message: wspr_message(rng),
        freq_hz: rng.random_range(WSPR_FREQ_RANGE_HZ.0..WSPR_FREQ_RANGE_HZ.1),
        dt_s: rng.random_range(WSPR_DT_RANGE_S.0..WSPR_DT_RANGE_S.1),
        snr_db,
        fading,
        drift_hz_per_s: 0.0,
    };
    WsprScene {
        signals: vec![signal],
        noise: Noise::Awgn,
    }
}

/// A busy WSPR window: `count` random type 1 messages with SNR uniform in `snr_range_db`, DT
/// uniform in [`WSPR_DT_RANGE_S`], drift uniform in ±`max_drift_hz_per_s`, and centres on a
/// shuffled grid at least `spacing_hz` apart within [`WSPR_FREQ_RANGE_HZ`].
pub fn wspr_band<R: Rng>(
    count: usize,
    snr_range_db: (f64, f64),
    spacing_hz: f64,
    max_drift_hz_per_s: f64,
    rng: &mut R,
) -> WsprScene {
    let (lo, hi) = WSPR_FREQ_RANGE_HZ;
    let slots = (((hi - lo) / spacing_hz).floor() as usize).max(1);
    let mut order: Vec<usize> = (0..slots).collect();
    for i in (1..order.len()).rev() {
        let j = rng.random_range(0..=i);
        order.swap(i, j);
    }
    // Each grid slot is `pitch` wide; a signal sits anywhere in its first `pitch - spacing`.
    let pitch = (hi - lo) / slots as f64;
    let jitter = (pitch - spacing_hz).max(0.0);
    let signals = order
        .into_iter()
        .take(count)
        .map(|k| WsprSignal {
            message: wspr_message(rng),
            freq_hz: lo + k as f64 * pitch + rng.random_range(0.0..=jitter),
            dt_s: rng.random_range(WSPR_DT_RANGE_S.0..WSPR_DT_RANGE_S.1),
            snr_db: rng.random_range(snr_range_db.0..=snr_range_db.1),
            fading: None,
            drift_hz_per_s: if max_drift_hz_per_s > 0.0 {
                rng.random_range(-max_drift_hz_per_s..=max_drift_hz_per_s)
            } else {
                0.0
            },
        })
        .collect();
    WsprScene {
        signals,
        noise: Noise::Awgn,
    }
}

/// A WSPR slot of noise only.
pub fn wspr_noise_only() -> WsprScene {
    WsprScene {
        signals: Vec::new(),
        noise: Noise::Awgn,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn power(x: &[f32]) -> f64 {
        x.iter().map(|&v| f64::from(v) * f64::from(v)).sum::<f64>() / x.len() as f64
    }

    #[test]
    fn renders_a_slot_with_the_signal_where_the_truth_says() {
        let scene = WsprScene {
            signals: vec![WsprSignal::new("K1ABC FN42 37", 1500.0, 0.5, -10.0)],
            noise: Noise::None,
        };
        let (audio, truth) = render_wspr(&scene, 3).expect("render");
        assert_eq!(audio.len(), 1_440_000);
        assert_eq!(truth[0].text, "K1ABC FN42 37");
        // Starts at 1.5 s, lasts 110.592 s.
        let start = 18_000;
        let end = start + 1_327_104;
        let expected = 10f64.powf(-1.0) * NOISE_RMS * NOISE_RMS * 2500.0 / 6000.0;
        let measured = power(&audio[start + 1000..end - 1000]);
        assert!(
            (10.0 * (measured / expected).log10()).abs() < 0.05,
            "{measured} vs {expected}"
        );
        assert!(power(&audio[..start - 10]) < expected * 1e-9);
        assert!(power(&audio[end + 10..]) < expected * 1e-9);
    }

    #[test]
    fn deterministic_noise_fading_and_type_3_truth() {
        let mut s = WsprSignal::new("<PJ4/K1ABC> FK52UD 33", 1450.0, 0.0, -20.0);
        s.fading = Some(Watterson::MODERATE);
        s.drift_hz_per_s = 0.01;
        let scene = WsprScene {
            signals: vec![s],
            noise: Noise::Awgn,
        };
        let (a, ta) = render_wspr(&scene, 9).expect("render");
        let (b, _) = render_wspr(&scene, 9).expect("render");
        let (c, _) = render_wspr(&scene, 10).expect("render");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(ta[0].text, "<...> FK52UD 33");
        let noise = power(&a[..10_000]);
        assert!((noise.sqrt() - NOISE_RMS).abs() < 0.001, "{}", noise.sqrt());
    }

    #[test]
    fn bad_signals_are_refused() {
        let scene = |m: &str, f: f64| WsprScene {
            signals: vec![WsprSignal::new(m, f, 0.0, -10.0)],
            noise: Noise::None,
        };
        assert!(matches!(
            render_wspr(&scene("K1ABC FN42 31", 1500.0), 0),
            Err(RenderError::Message(..))
        ));
        assert!(matches!(
            render_wspr(&scene("K1ABC FN42 37", f64::NAN), 0),
            Err(RenderError::NotFinite(0))
        ));
    }

    #[test]
    fn random_scenes_stay_in_the_window() {
        let mut rng = ChaCha8Rng::seed_from_u64(4);
        for _ in 0..50 {
            let s = &wspr_single(-25.0, None, &mut rng).signals[0];
            assert!(Message::parse(&s.message).is_ok(), "{}", s.message);
            assert!((WSPR_FREQ_RANGE_HZ.0..WSPR_FREQ_RANGE_HZ.1).contains(&s.freq_hz));
        }
        let band = wspr_band(20, (-28.0, -10.0), 8.0, 0.01, &mut rng);
        assert_eq!(band.signals.len(), 20);
        let mut f: Vec<f64> = band.signals.iter().map(|s| s.freq_hz).collect();
        f.sort_by(f64::total_cmp);
        assert!(f.windows(2).all(|w| w[1] - w[0] >= 8.0 - 1e-9), "{f:?}");
        assert!(band.signals.iter().all(|s| s.drift_hz_per_s.abs() <= 0.01));
    }
}
