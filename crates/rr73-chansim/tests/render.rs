//! Rendering tests that use the codec's tones and GFSK synthesis.

use rr73_chansim::{
    NOISE_RMS, Noise, RenderError, Scene, SimSignal, Watterson, noise_only, render, render_loop,
};
use rr73_ft8::Mode;

fn power(x: &[f32]) -> f64 {
    x.iter().map(|&v| f64::from(v) * f64::from(v)).sum::<f64>() / x.len() as f64
}

fn quiet(mode: Mode, signals: Vec<SimSignal>) -> Scene {
    Scene {
        mode,
        signals,
        noise: Noise::None,
    }
}

#[test]
fn rendering_is_deterministic_and_seed_dependent() {
    let mut faded = SimSignal::new("CQ K1ABC FN42", 1000.0, 0.1, -10.0);
    faded.fading = Some(Watterson::MODERATE);
    let scene = Scene {
        mode: Mode::Ft8,
        signals: vec![faded],
        noise: Noise::Awgn,
    };
    let (a, ta) = render(&scene, 7).expect("render");
    let (b, tb) = render(&scene, 7).expect("render");
    let (c, _) = render(&scene, 8).expect("render");
    assert_eq!(a, b);
    assert_eq!(ta, tb);
    assert_ne!(a, c);
    assert_eq!(a.len(), 180_000);
    assert_eq!(ta[0].text, "CQ K1ABC FN42");
}

#[test]
fn signal_power_follows_the_2500_hz_convention() {
    // Without noise, a steady signal at S dB has power 10^(S/10) * rms^2 * 2500 / 6000
    // over its 12.64 s (79 symbols of 0.16 s).
    for snr in [-20.0, -10.0, 0.0] {
        let (audio, _) = render(
            &quiet(Mode::Ft8, vec![SimSignal::new("CQ K1ABC FN42", 1500.0, 0.0, snr)]),
            1,
        )
        .expect("render");
        let start = 6000;
        let len = 79 * 1920;
        let measured = power(&audio[start..start + len]);
        let expected = 10f64.powf(snr / 10.0) * NOISE_RMS * NOISE_RMS * 2500.0 / 6000.0;
        assert!(
            (10.0 * (measured / expected).log10()).abs() < 0.2,
            "{snr} dB: {measured} vs {expected}"
        );
        // Nothing before the nominal start.
        assert!(power(&audio[..start - 10]) < expected * 1e-6);
    }
}

#[test]
fn noise_has_the_reference_level() {
    let (audio, truth) = render(&noise_only(Mode::Ft8), 3).expect("render");
    assert!(truth.is_empty());
    let rms = power(&audio).sqrt();
    assert!((rms - NOISE_RMS).abs() < 0.0005, "{rms}");
}

#[test]
fn dt_shifts_the_start_and_partial_signals_are_cut() {
    let early = render(
        &quiet(
            Mode::Ft8,
            vec![SimSignal::new("CQ K1ABC FN42", 1500.0, -1.0, 0.0)],
        ),
        1,
    )
    .expect("render")
    .0;
    // Starts 0.5 s before the slot: the first samples already carry signal.
    assert!(power(&early[..1000]) > 0.0);
    let late = render(
        &quiet(Mode::Ft8, vec![SimSignal::new("CQ K1ABC FN42", 1500.0, 1.0, 0.0)]),
        1,
    )
    .expect("render")
    .0;
    assert!(power(&late[..17_000]) < 1e-12);
    assert!(power(&late[19_000..20_000]) > 0.0);
}

#[test]
fn loops_carry_signals_past_the_end_over_to_the_start() {
    let at = |dt: f64| quiet(Mode::Ft8, vec![SimSignal::new("CQ K1ABC FN42", 1500.0, dt, 0.0)]);
    // Starting 11 s into the slot, the transmission runs 8.64 s past its end. The loop is
    // the cut rendering at that DT plus the cut rendering one slot (15 s) earlier.
    let (looped, truth) = render_loop(&at(10.5), 1).expect("render");
    let (head, _) = render(&at(10.5), 1).expect("render");
    let (tail, _) = render(&at(10.5 - 15.0), 1).expect("render");
    assert_eq!(truth[0].dt_s, 10.5);
    let joined: Vec<f32> = head.iter().zip(&tail).map(|(h, t)| h + t).collect();
    assert_eq!(looped, joined);
    assert!(power(&looped[..12_000]) > 0.0 && power(&looped[170_000..]) > 0.0);
    // The same holds for any whole number of slots, early or late.
    assert_eq!(render_loop(&at(10.5 - 30.0), 1).expect("render").0, looped);
    assert_eq!(render_loop(&at(10.5 + 15.0), 1).expect("render").0, looped);
    // A transmission inside the slot renders as before, noise included.
    let mut noisy = at(0.2);
    noisy.noise = Noise::Awgn;
    assert_eq!(render_loop(&noisy, 3), render(&noisy, 3));
}

#[test]
fn loud_scenes_are_scaled_below_full_scale() {
    let signals = (0..30)
        .map(|i| SimSignal::new("CQ K1ABC FN42", 300.0 + 80.0 * f64::from(i), 0.0, 30.0))
        .collect();
    let (audio, _) = render(&quiet(Mode::Ft8, signals), 1).expect("render");
    let peak = audio.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    assert!(peak <= 0.98 + 1e-6 && peak > 0.9, "{peak}");
}

#[test]
fn bad_messages_and_parameters_are_errors() {
    let bad = quiet(
        Mode::Ft8,
        vec![SimSignal::new(
            "THIS IS NOT A VALID FT8 MESSAGE AT ALL",
            1000.0,
            0.0,
            0.0,
        )],
    );
    assert!(matches!(render(&bad, 1), Err(RenderError::Message(..))));
    let nan = quiet(
        Mode::Ft8,
        vec![SimSignal::new("CQ K1ABC FN42", f64::NAN, 0.0, 0.0)],
    );
    assert_eq!(render(&nan, 1), Err(RenderError::NotFinite(0)));
}

#[test]
fn random_messages_round_trip_and_render() {
    use rand::SeedableRng;
    use rr73_ft8::message::{self, Message};
    let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(4);
    for i in 0..2000 {
        let text = rr73_chansim::messages::message(&mut rng);
        let mut hashes = rr73_ft8::CallsignHashes::new();
        let parsed = Message::parse(&text).unwrap_or_else(|e| panic!("{text}: {e}"));
        let payload = message::pack(&parsed, &mut hashes).unwrap_or_else(|e| panic!("{text}: {e}"));
        let back = message::unpack(&payload, &hashes).unwrap_or_else(|e| panic!("{text}: {e}"));
        assert_eq!(back.to_string(), text);
        if i % 100 == 0 {
            let scene = quiet(Mode::Ft8, vec![SimSignal::new(text.clone(), 1000.0, 0.0, 0.0)]);
            let (_, truth) = render(&scene, 1).unwrap_or_else(|e| panic!("{text}: {e}"));
            assert_eq!(truth[0].text, text);
        }
    }
}
