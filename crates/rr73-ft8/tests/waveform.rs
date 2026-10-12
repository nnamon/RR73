//! GFSK waveforms: agreement with ft8_lib's modulator (`fixtures/ft8/waveforms.json`) and
//! properties of the signal itself.

mod common;

use common::{Rng, Waveform, tone_digits};
use rr73_ft8::message::{Message, pack};
use rr73_ft8::{CallsignHashes, Mode, synth, tones};
use std::f64::consts::{PI, TAU};

fn mode_of(w: &Waveform) -> Mode {
    if w.mode == "ft4" { Mode::Ft4 } else { Mode::Ft8 }
}

/// Normalised correlation of two equally long sample sets.
fn correlation(a: &[f64], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f64 = a.iter().map(|x| x * x).sum();
    let nb: f64 = b.iter().map(|x| x * x).sum();
    dot / (na * nb).sqrt()
}

#[test]
fn fixture_tones_are_ours() {
    let waves: Vec<Waveform> = common::load("waveforms.json");
    for w in &waves {
        let message = Message::parse(&w.text).unwrap_or_else(|e| panic!("{}: {e}", w.text));
        let payload =
            pack(&message, &mut CallsignHashes::new()).unwrap_or_else(|e| panic!("{}: {e}", w.text));
        assert_eq!(
            tones::from_payload(mode_of(w), &payload),
            tone_digits(&w.tones),
            "{}",
            w.text
        );
    }
}

#[test]
fn waveforms_correlate_with_ft8lib() {
    let waves: Vec<Waveform> = common::load("waveforms.json");
    assert!(waves.iter().any(|w| w.mode == "ft8") && waves.iter().any(|w| w.mode == "ft4"));
    for w in &waves {
        let mode = mode_of(w);
        let ours = synth::gfsk(mode, &tone_digits(&w.tones), w.f0_hz, w.sample_rate, 1.0);
        assert_eq!(ours.len(), w.n_samples, "{}", w.text);
        let n = w.n_samples / mode.params().symbols;
        // FT4 ramps differ from ft8_lib in the first and last symbol (see synth module docs).
        let compared = |k: usize| mode == Mode::Ft8 || (k >= n && k < w.n_samples - n);
        let (mut a, mut b) = (Vec::new(), Vec::new());
        let mut max_diff = 0.0f64;
        for (k, v) in w.samples().into_iter().filter(|(k, _)| compared(*k)) {
            a.push(f64::from(ours[k]));
            b.push(f64::from(v));
            max_diff = max_diff.max((f64::from(ours[k]) - f64::from(v)).abs());
        }
        let c = correlation(&a, &b);
        eprintln!(
            "{:?} {} Hz at {} Hz: correlation {c:.7}, max difference {max_diff:.2e} over {} samples",
            mode,
            w.f0_hz,
            w.sample_rate,
            a.len()
        );
        assert!(a.len() > 1500, "{} samples", a.len());
        assert!(
            c > 0.999,
            "{} {:?} {} Hz at {} Hz: correlation {c}",
            w.text,
            mode,
            w.f0_hz,
            w.sample_rate
        );
        // ft8_lib accumulates phase in 32-bit floats; the residual is its rounding.
        assert!(max_diff < 0.02, "{}: max difference {max_diff}", w.text);
    }
}

#[test]
fn ft4_ramp_symbols_use_a_full_symbol_raised_cosine() {
    let waves: Vec<Waveform> = common::load("waveforms.json");
    let w = waves.iter().find(|w| w.mode == "ft4").expect("an FT4 waveform");
    let ours = synth::gfsk(Mode::Ft4, &tone_digits(&w.tones), w.f0_hz, w.sample_rate, 1.0);
    let n = w.n_samples / 105;
    // ft8_lib's envelope is 1 from n/8 on, so ours must be its samples times the QEX ramp.
    for k in n / 8..w.head_len.min(n) {
        let env = (1.0 - (PI * k as f64 / n as f64).cos()) / 2.0;
        let expected = f64::from(w.head[k]) * env;
        assert!((f64::from(ours[k]) - expected).abs() < 1e-3, "sample {k}");
        let end = w.n_samples - 1 - k;
        let tail = f64::from(w.tail[w.head_len - 1 - k]) * env;
        assert!((f64::from(ours[end]) - tail).abs() < 1e-3, "sample {end}");
    }
    assert_eq!(ours[0], 0.0);
}

/// Magnitude of the correlation of `x` with a complex tone at `f` Hz.
fn tone_power(x: &[f32], f: f64, rate: f64) -> f64 {
    let (mut re, mut im) = (0.0, 0.0);
    for (k, &v) in x.iter().enumerate() {
        let ph = TAU * f * k as f64 / rate;
        re += f64::from(v) * ph.cos();
        im -= f64::from(v) * ph.sin();
    }
    re.hypot(im)
}

#[test]
fn every_symbol_carries_its_tone() {
    let mut rng = Rng::new(11);
    for (mode, rate, f0) in [
        (Mode::Ft8, 12_000, 1000.0),
        (Mode::Ft8, 48_000, 2700.0),
        (Mode::Ft4, 12_000, 500.0),
        (Mode::Ft4, 48_000, 1900.0),
    ] {
        let params = mode.params();
        let payload = rng.payload();
        let t = tones::from_payload(mode, &payload);
        let wave = synth::gfsk(mode, &t, f0, rate, 0.5);
        let n = wave.len() / t.len();
        let spacing = f64::from(rate) / n as f64;
        assert!((spacing - f64::from(params.tone_spacing_hz)).abs() < 1e-3);
        for (i, &tone) in t.iter().enumerate() {
            // The middle half of each symbol, where the Gaussian transitions have settled.
            let window = &wave[i * n + n / 4..i * n + 3 * n / 4];
            let best = (0..params.tones as u8)
                .max_by(|&a, &b| {
                    let pa = tone_power(window, f64::from(f0) + f64::from(a) * spacing, f64::from(rate));
                    let pb = tone_power(window, f64::from(f0) + f64::from(b) * spacing, f64::from(rate));
                    pa.total_cmp(&pb)
                })
                .unwrap_or(u8::MAX);
            assert_eq!(best, tone, "{mode:?} at {rate} Hz, symbol {i}");
        }
    }
}

#[test]
fn phase_and_frequency_are_continuous() {
    let mut rng = Rng::new(5);
    for (mode, rate, f0) in [
        (Mode::Ft8, 12_000u32, 1500.0f32),
        (Mode::Ft4, 12_000, 1000.0),
        (Mode::Ft8, 48_000, 300.0),
    ] {
        let params = mode.params();
        let t = tones::from_payload(mode, &rng.payload());
        let amplitude = 0.8f64;
        let wave = synth::gfsk(mode, &t, f0, rate, amplitude as f32);
        let fs = f64::from(rate);
        let f_max = f64::from(f0) + (params.tones - 1) as f64 * f64::from(params.tone_spacing_hz);
        // A phase jump would show as a step larger than the steepest slope of the sine.
        let slope = amplitude * TAU * f_max / fs;
        for k in 1..wave.len() {
            let step = (f64::from(wave[k]) - f64::from(wave[k - 1])).abs();
            assert!(
                step <= slope * 1.001 + 1e-6,
                "{mode:?}: step {step} at sample {k}"
            );
        }
        // Instantaneous frequency from three samples of a sinusoid: s[k-1] + s[k+1] = 2 cos(w) s[k].
        // The estimate assumes constant amplitude, so the first and last symbol (ramps) are skipped.
        let n = wave.len() / t.len();
        let mut last: Option<f64> = None;
        let mut estimates = 0;
        for k in n..wave.len() - n {
            let s = f64::from(wave[k]);
            if s.abs() < 0.6 * amplitude {
                continue;
            }
            let c = ((f64::from(wave[k - 1]) + f64::from(wave[k + 1])) / (2.0 * s)).clamp(-1.0, 1.0);
            let f = c.acos() * fs / TAU;
            assert!(
                f > f64::from(f0) - 2.0 && f < f_max + 2.0,
                "{mode:?}: {f} Hz at sample {k}"
            );
            if let Some(prev) = last {
                // FSK without shaping would jump by up to 7 tone spacings between samples.
                assert!(
                    (f - prev).abs() < 3.0,
                    "{mode:?}: frequency jumps {prev} -> {f} Hz at sample {k}"
                );
            }
            last = Some(f);
            estimates += 1;
        }
        assert!(estimates > wave.len() / 3);
    }
}

#[test]
fn amplitude_ramps_follow_qex() {
    let t = vec![0u8; 79];
    let wave = synth::gfsk(Mode::Ft8, &t, 1000.0, 12_000, 1.0);
    // FT8: 20 ms = 240 samples of raised cosine, then full amplitude.
    let peak = |range: std::ops::Range<usize>| wave[range].iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!(peak(0..24) < 0.03);
    assert!(peak(240..480) > 0.99);
    assert!(peak(wave.len() - 24..wave.len()) < 0.03);
    let t4 = vec![0u8; 105];
    let wave4 = synth::gfsk(Mode::Ft4, &t4, 1000.0, 12_000, 1.0);
    // FT4: the whole 48 ms ramp symbol.
    let peak4 = |range: std::ops::Range<usize>| wave4[range].iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!(peak4(0..144) < 0.16);
    assert!(peak4(240..336) > 0.4 && peak4(240..336) < 0.75);
    assert!(peak4(576..700) > 0.99);
}
