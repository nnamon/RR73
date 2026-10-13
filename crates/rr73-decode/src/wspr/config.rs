//! WSPR decoder configuration: which implementation each stage uses and its parameters, as
//! named presets plus `key=value` overrides on dotted paths (`fano.max_cycles_per_bit=20000`),
//! the same scheme as [`crate::DecoderConfig`].

use serde::{Deserialize, Serialize};

use crate::config::ConfigError;

/// Names of the built-in WSPR presets.
pub const WSPR_PRESETS: &[&str] = &["wspr", "wspr-deep"];

/// `true` when `name` names a WSPR preset.
pub fn is_wspr_preset(name: &str) -> bool {
    WSPR_PRESETS.contains(&name)
}

/// The full WSPR decoder configuration.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WsprConfig {
    /// Candidate search.
    pub search: WsprSearchParams,
    /// Time, frequency and drift refinement.
    pub refine: WsprRefineParams,
    /// Symbol powers to soft bits.
    pub demod: WsprDemodParams,
    /// Sequential decoding of the convolutional code.
    pub fano: FanoParams,
    /// Message checks.
    pub validate: WsprValidateParams,
    /// Decoding passes. Each pass after the first runs on the audio left by subtraction.
    pub passes: u32,
}

/// Candidate search implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WsprSearchKind {
    /// Sync-vector correlation over a symbol-length spectrogram, with drift hypotheses.
    Sync,
}

/// Candidate search parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WsprSearchParams {
    /// Implementation.
    pub kind: WsprSearchKind,
    /// Lowest signal centre searched, in Hz of audio.
    pub freq_min_hz: f32,
    /// Highest signal centre searched, in Hz of audio.
    pub freq_max_hz: f32,
    /// DT search range start, in seconds from the nominal start (1 s into the slot).
    pub dt_min_s: f32,
    /// DT search range end, in seconds from the nominal start.
    pub dt_max_s: f32,
    /// Largest drift searched, in Hz over the whole transmission (110.6 s), either sign.
    pub drift_max_hz: f32,
    /// Step between drift hypotheses, in Hz over the transmission.
    pub drift_step_hz: f32,
    /// Most candidates kept, best scores first.
    pub max_candidates: usize,
    /// Lowest sync score kept, in standard deviations of the score on noise.
    pub min_score: f32,
}

/// Refinement implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WsprRefineKind {
    /// Keep the search grid position.
    None,
    /// Coordinate search over time, frequency and drift with coherent per-symbol tone
    /// correlations.
    Grid,
    /// Grid search for time and coarse frequency, then frequency and drift from the phase
    /// coherence of blocks of `block` symbols.
    Coherent,
}

/// Refinement parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WsprRefineParams {
    /// Implementation.
    pub kind: WsprRefineKind,
    /// Symbols per block of the coherence metric (used by `coherent`), 1 to 8.
    pub block: usize,
}

/// Demodulator implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WsprDemodKind {
    /// Noncoherent binary FSK between the two tones the sync bit allows: the log-likelihood
    /// ratio of two Rician hypotheses from the tone amplitudes, the estimated signal amplitude
    /// and the noise power.
    Noncoherent,
    /// Multi-symbol noncoherent detection over `block` symbols of phase-aligned correlations.
    Block,
}

/// Demodulator parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WsprDemodParams {
    /// Implementation.
    pub kind: WsprDemodKind,
    /// Factor applied to every log-likelihood ratio.
    pub llr_scale: f32,
    /// Symbols per block for `block`: odd, 1 to 9.
    pub block: usize,
}

/// Sequential decoder implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FanoKind {
    /// The Fano algorithm with a moving threshold.
    Fano,
}

/// Sequential decoder parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FanoParams {
    /// Implementation.
    pub kind: FanoKind,
    /// Most decoder steps per input bit before giving up (81 input bits per message).
    pub max_cycles_per_bit: u32,
    /// Threshold step, in bits of path metric.
    pub delta: f32,
    /// Metric bias per code bit, in bits (the code rate, 0.5, is the textbook value).
    pub bias: f32,
}

/// Validator implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WsprValidateKind {
    /// Unpack, callsign plausibility, re-encoding checks and duplicates.
    Unpack,
}

/// Validator parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WsprValidateParams {
    /// Implementation.
    pub kind: WsprValidateKind,
    /// Most data bits (of 162) on which the re-encoded message may disagree with the
    /// demodulator's hard decisions.
    pub max_hard_errors: u32,
    /// Lowest SNR a decode may report, in dB in 2500 Hz.
    pub min_snr_db: f32,
}

impl WsprConfig {
    /// The `wspr` preset: sync search over 1400 to 1600 Hz, DT -2 to 4 s and drift up to
    /// 4 Hz over the transmission in 0.5 Hz steps, at most 60 candidates scoring 4 or more;
    /// coherent refinement over blocks of 5 symbols; soft bits from 5-symbol blocks; the Fano
    /// decoder with up to 10000 steps per bit; unpack and plausibility checks; one pass.
    pub fn wspr() -> Self {
        Self {
            search: WsprSearchParams {
                kind: WsprSearchKind::Sync,
                freq_min_hz: 1400.0,
                freq_max_hz: 1600.0,
                dt_min_s: -2.0,
                dt_max_s: 4.0,
                drift_max_hz: 4.0,
                drift_step_hz: 0.5,
                max_candidates: 60,
                min_score: 4.0,
            },
            refine: WsprRefineParams {
                kind: WsprRefineKind::Coherent,
                block: 5,
            },
            demod: WsprDemodParams {
                kind: WsprDemodKind::Block,
                llr_scale: 1.0,
                block: 5,
            },
            fano: FanoParams {
                kind: FanoKind::Fano,
                max_cycles_per_bit: 10_000,
                delta: 1.0,
                bias: 0.5,
            },
            validate: WsprValidateParams {
                kind: WsprValidateKind::Unpack,
                max_hard_errors: 162,
                min_snr_db: -40.0,
            },
            passes: 1,
        }
    }

    /// The `wspr-deep` preset: `wspr` with more candidates and 5 times the Fano steps.
    pub fn wspr_deep() -> Self {
        let mut c = Self::wspr();
        c.search.max_candidates = 120;
        c.fano.max_cycles_per_bit = 50_000;
        c
    }

    /// The preset called `name`.
    pub fn preset(name: &str) -> Result<Self, ConfigError> {
        match name {
            "wspr" => Ok(Self::wspr()),
            "wspr-deep" => Ok(Self::wspr_deep()),
            other => Err(ConfigError::UnknownPreset(other.to_string())),
        }
    }

    /// Applies `key=value` overrides in order, as [`crate::DecoderConfig::with_overrides`].
    pub fn with_overrides<S: AsRef<str>>(&self, overrides: &[S]) -> Result<Self, ConfigError> {
        let value = serde_json::to_value(self).map_err(|e| ConfigError::Invalid(e.to_string()))?;
        let value = crate::config::apply_overrides(value, overrides)?;
        let config: Self = serde_json::from_value(value).map_err(|e| ConfigError::Invalid(e.to_string()))?;
        config.check()?;
        Ok(config)
    }

    /// Checks parameter ranges that would make decoding meaningless.
    pub fn check(&self) -> Result<(), ConfigError> {
        let bad = |s: &str| Err(ConfigError::Invalid(s.to_string()));
        let s = &self.search;
        if !(s.freq_min_hz >= 1350.0 && s.freq_max_hz <= 1650.0 && s.freq_min_hz < s.freq_max_hz) {
            return bad("search frequencies must satisfy 1350 <= min < max <= 1650 Hz");
        }
        if !(s.dt_min_s >= -10.0 && s.dt_max_s <= 10.0 && s.dt_min_s < s.dt_max_s) {
            return bad("DT range must satisfy -10 <= min < max <= 10 s");
        }
        if !(s.drift_max_hz >= 0.0 && s.drift_max_hz <= 20.0 && s.drift_step_hz > 0.0) {
            return bad("drift_max_hz must be 0 to 20 and drift_step_hz positive");
        }
        if s.drift_max_hz / s.drift_step_hz > 200.0 || s.max_candidates > 10_000 || !s.min_score.is_finite() {
            return bad("at most 401 drift steps and 10000 candidates; min_score finite");
        }
        if !(self.demod.llr_scale > 0.0 && self.demod.llr_scale.is_finite()) {
            return bad("llr_scale must be positive");
        }
        if !(1..=8).contains(&self.refine.block) {
            return bad("refine.block must be 1 to 8");
        }
        if !(1..=9).contains(&self.demod.block) || self.demod.block.is_multiple_of(2) {
            return bad("demod.block must be odd, 1 to 9");
        }
        let f = &self.fano;
        if !(1..=10_000_000).contains(&f.max_cycles_per_bit)
            || !(f.delta > 0.0 && f.delta.is_finite())
            || !(0.0..=1.0).contains(&f.bias)
        {
            return bad("max_cycles_per_bit 1 to 10000000, delta positive, bias 0 to 1");
        }
        if !self.validate.min_snr_db.is_finite() {
            return bad("min_snr_db must be finite");
        }
        if !(1..=4).contains(&self.passes) {
            return bad("passes must be 1 to 4");
        }
        Ok(())
    }
}

impl Default for WsprConfig {
    fn default() -> Self {
        Self::wspr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_are_valid_and_overrides_apply() {
        for name in WSPR_PRESETS {
            let c = WsprConfig::preset(name).expect(name);
            c.check().expect(name);
            assert!(is_wspr_preset(name));
        }
        assert!(!is_wspr_preset("baseline"));
        assert!(WsprConfig::preset("baseline").is_err());
        let c = WsprConfig::wspr()
            .with_overrides(&["fano.max_cycles_per_bit=2000", "refine.kind=none"])
            .expect("overrides");
        assert_eq!(c.fano.max_cycles_per_bit, 2000);
        assert_eq!(c.refine.kind, WsprRefineKind::None);
        assert!(WsprConfig::wspr().with_overrides(&["fano.cycles=1"]).is_err());
        assert!(WsprConfig::wspr().with_overrides(&["passes=0"]).is_err());
        let json = serde_json::to_string(&c).expect("json");
        assert_eq!(serde_json::from_str::<WsprConfig>(&json).expect("parse"), c);
    }
}
