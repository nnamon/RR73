//! `rr73-bench synth`: named synthetic sets written as corpus slots with exact truth.

use std::path::{Path, PathBuf};

use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use rayon::prelude::*;
use rr73_chansim::{
    Noise, Scene, SimSignal, Truth, Watterson, WsprScene, WsprSignal, crowded, messages, noise_only, render,
    render_wspr, single, wspr_band, wspr_noise_only, wspr_single,
};
use rr73_corpus::{Entry, SlotMeta, SlotMode, Source, SourceKind, Timing, TimingReference, write_slot};
use rr73_ft8::Mode;

/// Names accepted by `--set`.
pub const SETS: &[&str] = &[
    "smoke",
    "noise-ci",
    "noise",
    "snr-sweep",
    "crowded",
    "wspr-smoke",
    "wspr-noise",
    "wspr-snr-sweep",
    "wspr-band",
    "late-start",
    "ap-sweep",
];

/// The operator and the QSO partner of the `ap-sweep` set.
pub const AP_MY: &str = "9V1NE";
pub const AP_DX: &str = "K1ABC";

/// SNR steps of the `ap-sweep` set, in dB.
pub fn ap_sweep_steps() -> impl Iterator<Item = i32> {
    -30..=-18
}

/// Slow Watterson fading for WSPR sets: 0.1 Hz spread, 1 ms delay. WSPR's 1.46 Hz tone
/// spacing and 0.68 s symbols make the 0.5 Hz ITU-R moderate profile much harsher than for
/// FT8, so the WSPR sweep uses a slower one as well.
pub const WSPR_SLOW_FADING: Watterson = Watterson {
    doppler_spread_hz: 0.1,
    delay_ms: 1.0,
};

/// Slots in the `noise-ci` set.
pub const NOISE_CI_SLOTS: usize = 200;

/// Sizes that `synth` options can change.
#[derive(Clone, Debug)]
pub struct SynthOptions {
    /// Noise-only slots in the `noise` set.
    pub noise_count: usize,
    /// Slots per SNR step and channel in `snr-sweep`.
    pub per_step: usize,
    /// Slots per subset in `crowded`.
    pub crowded_count: usize,
}

impl Default for SynthOptions {
    fn default() -> Self {
        Self {
            noise_count: 1000,
            per_step: 40,
            crowded_count: 20,
        }
    }
}

/// What a slot holds: an FT8 or FT4 scene, or a WSPR scene.
#[derive(Clone, Debug, PartialEq)]
pub enum JobScene {
    /// FT8 or FT4.
    Ft(Scene),
    /// WSPR.
    Wspr(WsprScene),
}

/// One slot to render: where it goes and what it holds.
#[derive(Clone, Debug)]
pub struct Job {
    /// Directory the slot is written to.
    pub dir: PathBuf,
    /// Set name, such as `wspr-snr-sweep/awgn`.
    pub set: String,
    /// Index within the set.
    pub index: usize,
    /// Rendering seed.
    pub seed: u64,
    /// The scene.
    pub scene: JobScene,
}

/// SNR steps of the `snr-sweep` set, in dB.
pub fn sweep_steps() -> impl Iterator<Item = i32> {
    -28..=-8
}

/// SNR steps of the `wspr-snr-sweep` set, in dB.
pub fn wspr_sweep_steps() -> impl Iterator<Item = i32> {
    -34..=-20
}

/// Renders the named set into `out/<set>/...`, replacing that directory. Returns the number
/// of slots written.
pub fn synth_set(name: &str, out: &Path, opts: &SynthOptions) -> Result<usize, String> {
    let base = out.join(name);
    let jobs = jobs_for(name, &base, opts)?;
    if base.exists() {
        std::fs::remove_dir_all(&base).map_err(|e| format!("{}: {e}", base.display()))?;
    }
    let results: Vec<Result<(), String>> = jobs.par_iter().map(write_job).collect();
    results.into_iter().collect::<Result<Vec<()>, String>>()?;
    Ok(jobs.len())
}

fn set_seed(name: &str) -> u64 {
    crate::util::fnv1a(name.as_bytes())
}

/// The slots of the named set, rendered into `base`.
pub fn jobs_for(name: &str, base: &Path, opts: &SynthOptions) -> Result<Vec<Job>, String> {
    let mut jobs = Vec::new();
    let mut push = |sub: &str, index: usize, scene_of: &mut dyn FnMut(&mut ChaCha8Rng) -> JobScene| {
        let set = if sub.is_empty() {
            name.to_string()
        } else {
            format!("{name}/{sub}")
        };
        let seed = set_seed(&set).wrapping_add(index as u64);
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        let scene = scene_of(&mut rng);
        let dir = if sub.is_empty() {
            base.to_path_buf()
        } else {
            base.join(sub)
        };
        jobs.push(Job {
            dir,
            set,
            index,
            seed,
            scene,
        });
    };
    match name {
        "smoke" => {
            // FT8: steady signals from -16 to -6 dB, faded, drifting, a 10-signal band and
            // noise; FT4: steady signals. Levels sit above the baseline's threshold so the
            // set checks the plumbing more than sensitivity.
            let mut i = 0;
            for snr in [-16.0, -14.0, -12.0, -10.0, -8.0, -6.0] {
                for _ in 0..2 {
                    push("ft8", i, &mut |r| JobScene::Ft(single(Mode::Ft8, snr, None, r)));
                    i += 1;
                }
            }
            for snr in [-12.0, -10.0, -8.0, -6.0] {
                push("ft8", i, &mut |r| {
                    JobScene::Ft(single(Mode::Ft8, snr, Some(Watterson::MODERATE), r))
                });
                i += 1;
            }
            for drift in [-0.3, 0.3] {
                push("ft8", i, &mut |r| {
                    let mut s = single(Mode::Ft8, -8.0, None, r);
                    s.signals[0].drift_hz_per_s = drift;
                    JobScene::Ft(s)
                });
                i += 1;
            }
            for _ in 0..4 {
                push("ft8", i, &mut |r| {
                    JobScene::Ft(crowded(Mode::Ft8, 10, false, (-16.0, -2.0), 60.0, r))
                });
                i += 1;
            }
            for _ in 0..2 {
                push("ft8", i, &mut |_| JobScene::Ft(noise_only(Mode::Ft8)));
                i += 1;
            }
            for (k, snr) in [-14.0, -12.0, -10.0, -8.0, -6.0, -4.0].into_iter().enumerate() {
                push("ft4", k, &mut |r| JobScene::Ft(single(Mode::Ft4, snr, None, r)));
            }
        }
        "noise-ci" => {
            for i in 0..NOISE_CI_SLOTS {
                push("", i, &mut |_| JobScene::Ft(noise_only(Mode::Ft8)));
            }
        }
        "noise" => {
            for i in 0..opts.noise_count {
                push("", i, &mut |_| JobScene::Ft(noise_only(Mode::Ft8)));
            }
        }
        "ap-sweep" => {
            // Messages to AP_MY at -30 to -18 dB, steady in AWGN: from AP_DX, the QSO partner,
            // ending in turn with a report, an R-report, RRR, RR73 and 73 (qso), and from other
            // stations with a grid (callers). Noise slots carry the same context, the partner
            // somewhere in the band, to count false decodes. render_job writes the context.
            const ENDS: [&str; 5] = ["-15", "R-15", "RRR", "RR73", "73"];
            let (mut q, mut c) = (0, 0);
            for snr in ap_sweep_steps() {
                for k in 0..opts.per_step {
                    push("qso", q, &mut |r| {
                        let mut s = single(Mode::Ft8, f64::from(snr), None, r);
                        s.signals[0].message = format!("{AP_MY} {AP_DX} {}", ENDS[k % ENDS.len()]);
                        JobScene::Ft(s)
                    });
                    q += 1;
                    push("callers", c, &mut |r| {
                        let mut s = single(Mode::Ft8, f64::from(snr), None, r);
                        s.signals[0].message =
                            format!("{AP_MY} {} {}", messages::callsign(r), messages::grid(r));
                        JobScene::Ft(s)
                    });
                    c += 1;
                }
            }
            for i in 0..opts.noise_count {
                push("noise", i, &mut |_| JobScene::Ft(noise_only(Mode::Ft8)));
            }
        }
        "snr-sweep" => {
            for (sub, fading) in [("awgn", None), ("fading", Some(Watterson::MODERATE))] {
                let mut i = 0;
                for snr in sweep_steps() {
                    for _ in 0..opts.per_step {
                        push(sub, i, &mut |r| {
                            JobScene::Ft(single(Mode::Ft8, f64::from(snr), fading, r))
                        });
                        i += 1;
                    }
                }
            }
        }
        "crowded" => {
            for (sub, n, overlap) in [
                ("n10", 10, false),
                ("n20", 20, false),
                ("n40", 40, false),
                ("n20-overlap", 20, true),
            ] {
                for i in 0..opts.crowded_count {
                    push(sub, i, &mut |r| {
                        JobScene::Ft(crowded(Mode::Ft8, n, overlap, (-18.0, 0.0), 60.0, r))
                    });
                }
            }
        }
        "wspr-smoke" => {
            // Steady type 1 signals from -26 to -15 dB, types 2 and 3, drift, slow fading, two
            // busy windows and noise. Most sit above the protocol's -28 dB threshold so the
            // set checks the plumbing more than sensitivity.
            let mut i = 0;
            let mut add = |scene_of: &mut dyn FnMut(&mut ChaCha8Rng) -> WsprScene| {
                push("", i, &mut |r| JobScene::Wspr(scene_of(r)));
                i += 1;
            };
            for snr in [-26.0, -24.0, -22.0, -20.0, -18.0, -15.0] {
                for _ in 0..2 {
                    add(&mut |r| wspr_single(snr, None, r));
                }
            }
            for text in ["PJ4/K1ABC 33", "K1ABC/P 37", "<PJ4/K1ABC> FK52UD 33"] {
                add(&mut |r| {
                    let mut s = wspr_single(-20.0, None, r);
                    s.signals[0].message = text.to_string();
                    s
                });
            }
            for drift in [-0.03, -0.01, 0.01, 0.03] {
                add(&mut |r| {
                    let mut s = wspr_single(-20.0, None, r);
                    s.signals[0].drift_hz_per_s = drift;
                    s
                });
            }
            for _ in 0..2 {
                add(&mut |r| wspr_single(-20.0, Some(WSPR_SLOW_FADING), r));
            }
            for _ in 0..2 {
                add(&mut |r| wspr_band(15, (-26.0, -10.0), 10.0, 0.01, r));
            }
            for _ in 0..2 {
                add(&mut |_| wspr_noise_only());
            }
        }
        "late-start" => {
            // A transmission that starts late by L s, four ways: `shift` sends it whole, L s
            // late, cut at the end of the slot; `cut` keeps it on time and drops its first L s;
            // `splice` and `replace` are `cut` and `shift` after a CQ at the same frequency sent
            // for the first L s, as when a reply replaces our CQ on air.
            // Steady signals from -22 to -8 dB (FT8) and -20 to -6 dB (FT4) in 2 dB steps, DT 0
            // before the delay.
            for (mode, name, lates, snrs) in [
                (
                    Mode::Ft8,
                    "ft8",
                    &[0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 6.0][..],
                    &[-22.0, -20.0, -18.0, -16.0, -14.0, -12.0, -10.0, -8.0][..],
                ),
                (
                    Mode::Ft4,
                    "ft4",
                    &[0.0, 0.25, 0.5, 0.625, 0.75, 0.875, 1.0, 1.25, 1.5, 2.0, 2.5][..],
                    &[-20.0, -18.0, -16.0, -14.0, -12.0, -10.0, -8.0, -6.0][..],
                ),
            ] {
                for how in ["shift", "cut", "splice", "replace"] {
                    for &late in lates {
                        let sub = format!("{name}-{how}-{late:.3}");
                        let mut i = 0;
                        for &snr in snrs {
                            for _ in 0..opts.per_step {
                                push(&sub, i, &mut |r| {
                                    let mut s = single(mode, snr, None, r);
                                    let sig = &mut s.signals[0];
                                    if how == "shift" || how == "replace" {
                                        sig.dt_s = late;
                                    } else {
                                        sig.dt_s = 0.0;
                                        sig.cut_s = late;
                                    }
                                    if (how == "splice" || how == "replace") && late > 0.0 {
                                        let mut cq = SimSignal::new("CQ 9V1NE OJ11", sig.freq_hz, 0.0, snr);
                                        cq.length_s = Some(late);
                                        s.signals.push(cq);
                                    }
                                    JobScene::Ft(s)
                                });
                                i += 1;
                            }
                        }
                    }
                }
            }
        }
        "wspr-noise" => {
            for i in 0..opts.noise_count {
                push("", i, &mut |_| JobScene::Wspr(wspr_noise_only()));
            }
        }
        "wspr-snr-sweep" => {
            for (sub, fading) in [("awgn", None), ("fading", Some(WSPR_SLOW_FADING))] {
                let mut i = 0;
                for snr in wspr_sweep_steps() {
                    for _ in 0..opts.per_step {
                        push(sub, i, &mut |r| {
                            JobScene::Wspr(wspr_single(f64::from(snr), fading, r))
                        });
                        i += 1;
                    }
                }
            }
        }
        "wspr-band" => {
            for i in 0..opts.crowded_count {
                push("", i, &mut |r| {
                    JobScene::Wspr(wspr_band(20, (-28.0, -10.0), 8.0, 0.01, r))
                });
            }
        }
        other => return Err(format!("unknown set {other:?}; known sets: {}", SETS.join(", "))),
    }
    Ok(jobs)
}

/// Renders a job: the slot's samples, its sidecar and its stem.
pub fn render_job(job: &Job) -> Result<(Vec<f32>, SlotMeta, String), String> {
    let fail = |e: rr73_chansim::RenderError| format!("{} slot {}: {e}", job.set, job.index);
    let (samples, truth, mode, noise, signals): (Vec<f32>, Vec<Truth>, SlotMode, Noise, serde_json::Value) =
        match &job.scene {
            JobScene::Ft(scene) => {
                let (samples, truth) = render(scene, job.seed).map_err(fail)?;
                let mode = match scene.mode {
                    Mode::Ft8 => SlotMode::Ft8,
                    Mode::Ft4 => SlotMode::Ft4,
                };
                let signals = serde_json::to_value(&scene.signals).unwrap_or_default();
                (samples, truth, mode, scene.noise, signals)
            }
            JobScene::Wspr(scene) => {
                let (samples, truth) = render_wspr(scene, job.seed).map_err(fail)?;
                let signals = serde_json::to_value::<&[WsprSignal]>(&scene.signals).unwrap_or_default();
                (samples, truth, SlotMode::Wspr, scene.noise, signals)
            }
        };
    // Stems follow WSJT-X naming: one slot period apart from 2026-01-01 00:00:00 UTC.
    let slot_s = mode.slot_s();
    let t = (job.index as f64 * slot_s) as i64 % 86_400;
    let (h, m, s) = (t / 3600, (t % 3600) / 60, t % 60);
    let stem = format!("260101_{h:02}{m:02}{s:02}_s{:04}", job.index);
    let mut meta = SlotMeta::new(
        mode,
        Source::new(SourceKind::Synthetic)
            .with(
                "generator",
                format!("rr73-bench {} synth", env!("CARGO_PKG_VERSION")),
            )
            .with("set", job.set.clone())
            .with("seed", job.seed)
            .with("noise", if noise == Noise::Awgn { "awgn" } else { "none" })
            .with("signals", signals.clone()),
    );
    if job.set.starts_with("ap-sweep/") {
        // The partner's frequency: its signal in `qso`, anywhere for callers (unknown), a
        // frequency drawn from the seed for noise.
        let dx_hz = match job.set.as_str() {
            "ap-sweep/qso" => signals
                .get(0)
                .and_then(|s| s.get("freq_hz"))
                .cloned()
                .unwrap_or_default(),
            "ap-sweep/noise" => serde_json::json!(300.0 + (job.seed % 2400) as f64),
            _ => serde_json::Value::Null,
        };
        meta.source.extra.insert(
            "ap".to_string(),
            serde_json::json!({ "my": AP_MY, "dx": AP_DX, "dx_hz": dx_hz }),
        );
    }
    meta.start_utc = Some(format!(
        "2026-01-01T{h:02}:{m:02}:{s:02}{}Z",
        if mode == SlotMode::Ft4 && job.index % 2 == 1 {
            ".5"
        } else {
            ""
        }
    ));
    meta.timing = Some(Timing {
        reference: TimingReference::Synthetic,
        offset_s: 0.0,
    });
    meta.noise_only = truth.is_empty();
    meta.truth = Some(
        truth
            .into_iter()
            .map(|t| Entry {
                text: t.text,
                freq_hz: t.freq_hz,
                dt_s: t.dt_s,
                snr_db: t.snr_db,
            })
            .collect(),
    );
    Ok((samples, meta, stem))
}

fn write_job(job: &Job) -> Result<(), String> {
    let (samples, meta, stem) = render_job(job)?;
    write_slot(&job.dir, &stem, &samples, &meta).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_plans_have_the_documented_sizes() {
        let opts = SynthOptions {
            noise_count: 7,
            per_step: 3,
            crowded_count: 2,
        };
        let base = Path::new("unused");
        assert_eq!(jobs_for("smoke", base, &opts).map(|j| j.len()), Ok(30));
        assert_eq!(jobs_for("noise-ci", base, &opts).map(|j| j.len()), Ok(200));
        assert_eq!(jobs_for("noise", base, &opts).map(|j| j.len()), Ok(7));
        assert_eq!(
            jobs_for("snr-sweep", base, &opts).map(|j| j.len()),
            Ok(21 * 3 * 2)
        );
        assert_eq!(jobs_for("crowded", base, &opts).map(|j| j.len()), Ok(8));
        assert_eq!(
            jobs_for("ap-sweep", base, &opts).map(|j| j.len()),
            Ok(13 * 3 * 2 + 7)
        );
        assert_eq!(jobs_for("wspr-smoke", base, &opts).map(|j| j.len()), Ok(25));
        assert_eq!(jobs_for("wspr-noise", base, &opts).map(|j| j.len()), Ok(7));
        assert_eq!(
            jobs_for("wspr-snr-sweep", base, &opts).map(|j| j.len()),
            Ok(15 * 3 * 2)
        );
        assert_eq!(jobs_for("wspr-band", base, &opts).map(|j| j.len()), Ok(2));
        // FT8: 4 ways x 12 delays, FT4: 4 x 11, each at 8 SNRs.
        assert_eq!(
            jobs_for("late-start", base, &opts).map(|j| j.len()),
            Ok((4 * 12 + 4 * 11) * 8 * 3)
        );
        assert!(jobs_for("bogus", base, &opts).is_err());
    }

    #[test]
    fn plans_are_deterministic_and_seeds_differ_per_slot() {
        let opts = SynthOptions::default();
        let a = jobs_for("smoke", Path::new("x"), &opts).expect("plan");
        let b = jobs_for("smoke", Path::new("x"), &opts).expect("plan");
        assert!(
            a.iter()
                .zip(&b)
                .all(|(x, y)| x.scene == y.scene && x.seed == y.seed)
        );
        let mut seeds: Vec<(String, u64)> = a.iter().map(|j| (j.set.clone(), j.seed)).collect();
        seeds.sort();
        seeds.dedup();
        assert_eq!(seeds.len(), a.len());
    }
}
