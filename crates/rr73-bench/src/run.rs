//! `rr73-bench run`: decode every slot under the given paths, or of synthetic sets rendered in
//! memory, and score it.

use std::path::{Path, PathBuf};
use std::time::Instant;

use rayon::prelude::*;
use rr73_corpus::{Entry, SlotFiles, SlotMeta, SlotMode, Tolerance, discover, match_entries, read_slot, wav};
use rr73_decode::wspr::{WsprConfig, WsprContext, decode_wspr, is_wspr_preset};
use rr73_decode::{
    ApContext, DecodeContext, DecodeSession, DecodeStats, DecoderConfig, SlotAudio, Stage, StageTimings,
};
use rr73_ft8::{CallsignHashes, Mode};

use crate::results::{
    self, DecodeRecord, EntryRecord, RESULTS_FORMAT, Results, SlotKind, SlotResult, set_name, summarise,
};
use crate::synth::{self, Job, SynthOptions};
use crate::util;

/// Options of one run.
#[derive(Clone, Debug)]
pub struct RunOptions {
    /// Preset name: an FT8 preset or a WSPR preset (`wspr`, `wspr-deep`).
    pub preset: String,
    /// `key=value` overrides.
    pub overrides: Vec<String>,
    /// Corpus files or directories.
    pub paths: Vec<PathBuf>,
    /// Synthetic sets rendered in memory instead of read from the corpus.
    pub synth: Vec<String>,
    /// Sizes of the synthetic sets rendered in memory.
    pub synth_options: SynthOptions,
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
    /// Spans of each slot set to digital silence (zeros) before decoding, as start and end
    /// in seconds from the slot start.
    pub silent_s: Vec<(f64, f64)>,
    /// Later stages, each `"<preset> [key=value ...]"`, run after the preset on the same
    /// slot (see [`rr73_decode::DecodeSession`]). FT8 and FT4 presets only.
    pub then: Vec<String>,
    /// A QSO context for a priori decoding of every slot, in place of the one a slot's
    /// metadata gives (`ap` in its source, as the `ap-sweep` set writes).
    pub ap: Option<ApContext>,
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

/// How each slot is decoded: the decoder, the FT8 stages after its preset, and how much of
/// the slot it sees.
struct Plan<'a> {
    decoder: &'a Decoder,
    /// Every FT8 stage, the preset first; empty for WSPR.
    stages: Vec<(String, DecoderConfig)>,
    audio_s: Option<f64>,
    fill: AudioFill,
    silent_s: Vec<(f64, f64)>,
    ap: Option<ApContext>,
}

/// The QSO context for a slot: the run's, else the slot's own (`ap` in its source:
/// `{"my": "9V1NE", "dx": "K1ABC", "dx_hz": 1500.0}`), else none.
fn ap_context(meta: &SlotMeta, plan: &Plan<'_>) -> Option<ApContext> {
    if let Some(c) = &plan.ap {
        return Some(c.clone());
    }
    let v = meta.source.extra.get("ap")?;
    Some(ApContext {
        my_call: v.get("my")?.as_str()?.to_string(),
        dx_call: v.get("dx").and_then(|d| d.as_str()).map(str::to_string),
        dx_hz: v
            .get("dx_hz")
            .and_then(serde_json::Value::as_f64)
            .map(|f| f as f32),
    })
}

/// The decoder a preset names.
#[derive(Clone, Debug)]
pub enum Decoder {
    /// FT8 and FT4.
    Ft(DecoderConfig),
    /// WSPR.
    Wspr(WsprConfig),
}

impl Decoder {
    /// The decoder for `preset` with `overrides`.
    pub fn new(preset: &str, overrides: &[String]) -> Result<Self, String> {
        if is_wspr_preset(preset) {
            WsprConfig::preset(preset)
                .and_then(|c| c.with_overrides(overrides))
                .map(Decoder::Wspr)
                .map_err(|e| e.to_string())
        } else {
            DecoderConfig::preset(preset)
                .and_then(|c| c.with_overrides(overrides))
                .map(Decoder::Ft)
                .map_err(|e| e.to_string())
        }
    }

    /// The configuration as JSON. Going through text keeps `f32` values short (`-2.3`,
    /// where a direct conversion to a JSON value would widen them to `-2.299999952316284`).
    pub fn config_json(&self) -> Result<serde_json::Value, String> {
        let text = match self {
            Decoder::Ft(c) => serde_json::to_string(c),
            Decoder::Wspr(c) => serde_json::to_string(c),
        }
        .map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| e.to_string())
    }
}

/// One decoder context per thread for each decoder family.
#[derive(Default)]
struct Contexts {
    ft: DecodeContext,
    wspr: WsprContext,
}

/// Runs the decoder over the corpus, writes the results file and returns it with its path.
pub fn run(opts: &RunOptions) -> Result<(Results, PathBuf), String> {
    let decoder = Decoder::new(&opts.preset, &opts.overrides)?;
    let mut stages = Vec::new();
    match &decoder {
        Decoder::Ft(config) => {
            stages.push((opts.preset.clone(), config.clone()));
            for spec in &opts.then {
                stages.push(stage_spec(spec)?);
            }
        }
        Decoder::Wspr(_) => {
            if !opts.then.is_empty() || opts.audio_s.is_some() || !opts.silent_s.is_empty() {
                return Err("--then, --audio-s and --silent-s apply to FT8 and FT4 presets only".into());
            }
        }
    }
    let plan = Plan {
        decoder: &decoder,
        stages,
        audio_s: opts.audio_s,
        fill: opts.audio_fill,
        silent_s: opts.silent_s.clone(),
        ap: opts.ap.clone(),
    };
    let files = if opts.paths.is_empty() {
        Vec::new()
    } else {
        discover(&opts.paths).map_err(|e| e.to_string())?
    };
    let mut jobs: Vec<Job> = Vec::new();
    for name in &opts.synth {
        let base = Path::new("corpus/synthetic").join(name);
        jobs.extend(synth::jobs_for(name, &base, &opts.synth_options)?);
    }
    if files.is_empty() && jobs.is_empty() {
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
        let mut read: Vec<SlotResult> = files
            .par_iter()
            .map_init(Contexts::default, |ctx, f| process_file(f, &plan, ctx, reference))
            .collect();
        let rendered: Vec<SlotResult> = jobs
            .par_iter()
            .map_init(Contexts::default, |ctx, j| process_job(j, &plan, ctx))
            .collect();
        read.extend(rendered);
        read
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
        config: decoder.config_json()?,
        reference_key: opts.reference.clone(),
        audio_s: opts.audio_s,
        audio_fill: opts.audio_s.map(|_| opts.audio_fill),
        silent_s: opts.silent_s.iter().map(|&(a, b)| [a, b]).collect(),
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
        key.extend(opts.silent_s.iter().map(|(a, b)| format!("silent {a}:{b}")));
        default_path(&git_sha, &opts.preset, &key)
    });
    results::save(&results, &out)?;
    Ok((results, out))
}

/// Parses a `--silent-s` span, `START:END` in seconds.
pub fn silent_span(spec: &str) -> Result<(f64, f64), String> {
    let bad = || format!("--silent-s {spec:?}: expected START:END in seconds, such as 0:2.5");
    let (a, b) = spec.split_once(':').ok_or_else(bad)?;
    let a: f64 = a.trim().parse().map_err(|_| bad())?;
    let b: f64 = b.trim().parse().map_err(|_| bad())?;
    if !(a.is_finite() && b.is_finite() && a < b) {
        return Err(bad());
    }
    Ok((a, b))
}

/// Parses a `--then` stage: a preset name followed by `key=value` overrides, separated by
/// spaces.
pub fn stage_spec(spec: &str) -> Result<(String, DecoderConfig), String> {
    let Stage { name, config, .. } = Stage::parse(spec).map_err(|e| format!("--then {spec:?}: {e}"))?;
    Ok((name, config))
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

fn error_slot(path: String, set: String, mode: String, error: String) -> SlotResult {
    SlotResult {
        path,
        set,
        mode,
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
        error: Some(error),
    }
}

fn process_file(
    files: &SlotFiles,
    plan: &Plan<'_>,
    ctx: &mut Contexts,
    reference: Option<&str>,
) -> SlotResult {
    let path = files.wav.display().to_string();
    let set = set_name(&files.wav);
    match read_slot(files) {
        Ok(slot) => process_slot(path, set, &slot.meta, &slot.samples, plan, ctx, reference),
        Err(e) => error_slot(path, set, String::new(), e.to_string()),
    }
}

/// Renders a synthetic slot in memory and decodes it as if read from its WAV file: samples
/// pass through the same 16-bit rounding.
fn process_job(job: &Job, plan: &Plan<'_>, ctx: &mut Contexts) -> SlotResult {
    let (samples, meta, stem) = match synth::render_job(job) {
        Ok(r) => r,
        Err(e) => {
            let path = job.dir.join(format!("{}.wav", job.index)).display().to_string();
            return error_slot(path, job.set.clone(), String::new(), e);
        }
    };
    let wav_path = job.dir.join(format!("{stem}.wav"));
    let samples: Vec<f32> = samples
        .iter()
        .map(|&x| f32::from(wav::to_i16(x)) / 32_768.0)
        .collect();
    process_slot(
        wav_path.display().to_string(),
        set_name(&wav_path),
        &meta,
        &samples,
        plan,
        ctx,
        None,
    )
}

/// What a decoder returned for one slot, in the bench's terms.
struct Decoded {
    entries: Vec<Entry>,
    records: Vec<DecodeRecord>,
    stages: StageTimings,
    stats: DecodeStats,
    /// Wall time of each stage, when there is more than one.
    stage_s: Vec<f64>,
    /// Longest single session step, overall and by kind.
    step_max_s: f64,
    step_max_by_kind: std::collections::BTreeMap<String, f64>,
}

fn run_decoder(
    meta: &SlotMeta,
    samples: &[f32],
    plan: &Plan<'_>,
    ctx: &mut Contexts,
) -> Result<Decoded, String> {
    match (plan.decoder, meta.mode) {
        (Decoder::Ft(_), SlotMode::Ft8 | SlotMode::Ft4) => {
            let mode = if meta.mode == SlotMode::Ft8 {
                Mode::Ft8
            } else {
                Mode::Ft4
            };
            // Each slot starts from an empty hash table so results do not depend on thread
            // order.
            ctx.ft.hashes = CallsignHashes::new();
            ctx.ft.ap = ap_context(meta, plan);
            let mut cut = samples.to_vec();
            for &(a, b) in &plan.silent_s {
                let at = |s: f64| ((s.max(0.0) * 12_000.0).round() as usize).min(cut.len());
                let (a, b) = (at(a), at(b));
                if a < b {
                    cut[a..b].fill(0.0);
                }
            }
            let mut partial = false;
            if let Some(seconds) = plan.audio_s {
                let keep = ((seconds.max(0.0) * 12_000.0).round() as usize).min(cut.len());
                match plan.fill {
                    AudioFill::Absent => {
                        cut.truncate(keep);
                        partial = true;
                    }
                    AudioFill::Zero => cut[keep..].fill(0.0),
                }
            }
            let audio = if partial {
                SlotAudio::partial(&cut, mode)
            } else {
                SlotAudio::new(&cut, mode)
            };
            let stages = plan
                .stages
                .iter()
                .map(|(name, config)| Stage::new(name.clone(), config.clone()))
                .collect();
            let mut session = DecodeSession::with_context(&audio, stages, std::mem::take(&mut ctx.ft));
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
            let report = session.report();
            let decode_stages = session.decode_stages().to_vec();
            let stage_s = if session.stage_count() > 1 {
                session.stage_seconds().to_vec()
            } else {
                Vec::new()
            };
            ctx.ft = session.into_context();
            Ok(Decoded {
                entries: report
                    .decodes
                    .iter()
                    .map(|d| Entry {
                        text: d.text.clone(),
                        freq_hz: f64::from(d.freq_hz),
                        dt_s: f64::from(d.dt_s),
                        snr_db: f64::from(d.snr_db),
                    })
                    .collect(),
                records: report
                    .decodes
                    .iter()
                    .zip(&decode_stages)
                    .map(|(d, &stage)| DecodeRecord {
                        text: d.text.clone(),
                        freq_hz: round(f64::from(d.freq_hz), 3),
                        dt_s: round(f64::from(d.dt_s), 3),
                        snr_db: round(f64::from(d.snr_db), 2),
                        pass: d.pass,
                        ldpc_iterations: d.ldpc_iterations,
                        hard_errors: d.hard_errors,
                        score: round(f64::from(d.score), 3),
                        matched: false,
                        osd: d.osd,
                        osd_distance: round(f64::from(d.osd_distance), 4),
                        ap: d.ap,
                        block: d.block,
                        stage: stage as u32,
                        drift_hz_per_s: None,
                    })
                    .collect(),
                stages: report.timings,
                stats: report.stats,
                stage_s,
                step_max_s,
                step_max_by_kind,
            })
        }
        (Decoder::Wspr(config), SlotMode::Wspr) => {
            ctx.wspr.hashes.clear();
            let report = decode_wspr(samples, config, &mut ctx.wspr);
            Ok(Decoded {
                entries: report
                    .decodes
                    .iter()
                    .map(|d| Entry {
                        text: d.text.clone(),
                        freq_hz: f64::from(d.freq_hz),
                        dt_s: f64::from(d.dt_s),
                        snr_db: f64::from(d.snr_db),
                    })
                    .collect(),
                records: report
                    .decodes
                    .iter()
                    .map(|d| DecodeRecord {
                        text: d.text.clone(),
                        freq_hz: round(f64::from(d.freq_hz), 3),
                        dt_s: round(f64::from(d.dt_s), 3),
                        snr_db: round(f64::from(d.snr_db), 2),
                        pass: d.pass,
                        ldpc_iterations: d.cycles,
                        hard_errors: d.hard_errors,
                        score: round(f64::from(d.score), 3),
                        matched: false,
                        osd: false,
                        osd_distance: 0.0,
                        ap: None,
                        block: None,
                        stage: 0,
                        drift_hz_per_s: Some(round(f64::from(d.drift_hz_per_s), 5)),
                    })
                    .collect(),
                stages: report.timings,
                stats: report.stats,
                stage_s: Vec::new(),
                step_max_s: 0.0,
                step_max_by_kind: Default::default(),
            })
        }
        (d, mode) => Err(format!(
            "{} slot cannot be decoded with a {} preset",
            mode.name(),
            if matches!(d, Decoder::Wspr(_)) {
                "WSPR"
            } else {
                "FT8 or FT4"
            }
        )),
    }
}

fn process_slot(
    path: String,
    set: String,
    meta: &SlotMeta,
    samples: &[f32],
    plan: &Plan<'_>,
    ctx: &mut Contexts,
    reference: Option<&str>,
) -> SlotResult {
    let started = Instant::now();
    let decoded = match run_decoder(meta, samples, plan, ctx) {
        Ok(d) => d,
        Err(e) => return error_slot(path, set, meta.mode.name().into(), e),
    };
    let time_s = started.elapsed().as_secs_f64();
    let expected = meta.expected(reference);
    let score = match_entries(&decoded.entries, expected, Tolerance::default());
    let kind = if meta.noise_only {
        SlotKind::Noise
    } else if meta.truth.is_some() {
        SlotKind::Synthetic
    } else {
        SlotKind::Real
    };
    let decodes = decoded
        .records
        .into_iter()
        .zip(&score.decode_match)
        .map(|(mut d, m)| {
            d.matched = m.is_some();
            d
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
        mode: meta.mode.name().into(),
        kind,
        expected: score.expected,
        decoded: score.decodes,
        matched: score.matched,
        unique: score.unique,
        time_s,
        stages: decoded.stages,
        stats: decoded.stats,
        stage_s: decoded.stage_s,
        step_max_s: decoded.step_max_s,
        step_max_by_kind: decoded.step_max_by_kind,
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
    fn subtraction_residue_gives_no_false_decode() {
        // Slot 526 of wspr-snr-sweep/awgn at 40 slots per step: before the guard around
        // subtracted signals, the second pass decoded the residue of its -21 dB signal as
        // `IVH/9J7TAD 57` (1.6 Hz off, 66 hard errors).
        let opts = SynthOptions {
            per_step: 40,
            ..SynthOptions::default()
        };
        let jobs = synth::jobs_for("wspr-snr-sweep", Path::new("x"), &opts).expect("jobs");
        let job = jobs
            .iter()
            .find(|j| j.set == "wspr-snr-sweep/awgn" && j.index == 526)
            .expect("job");
        let decoder = Decoder::new("wspr", &[]).expect("wspr");
        let plan = Plan {
            decoder: &decoder,
            stages: Vec::new(),
            audio_s: None,
            fill: AudioFill::Absent,
            silent_s: Vec::new(),
            ap: None,
        };
        let r = process_job(job, &plan, &mut Contexts::default());
        assert_eq!((r.expected, r.matched, r.unique), (1, 1, 0), "{:?}", r.decodes);
    }

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
        let v = Decoder::Ft(DecoderConfig::baseline())
            .config_json()
            .expect("json");
        assert_eq!(v["search"]["ft8_dt_min_s"].to_string(), "-2.3");
        let w = Decoder::new("wspr", &[])
            .expect("wspr")
            .config_json()
            .expect("json");
        assert_eq!(w["search"]["dt_min_s"].to_string(), "-2.0");
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
