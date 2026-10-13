//! `rr73-bench run`: decode every slot under the given paths and score it.

use std::path::{Path, PathBuf};
use std::time::Instant;

use rayon::prelude::*;
use rr73_corpus::{Entry, SlotFiles, SlotMode, Tolerance, discover, match_entries, read_slot};
use rr73_decode::{DecodeContext, DecodeSession, DecoderConfig, SlotAudio, Stage};
use rr73_ft8::{CallsignHashes, Mode};

use crate::results::{
    self, DecodeRecord, EntryRecord, RESULTS_FORMAT, Results, SlotKind, SlotResult, set_name, summarise,
};
use crate::util;

/// Options of one run.
#[derive(Clone, Debug)]
pub struct RunOptions {
    /// Preset name.
    pub preset: String,
    /// `key=value` overrides.
    pub overrides: Vec<String>,
    /// Corpus files or directories.
    pub paths: Vec<PathBuf>,
    /// Output file; default `results/<git-sha>-<preset>.json`.
    pub out: Option<PathBuf>,
    /// Decoder threads; default all CPUs.
    pub threads: Option<usize>,
    /// Reference key for real slots.
    pub reference: Option<String>,
    /// Decode only the first this many seconds of each slot.
    pub audio_s: Option<f64>,
    /// What stands in for the rest of the slot when `audio_s` is set.
    pub audio_fill: AudioFill,
    /// Later stages, each `"<preset> [key=value ...]"`, run after the preset on the same
    /// slot (see [`rr73_decode::DecodeSession`]).
    pub then: Vec<String>,
}

/// The rest of a slot cut short by `--audio-s`.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize, clap::ValueEnum,
)]
#[serde(rename_all = "kebab-case")]
pub enum AudioFill {
    /// The audio ends there; the decoder treats the slot as partial.
    #[default]
    Absent,
    /// Zeros up to the slot length; the decoder sees a full slot.
    Zero,
}

/// Runs the decoder over the corpus, writes the results file and returns it with its path.
pub fn run(opts: &RunOptions) -> Result<(Results, PathBuf), String> {
    let config = DecoderConfig::preset(&opts.preset)
        .and_then(|c| c.with_overrides(&opts.overrides))
        .map_err(|e| e.to_string())?;
    let mut stages = vec![(opts.preset.clone(), config.clone())];
    for spec in &opts.then {
        stages.push(stage_spec(spec)?);
    }
    let files = discover(&opts.paths).map_err(|e| e.to_string())?;
    if files.is_empty() {
        return Err("no slots found under the given paths".into());
    }
    let threads = opts
        .threads
        .unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1))
        .max(1);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    let reference = opts.reference.as_deref();
    let mut slots: Vec<SlotResult> = pool.install(|| {
        files
            .par_iter()
            .map_init(DecodeContext::new, |ctx, f| {
                process(f, &stages, ctx, reference, opts.audio_s, opts.audio_fill)
            })
            .collect()
    });
    let wall_s = start.elapsed().as_secs_f64();
    slots.sort_by(|a, b| a.path.cmp(&b.path));

    let git_sha = util::git_sha();
    let results = Results {
        format: RESULTS_FORMAT.into(),
        created_utc: util::now_utc(),
        git_sha: git_sha.clone(),
        preset: opts.preset.clone(),
        overrides: opts.overrides.clone(),
        config: config_json(&config)?,
        reference_key: opts.reference.clone(),
        audio_s: opts.audio_s,
        audio_fill: opts.audio_s.map(|_| opts.audio_fill),
        then: opts.then.clone(),
        environment: util::environment(threads),
        wall_s,
        slim: false,
        sets: summarise(&slots),
        slots,
    };
    let out = opts.out.clone().unwrap_or_else(|| {
        let mut key = opts.overrides.clone();
        key.extend(opts.then.iter().map(|t| format!("then {t}")));
        default_path(&git_sha, &opts.preset, &key)
    });
    results::save(&results, &out)?;
    Ok((results, out))
}

/// Parses a `--then` stage: a preset name followed by `key=value` overrides, separated by
/// spaces.
pub fn stage_spec(spec: &str) -> Result<(String, DecoderConfig), String> {
    let Stage { name, config, .. } = Stage::parse(spec).map_err(|e| format!("--then {spec:?}: {e}"))?;
    Ok((name, config))
}

/// The configuration as JSON. Going through text keeps `f32` values short (`-2.3`, where a
/// direct conversion to a JSON value would widen them to `-2.299999952316284`).
fn config_json(config: &DecoderConfig) -> Result<serde_json::Value, String> {
    let text = serde_json::to_string(config).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// `results/<git-sha>-<preset>.json`, with `-<hash>` of the overrides when there are any.
pub fn default_path(sha: &str, preset: &str, overrides: &[String]) -> PathBuf {
    let mut name = format!("{sha}-{preset}");
    if !overrides.is_empty() {
        name.push_str(&format!(
            "-{:08x}",
            util::fnv1a(overrides.join("\n").as_bytes()) as u32
        ));
    }
    Path::new("results").join(format!("{name}.json"))
}

fn process(
    files: &SlotFiles,
    stages: &[(String, DecoderConfig)],
    ctx: &mut DecodeContext,
    reference: Option<&str>,
    audio_s: Option<f64>,
    fill: AudioFill,
) -> SlotResult {
    let path = files.wav.display().to_string();
    let set = set_name(&files.wav);
    let slot = match read_slot(files) {
        Ok(s) => s,
        Err(e) => {
            return SlotResult {
                path,
                set,
                mode: String::new(),
                kind: SlotKind::Real,
                expected: 0,
                decoded: 0,
                matched: 0,
                unique: 0,
                time_s: 0.0,
                stages: Default::default(),
                stats: Default::default(),
                stage_s: Vec::new(),
                step_max_s: 0.0,
                step_max_by_kind: Default::default(),
                decodes: Vec::new(),
                entries: Vec::new(),
                error: Some(e.to_string()),
            };
        }
    };
    let mode = match slot.meta.mode {
        SlotMode::Ft8 => Mode::Ft8,
        SlotMode::Ft4 => Mode::Ft4,
    };
    // Each slot starts from an empty hash table so results do not depend on thread order.
    ctx.hashes = CallsignHashes::new();
    let mut samples = slot.samples.clone();
    let mut partial = false;
    if let Some(seconds) = audio_s {
        let keep = ((seconds.max(0.0) * 12_000.0).round() as usize).min(samples.len());
        match fill {
            AudioFill::Absent => {
                samples.truncate(keep);
                partial = true;
            }
            AudioFill::Zero => samples[keep..].fill(0.0),
        }
    }
    let audio = if partial {
        SlotAudio::partial(&samples, mode)
    } else {
        SlotAudio::new(&samples, mode)
    };
    let stages = stages
        .iter()
        .map(|(name, config)| Stage::new(name.clone(), config.clone()))
        .collect();
    let started = Instant::now();
    let mut session = DecodeSession::with_context(&audio, stages, std::mem::take(ctx));
    let mut step_max_s = 0.0f64;
    let mut step_max_by_kind = std::collections::BTreeMap::<String, f64>::new();
    while !session.is_done() {
        let kind = session.next_step_kind();
        let step = Instant::now();
        session.step();
        let t = step.elapsed().as_secs_f64();
        step_max_s = step_max_s.max(t);
        let max = step_max_by_kind.entry(kind.to_string()).or_default();
        *max = max.max(t);
    }
    let time_s = started.elapsed().as_secs_f64();
    let report = session.report();
    let decode_stages = session.decode_stages().to_vec();
    let stage_s = if session.stage_count() > 1 {
        session.stage_seconds().to_vec()
    } else {
        Vec::new()
    };
    *ctx = session.into_context();

    let decoded: Vec<Entry> = report
        .decodes
        .iter()
        .map(|d| Entry {
            text: d.text.clone(),
            freq_hz: f64::from(d.freq_hz),
            dt_s: f64::from(d.dt_s),
            snr_db: f64::from(d.snr_db),
        })
        .collect();
    let expected = slot.meta.expected(reference);
    let score = match_entries(&decoded, expected, Tolerance::default());
    let kind = if slot.meta.noise_only {
        SlotKind::Noise
    } else if slot.meta.truth.is_some() {
        SlotKind::Synthetic
    } else {
        SlotKind::Real
    };
    let decodes = report
        .decodes
        .iter()
        .zip(&score.decode_match)
        .zip(&decode_stages)
        .map(|((d, m), &stage)| DecodeRecord {
            text: d.text.clone(),
            freq_hz: round(f64::from(d.freq_hz), 3),
            dt_s: round(f64::from(d.dt_s), 3),
            snr_db: round(f64::from(d.snr_db), 2),
            pass: d.pass,
            ldpc_iterations: d.ldpc_iterations,
            hard_errors: d.hard_errors,
            score: round(f64::from(d.score), 3),
            matched: m.is_some(),
            osd: d.osd,
            osd_distance: round(f64::from(d.osd_distance), 4),
            stage: stage as u32,
        })
        .collect();
    let entries = expected
        .iter()
        .zip(&score.entry_match)
        .map(|(e, m)| EntryRecord {
            text: e.text.clone(),
            freq_hz: e.freq_hz,
            dt_s: e.dt_s,
            snr_db: e.snr_db,
            matched: m.is_some(),
        })
        .collect();
    SlotResult {
        path,
        set,
        mode: slot.meta.mode.name().into(),
        kind,
        expected: score.expected,
        decoded: score.decodes,
        matched: score.matched,
        unique: score.unique,
        time_s,
        stages: report.timings,
        stats: report.stats,
        stage_s,
        step_max_s,
        step_max_by_kind,
        decodes,
        entries,
        error: None,
    }
}

fn round(x: f64, digits: i32) -> f64 {
    let f = 10f64.powi(digits);
    (x * f).round() / f
}

/// Per-stage totals printed after a run with `--then`: decodes found by each stage (matched,
/// false on synthetic and noise slots, unmatched on recordings) and its time per slot.
pub fn stage_table(results: &Results) -> String {
    let count = 1 + results.then.len();
    let mut out = format!(
        "{:<6} {:>8} {:>8} {:>6} {:>9} {:>9} {:>9} {:>9}\n",
        "stage", "decodes", "matched", "false", "unmatched", "p50 ms", "p90 ms", "max ms"
    );
    for stage in 0..count {
        let (mut decodes, mut matched, mut false_decodes, mut unmatched) = (0, 0, 0, 0);
        let mut times = Vec::new();
        for slot in &results.slots {
            for d in slot.decodes.iter().filter(|d| d.stage as usize == stage) {
                decodes += 1;
                if d.matched {
                    matched += 1;
                } else if slot.kind == SlotKind::Real {
                    unmatched += 1;
                } else {
                    false_decodes += 1;
                }
            }
            if let Some(&t) = slot.stage_s.get(stage) {
                times.push(t * 1000.0);
            }
        }
        let p = |q: f64| {
            rr73_corpus::stats::percentile(&times, q)
                .map(|v| format!("{v:.1}"))
                .unwrap_or_else(|| "-".into())
        };
        out.push_str(&format!(
            "{:<6} {:>8} {:>8} {:>6} {:>9} {:>9} {:>9} {:>9}\n",
            stage + 1,
            decodes,
            matched,
            false_decodes,
            unmatched,
            p(50.0),
            p(90.0),
            p(100.0),
        ));
    }
    let step_max = results.slots.iter().map(|s| s.step_max_s).fold(0.0, f64::max);
    out.push_str(&format!("longest step: {:.1} ms\n", step_max * 1000.0));
    out
}

/// The summary table printed after a run.
pub fn summary_table(results: &Results) -> String {
    let mut out = format!(
        "{:<28} {:>6} {:>8} {:>8} {:>7} {:>6} {:>7} {:>7} {:>8} {:>8}\n",
        "set", "slots", "expected", "matched", "recall", "false", "unique", "SNR50", "p50 ms", "p90 ms"
    );
    for (name, s) in &results.sets {
        out.push_str(&format!(
            "{:<28} {:>6} {:>8} {:>8} {:>7} {:>6} {:>7} {:>7} {:>8.1} {:>8.1}\n",
            name,
            s.slots,
            s.expected,
            s.matched,
            s.recall
                .map(|r| format!("{:.3}", r))
                .unwrap_or_else(|| "-".into()),
            s.false_decodes,
            s.unique_real,
            s.snr50
                .map(|f| format!("{:.1}", f.snr50_db))
                .unwrap_or_else(|| "-".into()),
            s.time.p50_ms,
            s.time.p90_ms,
        ));
        if s.errors > 0 {
            out.push_str(&format!("  {} slot(s) could not be read\n", s.errors));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_specs_name_a_preset_and_overrides() {
        let (name, c) = stage_spec("  subtract-3-osd2 search.max_candidates=300 passes=2 ").expect("spec");
        assert_eq!(name, "subtract-3-osd2 search.max_candidates=300 passes=2");
        assert_eq!((c.search.max_candidates, c.passes), (300, 2));
        assert!(c.ldpc.osd_erasures_as_errors);
        assert!(stage_spec("").is_err());
        assert!(stage_spec("no-such-preset").is_err());
        assert!(stage_spec("baseline search.nothing=1").is_err());
    }

    #[test]
    fn config_floats_stay_short() {
        let v = config_json(&DecoderConfig::baseline()).expect("json");
        assert_eq!(v["search"]["ft8_dt_min_s"].to_string(), "-2.3");
    }

    #[test]
    fn default_paths_name_the_commit_preset_and_overrides() {
        assert_eq!(
            default_path("abc", "baseline", &[]),
            Path::new("results/abc-baseline.json")
        );
        let p = default_path("abc", "baseline", &["ldpc.kind=min-sum".into()]);
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        assert!(
            name.starts_with("abc-baseline-") && name.ends_with(".json") && name.len() == 26,
            "{name}"
        );
        assert_ne!(
            p,
            default_path("abc", "baseline", &["ldpc.kind=sum-product".into()])
        );
    }
}
