//! The results file (`rr73-bench-results/1`) and per-set summaries.

use std::collections::BTreeMap;
use std::path::Path;

use rr73_corpus::stats::{self, Snr50, Step};
use rr73_decode::{DecodeStats, StageTimings};
use serde::{Deserialize, Serialize};

/// Schema version of results files.
pub const RESULTS_FORMAT: &str = "rr73-bench-results/1";

/// One `rr73-bench run`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Results {
    /// Schema version, [`RESULTS_FORMAT`].
    pub format: String,
    /// When the run finished, ISO 8601 UTC.
    pub created_utc: String,
    /// Commit of the decoder, `-dirty` when the tree had changes, or `unknown`.
    pub git_sha: String,
    /// Preset name.
    pub preset: String,
    /// `key=value` overrides applied to the preset, in order.
    pub overrides: Vec<String>,
    /// The full decoder configuration that ran.
    pub config: serde_json::Value,
    /// Reference key used for real slots, or `null` for the default choice.
    pub reference_key: Option<String>,
    /// Seconds of each slot decoded (`--audio-s`), or `null` for whole slots.
    #[serde(default)]
    pub audio_s: Option<f64>,
    /// What stood in for the rest of a cut slot (`--audio-fill`).
    #[serde(default)]
    pub audio_fill: Option<crate::run::AudioFill>,
    /// Later stages (`--then`), each a preset name followed by `key=value` overrides.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub then: Vec<String>,
    /// Machine and build.
    pub environment: Environment,
    /// Wall time of the whole run (reading, decoding, scoring), in seconds.
    pub wall_s: f64,
    /// `true` when per-slot decode and entry lists were dropped (`rr73-bench slim`).
    #[serde(default)]
    pub slim: bool,
    /// Summary per set, keyed by set name.
    pub sets: BTreeMap<String, SetSummary>,
    /// One record per slot, sorted by path.
    pub slots: Vec<SlotResult>,
}

/// Where the run happened.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Environment {
    /// Operating system (`linux`, `macos`).
    pub os: String,
    /// CPU architecture (`x86_64`, `aarch64`).
    pub arch: String,
    /// Logical CPUs available.
    pub cpus: usize,
    /// Decoder threads used.
    pub threads: usize,
    /// Build profile of the bench (`release` or `debug`).
    pub profile: String,
    /// Version of rr73-bench.
    pub bench_version: String,
}

/// What unmatched decodes on a slot mean.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SlotKind {
    /// Synthetic slot with exact truth: unmatched decodes are false.
    Synthetic,
    /// Noise only: every decode is false.
    Noise,
    /// Recording scored against a reference tool: unmatched decodes need review.
    Real,
}

/// One slot's outcome.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SlotResult {
    /// WAV path as discovered.
    pub path: String,
    /// Set name (directory under `corpus/`).
    pub set: String,
    /// `FT8` or `FT4`.
    pub mode: String,
    /// Slot kind.
    pub kind: SlotKind,
    /// Truth or reference entries.
    pub expected: usize,
    /// Decodes.
    pub decoded: usize,
    /// Entries matched by a decode.
    pub matched: usize,
    /// Decodes matching no entry.
    pub unique: usize,
    /// Wall time of the decode call, in seconds.
    pub time_s: f64,
    /// Decoder stage timings.
    pub stages: StageTimings,
    /// Decoder counters.
    pub stats: DecodeStats,
    /// Wall time of each stage, in seconds (runs with `--then`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stage_s: Vec<f64>,
    /// Longest single decoder step, in seconds: how long a caller waits at most before it
    /// can stop the session.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub step_max_s: f64,
    /// Longest step of each kind (`start-stage`, `start-pass`, `spectrogram`, `search`, `candidates`,
    /// `subtract`), in seconds.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub step_max_by_kind: BTreeMap<String, f64>,
    /// The decodes (dropped in slim files).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decodes: Vec<DecodeRecord>,
    /// The expected entries with their match status (dropped in slim files).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entries: Vec<EntryRecord>,
    /// Why the slot could not be read, if it could not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A decode as recorded in results.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DecodeRecord {
    /// Message text.
    pub text: String,
    /// Base-tone frequency, in Hz.
    pub freq_hz: f64,
    /// DT, in seconds.
    pub dt_s: f64,
    /// SNR in 2500 Hz, in dB.
    pub snr_db: f64,
    /// Pass that found it.
    pub pass: u32,
    /// LDPC iterations.
    pub ldpc_iterations: u32,
    /// LDPC hard errors.
    pub hard_errors: u32,
    /// Sync score, in dB.
    pub score: f64,
    /// `true` when it matched an expected entry.
    pub matched: bool,
    /// `true` when ordered-statistics decoding found it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub osd: bool,
    /// For OSD decodes, the weighted distance as a fraction of the total reliability.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub osd_distance: f64,
    /// Index of the stage that found it (0 is the preset, 1 the first `--then` stage).
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub stage: u32,
}

fn is_zero_u32(x: &u32) -> bool {
    *x == 0
}

fn is_zero(x: &f64) -> bool {
    *x == 0.0
}

/// An expected entry as recorded in results.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EntryRecord {
    /// Message text.
    pub text: String,
    /// Base-tone frequency, in Hz.
    pub freq_hz: f64,
    /// DT, in seconds.
    pub dt_s: f64,
    /// SNR in 2500 Hz, in dB (truth for synthetic slots, the tool's estimate otherwise).
    pub snr_db: f64,
    /// `true` when a decode matched it.
    pub matched: bool,
}

/// Time per slot, in milliseconds.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct TimeStats {
    /// Mean.
    pub mean_ms: f64,
    /// Median.
    pub p50_ms: f64,
    /// 90th percentile.
    pub p90_ms: f64,
    /// 99th percentile.
    pub p99_ms: f64,
    /// Maximum.
    pub max_ms: f64,
}

impl TimeStats {
    /// Statistics of `seconds`, in milliseconds. All zero for an empty list.
    pub fn of(seconds: &[f64]) -> Self {
        if seconds.is_empty() {
            return Self::default();
        }
        let ms: Vec<f64> = seconds.iter().map(|s| s * 1e3).collect();
        let p = |q| stats::percentile(&ms, q).unwrap_or(0.0);
        Self {
            mean_ms: ms.iter().sum::<f64>() / ms.len() as f64,
            p50_ms: p(50.0),
            p90_ms: p(90.0),
            p99_ms: p(99.0),
            max_ms: p(100.0),
        }
    }
}

/// Totals and fits for one set.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct SetSummary {
    /// Slots in the set.
    pub slots: usize,
    /// Slots that could not be read.
    pub errors: usize,
    /// Truth or reference entries.
    pub expected: usize,
    /// Decodes.
    pub decodes: usize,
    /// Entries matched.
    pub matched: usize,
    /// Matched over expected, or `null` with nothing expected.
    pub recall: Option<f64>,
    /// Unmatched decodes on synthetic and noise-only slots.
    pub false_decodes: usize,
    /// Unmatched decodes on real slots (candidates for review).
    pub unique_real: usize,
    /// SNR50 fit over synthetic truth, when the set spans at least two SNRs.
    pub snr50: Option<Snr50>,
    /// Decoded fraction per SNR step over synthetic truth.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<Step>,
    /// Decode time per slot.
    pub time: TimeStats,
    /// Mean stage time per slot, in milliseconds.
    pub stage_mean_ms: StageMs,
}

/// Stage times in milliseconds.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct StageMs {
    /// Spectrogram.
    pub spectrogram: f64,
    /// Candidate search.
    pub search: f64,
    /// Refinement.
    pub refine: f64,
    /// Demodulation.
    pub demod: f64,
    /// LDPC decoding.
    pub ldpc: f64,
    /// Validation and SNR.
    pub validate: f64,
    /// Subtraction.
    pub subtract: f64,
    /// Whole decode call.
    pub total: f64,
}

/// Builds the per-set summaries from slot results. SNR50 and steps need the entry lists,
/// so a slim file keeps the summaries it was given.
pub fn summarise(slots: &[SlotResult]) -> BTreeMap<String, SetSummary> {
    let mut by_set: BTreeMap<String, Vec<&SlotResult>> = BTreeMap::new();
    for s in slots {
        by_set.entry(s.set.clone()).or_default().push(s);
    }
    by_set
        .into_iter()
        .map(|(name, members)| (name, summarise_set(&members)))
        .collect()
}

fn summarise_set(slots: &[&SlotResult]) -> SetSummary {
    let mut sum = SetSummary {
        slots: slots.len(),
        ..SetSummary::default()
    };
    let mut times = Vec::new();
    let mut points = Vec::new();
    let mut stage = StageTimings::default();
    for s in slots {
        if s.error.is_some() {
            sum.errors += 1;
            continue;
        }
        sum.expected += s.expected;
        sum.decodes += s.decoded;
        sum.matched += s.matched;
        match s.kind {
            SlotKind::Real => sum.unique_real += s.unique,
            SlotKind::Synthetic | SlotKind::Noise => sum.false_decodes += s.unique,
        }
        times.push(s.time_s);
        let st = &s.stages;
        stage.spectrogram_s += st.spectrogram_s;
        stage.search_s += st.search_s;
        stage.refine_s += st.refine_s;
        stage.demod_s += st.demod_s;
        stage.ldpc_s += st.ldpc_s;
        stage.validate_s += st.validate_s;
        stage.subtract_s += st.subtract_s;
        stage.total_s += st.total_s;
        if s.kind == SlotKind::Synthetic {
            points.extend(s.entries.iter().map(|e| (e.snr_db, e.matched)));
        }
    }
    sum.recall = (sum.expected > 0).then(|| sum.matched as f64 / sum.expected as f64);
    sum.snr50 = stats::fit_snr50(&points);
    let steps = stats::recall_steps(&points);
    if steps.len() >= 2 {
        sum.steps = steps;
    }
    sum.time = TimeStats::of(&times);
    let ms = 1e3 / times.len().max(1) as f64;
    sum.stage_mean_ms = StageMs {
        spectrogram: stage.spectrogram_s * ms,
        search: stage.search_s * ms,
        refine: stage.refine_s * ms,
        demod: stage.demod_s * ms,
        ldpc: stage.ldpc_s * ms,
        validate: stage.validate_s * ms,
        subtract: stage.subtract_s * ms,
        total: stage.total_s * ms,
    };
    sum
}

/// Set name of a slot: its directory below the last `corpus` path component, or the
/// directory as given when there is none.
pub fn set_name(wav: &Path) -> String {
    let dir = wav.parent().unwrap_or(Path::new(""));
    let parts: Vec<String> = dir
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    match parts.iter().rposition(|p| p == "corpus") {
        Some(i) if i + 1 < parts.len() => parts[i + 1..].join("/"),
        _ => {
            let s = parts.join("/");
            if s.is_empty() { ".".into() } else { s }
        }
    }
}

/// Reads a results file and checks its format.
pub fn load(path: &Path) -> Result<Results, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let results: Results = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    if results.format != RESULTS_FORMAT {
        return Err(format!(
            "{}: unknown results format {:?}",
            path.display(),
            results.format
        ));
    }
    Ok(results)
}

/// Writes a results file (pretty JSON with a trailing newline), creating its directory.
pub fn save(results: &Results, path: &Path) -> Result<(), String> {
    if let Some(dir) = path.parent()
        && !dir.as_os_str().is_empty()
    {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let mut text = serde_json::to_string_pretty(results).map_err(|e| e.to_string())?;
    text.push('\n');
    std::fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(set: &str, kind: SlotKind, expected: usize, matched: usize, unique: usize, t: f64) -> SlotResult {
        SlotResult {
            path: format!("corpus/{set}/x.wav"),
            set: set.into(),
            mode: "FT8".into(),
            kind,
            expected,
            decoded: matched + unique,
            matched,
            unique,
            time_s: t,
            stages: StageTimings::default(),
            stats: DecodeStats::default(),
            stage_s: Vec::new(),
            step_max_s: 0.0,
            step_max_by_kind: BTreeMap::new(),
            decodes: Vec::new(),
            entries: (0..expected)
                .map(|i| EntryRecord {
                    text: "A B C".into(),
                    freq_hz: 1000.0,
                    dt_s: 0.0,
                    snr_db: -20.0 + i as f64,
                    matched: i >= expected - matched,
                })
                .collect(),
            error: None,
        }
    }

    #[test]
    fn set_names_come_from_the_corpus_tree() {
        assert_eq!(
            set_name(Path::new("corpus/public/ft8_lib/a.wav")),
            "public/ft8_lib"
        );
        assert_eq!(
            set_name(Path::new("/work/corpus/synthetic/snr-sweep/awgn/a.wav")),
            "synthetic/snr-sweep/awgn"
        );
        assert_eq!(set_name(Path::new("elsewhere/x/a.wav")), "elsewhere/x");
        assert_eq!(set_name(Path::new("a.wav")), ".");
    }

    #[test]
    fn summaries_separate_false_and_review_decodes() {
        let slots = vec![
            slot("synthetic/s", SlotKind::Synthetic, 10, 6, 1, 0.010),
            slot("synthetic/s", SlotKind::Noise, 0, 0, 2, 0.020),
            slot("public/p", SlotKind::Real, 5, 4, 3, 0.030),
        ];
        let sets = summarise(&slots);
        let s = &sets["synthetic/s"];
        assert_eq!(
            (s.slots, s.expected, s.matched, s.false_decodes, s.unique_real),
            (2, 10, 6, 3, 0)
        );
        assert_eq!(s.recall, Some(0.6));
        let fit = s.snr50.expect("fit");
        assert!((fit.snr50_db + 16.5).abs() < 0.6, "{fit:?}");
        assert_eq!(s.steps.len(), 10);
        assert_eq!(s.time.p50_ms, 10.0);
        let p = &sets["public/p"];
        assert_eq!((p.unique_real, p.false_decodes), (3, 0));
        assert!(p.snr50.is_none());
    }

    #[test]
    fn time_stats_handle_empty_input() {
        assert_eq!(TimeStats::of(&[]), TimeStats::default());
        let t = TimeStats::of(&[0.001, 0.002, 0.003]);
        assert_eq!((t.p50_ms, t.max_ms), (2.0, 3.0));
    }
}
