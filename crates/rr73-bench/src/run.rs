//! `rr73-bench run`: decode every slot under the given paths, or of synthetic sets rendered in
//! memory, and score it.

use std::path::{Path, PathBuf};
use std::time::Instant;

use rayon::prelude::*;
use rr73_corpus::{Entry, SlotFiles, SlotMeta, SlotMode, Tolerance, discover, match_entries, read_slot, wav};
use rr73_decode::wspr::{WsprConfig, WsprContext, decode_wspr, is_wspr_preset};
use rr73_decode::{DecodeContext, DecodeStats, DecoderConfig, SlotAudio, StageTimings, decode};
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
            .map_init(Contexts::default, |ctx, f| {
                process_file(f, &decoder, ctx, reference)
            })
            .collect();
        let rendered: Vec<SlotResult> = jobs
            .par_iter()
            .map_init(Contexts::default, |ctx, j| process_job(j, &decoder, ctx))
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
        environment: util::environment(threads),
        wall_s,
        slim: false,
        sets: summarise(&slots),
        slots,
    };
    let out = opts
        .out
        .clone()
        .unwrap_or_else(|| default_path(&git_sha, &opts.preset, &opts.overrides));
    results::save(&results, &out)?;
    Ok((results, out))
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
        decodes: Vec::new(),
        entries: Vec::new(),
        error: Some(error),
    }
}

fn process_file(
    files: &SlotFiles,
    decoder: &Decoder,
    ctx: &mut Contexts,
    reference: Option<&str>,
) -> SlotResult {
    let path = files.wav.display().to_string();
    let set = set_name(&files.wav);
    match read_slot(files) {
        Ok(slot) => process_slot(path, set, &slot.meta, &slot.samples, decoder, ctx, reference),
        Err(e) => error_slot(path, set, String::new(), e.to_string()),
    }
}

/// Renders a synthetic slot in memory and decodes it as if read from its WAV file: samples
/// pass through the same 16-bit rounding.
fn process_job(job: &Job, decoder: &Decoder, ctx: &mut Contexts) -> SlotResult {
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
        decoder,
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
}

fn run_decoder(
    meta: &SlotMeta,
    samples: &[f32],
    decoder: &Decoder,
    ctx: &mut Contexts,
) -> Result<Decoded, String> {
    match (decoder, meta.mode) {
        (Decoder::Ft(config), SlotMode::Ft8 | SlotMode::Ft4) => {
            let mode = if meta.mode == SlotMode::Ft8 {
                Mode::Ft8
            } else {
                Mode::Ft4
            };
            // Each slot starts from an empty hash table so results do not depend on thread
            // order.
            ctx.ft.hashes = CallsignHashes::new();
            let report = decode(&SlotAudio::new(samples, mode), config, &mut ctx.ft);
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
                        ldpc_iterations: d.ldpc_iterations,
                        hard_errors: d.hard_errors,
                        score: round(f64::from(d.score), 3),
                        matched: false,
                        osd: d.osd,
                        osd_distance: round(f64::from(d.osd_distance), 4),
                        drift_hz_per_s: None,
                    })
                    .collect(),
                stages: report.timings,
                stats: report.stats,
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
                        drift_hz_per_s: Some(round(f64::from(d.drift_hz_per_s), 5)),
                    })
                    .collect(),
                stages: report.timings,
                stats: report.stats,
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
    decoder: &Decoder,
    ctx: &mut Contexts,
    reference: Option<&str>,
) -> SlotResult {
    let started = Instant::now();
    let decoded = match run_decoder(meta, samples, decoder, ctx) {
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
        decodes,
        entries,
        error: None,
    }
}

fn round(x: f64, digits: i32) -> f64 {
    let f = 10f64.powi(digits);
    (x * f).round() / f
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
        let r = process_job(job, &decoder, &mut Contexts::default());
        assert_eq!((r.expected, r.matched, r.unique), (1, 1, 0), "{:?}", r.decodes);
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
