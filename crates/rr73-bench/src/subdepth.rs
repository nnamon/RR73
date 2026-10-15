//! `rr73-bench subtraction`: how much of a decoded signal the subtractor removes.
//!
//! Each slot holds one random FT8 message rendered twice with the same seed, alone and in
//! white noise, so the noise is known exactly. The noisy slot is decoded with the
//! configuration; the decode of the message is then subtracted from the noisy audio with the
//! configuration's subtractor. What remains of the signal is the residual minus the noise,
//! `error = clean - rebuilt`, and the depth is `10 log10(Σ error² / Σ clean²)` in dB: -20 dB
//! leaves a hundredth of the signal's energy behind.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use rayon::prelude::*;
use rr73_chansim::{Noise, Scene, SimSignal, Watterson, render};
use rr73_decode::stages::Subtractor;
use rr73_decode::subtract::{ModelSubtract, SubtractScratch};
use rr73_decode::{DecodeContext, DecoderConfig, SlotAudio, decode};
use rr73_ft8::Mode;

/// One channel the depth is measured on.
#[derive(Clone, Copy, Debug)]
struct Case {
    name: &'static str,
    snr_db: f64,
    fading: Option<Watterson>,
    drift_hz_per_s: f64,
}

const CASES: [Case; 7] = [
    Case {
        name: "steady -10 dB",
        snr_db: -10.0,
        fading: None,
        drift_hz_per_s: 0.0,
    },
    Case {
        name: "steady 0 dB",
        snr_db: 0.0,
        fading: None,
        drift_hz_per_s: 0.0,
    },
    Case {
        name: "steady +10 dB",
        snr_db: 10.0,
        fading: None,
        drift_hz_per_s: 0.0,
    },
    Case {
        name: "steady +20 dB",
        snr_db: 20.0,
        fading: None,
        drift_hz_per_s: 0.0,
    },
    Case {
        name: "moderate fading +10 dB",
        snr_db: 10.0,
        fading: Some(Watterson::MODERATE),
        drift_hz_per_s: 0.0,
    },
    Case {
        name: "disturbed fading +10 dB",
        snr_db: 10.0,
        fading: Some(Watterson::DISTURBED),
        drift_hz_per_s: 0.0,
    },
    Case {
        name: "drift 0.2 Hz/s +10 dB",
        snr_db: 10.0,
        fading: None,
        drift_hz_per_s: 0.2,
    },
];

/// Depth per case: name, slots decoded, slots, and the 10th, 50th and 90th percentile depth
/// in dB.
pub type DepthRow = (&'static str, usize, usize, f64, f64, f64);

/// Measures the subtraction depth of `config` over `per_case` slots of each case.
pub fn depth(
    config: &DecoderConfig,
    per_case: usize,
    threads: Option<usize>,
) -> Result<Vec<DepthRow>, String> {
    let threads = threads
        .unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1))
        .max(1);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|e| e.to_string())?;
    let subtractor = ModelSubtract {
        smooth_s: config.subtract.smooth_s,
        refine: config.subtract.refine,
    };
    let mut rows = Vec::new();
    for (c, case) in CASES.iter().enumerate() {
        let depths: Vec<Option<f64>> = pool.install(|| {
            (0..per_case)
                .into_par_iter()
                .map(|i| one(config, &subtractor, case, (c * 100_000 + i) as u64))
                .collect()
        });
        let mut got: Vec<f64> = depths.into_iter().flatten().collect();
        got.sort_by(f64::total_cmp);
        let pct = |q: f64| rr73_corpus::stats::percentile(&got, q).unwrap_or(f64::NAN);
        rows.push((case.name, got.len(), per_case, pct(10.0), pct(50.0), pct(90.0)));
    }
    Ok(rows)
}

fn one(config: &DecoderConfig, subtractor: &ModelSubtract, case: &Case, seed: u64) -> Option<f64> {
    let mut rng = ChaCha8Rng::seed_from_u64(seed ^ 0x5eed_f5ab);
    let signal = SimSignal {
        message: rr73_chansim::messages::message(&mut rng),
        freq_hz: rng.random_range(400.0..2600.0),
        dt_s: rng.random_range(-0.5..0.5),
        snr_db: case.snr_db,
        fading: case.fading,
        drift_hz_per_s: case.drift_hz_per_s,
        cut_s: 0.0,
        length_s: None,
    };
    let scene = |noise| Scene {
        mode: Mode::Ft8,
        signals: vec![signal.clone()],
        noise,
    };
    let (clean, truth) = render(&scene(Noise::None), seed).ok()?;
    let (noisy, _) = render(&scene(Noise::Awgn), seed).ok()?;
    let report = decode(
        &SlotAudio::new(&noisy, Mode::Ft8),
        config,
        &mut DecodeContext::new(),
    );
    let text = &truth.first()?.text;
    let d = report.decodes.iter().find(|d| &d.text == text)?;
    let mut residual = noisy.clone();
    subtractor.subtract(
        rr73_decode::pipeline::layout(Mode::Ft8),
        &mut residual,
        std::slice::from_ref(d),
        &mut SubtractScratch::default(),
    );
    let (mut error, mut energy) = (0.0f64, 0.0f64);
    for ((&r, &n), &c) in residual.iter().zip(&noisy).zip(&clean) {
        let noise = f64::from(n) - f64::from(c);
        error += (f64::from(r) - noise).powi(2);
        energy += f64::from(c).powi(2);
    }
    (energy > 0.0).then(|| 10.0 * (error / energy).log10())
}

/// The table printed by `rr73-bench subtraction`.
pub fn render_rows(rows: &[DepthRow]) -> String {
    let mut out = format!(
        "{:<26} {:>8} {:>9} {:>9} {:>9}\n",
        "case", "decoded", "p10 dB", "p50 dB", "p90 dB"
    );
    for (name, got, of, p10, p50, p90) in rows {
        out.push_str(&format!(
            "{name:<26} {:>8} {p10:>9.1} {p50:>9.1} {p90:>9.1}\n",
            format!("{got}/{of}")
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_strong_steady_signal_is_removed_deeply() {
        let config = DecoderConfig::preset("subtract-3-osd2").expect("preset");
        let subtractor = ModelSubtract {
            smooth_s: config.subtract.smooth_s,
            refine: true,
        };
        let d = one(&config, &subtractor, &CASES[2], 1).expect("decoded");
        assert!(d < -20.0, "depth {d} dB");
    }
}
