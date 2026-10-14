//! `rr73-bench gate`: fail when results regress against a baseline beyond thresholds.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::Path;

use serde::Deserialize;

use crate::results::{Results, SetSummary};

/// Limits for one set. Omitted fields take the `[default]` values.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Limits {
    /// Largest allowed fall in recall (absolute, 0 to 1).
    pub max_recall_drop: Option<f64>,
    /// Largest allowed rise in false decodes (count over the set).
    pub max_false_increase: Option<usize>,
    /// Largest allowed rise in SNR50, in dB.
    pub max_snr50_rise_db: Option<f64>,
    /// Largest allowed ratio of median time per slot to the baseline's; 0 turns the check off.
    pub max_time_ratio: Option<f64>,
}

/// The parsed `bench/gate.toml`.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct GateConfig {
    /// Sets that must be present in the results.
    #[serde(default)]
    pub required_sets: Vec<String>,
    /// Limits for every set.
    #[serde(default)]
    pub default: Limits,
    /// Per-set limits, keyed by set name.
    #[serde(default)]
    pub sets: BTreeMap<String, Limits>,
}

/// Fully resolved limits.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Resolved {
    recall: f64,
    false_inc: usize,
    snr50: f64,
    time: f64,
}

impl GateConfig {
    /// Reads and parses a gate file.
    pub fn load(path: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
    }

    fn limits(&self, set: &str) -> Resolved {
        let own = self.sets.get(set);
        let pick_f = |f: fn(&Limits) -> Option<f64>, fallback: f64| {
            own.and_then(f).or(f(&self.default)).unwrap_or(fallback)
        };
        Resolved {
            recall: pick_f(|l| l.max_recall_drop, 0.0),
            false_inc: own
                .and_then(|l| l.max_false_increase)
                .or(self.default.max_false_increase)
                .unwrap_or(0),
            snr50: pick_f(|l| l.max_snr50_rise_db, 0.0),
            time: pick_f(|l| l.max_time_ratio, 0.0),
        }
    }
}

/// One check and its outcome.
#[derive(Clone, Debug, PartialEq)]
pub struct Check {
    /// Set name.
    pub set: String,
    /// What was checked.
    pub metric: String,
    /// Baseline value.
    pub baseline: String,
    /// Value in the results.
    pub value: String,
    /// The limit applied.
    pub limit: String,
    /// `true` when within the limit.
    pub pass: bool,
}

/// Compares every set present in both files, and requires the configured sets. The two
/// files must come from the same preset, overrides and later stages (`--then`).
pub fn gate(results: &Results, baseline: &Results, config: &GateConfig) -> Vec<Check> {
    let mut checks = Vec::new();
    let describe = |r: &Results| {
        let mut d = if r.overrides.is_empty() {
            r.preset.clone()
        } else {
            format!("{} [{}]", r.preset, r.overrides.join(", "))
        };
        for stage in &r.then {
            d.push_str(&format!(" then {stage}"));
        }
        d
    };
    let (want, have) = (describe(baseline), describe(results));
    checks.push(Check {
        set: "all".into(),
        metric: "preset".into(),
        pass: want == have,
        baseline: want,
        value: have,
        limit: "equal".into(),
    });
    for name in &config.required_sets {
        if !results.sets.contains_key(name) {
            checks.push(Check {
                set: name.clone(),
                metric: "present".into(),
                baseline: if baseline.sets.contains_key(name) {
                    "yes"
                } else {
                    "no"
                }
                .into(),
                value: "no".into(),
                limit: "required".into(),
                pass: false,
            });
        }
    }
    for (name, base) in &baseline.sets {
        let Some(now) = results.sets.get(name) else {
            continue;
        };
        checks.extend(check_set(name, base, now, config.limits(name)));
    }
    checks
}

fn check_set(name: &str, base: &SetSummary, now: &SetSummary, lim: Resolved) -> Vec<Check> {
    let mut out = Vec::new();
    let mut push = |metric: &str, baseline: String, value: String, limit: String, pass: bool| {
        out.push(Check {
            set: name.into(),
            metric: metric.into(),
            baseline,
            value,
            limit,
            pass,
        })
    };
    push(
        "slots",
        base.slots.to_string(),
        format!("{} ({} unreadable)", now.slots, now.errors),
        "equal, all readable".into(),
        now.slots == base.slots && now.errors == 0,
    );
    if let Some(b) = base.recall {
        let v = now.recall;
        push(
            "recall",
            format!("{b:.4}"),
            v.map(|x| format!("{x:.4}")).unwrap_or_else(|| "-".into()),
            format!(">= {:.4}", b - lim.recall),
            v.is_some_and(|x| x >= b - lim.recall - 1e-12),
        );
    }
    push(
        "false decodes",
        base.false_decodes.to_string(),
        now.false_decodes.to_string(),
        format!("<= {}", base.false_decodes + lim.false_inc),
        now.false_decodes <= base.false_decodes + lim.false_inc,
    );
    if let Some(b) = base.snr50 {
        let v = now.snr50.map(|f| f.snr50_db);
        // No fit means every signal decoded or none did (or decoding fell with SNR). It
        // passes only when recall did not fall, which covers the all-decoded case.
        let pass = match v {
            Some(x) => x <= b.snr50_db + lim.snr50 + 1e-12,
            None => now.recall.unwrap_or(0.0) >= base.recall.unwrap_or(0.0),
        };
        push(
            "SNR50 dB",
            format!("{:.2}", b.snr50_db),
            v.map(|x| format!("{x:.2}")).unwrap_or_else(|| "no fit".into()),
            format!("<= {:.2}", b.snr50_db + lim.snr50),
            pass,
        );
    }
    if lim.time > 0.0 && base.time.p50_ms > 0.0 {
        push(
            "p50 ms per slot",
            format!("{:.2}", base.time.p50_ms),
            format!("{:.2}", now.time.p50_ms),
            format!("<= {:.2}", base.time.p50_ms * lim.time),
            now.time.p50_ms <= base.time.p50_ms * lim.time,
        );
    }
    out
}

/// A table of the checks and a final verdict line.
pub fn render(checks: &[Check]) -> String {
    let mut out = format!(
        "{:<28} {:<16} {:>12} {:>24} {:>22}  result\n",
        "set", "check", "baseline", "now", "limit"
    );
    for c in checks {
        let _ = writeln!(
            out,
            "{:<28} {:<16} {:>12} {:>24} {:>22}  {}",
            c.set,
            c.metric,
            c.baseline,
            c.value,
            c.limit,
            if c.pass { "pass" } else { "FAIL" }
        );
    }
    let failed = checks.iter().filter(|c| !c.pass).count();
    if failed == 0 {
        let _ = writeln!(out, "Gate passed: {} checks.", checks.len());
    } else {
        let _ = writeln!(out, "Gate failed: {failed} of {} checks.", checks.len());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::results::{Environment, RESULTS_FORMAT, TimeStats};
    use rr73_corpus::stats::Snr50;

    fn summary(recall: f64, false_decodes: usize, snr50: Option<f64>, p50: f64) -> SetSummary {
        SetSummary {
            slots: 10,
            expected: 100,
            matched: (recall * 100.0) as usize,
            recall: Some(recall),
            false_decodes,
            snr50: snr50.map(|s| Snr50 {
                snr50_db: s,
                slope_per_db: 1.0,
                width_10_90_db: 4.4,
                signals: 100,
                extrapolated: false,
            }),
            time: TimeStats {
                p50_ms: p50,
                ..TimeStats::default()
            },
            ..SetSummary::default()
        }
    }

    fn results(sets: Vec<(&str, SetSummary)>) -> Results {
        Results {
            format: RESULTS_FORMAT.into(),
            created_utc: String::new(),
            git_sha: String::new(),
            preset: "baseline".into(),
            overrides: Vec::new(),
            config: serde_json::Value::Null,
            reference_key: None,
            audio_s: None,
            audio_fill: None,
            silent_s: Vec::new(),
            then: Vec::new(),
            environment: Environment {
                os: String::new(),
                arch: String::new(),
                cpus: 1,
                threads: 1,
                profile: String::new(),
                bench_version: String::new(),
            },
            wall_s: 0.0,
            slim: true,
            sets: sets.into_iter().map(|(n, s)| (n.to_string(), s)).collect(),
            slots: Vec::new(),
        }
    }

    const CONFIG: &str = r#"
        required_sets = ["synthetic/smoke"]
        [default]
        max_recall_drop = 0.01
        max_false_increase = 0
        max_snr50_rise_db = 0.3
        max_time_ratio = 0
        [sets."public/ft8_lib"]
        max_recall_drop = 0.05
        max_time_ratio = 2.0
    "#;

    #[test]
    fn config_parses_and_resolves_per_set_limits() {
        let c: GateConfig = toml::from_str(CONFIG).expect("toml");
        assert_eq!(c.limits("synthetic/smoke").recall, 0.01);
        assert_eq!(c.limits("public/ft8_lib").recall, 0.05);
        assert_eq!(c.limits("public/ft8_lib").snr50, 0.3);
        assert_eq!(c.limits("public/ft8_lib").time, 2.0);
        assert!(toml::from_str::<GateConfig>("[default]\nmax_recal_drop = 1").is_err());
    }

    #[test]
    fn regressions_fail_and_improvements_pass() {
        let c: GateConfig = toml::from_str(CONFIG).expect("toml");
        let base = results(vec![
            ("synthetic/smoke", summary(0.90, 0, Some(-19.0), 10.0)),
            ("public/ft8_lib", summary(0.50, 0, None, 10.0)),
        ]);
        let same = gate(&base, &base, &c);
        assert!(same.iter().all(|k| k.pass), "{}", render(&same));

        let better = results(vec![
            ("synthetic/smoke", summary(0.95, 0, Some(-20.0), 9.0)),
            ("public/ft8_lib", summary(0.47, 0, None, 19.0)),
        ]);
        assert!(gate(&better, &base, &c).iter().all(|k| k.pass));

        let worse = results(vec![
            ("synthetic/smoke", summary(0.88, 1, Some(-18.6), 10.0)),
            ("public/ft8_lib", summary(0.44, 0, None, 21.0)),
        ]);
        let failed: Vec<String> = gate(&worse, &base, &c)
            .into_iter()
            .filter(|k| !k.pass)
            .map(|k| format!("{} {}", k.set, k.metric))
            .collect();
        assert_eq!(
            failed,
            vec![
                "public/ft8_lib recall",
                "public/ft8_lib p50 ms per slot",
                "synthetic/smoke recall",
                "synthetic/smoke false decodes",
                "synthetic/smoke SNR50 dB",
            ]
        );
    }

    #[test]
    fn missing_required_sets_and_lost_fits_fail() {
        let c: GateConfig = toml::from_str(CONFIG).expect("toml");
        let base = results(vec![("synthetic/smoke", summary(0.9, 0, Some(-19.0), 1.0))]);
        let empty = results(vec![]);
        assert!(
            gate(&empty, &base, &c)
                .iter()
                .any(|k| !k.pass && k.metric == "present")
        );
        let mut other = results(vec![("synthetic/smoke", summary(0.9, 0, Some(-19.0), 1.0))]);
        other.preset = "subtract-3".into();
        let failed: Vec<String> = gate(&other, &base, &c)
            .into_iter()
            .filter(|k| !k.pass)
            .map(|k| k.metric)
            .collect();
        assert_eq!(failed, vec!["preset"]);
        let mut staged = results(vec![("synthetic/smoke", summary(0.9, 0, Some(-19.0), 1.0))]);
        staged.then = vec!["subtract-3-osd2 spectrogram.time_osr=4".into()];
        let failed: Vec<String> = gate(&staged, &base, &c)
            .into_iter()
            .filter(|k| !k.pass)
            .map(|k| k.metric)
            .collect();
        assert_eq!(failed, vec!["preset"]);
        let no_fit = results(vec![("synthetic/smoke", summary(0.85, 0, None, 1.0))]);
        assert!(
            gate(&no_fit, &base, &c)
                .iter()
                .any(|k| !k.pass && k.metric == "SNR50 dB")
        );
        let all_decoded = results(vec![("synthetic/smoke", summary(1.0, 0, None, 1.0))]);
        assert!(gate(&all_decoded, &base, &c).iter().all(|k| k.pass));
        let mut fewer = summary(0.9, 0, Some(-19.0), 1.0);
        fewer.slots = 9;
        let fewer = results(vec![("synthetic/smoke", fewer)]);
        assert!(
            gate(&fewer, &base, &c)
                .iter()
                .any(|k| !k.pass && k.metric == "slots")
        );
    }
}

#[cfg(test)]
mod repository_config {
    use super::*;

    #[test]
    fn committed_gate_file_parses() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../bench/gate.toml");
        let config = GateConfig::load(&path).expect("bench/gate.toml");
        assert!(config.required_sets.contains(&"public/ft8_lib".to_string()));
        for name in config.sets.keys() {
            assert!(
                config.required_sets.contains(name),
                "{name} has limits but is not required"
            );
        }
    }
}

#[cfg(test)]
mod recorded_baselines {
    use crate::results::load;
    use std::path::Path;

    #[test]
    fn each_committed_baseline_holds_its_preset() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../bench");
        for preset in ["baseline", "subtract-3-osd2"] {
            let r = load(&dir.join(format!("{preset}.json"))).expect(preset);
            assert_eq!(r.preset, preset);
            assert!(r.overrides.is_empty(), "{preset}");
            assert!(r.slim, "{preset}");
        }
        let deep = load(&dir.join("subtract-3-osd2-deep.json")).expect("deep");
        assert_eq!(deep.preset, "subtract-3-osd2");
        assert!(deep.overrides.is_empty() && deep.slim);
        assert_eq!(deep.then.len(), 2);
    }
}
