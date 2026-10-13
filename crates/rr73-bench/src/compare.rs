//! `rr73-bench compare`: what changed between two results files.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use rr73_corpus::normalise_text;
use rr73_corpus::stats;

use crate::results::{DecodeRecord, Results, SetSummary, SlotResult};

/// Frequency difference within which two decodes of the same text are the same signal, in Hz.
const SAME_SIGNAL_HZ: f64 = 10.0;

/// A decode present in one file and not the other.
#[derive(Clone, Debug, PartialEq)]
pub struct Change {
    /// Slot path.
    pub path: String,
    /// The decode.
    pub decode: DecodeRecord,
}

/// Decodes gained (in `b`, not in `a`) and lost (in `a`, not in `b`), over slots in both.
pub fn changes(a: &Results, b: &Results) -> (Vec<Change>, Vec<Change>) {
    let index: BTreeMap<&str, &SlotResult> = a.slots.iter().map(|s| (s.path.as_str(), s)).collect();
    let mut gained = Vec::new();
    let mut lost = Vec::new();
    for sb in &b.slots {
        let Some(sa) = index.get(sb.path.as_str()) else {
            continue;
        };
        gained.extend(missing(&sb.decodes, &sa.decodes).map(|d| Change {
            path: sb.path.clone(),
            decode: d.clone(),
        }));
        lost.extend(missing(&sa.decodes, &sb.decodes).map(|d| Change {
            path: sb.path.clone(),
            decode: d.clone(),
        }));
    }
    (gained, lost)
}

/// Decodes in `from` with no decode of the same text within [`SAME_SIGNAL_HZ`] in `other`.
fn missing<'a>(
    from: &'a [DecodeRecord],
    other: &'a [DecodeRecord],
) -> impl Iterator<Item = &'a DecodeRecord> {
    from.iter().filter(move |d| {
        let t = normalise_text(&d.text);
        !other
            .iter()
            .any(|o| normalise_text(&o.text) == t && (o.freq_hz - d.freq_hz).abs() <= SAME_SIGNAL_HZ)
    })
}

fn opt(v: Option<f64>, digits: usize) -> String {
    v.map(|x| format!("{x:.digits$}")).unwrap_or_else(|| "-".into())
}

fn delta(a: Option<f64>, b: Option<f64>, digits: usize) -> String {
    match (a, b) {
        (Some(a), Some(b)) => format!("{:+.digits$}", b - a),
        _ => "".into(),
    }
}

fn describe(r: &Results) -> String {
    let mut s = format!("{} {}", r.git_sha, r.preset);
    if !r.overrides.is_empty() {
        s.push_str(&format!(" [{}]", r.overrides.join(", ")));
    }
    s.push_str(&format!(
        " ({} {} {} thread(s), {})",
        r.environment.os, r.environment.arch, r.environment.threads, r.created_utc
    ));
    s
}

/// The comparison report, listing at most `limit` gained and `limit` lost decodes.
pub fn report(a: &Results, b: &Results, limit: usize) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "a: {}", describe(a));
    let _ = writeln!(out, "b: {}", describe(b));
    let _ = writeln!(out);
    let _ = writeln!(
        out,
        "{:<28} {:>6} {:>15} {:>13} {:>11} {:>11} {:>17} {:>17} {:>17}",
        "set",
        "slots",
        "recall a>b",
        "matched a>b",
        "false a>b",
        "unique a>b",
        "SNR50 dB a>b",
        "p50 ms a>b",
        "p90 ms a>b"
    );
    let names: BTreeSet<&String> = a.sets.keys().chain(b.sets.keys()).collect();
    let empty = SetSummary::default();
    for name in names {
        let (sa, sb) = (a.sets.get(name), b.sets.get(name));
        let note = match (sa, sb) {
            (None, _) => " (only in b)",
            (_, None) => " (only in a)",
            _ => "",
        };
        let (sa, sb) = (sa.unwrap_or(&empty), sb.unwrap_or(&empty));
        let snr = |s: &SetSummary| s.snr50.map(|f| f.snr50_db);
        let _ = writeln!(
            out,
            "{:<28} {:>6} {:>15} {:>13} {:>11} {:>11} {:>17} {:>17} {:>17}{note}",
            name,
            sb.slots.max(sa.slots),
            format!(
                "{}>{} {}",
                opt(sa.recall, 3),
                opt(sb.recall, 3),
                delta(sa.recall, sb.recall, 3)
            ),
            format!("{}>{}", sa.matched, sb.matched),
            format!("{}>{}", sa.false_decodes, sb.false_decodes),
            format!("{}>{}", sa.unique_real, sb.unique_real),
            format!(
                "{}>{} {}",
                opt(snr(sa), 2),
                opt(snr(sb), 2),
                delta(snr(sa), snr(sb), 2)
            ),
            format!("{:.1}>{:.1}", sa.time.p50_ms, sb.time.p50_ms),
            format!("{:.1}>{:.1}", sa.time.p90_ms, sb.time.p90_ms),
        );
    }

    let time = |r: &Results| -> Vec<f64> {
        r.slots
            .iter()
            .filter(|s| s.error.is_none())
            .map(|s| s.time_s * 1e3)
            .collect()
    };
    let (ta, tb) = (time(a), time(b));
    let _ = writeln!(out);
    let _ = writeln!(
        out,
        "time per slot, all slots (ms):   p50        p90        p99        mean"
    );
    for (label, t) in [("a", &ta), ("b", &tb)] {
        let p = |q| stats::percentile(t, q).unwrap_or(0.0);
        let mean = if t.is_empty() {
            0.0
        } else {
            t.iter().sum::<f64>() / t.len() as f64
        };
        let _ = writeln!(
            out,
            "  {label} ({:>5} slots)                {:>8.2}   {:>8.2}   {:>8.2}   {:>8.2}",
            t.len(),
            p(50.0),
            p(90.0),
            p(99.0),
            mean
        );
    }

    let _ = writeln!(out);
    if a.slim || b.slim {
        let _ = writeln!(
            out,
            "Decode lists are not in slim results files; gained and lost decodes are not listed."
        );
        return out;
    }
    let only_a = a
        .slots
        .iter()
        .filter(|s| !b.slots.iter().any(|t| t.path == s.path))
        .count();
    let only_b = b
        .slots
        .iter()
        .filter(|s| !a.slots.iter().any(|t| t.path == s.path))
        .count();
    if only_a + only_b > 0 {
        let _ = writeln!(
            out,
            "Slots only in a: {only_a}. Slots only in b: {only_b}. They are left out below."
        );
    }
    let (gained, lost) = changes(a, b);
    let count = |v: &[Change], m: bool| v.iter().filter(|c| c.decode.matched == m).count();
    let _ = writeln!(
        out,
        "Gained: {} decodes ({} matched, {} unmatched). Lost: {} decodes ({} matched, {} unmatched).",
        gained.len(),
        count(&gained, true),
        count(&gained, false),
        lost.len(),
        count(&lost, true),
        count(&lost, false)
    );
    for (label, list) in [("+", &gained), ("-", &lost)] {
        for c in list.iter().take(limit) {
            let d = &c.decode;
            let _ = writeln!(
                out,
                "{label} {:<9} {:>6.1} dB {:>7.1} Hz {:>5.2} s  {:<24} {}",
                if d.matched { "matched" } else { "unmatched" },
                d.snr_db,
                d.freq_hz,
                d.dt_s,
                d.text,
                c.path
            );
        }
        if list.len() > limit {
            let _ = writeln!(out, "{label} ... {} more", list.len() - limit);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::results::{Environment, RESULTS_FORMAT, SlotKind, summarise};

    fn rec(text: &str, freq: f64, matched: bool) -> DecodeRecord {
        DecodeRecord {
            text: text.into(),
            freq_hz: freq,
            dt_s: 0.1,
            snr_db: -10.0,
            pass: 1,
            ldpc_iterations: 3,
            hard_errors: 2,
            score: 8.0,
            matched,
            osd: false,
            osd_distance: 0.0,
        }
    }

    fn results(decodes: Vec<DecodeRecord>) -> Results {
        let slot = SlotResult {
            path: "corpus/public/x/a.wav".into(),
            set: "public/x".into(),
            mode: "FT8".into(),
            kind: SlotKind::Real,
            expected: 3,
            decoded: decodes.len(),
            matched: decodes.iter().filter(|d| d.matched).count(),
            unique: decodes.iter().filter(|d| !d.matched).count(),
            time_s: 0.01,
            stages: Default::default(),
            stats: Default::default(),
            decodes,
            entries: Vec::new(),
            error: None,
        };
        let slots = vec![slot];
        Results {
            format: RESULTS_FORMAT.into(),
            created_utc: "2026-10-13T00:00:00Z".into(),
            git_sha: "abc".into(),
            preset: "baseline".into(),
            overrides: Vec::new(),
            config: serde_json::Value::Null,
            reference_key: None,
            audio_s: None,
            audio_fill: None,
            environment: Environment {
                os: "linux".into(),
                arch: "x86_64".into(),
                cpus: 1,
                threads: 1,
                profile: "release".into(),
                bench_version: "0".into(),
            },
            wall_s: 1.0,
            slim: false,
            sets: summarise(&slots),
            slots,
        }
    }

    #[test]
    fn gained_and_lost_use_text_and_frequency() {
        let a = results(vec![
            rec("CQ K1ABC FN42", 1000.0, true),
            rec("K1ABC W9XYZ -10", 1500.0, true),
        ]);
        let b = results(vec![
            rec("CQ K1ABC FN42", 1008.0, true),
            rec("K1ABC W9XYZ -10", 1520.0, false),
            rec("W9XYZ K1ABC RR73", 700.0, false),
        ]);
        let (gained, lost) = changes(&a, &b);
        let texts = |v: &[Change]| v.iter().map(|c| c.decode.text.clone()).collect::<Vec<_>>();
        assert_eq!(texts(&gained), vec!["K1ABC W9XYZ -10", "W9XYZ K1ABC RR73"]);
        assert_eq!(texts(&lost), vec!["K1ABC W9XYZ -10"]);
        let text = report(&a, &b, 10);
        assert!(
            text.contains(
                "Gained: 2 decodes (0 matched, 2 unmatched). Lost: 1 decodes (1 matched, 0 unmatched)."
            ),
            "{text}"
        );
        assert!(text.contains("corpus/public/x/a.wav"));
    }

    #[test]
    fn slim_files_compare_summaries_only() {
        let a = results(vec![rec("CQ K1ABC FN42", 1000.0, true)]);
        let mut b = a.clone();
        b.slim = true;
        let text = report(&a, &b, 10);
        assert!(text.contains("not listed"), "{text}");
    }
}
