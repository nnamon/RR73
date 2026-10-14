//! `rr73-bench import`: score another decoder's text output on the corpus, so it can be
//! compared with `rr73-bench compare`.
//!
//! Input is one text file holding, for each slot, a line `== <name>` followed by decodes in
//! the WSJT-X layout `HHMMSS SNR DT FREQ ~ MESSAGE`, as printed by `jt9` and by ft8_lib's
//! `decode_ft8`. The name is the slot's path below the corpus without extension
//! (`synthetic/noise/260101_000000_s0001`), any trailing part of it, or the stem when that
//! is unique. Text after the message that is separated by two or more spaces (country
//! names, AP markers) is dropped.

use std::collections::BTreeMap;
use std::path::PathBuf;

use rr73_corpus::{Entry, Tolerance, discover, match_entries, read_slot};
use serde_json::json;

use crate::results::{
    DecodeRecord, EntryRecord, RESULTS_FORMAT, Results, SlotKind, SlotResult, set_name, summarise,
};
use crate::util;

/// Options of one import.
#[derive(Clone, Debug)]
pub struct ImportOptions {
    /// The decoder output file.
    pub decodes: PathBuf,
    /// Name recorded as the preset, such as `ft8_lib-9fec6ca`.
    pub label: String,
    /// Seconds subtracted from each DT (ft8_lib prints the start time plus 0.16 s, which is
    /// DT + 0.66 s).
    pub dt_offset_s: f64,
    /// Corpus files or directories holding the slots the output covers.
    pub paths: Vec<PathBuf>,
    /// Reference key for real slots.
    pub reference: Option<String>,
    /// Results file to write.
    pub out: PathBuf,
}

/// Parses one decode line, or `None` for anything else.
pub fn parse_line(line: &str) -> Option<Entry> {
    let tilde = line.find('~')?;
    let fields: Vec<&str> = line[..tilde].split_whitespace().collect();
    if fields.len() < 4 {
        return None;
    }
    let n = fields.len();
    let snr_db: f64 = fields[n - 3].parse().ok()?;
    let dt_s: f64 = fields[n - 2].parse().ok()?;
    let freq_hz: f64 = fields[n - 1].parse().ok()?;
    let rest = line[tilde + 1..].trim_start();
    let text = rest.split("  ").next().unwrap_or("").trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(Entry {
        text,
        freq_hz,
        dt_s,
        snr_db,
    })
}

/// Splits the output file into decode lists keyed by stem.
pub fn parse_output(text: &str) -> BTreeMap<String, Vec<Entry>> {
    let mut out: BTreeMap<String, Vec<Entry>> = BTreeMap::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        if let Some(stem) = line.strip_prefix("== ") {
            let stem = stem.trim().to_string();
            out.entry(stem.clone()).or_default();
            current = Some(stem);
        } else if let (Some(stem), Some(e)) = (&current, parse_line(line)) {
            out.entry(stem.clone()).or_default().push(e);
        }
    }
    out
}

/// The section for a slot: the longest section name that equals the slot's path without
/// extension or one of its trailing parts (`synthetic/noise/260101_000000_s0001`,
/// `noise/260101_000000_s0001` or the bare stem).
pub fn section_for<'a>(
    lists: &'a BTreeMap<String, Vec<Entry>>,
    wav: &std::path::Path,
) -> Option<(&'a String, &'a Vec<Entry>)> {
    let path = wav.with_extension("");
    let parts: Vec<String> = path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    (0..parts.len()).find_map(|i| lists.get_key_value(&parts[i..].join("/")))
}

/// Scores the output against the corpus and writes a results file.
pub fn import(opts: &ImportOptions) -> Result<Results, String> {
    let text =
        std::fs::read_to_string(&opts.decodes).map_err(|e| format!("{}: {e}", opts.decodes.display()))?;
    let lists = parse_output(&text);
    let files = discover(&opts.paths).map_err(|e| e.to_string())?;
    let mut slots = Vec::new();
    let mut missing = Vec::new();
    let mut stem_count: BTreeMap<String, usize> = BTreeMap::new();
    for f in &files {
        *stem_count.entry(f.stem()).or_default() += 1;
    }
    for f in &files {
        let Some((key, list)) = section_for(&lists, &f.wav) else {
            missing.push(f.wav.display().to_string());
            continue;
        };
        if !key.contains('/') && stem_count.get(key).copied().unwrap_or(0) > 1 {
            return Err(format!(
                "section \"== {key}\" matches several slots; name sections by path below the corpus"
            ));
        }
        let slot = read_slot(f).map_err(|e| e.to_string())?;
        let decoded: Vec<Entry> = list
            .iter()
            .map(|e| Entry {
                dt_s: e.dt_s - opts.dt_offset_s,
                ..e.clone()
            })
            .collect();
        let expected = slot.meta.expected(opts.reference.as_deref());
        let score = match_entries(&decoded, expected, Tolerance::default());
        let kind = if slot.meta.noise_only {
            SlotKind::Noise
        } else if slot.meta.truth.is_some() {
            SlotKind::Synthetic
        } else {
            SlotKind::Real
        };
        slots.push(SlotResult {
            path: f.wav.display().to_string(),
            set: set_name(&f.wav),
            mode: slot.meta.mode.name().into(),
            kind,
            expected: score.expected,
            decoded: score.decodes,
            matched: score.matched,
            unique: score.unique,
            time_s: 0.0,
            stages: Default::default(),
            stats: Default::default(),
            stage_s: Vec::new(),
            step_max_s: 0.0,
            step_max_by_kind: Default::default(),
            decodes: decoded
                .iter()
                .zip(&score.decode_match)
                .map(|(d, m)| DecodeRecord {
                    text: d.text.clone(),
                    freq_hz: d.freq_hz,
                    dt_s: d.dt_s,
                    snr_db: d.snr_db,
                    pass: 1,
                    ldpc_iterations: 0,
                    hard_errors: 0,
                    score: 0.0,
                    matched: m.is_some(),
                    osd: false,
                    osd_distance: 0.0,
                    stage: 0,
                    drift_hz_per_s: None,
                })
                .collect(),
            entries: expected
                .iter()
                .zip(&score.entry_match)
                .map(|(e, m)| EntryRecord {
                    text: e.text.clone(),
                    freq_hz: e.freq_hz,
                    dt_s: e.dt_s,
                    snr_db: e.snr_db,
                    matched: m.is_some(),
                })
                .collect(),
            error: None,
        });
    }
    if slots.is_empty() {
        return Err("no slot in the corpus paths has decodes in the output file".into());
    }
    if !missing.is_empty() {
        eprintln!(
            "rr73-bench: {} slot(s) have no section in the output: {}",
            missing.len(),
            missing.join(" ")
        );
    }
    let results = Results {
        format: RESULTS_FORMAT.into(),
        created_utc: util::now_utc(),
        git_sha: "external".into(),
        preset: opts.label.clone(),
        overrides: Vec::new(),
        config: json!({
            "imported_from": opts.decodes.display().to_string(),
            "dt_offset_s": opts.dt_offset_s,
        }),
        reference_key: opts.reference.clone(),
        audio_s: None,
        audio_fill: None,
        then: Vec::new(),
        environment: util::environment(0),
        wall_s: 0.0,
        slim: false,
        sets: summarise(&slots),
        slots,
    };
    crate::results::save(&results, &opts.out)?;
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ft8_lib_and_wsjtx_lines() {
        let e = parse_line("000000 +13.0 +1.60 1291 ~  CQ R7IW LN35").expect("ft8_lib line");
        assert_eq!(
            (e.text.as_str(), e.freq_hz, e.dt_s, e.snr_db),
            ("CQ R7IW LN35", 1291.0, 1.6, 13.0)
        );
        let e = parse_line("110130  -6  0.7  683 ~  CQ TA6CQ KN70      AS Turkey").expect("wsjt-x line");
        assert_eq!(
            (e.text.as_str(), e.freq_hz, e.dt_s, e.snr_db),
            ("CQ TA6CQ KN70", 683.0, 0.7, -6.0)
        );
        assert!(parse_line("== 191111_110130").is_none());
        assert!(parse_line("Decoded 4 messages").is_none());
        assert!(parse_line("000000 x 1 2 ~  CQ").is_none());
    }

    #[test]
    fn splits_sections_by_stem() {
        let text = "== a\n000000 +1.0 +0.5 1000 ~  CQ K1ABC FN42\n== b\n== a\n000000 +1.0 +0.5 1500 ~  CQ W9XYZ EN37\n";
        let lists = parse_output(text);
        assert_eq!(lists["a"].len(), 2);
        assert!(lists["b"].is_empty());
    }

    #[test]
    fn sections_match_paths_and_stems() {
        let lists = parse_output("== synthetic/noise/x\n== y\n000000 +1.0 +0.5 1000 ~  CQ K1ABC FN42\n");
        let p = |s: &str| std::path::PathBuf::from(s);
        assert_eq!(
            section_for(&lists, &p("/work/corpus/synthetic/noise/x.wav")).map(|s| s.0.as_str()),
            Some("synthetic/noise/x")
        );
        assert!(section_for(&lists, &p("corpus/synthetic/smoke/x.wav")).is_none());
        assert_eq!(
            section_for(&lists, &p("corpus/public/y.wav")).map(|s| s.1.len()),
            Some(1)
        );
    }
}
