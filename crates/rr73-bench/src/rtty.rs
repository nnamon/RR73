//! RTTY bench: synthetic transmissions with known text, decoding with `rr73-rtty`, scoring
//! another decoder's text output (minimodem), and a report of character error rate against
//! SNR. See "RTTY" in `docs/bench.md`.
//!
//! A set lives in `corpus/rtty/synthetic/<set>/`: one 16-bit 12 kHz WAV per transmission and
//! a sidecar `<stem>.json` ([`RttyMeta`]) holding the text sent and the channel.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use rayon::prelude::*;
use rr73_chansim::Watterson;
use rr73_chansim::continuous::{CCIR_GOOD, CCIR_MODERATE, CCIR_POOR, ContinuousChannel, render_continuous};
use rr73_corpus::wav;
use rr73_rtty::score::char_errors;
use rr73_rtty::{DecoderConfig, RttyDecoder, RttyEvent, RttyParams, TxConfig, encode};
use serde::{Deserialize, Serialize};

use crate::results::Environment;
use crate::util;

/// Schema version of RTTY sidecars.
pub const META_FORMAT: &str = "rr73-rtty/1";
/// Schema version of RTTY results files.
pub const RESULTS_FORMAT: &str = "rr73-rtty-results/1";
/// Sample rate of the sets, in Hz.
const RATE: u32 = 12_000;

/// Sidecar of one synthetic transmission.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RttyMeta {
    /// Schema version, [`META_FORMAT`].
    pub format: String,
    /// Set name, such as `awgn` or `ccir-poor`.
    pub set: String,
    /// Text sent; empty for noise. Newlines go out as CR LF.
    pub text: String,
    /// Line code and keying.
    pub params: RttyParams,
    /// Mark tone as sent, in Hz.
    pub mark_hz: f64,
    /// Space tone as sent, in Hz.
    pub space_hz: f64,
    /// Channel the transmission went through. `snr_db` is in 3000 Hz.
    pub channel: ContinuousChannel,
    /// Seed of the text and the channel.
    pub seed: u64,
    /// Length of the file, in seconds.
    pub duration_s: f64,
}

/// Settings for `rr73-bench rtty synth`.
#[derive(Clone, Debug)]
pub struct SynthOptions {
    /// Directory the sets go in.
    pub out: PathBuf,
    /// Sets to write: `awgn`, `ccir-good`, `ccir-moderate`, `ccir-poor`, `noise`.
    pub sets: Vec<String>,
    /// Transmissions per SNR step.
    pub per_step: usize,
    /// Length of the text of each transmission, in seconds of keying.
    pub seconds: f64,
    /// Noise-only files in the `noise` set.
    pub noise_files: usize,
}

/// The SNR steps and fading of a named set, in dB in 3000 Hz.
fn set_plan(name: &str) -> Result<(Vec<f64>, Option<Watterson>), String> {
    let steps = |lo: i32, hi: i32, step: i32| -> Vec<f64> {
        (lo..=hi).step_by(step as usize).map(f64::from).collect()
    };
    match name {
        "awgn" => Ok((steps(-16, 0, 1), None)),
        "ccir-good" => Ok((steps(-12, 12, 2), Some(CCIR_GOOD))),
        "ccir-moderate" => Ok((steps(-12, 16, 2), Some(CCIR_MODERATE))),
        "ccir-poor" => Ok((steps(-12, 16, 2), Some(CCIR_POOR))),
        "noise" => Ok((Vec::new(), None)),
        other => Err(format!(
            "unknown RTTY set {other:?}; use awgn, ccir-good, ccir-moderate, ccir-poor or noise"
        )),
    }
}

/// Words of contest exchanges and conversation. Every character has the same code in the ITA2
/// and US figures tables, so any receiver prints them alike.
const WORDS: &[&str] = &[
    "CQ",
    "TEST",
    "DE",
    "TU",
    "UR",
    "RST",
    "599",
    "5NN",
    "NAME",
    "QTH",
    "RIG",
    "ANT",
    "WX",
    "HR",
    "ES",
    "FB",
    "OM",
    "QSL",
    "VIA",
    "BURO",
    "73",
    "GL",
    "BK",
    "KN",
    "SK",
    "AGN",
    "PSE",
    "QRZ",
    "NR",
    "DIPOLE",
    "WATTS",
    "SUNNY",
    "RAIN",
    "THE",
    "AND",
    "FOR",
    "WITH",
    "FROM",
    "MY",
    "YOUR",
    "GOOD",
    "SIGNAL",
    "COPY",
    "THANKS",
    "QSO",
    "BAND",
    "OPEN",
    "FADING",
    "NOISE",
    "SOLID",
    "SPLIT",
    "UP",
    "LISTENING",
    "(73)",
    "QRP",
    "100W",
    "YAGI",
    "14.085",
    "7.040",
    "1314Z",
    "-15C",
    "OK?",
    "NOTE:",
    "73,",
    "PSE.",
    "OP/P",
];

/// One random callsign such as `9V1NE` or `JA1KXM`.
fn callsign(rng: &mut ChaCha8Rng) -> String {
    const L: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let letter = |rng: &mut ChaCha8Rng| char::from(L[rng.random_range(0..L.len())]);
    let mut s = String::new();
    if rng.random_bool(0.3) {
        s.push(char::from(b'1' + rng.random_range(0..9u8)));
        s.push(letter(rng));
    } else {
        s.push(letter(rng));
        if rng.random_bool(0.5) {
            s.push(letter(rng));
        }
    }
    s.push(char::from(b'0' + rng.random_range(0..10u8)));
    for _ in 0..rng.random_range(1..=3) {
        s.push(letter(rng));
    }
    s
}

/// Text of about `chars` characters in lines of 6 to 10 words, each line ending in a newline.
pub fn random_text(rng: &mut ChaCha8Rng, chars: usize) -> String {
    let mut out = String::new();
    while out.len() < chars {
        let words = rng.random_range(6..=10);
        let line: Vec<String> = (0..words)
            .map(|_| match rng.random_range(0..10) {
                0 | 1 => callsign(rng),
                2 => format!("{:03}", rng.random_range(1..1000)),
                _ => WORDS[rng.random_range(0..WORDS.len())].to_string(),
            })
            .collect();
        out.push_str(&line.join(" "));
        out.push('\n');
    }
    out
}

/// Writes the named sets and returns the number of files written.
pub fn synth(opts: &SynthOptions) -> Result<usize, String> {
    let params = RttyParams::default();
    let tx = TxConfig::default();
    // About 7.5 bits per character plus shifts.
    let chars = (opts.seconds * params.baud / params.char_bits() * 0.9)
        .round()
        .max(1.0) as usize;
    let mut jobs = Vec::new();
    for set in &opts.sets {
        let (steps, fading) = set_plan(set)?;
        let dir = opts.out.join(set);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        }
        std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        if set == "noise" {
            for k in 0..opts.noise_files {
                jobs.push((set.clone(), dir.join(format!("noise-{k:03}")), None, fading, k));
            }
        }
        for &snr in &steps {
            for k in 0..opts.per_step {
                let stem = format!("snr{}{:02}-{k}", if snr < 0.0 { '-' } else { '+' }, snr.abs());
                jobs.push((set.clone(), dir.join(stem), Some(snr), fading, k));
            }
        }
    }
    jobs.par_iter()
        .map(|(set, stem, snr, fading, k)| {
            let seed = util::fnv1a(format!("rtty/{set}/{snr:?}/{k}").as_bytes());
            let mut rng = ChaCha8Rng::seed_from_u64(seed);
            let (text, signal, channel) = match snr {
                Some(snr_db) => {
                    let text = random_text(&mut rng, chars);
                    let signal = encode(&text, &tx).map_err(|e| e.to_string())?;
                    let channel = ContinuousChannel {
                        snr_db: *snr_db,
                        fading: *fading,
                        lead_s: 1.0,
                        tail_s: 1.0,
                        ..ContinuousChannel::default()
                    };
                    (text, signal, channel)
                }
                None => {
                    let channel = ContinuousChannel {
                        lead_s: opts.seconds,
                        ..ContinuousChannel::default()
                    };
                    (String::new(), Vec::new(), channel)
                }
            };
            let audio = render_continuous(&signal, &channel, seed);
            let meta = RttyMeta {
                format: META_FORMAT.into(),
                set: set.clone(),
                text,
                params,
                mark_hz: tx.mark_hz,
                space_hz: params.space_hz(tx.mark_hz),
                channel,
                seed,
                duration_s: audio.len() as f64 / f64::from(RATE),
            };
            wav::write(&stem.with_extension("wav"), &audio, RATE).map_err(|e| e.to_string())?;
            let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
            std::fs::write(stem.with_extension("json"), json + "\n").map_err(|e| e.to_string())
        })
        .collect::<Result<Vec<()>, String>>()?;
    Ok(jobs.len())
}

/// Score of one file.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileResult {
    /// WAV path.
    pub path: String,
    /// Set name.
    pub set: String,
    /// SNR in 3000 Hz, in dB; `None` for noise.
    pub snr_db: Option<f64>,
    /// Characters sent, after normalising.
    pub sent: usize,
    /// Characters received, after normalising.
    pub received: usize,
    /// Edit distance between sent and received text, in characters.
    pub errors: usize,
    /// Length of the audio, in seconds.
    pub audio_s: f64,
    /// Decoding time, in seconds of CPU (one thread).
    pub cpu_s: f64,
    /// Received text.
    pub text: String,
}

/// One decoder over a set of files.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RttyResults {
    /// Schema version, [`RESULTS_FORMAT`].
    pub format: String,
    /// Name in reports, such as `rr73` or `minimodem`.
    pub label: String,
    /// When the run finished, ISO 8601 UTC.
    pub created_utc: String,
    /// Commit of the bench.
    pub git_sha: String,
    /// Decoder configuration, or the reference decoder's command line.
    pub config: serde_json::Value,
    /// Machine and build.
    pub environment: Environment,
    /// One record per file, sorted by path.
    pub files: Vec<FileResult>,
}

/// Every `.wav` with an RTTY sidecar under `paths`, sorted.
fn discover(paths: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    fn walk(p: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
        if p.is_dir() {
            let entries = std::fs::read_dir(p).map_err(|e| format!("{}: {e}", p.display()))?;
            for e in entries {
                walk(&e.map_err(|e| e.to_string())?.path(), out)?;
            }
        } else if p.extension().is_some_and(|x| x == "wav") && p.with_extension("json").is_file() {
            out.push(p.to_path_buf());
        }
        Ok(())
    }
    let mut out = Vec::new();
    for p in paths {
        if !p.exists() {
            return Err(format!("{} does not exist", p.display()));
        }
        walk(p, &mut out)?;
    }
    out.sort();
    if out.is_empty() {
        return Err("no RTTY files (WAV plus sidecar) under the given paths".into());
    }
    Ok(out)
}

fn read_meta(wav_path: &Path) -> Result<RttyMeta, String> {
    let path = wav_path.with_extension("json");
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let meta: RttyMeta = serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.format != META_FORMAT {
        return Err(format!("{}: format {:?}", path.display(), meta.format));
    }
    Ok(meta)
}

fn score(path: &Path, meta: &RttyMeta, text: String, audio_s: f64, cpu_s: f64) -> FileResult {
    let (errors, sent) = char_errors(&meta.text, &text);
    let received = rr73_rtty::score::normalize(&text).chars().count();
    FileResult {
        path: path.display().to_string(),
        set: meta.set.clone(),
        snr_db: (!meta.text.is_empty()).then_some(meta.channel.snr_db),
        sent,
        received,
        errors,
        audio_s,
        cpu_s,
        text,
    }
}

/// Applies `key=value` overrides to a configuration through its JSON form. Values parse as
/// JSON when they can and as strings otherwise.
pub fn with_overrides(config: &DecoderConfig, overrides: &[String]) -> Result<DecoderConfig, String> {
    let mut value = serde_json::to_value(config).map_err(|e| e.to_string())?;
    for item in overrides {
        let (key, raw) = item
            .split_once('=')
            .ok_or_else(|| format!("override {item:?} is not key=value"))?;
        let parsed = serde_json::from_str::<serde_json::Value>(raw.trim())
            .unwrap_or_else(|_| serde_json::Value::String(raw.trim().to_string()));
        let slot = key
            .trim()
            .split('.')
            .try_fold(&mut value, |v, part| v.get_mut(part))
            .ok_or_else(|| format!("unknown key {key:?}"))?;
        if slot.is_object() {
            return Err(format!("{key} is a section; set one of its fields"));
        }
        *slot = parsed;
    }
    let cfg: DecoderConfig = serde_json::from_value(value).map_err(|e| e.to_string())?;
    cfg.check().map_err(|e| e.to_string())?;
    Ok(cfg)
}

/// Decodes `samples` with `cfg` in blocks of 0.1 s and returns the received text.
pub fn decode_text(samples: &[f32], cfg: DecoderConfig) -> Result<String, String> {
    let mut d = RttyDecoder::new(cfg).map_err(|e| e.to_string())?;
    let mut text = String::new();
    let mut take = |events: Vec<RttyEvent>| {
        for e in events {
            if let RttyEvent::Char { ch, .. } = e {
                text.push(ch);
            }
        }
    };
    for block in samples.chunks(1200) {
        take(d.push(block));
    }
    take(d.flush());
    Ok(text)
}

/// Settings for `rr73-bench rtty run`.
#[derive(Clone, Debug)]
pub struct RunOptions {
    /// Name in reports.
    pub label: String,
    /// `key=value` overrides of the default decoder configuration.
    pub overrides: Vec<String>,
    /// Decoder threads.
    pub threads: Option<usize>,
    /// Files or directories.
    pub paths: Vec<PathBuf>,
}

/// Decodes every file with `rr73-rtty`. The decoder starts on the sidecar's tones and line
/// code; the overrides apply on top.
pub fn run(opts: &RunOptions) -> Result<RttyResults, String> {
    let base = with_overrides(&DecoderConfig::default(), &opts.overrides)?;
    let files = discover(&opts.paths)?;
    let threads = opts
        .threads
        .unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1))
        .max(1);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|e| e.to_string())?;
    let results = pool.install(|| {
        files
            .par_iter()
            .map(|path| {
                let meta = read_meta(path)?;
                let (samples, rate) = wav::read(path).map_err(|e| e.to_string())?;
                if rate != RATE {
                    return Err(format!("{}: {rate} Hz, expected {RATE} Hz", path.display()));
                }
                let mut cfg = base;
                let overridden = |k: &str| opts.overrides.iter().any(|o| o.trim_start().starts_with(k));
                if !overridden("params.") {
                    cfg.params = meta.params;
                }
                if !overridden("mark_hz") {
                    cfg.mark_hz = meta.mark_hz;
                }
                let started = Instant::now();
                let text = decode_text(&samples, cfg)?;
                let cpu_s = started.elapsed().as_secs_f64();
                Ok(score(
                    path,
                    &meta,
                    text,
                    samples.len() as f64 / f64::from(RATE),
                    cpu_s,
                ))
            })
            .collect::<Result<Vec<FileResult>, String>>()
    })?;
    Ok(RttyResults {
        format: RESULTS_FORMAT.into(),
        label: opts.label.clone(),
        created_utc: util::now_utc(),
        git_sha: util::git_sha(),
        config: serde_json::to_value(base).map_err(|e| e.to_string())?,
        environment: util::environment(threads),
        files: results,
    })
}

/// Scores another decoder's output: for each WAV, `<texts>/<set>/<stem>.txt` holds the text it
/// printed and `<stem>.time` its CPU time as `user+system` seconds (bash `TIMEFORMAT=%3U+%3S`).
pub fn import(label: &str, texts: &Path, command: &str, paths: &[PathBuf]) -> Result<RttyResults, String> {
    let files = discover(paths)?;
    let mut out = Vec::new();
    for path in &files {
        let meta = read_meta(path)?;
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let base = texts.join(&meta.set).join(&stem);
        let txt = base.with_extension("txt");
        let raw = std::fs::read(&txt).map_err(|e| format!("{}: {e}", txt.display()))?;
        let text = String::from_utf8_lossy(&raw).into_owned();
        let cpu_s = std::fs::read_to_string(base.with_extension("time"))
            .ok()
            .map(|t| {
                t.trim()
                    .split('+')
                    .filter_map(|v| v.trim().parse::<f64>().ok())
                    .sum::<f64>()
            })
            .unwrap_or(0.0);
        out.push(score(path, &meta, text, meta.duration_s, cpu_s));
    }
    Ok(RttyResults {
        format: RESULTS_FORMAT.into(),
        label: label.into(),
        created_utc: util::now_utc(),
        git_sha: util::git_sha(),
        config: serde_json::Value::String(command.into()),
        environment: util::environment(1),
        files: out,
    })
}

/// Writes a results file.
pub fn save(r: &RttyResults, path: &Path) -> Result<(), String> {
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let json = serde_json::to_string_pretty(r).map_err(|e| e.to_string())?;
    std::fs::write(path, json + "\n").map_err(|e| format!("{}: {e}", path.display()))
}

/// Reads a results file and checks its format.
pub fn load(path: &Path) -> Result<RttyResults, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let r: RttyResults = serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))?;
    if r.format != RESULTS_FORMAT {
        return Err(format!("{}: format {:?}", path.display(), r.format));
    }
    Ok(r)
}

/// Character error rate of a group of files: errors over characters sent.
fn cer(files: &[&FileResult]) -> f64 {
    let sent: usize = files.iter().map(|f| f.sent).sum();
    let errors: usize = files.iter().map(|f| f.errors).sum();
    if sent == 0 {
        0.0
    } else {
        errors as f64 / sent as f64
    }
}

/// SNR at which the CER falls to `target`, interpolated in log CER between the steps either
/// side of the last crossing; `None` when the curve never crosses.
pub fn snr_at_cer(curve: &[(f64, f64)], target: f64) -> Option<f64> {
    let floor = 1e-5;
    let lg = |c: f64| c.max(floor).log10();
    // The highest SNR step still above the target, and the step after it.
    let i = curve.iter().rposition(|&(_, c)| c > target)?;
    let &(s1, c1) = curve.get(i + 1)?;
    let (s0, c0) = curve[i];
    let (l0, l1, lt) = (lg(c0), lg(c1), lg(target));
    if (l0 - l1).abs() < 1e-12 {
        return Some(s1);
    }
    Some(s0 + (s1 - s0) * (l0 - lt) / (l0 - l1))
}

/// Markdown report: CER per set and SNR side by side, SNR for 1 % and 10 % CER, false
/// characters on noise and CPU time per second of audio.
pub fn report(runs: &[RttyResults]) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    let mut sets: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    for r in runs {
        for f in &r.files {
            if let Some(snr) = f.snr_db {
                let steps = sets.entry(f.set.clone()).or_default();
                if !steps.iter().any(|&s| (s - snr).abs() < 1e-9) {
                    steps.push(snr);
                }
            }
        }
    }
    let header = |out: &mut String, first: &str| {
        let _ = write!(out, "| {first} |");
        for r in runs {
            let _ = write!(out, " {} |", r.label);
        }
        out.push_str("\n| --- |");
        for _ in runs {
            out.push_str(" --- |");
        }
        out.push('\n');
    };
    let curve = |r: &RttyResults, set: &str, steps: &[f64]| -> Vec<(f64, f64)> {
        steps
            .iter()
            .filter_map(|&s| {
                let group: Vec<&FileResult> = r
                    .files
                    .iter()
                    .filter(|f| f.set == set && f.snr_db.is_some_and(|x| (x - s).abs() < 1e-9))
                    .collect();
                (!group.is_empty()).then(|| (s, cer(&group)))
            })
            .collect()
    };
    for (set, steps) in &mut sets {
        steps.sort_by(f64::total_cmp);
        let sent: usize = runs
            .first()
            .map(|r| r.files.iter().filter(|f| &f.set == set).map(|f| f.sent).sum())
            .unwrap_or(0);
        let _ = writeln!(
            out,
            "\n### {set}: CER against SNR in 3000 Hz ({sent} characters)\n"
        );
        header(&mut out, "SNR");
        let curves: Vec<Vec<(f64, f64)>> = runs.iter().map(|r| curve(r, set, steps)).collect();
        for &s in steps.iter() {
            let _ = write!(out, "| {s:+.0} dB |");
            for c in &curves {
                match c.iter().find(|p| (p.0 - s).abs() < 1e-9) {
                    Some(&(_, v)) => {
                        let _ = write!(out, " {:.2} % |", 100.0 * v);
                    }
                    None => out.push_str(" |"),
                }
            }
            out.push('\n');
        }
        for target in [0.10, 0.01] {
            let _ = write!(out, "| SNR for CER {:.0} % |", 100.0 * target);
            for c in &curves {
                match snr_at_cer(c, target) {
                    Some(s) => {
                        let _ = write!(out, " {s:+.1} dB |");
                    }
                    None => out.push_str(" not reached |"),
                }
            }
            out.push('\n');
        }
    }
    let noise: Vec<Vec<&FileResult>> = runs
        .iter()
        .map(|r| r.files.iter().filter(|f| f.snr_db.is_none()).collect())
        .collect();
    if noise.iter().any(|n| !n.is_empty()) {
        let minutes: f64 = noise[0].iter().map(|f| f.audio_s).sum::<f64>() / 60.0;
        let _ = writeln!(out, "\n### Noise only ({minutes:.0} min)\n");
        header(&mut out, "Measure");
        out.push_str("| Characters printed per minute |");
        for n in &noise {
            let chars: usize = n.iter().map(|f| f.received).sum();
            let _ = write!(out, " {:.1} |", chars as f64 / minutes.max(1e-9));
        }
        out.push('\n');
    }
    out.push_str("\n### Cost\n\n");
    header(&mut out, "Measure");
    out.push_str("| CPU time per second of audio |");
    for r in runs {
        let cpu: f64 = r.files.iter().map(|f| f.cpu_s).sum();
        let audio: f64 = r.files.iter().map(|f| f.audio_s).sum();
        let _ = write!(out, " {:.2} ms |", 1000.0 * cpu / audio.max(1e-9));
    }
    out.push_str("\n| Audio decoded |");
    for r in runs {
        let audio: f64 = r.files.iter().map(|f| f.audio_s).sum();
        let _ = write!(out, " {:.0} min |", audio / 60.0);
    }
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_uses_shared_figures_only() {
        let mut rng = ChaCha8Rng::seed_from_u64(1);
        let t = random_text(&mut rng, 2000);
        assert!(t.len() >= 2000);
        assert!(t.ends_with('\n'));
        assert!(
            t.chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || " \n-?:().,/".contains(c)),
            "{t}"
        );
    }

    #[test]
    fn crossing_interpolates_in_log_cer() {
        let curve = [(-10.0, 0.5), (-8.0, 0.1), (-6.0, 0.001), (-4.0, 0.0)];
        assert_eq!(snr_at_cer(&curve, 0.1), Some(-8.0));
        let s = snr_at_cer(&curve, 0.01).expect("crossing");
        assert!((s - -7.0).abs() < 1e-9, "{s}");
        assert_eq!(snr_at_cer(&[(-4.0, 0.0)], 0.01), None);
        assert_eq!(snr_at_cer(&[(0.0, 0.5)], 0.01), None);
    }

    #[test]
    fn overrides_reach_nested_fields() {
        let c = with_overrides(
            &DecoderConfig::default(),
            &[
                "squelch_db=-12".into(),
                "afc.track=false".into(),
                "framer=uart".into(),
            ],
        )
        .expect("config");
        assert_eq!(c.squelch_db, Some(-12.0));
        assert!(!c.afc.track);
        assert_eq!(c.framer, rr73_rtty::Framer::Uart);
        assert!(with_overrides(&DecoderConfig::default(), &["nope=1".into()]).is_err());
        assert!(with_overrides(&DecoderConfig::default(), &["afc=1".into()]).is_err());
        assert!(with_overrides(&DecoderConfig::default(), &["atc_bits=0".into()]).is_err());
    }

    #[test]
    fn synthesised_files_decode() {
        let dir = std::env::temp_dir().join(format!("rr73-rtty-bench-{}", std::process::id()));
        let opts = SynthOptions {
            out: dir.clone(),
            sets: vec!["awgn".into(), "noise".into()],
            per_step: 1,
            seconds: 4.0,
            noise_files: 1,
        };
        assert_eq!(synth(&opts).expect("synth"), 18);
        let r = run(&RunOptions {
            label: "rr73".into(),
            // The squelch keeps the noise before and after the transmission from printing.
            overrides: vec!["squelch_db=-10".into()],
            threads: Some(2),
            paths: vec![dir.join("awgn").join("snr+00-0.wav"), dir.join("noise")],
        })
        .expect("run");
        assert_eq!(r.files.len(), 2);
        let signal = &r.files[0];
        assert_eq!(signal.snr_db, Some(0.0));
        assert!(signal.sent > 10);
        assert_eq!(
            signal.errors,
            0,
            "{:?} {:?}",
            read_meta(Path::new(&signal.path)).map(|m| m.text),
            signal.text
        );
        assert_eq!(r.files[1].snr_db, None);
        let table = report(&[r]);
        assert!(table.contains("| +0 dB | 0.00 % |"), "{table}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
