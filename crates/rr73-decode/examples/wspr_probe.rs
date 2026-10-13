//! Stage-by-stage diagnostics of the WSPR decoder on rendered slots: where weak signals are
//! lost (search, refinement, soft bits or the Fano decoder).
//!
//! cargo run --release -p rr73-decode --example wspr_probe -- <snr_db> <slots> [key=value ...]

use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use rr73_chansim::{render_wspr, wspr_single};
use rr73_decode::wspr::baseband::{Downconverter, SymbolSpectrogram};
use rr73_decode::wspr::demod::{BlockDemod, NoncoherentDemod, SoftSymbols, WsprDemod};
use rr73_decode::wspr::fano::{Fano, SequentialDecoder};
use rr73_decode::wspr::refine::{CoherentRefine, GridRefine, ToneCorrelator, WsprRefine};
use rr73_decode::wspr::search::{SearchScratch, SyncSearch, WsprSearch};
use rr73_decode::wspr::{WsprCandidate, WsprConfig};
use rr73_dsp::FftPlans;
use rr73_wspr::code::{self, CODE_BITS, INPUT_BITS};
use rr73_wspr::{Message, pack};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let snr: f64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(-30.0);
    let slots: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(20);
    let config = WsprConfig::wspr()
        .with_overrides(&args[3.min(args.len())..])
        .expect("config");
    let mut plans = FftPlans::new();
    let mut down = Downconverter::default();
    let mut bb = Vec::new();
    let mut spec = SymbolSpectrogram::default();
    let (mut buf, mut scratch) = (Vec::new(), Vec::new());
    let search = SyncSearch {
        params: config.search.clone(),
    };
    let mut ss = SearchScratch::default();
    let corr = ToneCorrelator::default();
    let demod: Box<dyn WsprDemod> = if config.demod.kind == rr73_decode::wspr::config::WsprDemodKind::Block {
        Box::new(BlockDemod {
            block: config.demod.block,
            llr_scale: config.demod.llr_scale,
        })
    } else {
        Box::new(NoncoherentDemod {
            llr_scale: config.demod.llr_scale,
        })
    };
    let mut corrs = Box::new([[rr73_dsp::fft::Complex32::new(0.0, 0.0); 4]; 162]);
    let fano = Fano {
        max_cycles_per_bit: config.fano.max_cycles_per_bit,
        delta: config.fano.delta,
        bias: config.fano.bias,
    };
    let mut powers = Box::new([[0.0f32; 4]; 162]);
    let mut refine_powers = Box::new([[0.0f32; 4]; 162]);
    let mut soft = SoftSymbols::default();
    let (mut found, mut decoded, mut genie_ok) = (0, 0, 0);
    let mut ber_sum = 0.0;
    for seed in 0..slots {
        let mut rng = ChaCha8Rng::seed_from_u64(seed * 7919 + 13);
        let scene = wspr_single(snr, None, &mut rng);
        let s = &scene.signals[0];
        let (audio, _) = render_wspr(&scene, seed).expect("render");
        down.run(&audio, &mut plans, &mut bb);
        spec.compute(&bb, &mut plans, &mut buf, &mut scratch);
        let mut cands = Vec::new();
        search.search(&spec, &mut cands, &mut ss);
        let near = cands.iter().enumerate().find(|(_, c)| {
            (f64::from(c.centre_hz()) - s.freq_hz).abs() < 1.5 && (f64::from(c.dt_s()) - s.dt_s).abs() < 0.4
        });
        let msg = Message::parse(&s.message).expect("msg");
        let packed = pack(&msg).expect("pack");
        let truth_code = code::convolve(&packed.encoder_input());
        // Genie candidate at the true position.
        let truth = WsprCandidate {
            tone0_hz: (s.freq_hz - 1500.0 - 1.5 * rr73_wspr::TONE_SPACING_HZ) as f32,
            start: ((1.0 + s.dt_s) * 375.0).round() as i32,
            drift_hz: 0.0,
            score: 0.0,
        };
        let mut line = format!("seed {seed:3} f {:.1} dt {:+.2}: ", s.freq_hz, s.dt_s);
        let mut run = |cand: &WsprCandidate, label: &str, line: &mut String| -> bool {
            corr.correlations(&bb, cand, &mut corrs, &mut powers);
            demod.soft(&corrs, &powers, &mut soft);
            let llr: [f32; CODE_BITS] = code::deinterleave(&soft.llr);
            let errors = (0..CODE_BITS)
                .filter(|&i| (llr[i] > 0.0) != (truth_code[i] == 1))
                .count();
            let mut bits = [0u8; INPUT_BITS];
            let out = fano.decode(&llr, &mut bits);
            let ok = out.decoded && bits == packed.encoder_input();
            line.push_str(&format!(
                "{label}[ber {errors:3} fano {} {:7}] ",
                if ok {
                    "OK "
                } else if out.decoded {
                    "BAD"
                } else {
                    "-- "
                },
                out.cycles
            ));
            if label == "genie" {
                ber_sum += errors as f64;
            }
            ok
        };
        genie_ok += u32::from(run(&truth, "genie", &mut line));
        match near {
            Some((rank, c)) => {
                found += 1;
                let mut r = *c;
                let mut refine_corrs = Box::new([[rr73_dsp::fft::Complex32::new(0.0, 0.0); 4]; 162]);
                if config.refine.kind == rr73_decode::wspr::config::WsprRefineKind::Coherent {
                    CoherentRefine {
                        block: config.refine.block,
                    }
                    .refine(&corr, &bb, &mut r, &mut refine_powers, &mut refine_corrs);
                } else {
                    GridRefine.refine(&corr, &bb, &mut r, &mut refine_powers, &mut refine_corrs);
                }
                line.push_str(&format!(
                    "cand #{rank} score {:.1} df {:+.2}->{:+.2} dt {:+.3}->{:+.3} drift {:+.2}->{:+.2} ",
                    c.score,
                    f64::from(c.centre_hz()) - s.freq_hz,
                    f64::from(r.centre_hz()) - s.freq_hz,
                    f64::from(c.dt_s()) - s.dt_s,
                    f64::from(r.dt_s()) - s.dt_s,
                    c.drift_hz,
                    r.drift_hz
                ));
                decoded += u32::from(run(&r, "ref", &mut line));
            }
            None => line.push_str(&format!(
                "no candidate (best {:?})",
                cands.first().map(|c| c.score)
            )),
        }
        println!("{line}");
    }
    println!(
        "snr {snr}: found {found}/{slots}, decoded {decoded}, genie decoded {genie_ok}, genie mean BER {:.1}/162",
        ber_sum / slots as f64
    );
}
