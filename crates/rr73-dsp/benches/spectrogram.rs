//! Spectrogram timing for the FT8 and FT4 decoder layouts.
//!
//! Run with `cargo bench -p rr73-dsp`. Prints the median and minimum time per slot over a
//! fixed number of runs. No external benchmark harness, so the numbers come from
//! `std::time::Instant` on the build machine.

use std::hint::black_box;
use std::time::{Duration, Instant};

use rr73_dsp::{FftPlans, Scale, Spectrogram, SpectrogramConfig, SpectrogramPlan};

const RUNS: usize = 60;

fn slot(len: usize) -> Vec<f32> {
    // Deterministic pseudo-noise plus a tone, so the FFT sees realistic data.
    let mut state = 0x2545_f491_4f6c_dd1du64;
    (0..len)
        .map(|i| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let noise = (state >> 40) as f32 / (1u64 << 24) as f32 - 0.5;
            noise * 0.1 + 0.05 * (i as f32 * 0.5).sin()
        })
        .collect()
}

fn time(name: &str, config: SpectrogramConfig, samples: &[f32]) {
    let mut plans = FftPlans::new();
    let frames = config.frames_for(samples.len());
    let fft_size = config.fft_size;
    let mut plan = match SpectrogramPlan::new(config, &mut plans) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{name}: {e}");
            return;
        }
    };
    let mut out = Spectrogram::new();
    plan.compute(samples, frames, &mut out);
    let mut times: Vec<Duration> = (0..RUNS)
        .map(|_| {
            let start = Instant::now();
            plan.compute(black_box(samples), frames, &mut out);
            black_box(out.data());
            start.elapsed()
        })
        .collect();
    times.sort();
    println!(
        "{name:<34} fft {fft_size:>5}  frames {frames:>4}  bins {:>4}  median {:>8.3} ms  min {:>8.3} ms",
        out.bins(),
        times[RUNS / 2].as_secs_f64() * 1e3,
        times[0].as_secs_f64() * 1e3,
    );
}

fn main() {
    let ft8 = slot(180_000);
    let ft4 = slot(90_000);
    let cases = [
        ("ft8 baseline (2x2, 200-3000 Hz, dB)", 1920, 2, 2, &ft8, Scale::Db),
        ("ft8 2x2 linear power", 1920, 2, 2, &ft8, Scale::Power),
        ("ft8 4x4, dB", 1920, 4, 4, &ft8, Scale::Db),
        ("ft4 baseline (2x2, 200-3000 Hz, dB)", 576, 2, 2, &ft4, Scale::Db),
    ];
    for (name, symbol, tosr, fosr, samples, scale) in cases {
        match SpectrogramConfig::oversampled(symbol, tosr, fosr, 200.0, 3000.0, 12_000) {
            Ok(mut config) => {
                config.scale = scale;
                time(name, config, samples);
            }
            Err(e) => eprintln!("{name}: {e}"),
        }
    }
}
