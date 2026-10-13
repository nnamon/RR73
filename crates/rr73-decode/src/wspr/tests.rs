//! Pipeline tests on slots rendered by the channel simulator.

use rr73_chansim::{Noise, WsprScene, WsprSignal, render_wspr};

use super::*;

fn slot(signals: Vec<WsprSignal>, seed: u64) -> Vec<f32> {
    render_wspr(
        &WsprScene {
            signals,
            noise: Noise::Awgn,
        },
        seed,
    )
    .expect("render")
    .0
}

#[test]
fn decodes_a_clean_signal_with_its_parameters() {
    let mut s = WsprSignal::new("K1ABC FN42 37", 1523.4, 0.7, -18.0);
    s.drift_hz_per_s = 0.012;
    let audio = slot(vec![s], 1);
    let mut ctx = WsprContext::new();
    let r = decode_wspr(&audio, &WsprConfig::wspr(), &mut ctx);
    assert_eq!(r.decodes.len(), 1, "{r:?}");
    let d = &r.decodes[0];
    assert_eq!(d.text, "K1ABC FN42 37");
    assert!((d.freq_hz - 1523.4).abs() < 0.2, "{d:?}");
    assert!((d.dt_s - 0.7).abs() < 0.05, "{d:?}");
    assert!((d.drift_hz_per_s - 0.012).abs() < 0.003, "{d:?}");
    assert!((d.snr_db + 18.0).abs() < 1.5, "{d:?}");
    assert!(r.stats.ldpc_attempts >= 1 && r.timings.total_s >= r.timings.ldpc_s);
}

#[test]
fn compound_and_hashed_messages_resolve_across_slots() {
    let mut ctx = WsprContext::new();
    let config = WsprConfig::wspr();
    let hashed = slot(
        vec![WsprSignal::new("<PJ4/K1ABC> FK52UD 33", 1450.0, 0.0, -15.0)],
        2,
    );
    let r = decode_wspr(&hashed, &config, &mut ctx);
    assert_eq!(
        r.decodes.iter().map(|d| d.text.as_str()).collect::<Vec<_>>(),
        ["<...> FK52UD 33"]
    );
    let compound = slot(vec![WsprSignal::new("PJ4/K1ABC 33", 1450.0, 0.0, -15.0)], 3);
    let r = decode_wspr(&compound, &config, &mut ctx);
    assert_eq!(
        r.decodes.iter().map(|d| d.text.as_str()).collect::<Vec<_>>(),
        ["PJ4/K1ABC 33"]
    );
    let r = decode_wspr(&hashed, &config, &mut ctx);
    assert_eq!(
        r.decodes.iter().map(|d| d.text.as_str()).collect::<Vec<_>>(),
        ["<PJ4/K1ABC> FK52UD 33"]
    );
}

#[test]
fn two_signals_and_noise() {
    let audio = slot(
        vec![
            WsprSignal::new("9V1NE OJ11 37", 1430.0, -0.5, -20.0),
            WsprSignal::new("G4JNT IO90 30", 1580.0, 1.5, -22.0),
        ],
        4,
    );
    let mut ctx = WsprContext::new();
    let r = decode_wspr(&audio, &WsprConfig::wspr(), &mut ctx);
    let mut texts: Vec<&str> = r.decodes.iter().map(|d| d.text.as_str()).collect();
    texts.sort_unstable();
    assert_eq!(texts, ["9V1NE OJ11 37", "G4JNT IO90 30"]);
    for seed in 10..12 {
        let r = decode_wspr(&slot(Vec::new(), seed), &WsprConfig::wspr(), &mut ctx);
        assert!(r.decodes.is_empty(), "{:?}", r.decodes);
    }
}

#[test]
fn hostile_audio_never_panics_or_decodes() {
    // Fewer Fano steps keep the debug build quick; the checks do not depend on depth.
    let config = WsprConfig::wspr()
        .with_overrides(&["fano.max_cycles_per_bit=500"])
        .expect("config");
    let mut ctx = WsprContext::new();
    let mut mixed = vec![0.0f32; 1_440_000];
    mixed[1000] = f32::NAN;
    mixed[2000] = f32::INFINITY;
    mixed[3000] = 1e30;
    for (name, samples) in [
        ("empty", Vec::new()),
        ("short", vec![0.5; 1000]),
        ("silence", vec![0.0; 1_440_000]),
        ("nan", vec![f32::NAN; 1_440_000]),
        ("mixed", mixed),
        ("long", vec![0.1; 2_000_000]),
    ] {
        let r = decode_wspr(&samples, &config, &mut ctx);
        assert!(r.decodes.is_empty(), "{name}");
        assert!(
            r.stats.candidates as usize <= config.search.max_candidates,
            "{name}"
        );
    }
}
