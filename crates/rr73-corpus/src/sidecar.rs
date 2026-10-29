//! The `rr73-slot/1` sidecar schema.
//!
//! Field order on write follows `docs/corpus.md`. Fields the format leaves open for a given
//! source are optional: `start_utc` (unknown for some public files), `dial_hz`, `timing`
//! (unknown clock) and `truth` (synthetic slots only). `source` carries the documented
//! `kind` plus any further keys, which are kept on read and written back unchanged.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The schema version this crate reads and writes.
pub const FORMAT: &str = "rr73-slot/1";

/// Mode of a slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SlotMode {
    /// FT8, 15 s slots.
    #[serde(rename = "FT8")]
    Ft8,
    /// FT4, 7.5 s slots.
    #[serde(rename = "FT4")]
    Ft4,
    /// WSPR, 120 s slots starting in even UTC minutes.
    #[serde(rename = "WSPR")]
    Wspr,
    /// LQ8, 15 s slots.
    #[serde(rename = "LQ8")]
    Lq8,
}

impl SlotMode {
    /// Samples in one slot at 12 kHz: 180000 for FT8 and LQ8, 90000 for FT4, 1440000 for WSPR.
    pub fn slot_samples(self) -> usize {
        match self {
            SlotMode::Ft8 | SlotMode::Lq8 => 180_000,
            SlotMode::Ft4 => 90_000,
            SlotMode::Wspr => 1_440_000,
        }
    }

    /// Slot length, in seconds: 15, 7.5 or 120.
    pub fn slot_s(self) -> f64 {
        self.slot_samples() as f64 / f64::from(crate::SAMPLE_RATE)
    }

    /// The name used in sidecars and on screen.
    pub fn name(self) -> &'static str {
        match self {
            SlotMode::Ft8 => "FT8",
            SlotMode::Ft4 => "FT4",
            SlotMode::Wspr => "WSPR",
            SlotMode::Lq8 => "LQ8",
        }
    }
}

/// Where a slot came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    /// Recorded from a KiwiSDR.
    Kiwisdr,
    /// Recorded in the app from a KX2.
    Kx2,
    /// Rendered by the channel simulator.
    Synthetic,
    /// A public test file.
    Public,
}

/// The `source` object: `kind` plus free-form keys (receiver, host, generator, seed, ...).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Source {
    /// Source kind.
    pub kind: SourceKind,
    /// Other keys, kept as written.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Source {
    /// A source of `kind` with no further keys.
    pub fn new(kind: SourceKind) -> Self {
        Self {
            kind,
            extra: serde_json::Map::new(),
        }
    }

    /// Adds a key, for builder-style construction.
    pub fn with(mut self, key: &str, value: impl Into<serde_json::Value>) -> Self {
        self.extra.insert(key.to_string(), value.into());
        self
    }
}

/// Clock reference of a recording.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimingReference {
    /// GPS-disciplined clock.
    Gps,
    /// NTP-synchronised clock.
    Ntp,
    /// The phone's clock.
    Phone,
    /// Synthetic slot: timing is exact.
    Synthetic,
}

/// The `timing` object.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Timing {
    /// Clock reference.
    pub reference: TimingReference,
    /// Correction applied before writing, in seconds.
    pub offset_s: f64,
}

/// One known or reference signal: message text, base-tone frequency, DT and SNR.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    /// Message text as transmitted.
    pub text: String,
    /// Base-tone (tone 0) audio frequency, in Hz.
    pub freq_hz: f64,
    /// Time offset from the nominal transmission start (0.5 s into the slot), in seconds.
    pub dt_s: f64,
    /// Signal-to-noise ratio in 2500 Hz, in dB.
    pub snr_db: f64,
}

/// Decodes from one reference tool run.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Reference {
    /// Tool name, version and options, such as `jt9 2.6.1 -8 -d 3`.
    pub tool: String,
    /// The tool's decodes.
    pub decodes: Vec<Entry>,
}

/// A slot sidecar.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SlotMeta {
    /// Schema version, [`FORMAT`].
    pub format: String,
    /// Mode.
    pub mode: SlotMode,
    /// Slot start, ISO 8601 UTC (`2026-10-13T13:14:15Z`), or `null` when not known.
    pub start_utc: Option<String>,
    /// Sample rate of the WAV, in Hz. Always 12000.
    pub sample_rate: u32,
    /// Radio dial frequency (USB), in Hz, or `null` when not known.
    pub dial_hz: Option<u64>,
    /// Origin of the recording.
    pub source: Source,
    /// Clock reference and applied correction, or `null` when not known.
    pub timing: Option<Timing>,
    /// `true` for slots that hold no signal and count false decodes.
    #[serde(default)]
    pub noise_only: bool,
    /// Synthetic slots: the exact signals.
    #[serde(default)]
    pub truth: Option<Vec<Entry>>,
    /// Decodes from reference tools, keyed by tool and depth.
    #[serde(default)]
    pub reference: BTreeMap<String, Reference>,
}

impl SlotMeta {
    /// A sidecar with the fixed fields filled in and everything optional empty.
    pub fn new(mode: SlotMode, source: Source) -> Self {
        Self {
            format: FORMAT.to_string(),
            mode,
            start_utc: None,
            sample_rate: crate::SAMPLE_RATE,
            dial_hz: None,
            source,
            timing: None,
            noise_only: false,
            truth: None,
            reference: BTreeMap::new(),
        }
    }

    /// The entries decodes are scored against: the truth for synthetic slots, otherwise the
    /// reference named `key`. With no key, a sidecar holding a single reference uses it, and
    /// one holding several uses `jt9-d3` if present, else the first key in sorted order.
    /// Noise-only slots and slots with nothing to score against return an empty list.
    pub fn expected(&self, key: Option<&str>) -> &[Entry] {
        if self.noise_only {
            return &[];
        }
        if let Some(truth) = &self.truth {
            return truth;
        }
        let chosen = match key {
            Some(k) => self.reference.get(k),
            None => self
                .reference
                .get("jt9-d3")
                .or_else(|| self.reference.values().next()),
        };
        chosen.map(|r| r.decodes.as_slice()).unwrap_or(&[])
    }

    /// `true` when unmatched decodes on this slot are false decodes: synthetic and
    /// noise-only slots, where the expected list is complete.
    pub fn unmatched_are_false(&self) -> bool {
        self.noise_only || self.truth.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC_EXAMPLE: &str = r#"{
      "format": "rr73-slot/1",
      "mode": "FT8",
      "start_utc": "2026-10-13T13:14:15Z",
      "sample_rate": 12000,
      "dial_hz": 14074000,
      "source": {
        "kind": "kiwisdr",
        "receiver": "sarts-web888",
        "host": "167.172.88.10",
        "antenna": "Wellbrook loop",
        "grid": "OJ11"
      },
      "timing": { "reference": "gps", "offset_s": 0.0 },
      "noise_only": false,
      "truth": null,
      "reference": {
        "jt9-d3": {
          "tool": "jt9 2.6.1 -8 -d 3",
          "decodes": [
            { "text": "CQ 9M2TRX OJ02", "freq_hz": 1022, "dt_s": 0.1, "snr_db": -7 }
          ]
        }
      }
    }"#;

    #[test]
    fn reads_the_example_from_the_format_doc() {
        let meta: SlotMeta = serde_json::from_str(DOC_EXAMPLE).expect("parse");
        assert_eq!(meta.format, FORMAT);
        assert_eq!(meta.mode, SlotMode::Ft8);
        assert_eq!(meta.dial_hz, Some(14_074_000));
        assert_eq!(meta.source.kind, SourceKind::Kiwisdr);
        assert_eq!(meta.source.extra["receiver"], "sarts-web888");
        assert_eq!(meta.timing.map(|t| t.reference), Some(TimingReference::Gps));
        let expected = meta.expected(None);
        assert_eq!(expected.len(), 1);
        assert_eq!(expected[0].text, "CQ 9M2TRX OJ02");
        assert!(!meta.unmatched_are_false());
    }

    #[test]
    fn round_trips_and_keeps_field_order() {
        let meta: SlotMeta = serde_json::from_str(DOC_EXAMPLE).expect("parse");
        let text = serde_json::to_string_pretty(&meta).expect("write");
        let again: SlotMeta = serde_json::from_str(&text).expect("reparse");
        assert_eq!(meta, again);
        let keys = [
            "\"format\"",
            "\"mode\"",
            "\"start_utc\"",
            "\"sample_rate\"",
            "\"dial_hz\"",
            "\"source\"",
            "\"timing\"",
            "\"noise_only\"",
            "\"truth\"",
            "\"reference\"",
        ];
        // Top-level keys only: `timing` also holds a `reference` key.
        let positions: Vec<usize> = keys
            .iter()
            .map(|k| text.find(&format!("\n  {k}:")).expect(k))
            .collect();
        assert!(positions.windows(2).all(|w| w[0] < w[1]), "{text}");
    }

    #[test]
    fn expected_prefers_truth_then_named_reference() {
        let mut meta = SlotMeta::new(SlotMode::Ft8, Source::new(SourceKind::Synthetic));
        let e = |t: &str| Entry {
            text: t.into(),
            freq_hz: 1000.0,
            dt_s: 0.0,
            snr_db: -10.0,
        };
        for key in ["b", "a"] {
            meta.reference.insert(
                key.into(),
                Reference {
                    tool: key.into(),
                    decodes: vec![e(key)],
                },
            );
        }
        assert_eq!(meta.expected(None)[0].text, "a");
        assert_eq!(meta.expected(Some("b"))[0].text, "b");
        assert!(meta.expected(Some("missing")).is_empty());
        meta.truth = Some(vec![e("truth")]);
        assert_eq!(meta.expected(Some("b"))[0].text, "truth");
        assert!(meta.unmatched_are_false());
        meta.noise_only = true;
        assert!(meta.expected(None).is_empty());
    }

    #[test]
    fn unknown_mode_and_kind_are_rejected() {
        let bad_mode = DOC_EXAMPLE.replace("\"FT8\"", "\"JT65\"");
        assert!(serde_json::from_str::<SlotMeta>(&bad_mode).is_err());
        let bad_kind = DOC_EXAMPLE.replace("\"kiwisdr\"", "\"tape\"");
        assert!(serde_json::from_str::<SlotMeta>(&bad_kind).is_err());
    }
}
