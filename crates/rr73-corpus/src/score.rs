//! Matching decodes against truth or reference entries (`docs/corpus.md`, Scoring).
//!
//! A decode matches an entry when the normalised message text is equal, the frequency is
//! within [`Tolerance::freq_hz`] and DT within [`Tolerance::dt_s`]. Each decode and each
//! entry match at most once. When several pairs qualify, the closest pairs are taken first
//! (frequency and DT differences, each relative to its tolerance, summed), ties broken by
//! index, so the result does not depend on hash order or thread timing.

use serde::{Deserialize, Serialize};

use crate::sidecar::Entry;

/// Matching tolerances.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Tolerance {
    /// Largest frequency difference, in Hz.
    pub freq_hz: f64,
    /// Largest DT difference, in seconds.
    pub dt_s: f64,
}

impl Default for Tolerance {
    /// 10 Hz and 0.5 s, from `docs/corpus.md`.
    fn default() -> Self {
        Self {
            freq_hz: 10.0,
            dt_s: 0.5,
        }
    }
}

/// Message text in the form used for comparison: trimmed, upper case, single spaces.
pub fn normalise_text(text: &str) -> String {
    text.split_whitespace()
        .map(str::to_uppercase)
        .collect::<Vec<_>>()
        .join(" ")
}

/// The outcome of scoring one slot.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SlotScore {
    /// Number of expected entries (truth or reference).
    pub expected: usize,
    /// Number of decodes scored.
    pub decodes: usize,
    /// Expected entries matched by a decode.
    pub matched: usize,
    /// Decodes that match no entry.
    pub unique: usize,
    /// For each decode, the index of the entry it matched.
    pub decode_match: Vec<Option<usize>>,
    /// For each expected entry, the index of the decode that matched it.
    pub entry_match: Vec<Option<usize>>,
}

impl SlotScore {
    /// Matched entries over expected entries, or `None` with nothing expected.
    pub fn recall(&self) -> Option<f64> {
        if self.expected == 0 {
            None
        } else {
            Some(self.matched as f64 / self.expected as f64)
        }
    }
}

/// Matches `decodes` against `expected` entries.
pub fn match_entries(decodes: &[Entry], expected: &[Entry], tol: Tolerance) -> SlotScore {
    let dec_text: Vec<String> = decodes.iter().map(|d| normalise_text(&d.text)).collect();
    let exp_text: Vec<String> = expected.iter().map(|e| normalise_text(&e.text)).collect();
    let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
    for (i, d) in decodes.iter().enumerate() {
        for (j, e) in expected.iter().enumerate() {
            if dec_text[i] != exp_text[j] {
                continue;
            }
            let df = (d.freq_hz - e.freq_hz).abs();
            let dt = (d.dt_s - e.dt_s).abs();
            // NaN fails both comparisons and never matches.
            if df <= tol.freq_hz && dt <= tol.dt_s {
                let cost = df / tol.freq_hz.max(f64::MIN_POSITIVE) + dt / tol.dt_s.max(f64::MIN_POSITIVE);
                pairs.push((cost, i, j));
            }
        }
    }
    pairs.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let mut decode_match = vec![None; decodes.len()];
    let mut entry_match = vec![None; expected.len()];
    for (_, i, j) in pairs {
        if decode_match[i].is_none() && entry_match[j].is_none() {
            decode_match[i] = Some(j);
            entry_match[j] = Some(i);
        }
    }
    let matched = entry_match.iter().filter(|m| m.is_some()).count();
    SlotScore {
        expected: expected.len(),
        decodes: decodes.len(),
        matched,
        unique: decodes.len() - matched,
        decode_match,
        entry_match,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(text: &str, freq_hz: f64, dt_s: f64) -> Entry {
        Entry {
            text: text.into(),
            freq_hz,
            dt_s,
            snr_db: 0.0,
        }
    }

    #[test]
    fn matches_on_text_frequency_and_dt() {
        let expected = [e("CQ 9V1NE OJ11", 1000.0, 0.1), e("K1ABC W9XYZ -12", 1500.0, 0.0)];
        let decodes = [
            e("cq  9v1ne oj11 ", 1009.0, 0.55), // within both tolerances
            e("K1ABC W9XYZ -12", 1511.0, 0.0),  // 11 Hz off
            e("K1ABC W9XYZ -13", 1500.0, 0.0),  // text differs
        ];
        let s = match_entries(&decodes, &expected, Tolerance::default());
        assert_eq!(s.matched, 1);
        assert_eq!(s.unique, 2);
        assert_eq!(s.decode_match, vec![Some(0), None, None]);
        assert_eq!(s.entry_match, vec![Some(0), None]);
        assert_eq!(s.recall(), Some(0.5));
    }

    #[test]
    fn dt_limit_is_inclusive_and_exceeding_it_fails() {
        let expected = [e("A B C", 1000.0, 0.0)];
        assert_eq!(
            match_entries(&[e("A B C", 1010.0, 0.5)], &expected, Tolerance::default()).matched,
            1
        );
        assert_eq!(
            match_entries(&[e("A B C", 1000.0, 0.51)], &expected, Tolerance::default()).matched,
            0
        );
    }

    #[test]
    fn each_entry_matches_once_and_closest_pairs_win() {
        // Two identical transmissions 8 Hz apart, decoded twice each; the duplicate decode
        // must count as unique and each entry must take its nearest decode.
        let expected = [e("CQ K1ABC FN42", 1000.0, 0.0), e("CQ K1ABC FN42", 1008.0, 0.0)];
        let decodes = [
            e("CQ K1ABC FN42", 1007.0, 0.0),
            e("CQ K1ABC FN42", 1001.0, 0.0),
            e("CQ K1ABC FN42", 1001.5, 0.0),
        ];
        let s = match_entries(&decodes, &expected, Tolerance::default());
        assert_eq!(s.matched, 2);
        assert_eq!(s.unique, 1);
        assert_eq!(s.entry_match, vec![Some(1), Some(0)]);
    }

    #[test]
    fn non_finite_values_never_match() {
        let expected = [e("A B C", 1000.0, 0.0)];
        let decodes = [e("A B C", f64::NAN, 0.0), e("A B C", 1000.0, f64::INFINITY)];
        let s = match_entries(&decodes, &expected, Tolerance::default());
        assert_eq!(s.matched, 0);
        assert_eq!(s.unique, 2);
        assert_eq!(match_entries(&[], &[], Tolerance::default()).recall(), None);
    }
}
