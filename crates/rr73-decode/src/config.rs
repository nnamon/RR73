//! Decoder configuration: which implementation each stage uses and its parameters.
//!
//! A configuration is a named preset plus `key=value` overrides on dotted paths, such as
//! `ldpc.max_iterations=50` or `ldpc.kind=min-sum`. The configuration serialises to JSON,
//! so a bench result records exactly what ran.

use rr73_dsp::WindowKind;
use serde::{Deserialize, Serialize};

/// Names of the built-in presets.
pub const PRESETS: &[&str] = &["baseline", "subtract-3"];

/// Errors from building a configuration.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ConfigError {
    /// No preset has this name.
    #[error("unknown preset {0:?}; known presets: baseline, subtract-3")]
    UnknownPreset(String),
    /// An override is not `key=value`.
    #[error("override {0:?} is not key=value")]
    BadOverride(String),
    /// An override names a key that does not exist.
    #[error("unknown configuration key {0:?}")]
    UnknownKey(String),
    /// The value does not fit the key's type, or the result breaks a rule.
    #[error("invalid configuration: {0}")]
    Invalid(String),
}

/// The full decoder configuration.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DecoderConfig {
    /// Spectrogram layout.
    pub spectrogram: SpectrogramParams,
    /// Candidate search.
    pub search: SearchParams,
    /// Time and frequency refinement.
    pub refine: RefineParams,
    /// Symbol energies to LLRs.
    pub demod: DemodParams,
    /// LDPC decoding.
    pub ldpc: LdpcParams,
    /// CRC, unpacking and duplicate removal.
    pub validate: ValidateParams,
    /// Signal subtraction between passes.
    pub subtract: SubtractParams,
    /// Decoding passes. Each pass after the first runs on the audio left by the subtractor.
    pub passes: u32,
}

/// Spectrogram layout, in multiples of the mode's symbol length and tone spacing.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpectrogramParams {
    /// Frames per symbol (time oversampling).
    pub time_osr: usize,
    /// Bins per tone spacing (frequency oversampling). The FFT is `freq_osr` symbols long.
    pub freq_osr: usize,
    /// Analysis window, spanning the whole FFT.
    pub window: WindowKind,
    /// Lowest frequency analysed, in Hz.
    pub freq_min_hz: f32,
    /// Highest frequency analysed, in Hz. Candidates keep all tones at or below it.
    pub freq_max_hz: f32,
}

/// Candidate search implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SearchKind {
    /// Costas sync score from ft8_lib: each sync tone against its frequency and time
    /// neighbours, in dB, averaged.
    Costas,
}

/// Candidate search parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchParams {
    /// Implementation.
    pub kind: SearchKind,
    /// Most candidates kept, best scores first.
    pub max_candidates: usize,
    /// Lowest sync score kept, in dB.
    pub min_score_db: f32,
    /// FT8 DT search range start, in seconds from the nominal start.
    pub ft8_dt_min_s: f32,
    /// FT8 DT search range end, in seconds from the nominal start.
    pub ft8_dt_max_s: f32,
    /// FT4 DT search range start, in seconds from the nominal start.
    pub ft4_dt_min_s: f32,
    /// FT4 DT search range end, in seconds from the nominal start.
    pub ft4_dt_max_s: f32,
}

/// Refinement implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefineKind {
    /// Keep the search grid position.
    None,
}

/// Refinement parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RefineParams {
    /// Implementation.
    pub kind: RefineKind,
}

/// Demodulator implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DemodKind {
    /// ft8_lib: per bit, the largest dB magnitude among tones with the bit set minus the
    /// largest among tones with it clear, then scaled to a fixed variance.
    MaxLog,
}

/// Demodulator parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemodParams {
    /// Implementation.
    pub kind: DemodKind,
    /// Variance the 174 LLRs are scaled to (ft8_lib uses 24).
    pub llr_variance: f32,
}

/// LDPC decoder implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LdpcKind {
    /// Sum-product belief propagation with ft8_lib's rational tanh and atanh.
    SumProduct,
    /// Normalised min-sum.
    MinSum,
}

/// LDPC parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LdpcParams {
    /// Implementation.
    pub kind: LdpcKind,
    /// Most message-passing iterations.
    pub max_iterations: u32,
    /// Min-sum check-message scale factor (used by `min-sum` only).
    pub min_sum_scale: f32,
}

/// Validator implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ValidateKind {
    /// CRC-14 check, non-zero payload, message unpack; duplicates are payloads already
    /// decoded in the slot.
    CrcUnpack,
}

/// Validator parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ValidateParams {
    /// Implementation.
    pub kind: ValidateKind,
}

/// Subtractor implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SubtractKind {
    /// Leave the audio unchanged.
    None,
    /// Rebuild each decode with a complex GFSK model, estimate its amplitude over time and
    /// subtract it.
    Model,
}

/// Subtractor parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubtractParams {
    /// Implementation.
    pub kind: SubtractKind,
    /// Moving-average length for the amplitude estimate, in seconds (used by `model`).
    pub smooth_s: f32,
    /// Refine start and frequency from the decoded tones before subtracting (used by
    /// `model`).
    pub refine: bool,
}

impl DecoderConfig {
    /// The `baseline` preset: the ft8_lib method. 2x time and 2x frequency oversampled
    /// waterfall (Hann window over 2 symbols, 200 to 3000 Hz), Costas sync score, the 140
    /// best candidates scoring at least 5 dB, max-log LLRs from dB magnitudes scaled to
    /// variance 24, 25 iterations of sum-product belief propagation, CRC and unpack, one
    /// pass. The FT8 DT range (-2.3 to 2.5 s) covers the same 60 time steps as ft8_lib.
    pub fn baseline() -> Self {
        Self {
            spectrogram: SpectrogramParams {
                time_osr: 2,
                freq_osr: 2,
                window: WindowKind::Hann,
                freq_min_hz: 200.0,
                freq_max_hz: 3000.0,
            },
            search: SearchParams {
                kind: SearchKind::Costas,
                max_candidates: 140,
                min_score_db: 5.0,
                ft8_dt_min_s: -2.3,
                ft8_dt_max_s: 2.5,
                ft4_dt_min_s: -1.0,
                ft4_dt_max_s: 1.0,
            },
            refine: RefineParams {
                kind: RefineKind::None,
            },
            demod: DemodParams {
                kind: DemodKind::MaxLog,
                llr_variance: 24.0,
            },
            ldpc: LdpcParams {
                kind: LdpcKind::SumProduct,
                max_iterations: 25,
                min_sum_scale: 0.75,
            },
            validate: ValidateParams {
                kind: ValidateKind::CrcUnpack,
            },
            subtract: SubtractParams {
                kind: SubtractKind::None,
                smooth_s: 0.16,
                refine: false,
            },
            passes: 1,
        }
    }

    /// The `subtract-3` preset: `baseline` plus up to 3 passes with model subtraction
    /// between them (amplitude averaged over 0.16 s, start and frequency refined from the
    /// decoded tones).
    pub fn subtract_3() -> Self {
        let mut c = Self::baseline();
        c.passes = 3;
        c.subtract = SubtractParams {
            kind: SubtractKind::Model,
            smooth_s: 0.16,
            refine: true,
        };
        c
    }

    /// The preset called `name`.
    pub fn preset(name: &str) -> Result<Self, ConfigError> {
        match name {
            "baseline" => Ok(Self::baseline()),
            "subtract-3" => Ok(Self::subtract_3()),
            other => Err(ConfigError::UnknownPreset(other.to_string())),
        }
    }

    /// Applies `key=value` overrides in order. Keys are dotted paths into the JSON form of
    /// the configuration. Values parse as JSON when they can (numbers, booleans) and as
    /// strings otherwise (`ldpc.kind=min-sum`).
    pub fn with_overrides<S: AsRef<str>>(&self, overrides: &[S]) -> Result<Self, ConfigError> {
        let mut value = serde_json::to_value(self).map_err(|e| ConfigError::Invalid(e.to_string()))?;
        for item in overrides {
            let item = item.as_ref();
            let (key, raw) = item
                .split_once('=')
                .ok_or_else(|| ConfigError::BadOverride(item.to_string()))?;
            let key = key.trim();
            let raw = raw.trim();
            let parsed = serde_json::from_str::<serde_json::Value>(raw)
                .unwrap_or_else(|_| serde_json::Value::String(raw.to_string()));
            let slot = key
                .split('.')
                .try_fold(&mut value, |v, part| v.get_mut(part))
                .ok_or_else(|| ConfigError::UnknownKey(key.to_string()))?;
            if slot.is_object() {
                return Err(ConfigError::UnknownKey(format!(
                    "{key} (a section, set one of its fields)"
                )));
            }
            *slot = parsed;
        }
        let config: Self = serde_json::from_value(value).map_err(|e| ConfigError::Invalid(e.to_string()))?;
        config.check()?;
        Ok(config)
    }

    /// Checks parameter ranges that would make decoding meaningless.
    pub fn check(&self) -> Result<(), ConfigError> {
        let bad = |s: &str| Err(ConfigError::Invalid(s.to_string()));
        let sp = &self.spectrogram;
        if !(1..=16).contains(&sp.time_osr) || !(1..=16).contains(&sp.freq_osr) {
            return bad("time_osr and freq_osr must be 1 to 16");
        }
        if !(sp.freq_min_hz >= 0.0 && sp.freq_max_hz > sp.freq_min_hz && sp.freq_max_hz <= 6000.0) {
            return bad("frequency range must satisfy 0 <= min < max <= 6000 Hz");
        }
        let s = &self.search;
        if !(s.ft8_dt_min_s < s.ft8_dt_max_s && s.ft4_dt_min_s < s.ft4_dt_max_s) {
            return bad("DT ranges must have min < max");
        }
        if !s.min_score_db.is_finite() || s.max_candidates > 100_000 {
            return bad("min_score_db must be finite and max_candidates at most 100000");
        }
        if !(self.demod.llr_variance > 0.0 && self.demod.llr_variance.is_finite()) {
            return bad("llr_variance must be positive");
        }
        if self.ldpc.max_iterations > 10_000
            || !(self.ldpc.min_sum_scale > 0.0 && self.ldpc.min_sum_scale <= 1.0)
        {
            return bad("max_iterations must be at most 10000 and min_sum_scale in (0, 1]");
        }
        if !(self.subtract.smooth_s > 0.0 && self.subtract.smooth_s <= 15.0) {
            return bad("subtract.smooth_s must be in (0, 15] s");
        }
        if !(1..=8).contains(&self.passes) {
            return bad("passes must be 1 to 8");
        }
        Ok(())
    }
}

impl Default for DecoderConfig {
    fn default() -> Self {
        Self::baseline()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baseline_is_valid_and_round_trips_through_json() {
        let c = DecoderConfig::baseline();
        c.check().expect("valid");
        let json = serde_json::to_string(&c).expect("json");
        let back: DecoderConfig = serde_json::from_str(&json).expect("parse");
        assert_eq!(c, back);
        assert_eq!(DecoderConfig::preset("baseline").expect("preset"), c);
        assert!(DecoderConfig::preset("osd-depth-9").is_err());
        for name in PRESETS {
            DecoderConfig::preset(name).expect(name);
        }
    }

    #[test]
    fn overrides_set_numbers_enums_and_reject_mistakes() {
        let c = DecoderConfig::baseline()
            .with_overrides(&[
                "ldpc.max_iterations=50",
                "ldpc.kind=min-sum",
                "search.min_score_db = 3.5",
            ])
            .expect("overrides");
        assert_eq!(c.ldpc.max_iterations, 50);
        assert_eq!(c.ldpc.kind, LdpcKind::MinSum);
        assert_eq!(c.search.min_score_db, 3.5);
        let base = DecoderConfig::baseline();
        assert!(matches!(
            base.with_overrides(&["ldpc.iters=5"]),
            Err(ConfigError::UnknownKey(_))
        ));
        assert!(matches!(
            base.with_overrides(&["ldpc=5"]),
            Err(ConfigError::UnknownKey(_))
        ));
        assert!(matches!(
            base.with_overrides(&["ldpc.kind=osd"]),
            Err(ConfigError::Invalid(_))
        ));
        assert!(matches!(
            base.with_overrides(&["passes"]),
            Err(ConfigError::BadOverride(_))
        ));
        assert!(matches!(
            base.with_overrides(&["passes=0"]),
            Err(ConfigError::Invalid(_))
        ));
        assert!(matches!(
            base.with_overrides(&["spectrogram.freq_osr=-1"]),
            Err(ConfigError::Invalid(_))
        ));
    }
}
