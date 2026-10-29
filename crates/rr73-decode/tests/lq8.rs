//! LQ8 decoding: whole slots rendered by the channel simulator, decoded with the app's preset
//! and later stages, through the LQ8 Costas array and message layer.

use rr73_chansim::{Noise, Scene, SimSignal};
use rr73_decode::{DecodeContext, DecodeSession, DecodedMessage, DecoderConfig, SlotAudio, Stage, decode};
use rr73_ft8::Mode;

/// The app's plan: the preset, then the two later stages (`DEEP` in
/// `web/src/lib/decode/worker-client.ts`).
const PLAN: &str = "subtract-3-osd2; \
    subtract-3-osd2 spectrogram.time_osr=4 spectrogram.freq_osr=4 spectrogram.window_symbols=2 search.skip_silent_frames=true validate.osd_min_snr_db=-23 ap.my_anywhere=false; \
    subtract-3-osd2 spectrogram.time_osr=8 spectrogram.freq_osr=4 spectrogram.window_symbols=2 search.skip_silent_frames=true validate.osd_min_snr_db=-23 ldpc.osd_window=91 search.max_candidates=400 search.min_score_db=2 ap.my_anywhere=false search.ft8_dt_max_s=2.5 search.ft4_dt_max_s=1.0 search.partial_min_score_db=null spectrogram.freq_max_hz=3000 demod.ft8_extra_sets=[[3,\"normalised\"],[1,\"normalised\"]]";

fn render(mode: Mode, signals: Vec<SimSignal>, seed: u64) -> Vec<f32> {
    let scene = Scene {
        mode,
        signals,
        noise: Noise::Awgn,
    };
    rr73_chansim::render(&scene, seed).expect("render").0
}

fn texts(mode: Mode, audio: &[f32], ctx: DecodeContext) -> Vec<String> {
    let stages = Stage::plan(PLAN).expect("plan");
    let mut session = DecodeSession::with_context(&SlotAudio::new(audio, mode), stages, ctx);
    session.run_to_end();
    session.decodes().iter().map(|d| d.text.clone()).collect()
}

#[test]
fn every_lq8_message_kind_decodes_with_hashes_resolved() {
    let signals = vec![
        SimSignal::new("CQ AB4SS FN42", 512.0, 0.1, -8.0),
        SimSignal::new("AB4SS 9V1NE OJ11 -03", 760.0, -0.2, -6.0),
        SimSignal::new("9V1NE AB4SS R+05", 1010.0, 0.3, -10.0),
        SimSignal::new("AB4SS 9V1DE/P JO22 -10", 1260.0, 0.0, -7.0),
        SimSignal::new("<9V1NE> R+05 <OE3OGC> R-03 <AB4SS>", 1510.0, 0.2, -9.0),
        SimSignal::new("AB4SS VP8/9V1DE 73", 1760.0, -0.1, -5.0),
        SimSignal::new("TNX FER QSO", 2010.0, 0.0, -4.0),
        SimSignal::new("CQ POTA 3DA0RU", 2260.0, 0.4, -8.0),
    ];
    let audio = render(Mode::Lq8, signals, 11);
    let mut ctx = DecodeContext::new();
    // The QSO under way: the operator 9V1NE with AB4SS, as the app sets it.
    ctx.lq8.set_active(&["9V1NE", "AB4SS"]);
    let mut got = texts(Mode::Lq8, &audio, ctx);
    got.sort();
    let mut want = vec![
        "CQ AB4SS FN42",
        "AB4SS 9V1NE OJ11 -03",
        "9V1NE AB4SS R+05",
        "<AB4SS> 9V1DE/P JO22 -10",
        "<9V1NE> R+05 <...> R-03 <AB4SS>",
        "<AB4SS> VP8/9V1DE 73",
        "TNX FER QSO",
        "CQ POTA 3DA0RU",
    ];
    want.sort();
    assert_eq!(got, want);
}

#[test]
fn decodes_carry_lq8_messages() {
    let audio = render(
        Mode::Lq8,
        vec![SimSignal::new("AB4SS 9V1NE OJ11 -03", 1000.0, 0.0, -12.0)],
        5,
    );
    let config = DecoderConfig::preset("subtract-3-osd2").expect("preset");
    let r = decode(
        &SlotAudio::new(&audio, Mode::Lq8),
        &config,
        &mut DecodeContext::new(),
    );
    assert_eq!(r.decodes.len(), 1);
    let d = &r.decodes[0];
    assert!((d.freq_hz - 1000.0).abs() < 1.0 && d.dt_s.abs() < 0.05, "{d:?}");
    assert!((d.snr_db + 12.0).abs() < 2.0, "{}", d.snr_db);
    let DecodedMessage::Lq8(m) = &d.message else {
        panic!("{:?}", d.message)
    };
    assert_eq!(
        (m.call1.as_str(), m.call2.as_str(), m.report),
        ("AB4SS", "9V1NE", -3)
    );
}

/// The Costas arrays differ in every symbol but one, so neither mode syncs on the other's
/// signals: a strong FT8 signal gives no LQ8 decode, and the reverse.
#[test]
fn ft8_and_lq8_do_not_decode_each_other() {
    for (sent, heard) in [(Mode::Ft8, Mode::Lq8), (Mode::Lq8, Mode::Ft8)] {
        let audio = render(
            sent,
            vec![
                SimSignal::new("CQ AB4SS FN42", 800.0, 0.0, 0.0),
                SimSignal::new("9V1NE AB4SS -10", 1600.0, 0.2, -5.0),
            ],
            3,
        );
        assert_eq!(texts(sent, &audio, DecodeContext::new()).len(), 2, "{sent:?}");
        assert!(
            texts(heard, &audio, DecodeContext::new()).is_empty(),
            "{sent:?} as {heard:?}"
        );
    }
}

/// No decodes from noise: 8 slots with the app's plan, and 3 with every candidate sent to the
/// decoder. `rr73-bench` measures more (`docs/design/lq8.md`).
#[test]
fn noise_gives_no_lq8_decodes() {
    for seed in 0..8 {
        let (noise, _) =
            rr73_chansim::render(&rr73_chansim::noise_only(Mode::Lq8), 4000 + seed).expect("render");
        let got = texts(Mode::Lq8, &noise, DecodeContext::new());
        assert!(got.is_empty(), "seed {seed}: {got:?}");
    }
    let config = DecoderConfig::preset("subtract-3-osd2")
        .and_then(|c| c.with_overrides(&["search.min_score_db=0"]))
        .expect("config");
    let mut attempts = 0;
    for seed in 0..3 {
        let (noise, _) =
            rr73_chansim::render(&rr73_chansim::noise_only(Mode::Lq8), 5000 + seed).expect("render");
        let r = decode(
            &SlotAudio::new(&noise, Mode::Lq8),
            &config,
            &mut DecodeContext::new(),
        );
        assert!(r.decodes.is_empty(), "seed {seed}: {:?}", r.decodes);
        attempts += r.stats.ldpc_attempts;
    }
    assert!(attempts >= 300, "{attempts}");
}
