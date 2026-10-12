//! `rr73-bench synth`: named synthetic sets written as corpus slots with exact truth.

use std::path::{Path, PathBuf};

use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use rayon::prelude::*;
use rr73_chansim::{Noise, Scene, Watterson, crowded, noise_only, render, single};
use rr73_corpus::{Entry, SlotMeta, SlotMode, Source, SourceKind, Timing, TimingReference, write_slot};
use rr73_ft8::Mode;

/// Names accepted by `--set`.
pub const SETS: &[&str] = &["smoke", "noise-ci", "noise", "snr-sweep", "crowded"];

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

/// One slot to render: where it goes and what it holds.
struct Job {
    dir: PathBuf,
    set: String,
    index: usize,
    seed: u64,
    scene: Scene,
}

/// SNR steps of the `snr-sweep` set, in dB.
pub fn sweep_steps() -> impl Iterator<Item = i32> {
    -28..=-8
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

fn jobs_for(name: &str, base: &Path, opts: &SynthOptions) -> Result<Vec<Job>, String> {
    let mut jobs = Vec::new();
    let mut push = |sub: &str, index: usize, scene_of: &mut dyn FnMut(&mut ChaCha8Rng) -> Scene| {
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
                    push("ft8", i, &mut |r| single(Mode::Ft8, snr, None, r));
                    i += 1;
                }
            }
            for snr in [-12.0, -10.0, -8.0, -6.0] {
                push("ft8", i, &mut |r| {
                    single(Mode::Ft8, snr, Some(Watterson::MODERATE), r)
                });
                i += 1;
            }
            for drift in [-0.3, 0.3] {
                push("ft8", i, &mut |r| {
                    let mut s = single(Mode::Ft8, -8.0, None, r);
                    s.signals[0].drift_hz_per_s = drift;
                    s
                });
                i += 1;
            }
            for _ in 0..4 {
                push("ft8", i, &mut |r| {
                    crowded(Mode::Ft8, 10, false, (-16.0, -2.0), 60.0, r)
                });
                i += 1;
            }
            for _ in 0..2 {
                push("ft8", i, &mut |_| noise_only(Mode::Ft8));
                i += 1;
            }
            for (k, snr) in [-14.0, -12.0, -10.0, -8.0, -6.0, -4.0].into_iter().enumerate() {
                push("ft4", k, &mut |r| single(Mode::Ft4, snr, None, r));
            }
        }
        "noise-ci" => {
            for i in 0..50 {
                push("", i, &mut |_| noise_only(Mode::Ft8));
            }
        }
        "noise" => {
            for i in 0..opts.noise_count {
                push("", i, &mut |_| noise_only(Mode::Ft8));
            }
        }
        "snr-sweep" => {
            for (sub, fading) in [("awgn", None), ("fading", Some(Watterson::MODERATE))] {
                let mut i = 0;
                for snr in sweep_steps() {
                    for _ in 0..opts.per_step {
                        push(sub, i, &mut |r| single(Mode::Ft8, f64::from(snr), fading, r));
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
                        crowded(Mode::Ft8, n, overlap, (-18.0, 0.0), 60.0, r)
                    });
                }
            }
        }
        other => return Err(format!("unknown set {other:?}; known sets: {}", SETS.join(", "))),
    }
    Ok(jobs)
}

fn write_job(job: &Job) -> Result<(), String> {
    let (samples, truth) =
        render(&job.scene, job.seed).map_err(|e| format!("{} slot {}: {e}", job.set, job.index))?;
    let mode = match job.scene.mode {
        Mode::Ft8 => SlotMode::Ft8,
        Mode::Ft4 => SlotMode::Ft4,
    };
    // Stems follow WSJT-X naming: one slot period apart from 2026-01-01 00:00:00 UTC.
    let slot_s = match mode {
        SlotMode::Ft8 => 15.0,
        SlotMode::Ft4 => 7.5,
    };
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
            .with(
                "noise",
                if job.scene.noise == Noise::Awgn {
                    "awgn"
                } else {
                    "none"
                },
            )
            .with(
                "signals",
                serde_json::to_value(&job.scene.signals).unwrap_or_default(),
            ),
    );
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
    meta.noise_only = job.scene.signals.is_empty();
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
        assert_eq!(jobs_for("noise-ci", base, &opts).map(|j| j.len()), Ok(50));
        assert_eq!(jobs_for("noise", base, &opts).map(|j| j.len()), Ok(7));
        assert_eq!(
            jobs_for("snr-sweep", base, &opts).map(|j| j.len()),
            Ok(21 * 3 * 2)
        );
        assert_eq!(jobs_for("crowded", base, &opts).map(|j| j.len()), Ok(8));
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
