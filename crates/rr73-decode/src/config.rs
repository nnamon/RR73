//! Decoder configuration: which implementation each stage uses and its parameters.
//!
//! A configuration is a named preset plus `key=value` overrides on dotted paths, such as
//! `ldpc.max_iterations=50` or `ldpc.kind=min-sum`. The configuration serialises to JSON,
//! so a bench result records exactly what ran.

use rr73_dsp::WindowKind;
use rr73_ft8::Mode;

pub use crate::osd::OsdSource;
use serde::{Deserialize, Serialize};

/// Names of the built-in presets.
pub const PRESETS: &[&str] = &["baseline", "subtract-3", "subtract-3-osd1", "subtract-3-osd2"];

/// Errors from building a configuration.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ConfigError {
    /// No preset has this name.
    #[error(
        "unknown preset {0:?}; known presets: baseline, subtract-3, subtract-3-osd1, subtract-3-osd2, wspr, wspr-deep"
    )]
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
    /// A priori decoding with the QSO context the caller gives (`crate::ap`). Absent from
    /// results written before it existed.
    #[serde(default)]
    pub ap: ApParams,
    /// SNR estimate. Absent from results written before it existed.
    #[serde(default)]
    pub snr: SnrParams,
    /// Retries of failed candidates with their overlapping neighbours removed (`crate::session`,
    /// experiment 0012). Absent from results written before it existed.
    #[serde(default)]
    pub pairs: PairParams,
}

/// Retries of failed candidates under overlapping signals (experiment 0012). At the end of each
/// pass, each failed candidate with a neighbour gets its block sets again with the neighbours
/// removed from its baseband (`crate::block::Interferer`): failed candidates whose sync stands
/// well above chance, as tones from their hard decisions, and candidates decoded by an earlier
/// retry, as their message's tones. A decode found there passes the same checks as any other,
/// and the next pass subtracts it from the audio.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairParams {
    /// Run the retries (block demodulator and model subtraction only).
    pub enabled: bool,
    /// The fewest FT8 sync symbols on their sent tone (of 21) for a failed candidate to serve
    /// as a hypothesis.
    pub ft8_min_sync: u8,
    /// The same for FT4 (of 16).
    pub ft4_min_sync: u8,
    /// The fewest FT8 sync symbols on their sent tone for a failed candidate to be tried
    /// again under a hypothesis.
    pub ft8_target_min_sync: u8,
    /// The same for FT4.
    pub ft4_target_min_sync: u8,
    /// Most retries per pass, strongest sync first.
    pub max_retries: usize,
    /// Most neighbours removed for one retry (1 to 4).
    pub max_interferers: u8,
    /// Block length (1 to 4 symbols) whose hard decisions give a failed candidate's tones.
    pub block: u8,
}

impl Default for PairParams {
    fn default() -> Self {
        Self {
            enabled: false,
            ft8_min_sync: 12,
            ft4_min_sync: 12,
            ft8_target_min_sync: 7,
            ft4_target_min_sync: 10,
            max_retries: 16,
            max_interferers: 2,
            block: 3,
        }
    }
}

impl PairParams {
    /// The fewest sync symbols for a hypothesis and for a target in `mode`.
    pub fn min_sync(&self, mode: Mode) -> (usize, usize) {
        match mode {
            Mode::Ft8 | Mode::Lq8 => (
                usize::from(self.ft8_min_sync),
                usize::from(self.ft8_target_min_sync),
            ),
            Mode::Ft4 => (
                usize::from(self.ft4_min_sync),
                usize::from(self.ft4_target_min_sync),
            ),
        }
    }
}

/// SNR estimate parameters (`crate::snr`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SnrParams {
    /// Measure each pass's noise floor across the band (`crate::passband`) and follow it at a
    /// receiver's passband edge. Off, the noise counts as flat around each signal.
    #[serde(default)]
    pub passband: bool,
}

/// A priori decoding: when it applies and what it accepts (`crate::ap`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApParams {
    /// Try the hypotheses on candidates that fail to decode, when the context names the
    /// operator's callsign.
    pub enabled: bool,
    /// The QSO hypotheses apply within this distance of the other station's frequency, in Hz.
    pub width_hz: f32,
    /// `my` (the operator's callsign first) applies to candidates anywhere in the band; else
    /// only within `width_hz` of the other station's frequency.
    pub my_anywhere: bool,
    /// `my` away from the other station's frequency uses belief propagation only, without
    /// ordered-statistics decoding, which costs most of its time.
    pub my_anywhere_bp_only: bool,
    /// Most code bits where the channel's hard decision may differ from the codeword of a
    /// `my` decode. It is tried on every candidate, so it takes the tightest limit.
    pub my_max_hard_errors: u32,
    /// Most code bits where the channel's hard decision may differ from the codeword of a
    /// `my_dx` decode.
    pub my_dx_max_hard_errors: u32,
    /// Most code bits where the channel's hard decision may differ from a whole message
    /// (`rrr`, `rr73`, `73`).
    pub whole_max_hard_errors: u32,
    /// Magnitude given to the log-likelihood ratios of known bits.
    pub strength: f32,
    /// Lowest SNR an AP decode may report, in dB.
    pub min_snr_db: f32,
    /// Try `CQ` as the first word on every candidate that fails, with or without a QSO
    /// context (experiment 0013). Its decodes pass the OSD message rule.
    #[serde(default)]
    pub cq: bool,
    /// `cq` uses belief propagation only, without ordered-statistics decoding.
    #[serde(default = "default_true")]
    pub cq_bp_only: bool,
    /// Most code bits where the channel's hard decision may differ from the codeword of a
    /// `cq` decode.
    #[serde(default = "default_cq_max_hard_errors")]
    pub cq_max_hard_errors: u32,
}

fn default_true() -> bool {
    true
}

fn default_cq_max_hard_errors() -> u32 {
    36
}

impl Default for ApParams {
    fn default() -> Self {
        Self {
            enabled: true,
            width_hz: 50.0,
            my_anywhere: true,
            my_anywhere_bp_only: true,
            my_max_hard_errors: 36,
            my_dx_max_hard_errors: 45,
            whole_max_hard_errors: 50,
            strength: 30.0,
            min_snr_db: -30.0,
            cq: false,
            cq_bp_only: true,
            cq_max_hard_errors: 36,
        }
    }
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
    /// Window length in symbols (1 to `freq_osr`), centred in the FFT with zero padding
    /// around it. `None` spans the whole FFT (`freq_osr` symbols), as ft8_lib does.
    #[serde(default)]
    pub window_symbols: Option<usize>,
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
    /// Leave spectrogram frames that overlap digital silence out of the sync score
    /// (`crate::silence`).
    #[serde(default)]
    pub skip_silent_frames: bool,
    /// Lowest score of a candidate whose sync symbols do not all lie inside the slot (a
    /// transmission that starts before the slot or runs past its end), in dB. `None` uses
    /// `min_score_db`.
    #[serde(default)]
    pub partial_min_score_db: Option<f32>,
    /// A lower threshold for FT8 candidates, in dB: those scoring from it up to `min_score_db`
    /// join the list as weak candidates, which need `demod.ft8_weak_min_sync` sync symbols on
    /// their sent tone for the block sets (experiment 0012). `None` keeps `min_score_db`.
    #[serde(default)]
    pub ft8_weak_score_db: Option<f32>,
    /// The same for FT4, with `demod.ft4_weak_min_sync`.
    #[serde(default)]
    pub ft4_weak_score_db: Option<f32>,
}

/// Refinement implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefineKind {
    /// Keep the search grid position.
    None,
    /// Start and frequency from the Costas arrays on a complex baseband of the candidate's
    /// band, and symbol levels read there with a one-symbol window (`crate::refine`).
    Baseband,
}

/// Refinement parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RefineParams {
    /// Implementation.
    pub kind: RefineKind,
    /// Skip a candidate whose refined position repeats one tried in the pass (used by
    /// `baseband`).
    #[serde(default = "yes")]
    pub skip_repeats: bool,
}

fn yes() -> bool {
    true
}

/// Demodulator implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DemodKind {
    /// ft8_lib: per bit, the largest dB magnitude among tones with the bit set minus the
    /// largest among tones with it clear, then scaled to a fixed variance.
    MaxLog,
    /// Noncoherent detection of blocks of symbols on complex tone amplitudes at a refined
    /// start and frequency (`crate::block`, experiment 0008): one set of LLRs per block
    /// length, tried in turn.
    Block,
}

/// Demodulator parameters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DemodParams {
    /// Implementation.
    pub kind: DemodKind,
    /// Variance the 174 LLRs are scaled to (ft8_lib uses 24).
    pub llr_variance: f32,
    /// Erase symbols in spectrogram frames that overlap digital silence and leave them out
    /// of the variance (`crate::silence`).
    #[serde(default)]
    pub skip_silent_frames: bool,
    /// With `block`: try the spectrogram's single-symbol LLRs (`max-log`) first and the block
    /// sets only when they give no message.
    #[serde(default)]
    pub spectrogram_first: bool,
    /// With `block`: block lengths tried in turn on FT8 candidates, 1 to 4 symbols each.
    #[serde(default = "default_ft8_blocks")]
    pub ft8_blocks: Vec<u8>,
    /// With `block`: block lengths tried in turn on FT4 candidates, 1 to 4 symbols each.
    #[serde(default = "default_ft4_blocks")]
    pub ft4_blocks: Vec<u8>,
    /// With `block`: block lengths whose soft bits get belief propagation only, without the
    /// ordered-statistics decoding that `ldpc.kind=bp-osd` adds.
    #[serde(default)]
    pub bp_only_blocks: Vec<u8>,
    /// With `block`: the score each tone sequence gets, `amplitude` or `log`.
    #[serde(default)]
    pub block_score: crate::block::BlockScore,
    /// With `block`: the fewest FT8 sync symbols (of 21) whose strongest tone at the refined
    /// start and frequency is the sent one, for a candidate to get the block sets; 0 tries
    /// every candidate.
    #[serde(default)]
    pub ft8_min_sync: u8,
    /// With `block`: the same for FT4 (of 16 sync symbols).
    #[serde(default)]
    pub ft4_min_sync: u8,
    /// With `block`: more sets of soft bits tried on FT8 candidates after `ft8_blocks`, each a
    /// block length (1 to 4 symbols) and a score, such as `[[3,"normalised"]]`.
    #[serde(default)]
    pub ft8_extra_sets: Vec<(u8, crate::block::BlockScore)>,
    /// With `block`: the same for FT4, after `ft4_blocks`.
    #[serde(default)]
    pub ft4_extra_sets: Vec<(u8, crate::block::BlockScore)>,
    /// With `block`: the fewest FT8 sync symbols on their sent tone (of 21) for a candidate to get
    /// the extra sets; below it only `ft8_blocks` are tried.
    #[serde(default)]
    pub ft8_extra_min_sync: u8,
    /// With `block`: the same for FT4 (of 16).
    #[serde(default)]
    pub ft4_extra_min_sync: u8,
    /// With `block`: the fewest FT8 sync symbols (of 21) for a weak candidate, one that scored
    /// below `search.min_score_db` and joined through `search.ft8_weak_score_db`.
    #[serde(default)]
    pub ft8_weak_min_sync: u8,
    /// With `block`: the same for FT4 (of 16).
    #[serde(default)]
    pub ft4_weak_min_sync: u8,
    /// With `block`: the fewest FT8 sync symbols (of 21) whose sent tone is the strongest on the
    /// search's grid for a weak candidate to get the block demodulator at all; 0 tries every one.
    /// Cheaper than the block demodulator's own gate, which needs a baseband per candidate.
    #[serde(default)]
    pub ft8_weak_grid_sync: u8,
    /// With `block`: the same for FT4 (of 16).
    #[serde(default)]
    pub ft4_weak_grid_sync: u8,
}

fn default_ft8_blocks() -> Vec<u8> {
    vec![1, 2, 3]
}

fn default_ft4_blocks() -> Vec<u8> {
    vec![1, 2, 4]
}

impl DemodParams {
    /// Block lengths tried on candidates of `mode` (empty unless `kind` is `block`).
    pub fn blocks(&self, mode: Mode) -> &[u8] {
        match (self.kind, mode) {
            (DemodKind::MaxLog, _) => &[],
            (DemodKind::Block, Mode::Ft8 | Mode::Lq8) => &self.ft8_blocks,
            (DemodKind::Block, Mode::Ft4) => &self.ft4_blocks,
        }
    }

    /// The sets of soft bits tried on candidates of `mode` after the block lengths of
    /// [`DemodParams::blocks`] (empty unless `kind` is `block`).
    pub fn extra_sets(&self, mode: Mode) -> &[(u8, crate::block::BlockScore)] {
        match (self.kind, mode) {
            (DemodKind::MaxLog, _) => &[],
            (DemodKind::Block, Mode::Ft8 | Mode::Lq8) => &self.ft8_extra_sets,
            (DemodKind::Block, Mode::Ft4) => &self.ft4_extra_sets,
        }
    }

    /// The fewest sync symbols a candidate of `mode` needs for the extra sets.
    pub fn extra_min_sync(&self, mode: Mode) -> usize {
        usize::from(match mode {
            Mode::Ft8 | Mode::Lq8 => self.ft8_extra_min_sync,
            Mode::Ft4 => self.ft4_extra_min_sync,
        })
    }

    /// The fewest sync symbols a candidate of `mode` needs for the block sets.
    pub fn min_sync(&self, mode: Mode) -> usize {
        usize::from(match mode {
            Mode::Ft8 | Mode::Lq8 => self.ft8_min_sync,
            Mode::Ft4 => self.ft4_min_sync,
        })
    }

    /// The fewest sync symbols a weak candidate of `mode` needs for the block sets.
    pub fn weak_min_sync(&self, mode: Mode) -> usize {
        usize::from(match mode {
            Mode::Ft8 | Mode::Lq8 => self.ft8_weak_min_sync,
            Mode::Ft4 => self.ft4_weak_min_sync,
        })
    }

    /// The fewest sync symbols on the search's grid a weak candidate of `mode` needs for the
    /// block demodulator.
    pub fn weak_grid_sync(&self, mode: Mode) -> usize {
        usize::from(match mode {
            Mode::Ft8 | Mode::Lq8 => self.ft8_weak_grid_sync,
            Mode::Ft4 => self.ft4_weak_grid_sync,
        })
    }

    /// `true` when the spectrogram's single-symbol LLRs are tried.
    pub fn uses_spectrogram(&self) -> bool {
        self.kind == DemodKind::MaxLog || self.spectrogram_first
    }
}

/// LDPC decoder implementations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LdpcKind {
    /// Sum-product belief propagation with ft8_lib's rational tanh and atanh.
    SumProduct,
    /// Normalised min-sum.
    MinSum,
    /// Sum-product, then ordered-statistics decoding when it fails.
    BpOsd,
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
    /// OSD order: 0, 1 or 2 flipped information positions (used by `bp-osd`).
    pub osd_order: u8,
    /// Least reliable information positions OSD flips, 1 to 91 (used by `bp-osd`).
    pub osd_window: usize,
    /// LLRs that order OSD's search (used by `bp-osd`).
    pub osd_source: OsdSource,
    /// Most code bits an OSD codeword may change from the channel hard decisions.
    pub osd_max_hard_errors: u32,
    /// Largest reliability-weighted distance of an OSD codeword, as a fraction of the total
    /// reliability.
    pub osd_max_distance: f32,
    /// Count erased bits (symbols outside the audio) as hard errors of OSD codewords.
    #[serde(default)]
    pub osd_erasures_as_errors: bool,
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
    /// Which messages an OSD codeword may carry.
    pub osd_messages: OsdMessages,
    /// Lowest SNR an OSD decode may report, in dB; codewords below it are rejected.
    pub osd_min_snr_db: f32,
    /// The same floor for FT4 slots, in dB, where it differs: FT4 decodes need more SNR than
    /// FT8. `None` uses `osd_min_snr_db`.
    pub osd_ft4_min_snr_db: Option<f32>,
}

impl ValidateParams {
    /// Lowest SNR an OSD decode may report in `mode`, in dB.
    pub fn osd_floor_db(&self, mode: Mode) -> f32 {
        match mode {
            Mode::Ft4 => self.osd_ft4_min_snr_db.unwrap_or(self.osd_min_snr_db),
            Mode::Ft8 | Mode::Lq8 => self.osd_min_snr_db,
        }
    }
}

/// Messages accepted from OSD codewords. Codewords from belief propagation are not checked.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OsdMessages {
    /// Any message that unpacks.
    Any,
    /// Standard messages (types 1 and 2) whose callsigns are sent in full and could have been
    /// issued: not starting with Q or 0, and starting with 1 only as 1A or 1S.
    Standard,
    /// As `standard`, and at least one callsign already known from other decodes.
    StandardKnown,
    /// As `standard`, without `R` before a locator, a form of VHF contests that HF traffic
    /// does not send. About half of random type 1 and 2 payloads carry it (experiment 0013).
    StandardHf,
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
    /// The lowest search score a candidate of `mode` may have, in dB: `search.min_score_db`, or
    /// the weak candidates' lower threshold.
    pub fn score_floor_db(&self, mode: Mode) -> f32 {
        let weak = match mode {
            Mode::Ft8 | Mode::Lq8 => self.search.ft8_weak_score_db,
            Mode::Ft4 => self.search.ft4_weak_score_db,
        };
        weak.map_or(self.search.min_score_db, |w| w.min(self.search.min_score_db))
    }

    /// The fewest sync symbols on their sent tone a candidate of `mode` with search score
    /// `score_db` needs for the block sets: `demod.ft8_min_sync` or `demod.ft4_min_sync`, or for
    /// a weak candidate (below `search.min_score_db`) the stricter of that and its own gate.
    pub fn block_min_sync(&self, mode: Mode, score_db: f32) -> usize {
        let base = self.demod.min_sync(mode);
        if score_db < self.search.min_score_db {
            base.max(self.demod.weak_min_sync(mode))
        } else {
            base
        }
    }

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
                window_symbols: None,
            },
            search: SearchParams {
                kind: SearchKind::Costas,
                max_candidates: 140,
                min_score_db: 5.0,
                ft8_dt_min_s: -2.3,
                ft8_dt_max_s: 2.5,
                ft4_dt_min_s: -1.0,
                ft4_dt_max_s: 1.0,
                skip_silent_frames: false,
                partial_min_score_db: None,
                ft8_weak_score_db: None,
                ft4_weak_score_db: None,
            },
            refine: RefineParams {
                kind: RefineKind::None,
                skip_repeats: true,
            },
            demod: DemodParams {
                kind: DemodKind::MaxLog,
                llr_variance: 24.0,
                skip_silent_frames: false,
                spectrogram_first: false,
                ft8_blocks: default_ft8_blocks(),
                ft4_blocks: default_ft4_blocks(),
                bp_only_blocks: Vec::new(),
                block_score: crate::block::BlockScore::Amplitude,
                ft8_min_sync: 0,
                ft4_min_sync: 0,
                ft8_extra_sets: Vec::new(),
                ft4_extra_sets: Vec::new(),
                ft8_extra_min_sync: 0,
                ft4_extra_min_sync: 0,
                ft8_weak_min_sync: 0,
                ft4_weak_min_sync: 0,
                ft8_weak_grid_sync: 0,
                ft4_weak_grid_sync: 0,
            },
            ldpc: LdpcParams {
                kind: LdpcKind::SumProduct,
                max_iterations: 25,
                min_sum_scale: 0.75,
                osd_order: 2,
                osd_window: 40,
                osd_source: OsdSource::Channel,
                osd_max_hard_errors: 174,
                osd_max_distance: 1.0,
                osd_erasures_as_errors: false,
            },
            validate: ValidateParams {
                kind: ValidateKind::CrcUnpack,
                osd_messages: OsdMessages::Standard,
                osd_min_snr_db: -24.0,
                osd_ft4_min_snr_db: None,
            },
            subtract: SubtractParams {
                kind: SubtractKind::None,
                smooth_s: 0.16,
                refine: false,
            },
            passes: 1,
            ap: ApParams::default(),
            snr: SnrParams::default(),
            pairs: PairParams::default(),
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

    /// `subtract-3` with ordered-statistics decoding of `order` (1 or 2) after failed belief
    /// propagation: reliabilities from the channel LLRs, flips among the `window` least
    /// reliable information positions, at most 30 hard errors, a weighted distance of at
    /// most 0.07 (erased bits of a partial slot count as hard errors), an SNR of at least
    /// -24 dB (-19 dB in FT4), and OSD messages limited to plausible standard messages. The
    /// limits come from `docs/experiments/0002-osd.md` and `docs/experiments/0003-anytime.md`.
    fn subtract_3_osd(order: u8, window: usize) -> Self {
        let mut c = Self::subtract_3();
        c.ldpc.kind = LdpcKind::BpOsd;
        c.ldpc.osd_order = order;
        c.ldpc.osd_window = window;
        c.ldpc.osd_source = OsdSource::Channel;
        c.ldpc.osd_max_hard_errors = 30;
        c.ldpc.osd_max_distance = 0.07;
        c.ldpc.osd_erasures_as_errors = true;
        c.validate.osd_messages = OsdMessages::Standard;
        c.validate.osd_ft4_min_snr_db = Some(-19.0);
        c
    }

    /// Soft bits from blocks of 1 and 3 FT8 symbols or 1 and 4 FT4 symbols, for candidates with
    /// at least 5 of 21 (FT8) or 7 of 16 (FT4) sync symbols on their sent tone (experiment 0008).
    fn with_block_soft_bits(mut self) -> Self {
        self.demod.kind = DemodKind::Block;
        self.demod.ft8_blocks = vec![1, 3];
        self.demod.ft4_blocks = vec![1, 4];
        self.demod.ft8_min_sync = 5;
        self.demod.ft4_min_sync = 7;
        self
    }

    /// A search to DT 4.5 s in FT8 and 1.5 s in FT4, past the 4 s and 1.25 s by which the
    /// sequencer may start a reply late (`LATE_S`), with a 6 dB sync threshold for positions
    /// whose Costas arrays do not all lie inside the slot (experiment 0010).
    fn with_late_starts(mut self) -> Self {
        self.search.ft8_dt_max_s = 4.5;
        self.search.ft4_dt_max_s = 1.5;
        self.search.partial_min_score_db = Some(6.0);
        self
    }

    /// The SNR estimate follows the receiver's passband edge, and the search covers tones to
    /// 3200 Hz, past the 3000 Hz edge of the recordings and the skirt beyond it (experiment
    /// 0011).
    fn with_passband_edge(mut self) -> Self {
        self.snr.passband = true;
        self.spectrogram.freq_max_hz = 3200.0;
        self
    }

    /// One more set of soft bits, 3 FT8 or 4 FT4 symbols scored normalised, for candidates with
    /// at least 9 sync symbols on their sent tone (experiment 0011).
    fn with_normalised_set(mut self) -> Self {
        self.demod.ft8_extra_sets = vec![(3, crate::block::BlockScore::Normalised)];
        self.demod.ft4_extra_sets = vec![(4, crate::block::BlockScore::Normalised)];
        self.demod.ft8_extra_min_sync = 9;
        self.demod.ft4_extra_min_sync = 9;
        self
    }

    /// Failed candidates retried with their overlapping neighbours removed, and FT8 candidates
    /// scoring 4 to 5 dB admitted when 8 of their 21 sync symbols have their sent tone strongest
    /// on the search grid and on the refined baseband (experiment 0012).
    fn with_overlap_retries(mut self) -> Self {
        self.pairs.enabled = true;
        self.search.ft8_weak_score_db = Some(4.0);
        self.demod.ft8_weak_grid_sync = 8;
        self.demod.ft8_weak_min_sync = 8;
        self
    }

    /// OSD messages without `R` before a locator, and `CQ` tried a priori with belief
    /// propagation on every FT8 and FT4 candidate that fails (experiment 0013).
    fn with_hf_rules(mut self) -> Self {
        self.validate.osd_messages = OsdMessages::StandardHf;
        self.ap.cq = true;
        self
    }

    /// The preset called `name`.
    pub fn preset(name: &str) -> Result<Self, ConfigError> {
        match name {
            "baseline" => Ok(Self::baseline()),
            "subtract-3" => Ok(Self::subtract_3()),
            "subtract-3-osd1" => Ok(Self::subtract_3_osd(1, 91)),
            "subtract-3-osd2" => Ok(Self::subtract_3_osd(2, 40)
                .with_block_soft_bits()
                .with_late_starts()
                .with_passband_edge()
                .with_normalised_set()
                .with_overlap_retries()
                .with_hf_rules()),
            other => Err(ConfigError::UnknownPreset(other.to_string())),
        }
    }

    /// Applies `key=value` overrides in order. Keys are dotted paths into the JSON form of
    /// the configuration. Values parse as JSON when they can (numbers, booleans) and as
    /// strings otherwise (`ldpc.kind=min-sum`).
    pub fn with_overrides<S: AsRef<str>>(&self, overrides: &[S]) -> Result<Self, ConfigError> {
        let value = serde_json::to_value(self).map_err(|e| ConfigError::Invalid(e.to_string()))?;
        let value = apply_overrides(value, overrides)?;
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
        if sp.window_symbols.is_some_and(|w| w == 0 || w > sp.freq_osr) {
            return bad("window_symbols must be 1 to freq_osr");
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
        if s.partial_min_score_db.is_some_and(|v| !v.is_finite()) {
            return bad("partial_min_score_db must be finite");
        }
        if !(self.demod.llr_variance > 0.0 && self.demod.llr_variance.is_finite()) {
            return bad("llr_variance must be positive");
        }
        let extra = [&self.demod.ft8_extra_sets, &self.demod.ft4_extra_sets];
        if extra.iter().any(|s| {
            s.len() > 8
                || s.iter()
                    .any(|&(n, _)| n == 0 || usize::from(n) > crate::block::MAX_BLOCK)
        }) {
            return bad(
                "demod.ft8_extra_sets and demod.ft4_extra_sets must list at most 8 sets of 1 to 4 symbols",
            );
        }
        let blocks = [&self.demod.ft8_blocks, &self.demod.ft4_blocks];
        if blocks.iter().any(|b| {
            b.len() > 8
                || b.iter()
                    .any(|&n| n == 0 || usize::from(n) > crate::block::MAX_BLOCK)
                || (self.demod.kind == DemodKind::Block && b.is_empty())
        }) {
            return bad(
                "demod.ft8_blocks and demod.ft4_blocks must list 1 to 8 block lengths of 1 to 4 symbols",
            );
        }
        if self.demod.ft8_extra_min_sync > 21 || self.demod.ft4_extra_min_sync > 16 {
            return bad(
                "demod.ft8_extra_min_sync must be at most 21 and demod.ft4_extra_min_sync at most 16",
            );
        }
        if self.demod.ft8_min_sync > 21 || self.demod.ft4_min_sync > 16 {
            return bad("demod.ft8_min_sync must be at most 21 and demod.ft4_min_sync at most 16");
        }
        if self.demod.ft8_weak_min_sync > 21
            || self.demod.ft4_weak_min_sync > 16
            || self.demod.ft8_weak_grid_sync > 21
            || self.demod.ft4_weak_grid_sync > 16
            || [self.search.ft8_weak_score_db, self.search.ft4_weak_score_db]
                .iter()
                .any(|v| v.is_some_and(|v| !v.is_finite()))
        {
            return bad(
                "demod.ft8_weak_min_sync must be at most 21, demod.ft4_weak_min_sync at most 16 and the weak score thresholds finite",
            );
        }
        if self.ldpc.max_iterations > 10_000
            || !(self.ldpc.min_sum_scale > 0.0 && self.ldpc.min_sum_scale <= 1.0)
        {
            return bad("max_iterations must be at most 10000 and min_sum_scale in (0, 1]");
        }
        let l = &self.ldpc;
        if l.osd_order > 2
            || !(1..=91).contains(&l.osd_window)
            || l.osd_max_distance.is_nan()
            || l.osd_max_distance < 0.0
        {
            return bad("osd_order must be 0 to 2, osd_window 1 to 91 and osd_max_distance at least 0");
        }
        if !(self.subtract.smooth_s > 0.0 && self.subtract.smooth_s <= 15.0) {
            return bad("subtract.smooth_s must be in (0, 15] s");
        }
        if !(1..=8).contains(&self.passes) {
            return bad("passes must be 1 to 8");
        }
        let p = &self.pairs;
        if p.ft8_min_sync > 21
            || p.ft8_target_min_sync > 21
            || p.ft4_min_sync > 16
            || p.ft4_target_min_sync > 16
            || p.block == 0
            || usize::from(p.block) > crate::block::MAX_BLOCK
            || p.max_retries > 256
            || !(1..=4).contains(&p.max_interferers)
        {
            return bad(
                "pairs: sync limits at most 21 (FT8) and 16 (FT4), block 1 to 4, at most 256 retries, 1 to 4 interferers",
            );
        }
        let a = &self.ap;
        if !(a.width_hz >= 0.0 && a.strength > 0.0 && a.strength.is_finite() && a.min_snr_db.is_finite())
            || a.my_max_hard_errors > 174
            || a.my_dx_max_hard_errors > 174
            || a.whole_max_hard_errors > 174
        {
            return bad(
                "ap.width_hz must be at least 0, ap.strength positive and the hard-error limits at most 174",
            );
        }
        Ok(())
    }
}

/// Applies `key=value` overrides to the JSON form of a configuration. Keys are dotted paths;
/// values parse as JSON when they can and as strings otherwise.
pub(crate) fn apply_overrides<S: AsRef<str>>(
    mut value: serde_json::Value,
    overrides: &[S],
) -> Result<serde_json::Value, ConfigError> {
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
    Ok(value)
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
    fn the_preset_follows_the_passband_edge_and_tries_a_normalised_set() {
        let c = DecoderConfig::preset("subtract-3-osd2").expect("preset");
        assert!(c.snr.passband);
        assert_eq!(c.spectrogram.freq_max_hz, 3200.0);
        assert_eq!(
            c.demod.extra_sets(Mode::Ft8),
            &[(3, crate::block::BlockScore::Normalised)]
        );
        assert_eq!(
            c.demod.extra_sets(Mode::Ft4),
            &[(4, crate::block::BlockScore::Normalised)]
        );
        assert_eq!(
            (
                c.demod.extra_min_sync(Mode::Ft8),
                c.demod.extra_min_sync(Mode::Ft4)
            ),
            (9, 9)
        );
        // Retries of overlapping candidates and FT8's weak candidates (experiment 0012).
        assert!(c.pairs.enabled);
        assert_eq!(
            (c.score_floor_db(Mode::Ft8), c.score_floor_db(Mode::Ft4)),
            (4.0, 5.0)
        );
        assert_eq!(c.block_min_sync(Mode::Ft8, 4.5), 8);
        assert_eq!(c.demod.weak_grid_sync(Mode::Ft8), 8);
        // The research reference keeps the ft8_lib method.
        let b = DecoderConfig::baseline();
        assert!(!b.snr.passband && b.spectrogram.freq_max_hz == 3000.0);
        assert!(!b.pairs.enabled && b.score_floor_db(Mode::Ft8) == 5.0);
    }

    #[test]
    fn weak_candidates_take_their_own_gate_and_pairs_parse() {
        let base = DecoderConfig::baseline();
        assert_eq!(base.score_floor_db(Mode::Ft8), 5.0);
        let c = base
            .with_overrides(&[
                "demod.kind=block",
                "demod.ft8_min_sync=5",
                "search.ft8_weak_score_db=4",
                "search.ft4_weak_score_db=3.5",
                "demod.ft8_weak_min_sync=8",
                "demod.ft4_weak_min_sync=9",
            ])
            .expect("weak gate");
        assert_eq!(
            (c.score_floor_db(Mode::Ft8), c.score_floor_db(Mode::Ft4)),
            (4.0, 3.5)
        );
        assert_eq!(c.block_min_sync(Mode::Ft8, 4.5), 8);
        assert_eq!(c.block_min_sync(Mode::Ft8, 5.0), 5);
        assert_eq!(c.block_min_sync(Mode::Ft4, 4.9), 9);
        // A stage with a lower threshold of its own, as stage 3, has no weak candidates.
        let c = c.with_overrides(&["search.min_score_db=2"]).expect("stage 3");
        assert_eq!(c.score_floor_db(Mode::Ft8), 2.0);
        assert_eq!(c.block_min_sync(Mode::Ft8, 2.5), 5);
        // The weak gate never loosens the gate every candidate takes.
        let c = c
            .with_overrides(&["search.min_score_db=5", "demod.ft8_weak_min_sync=3"])
            .expect("weak gate");
        assert_eq!(c.block_min_sync(Mode::Ft8, 4.5), 5);
        let p = base
            .with_overrides(&[
                "pairs.enabled=true",
                "pairs.max_interferers=4",
                "pairs.ft4_min_sync=11",
            ])
            .expect("pairs");
        assert!(p.pairs.enabled);
        assert_eq!(p.pairs.min_sync(Mode::Ft4), (11, 10));
        for bad in [
            "search.ft8_weak_score_db=NaN",
            "demod.ft8_weak_min_sync=22",
            "demod.ft4_weak_min_sync=17",
            "pairs.ft8_min_sync=22",
            "pairs.ft4_target_min_sync=17",
            "pairs.block=0",
            "pairs.block=5",
            "pairs.max_interferers=0",
            "pairs.max_interferers=5",
            "pairs.max_retries=257",
        ] {
            assert!(
                matches!(base.with_overrides(&[bad]), Err(ConfigError::Invalid(_))),
                "{bad}"
            );
        }
    }

    #[test]
    fn ft4_has_its_own_osd_floor() {
        let c = DecoderConfig::preset("subtract-3-osd2").expect("preset");
        assert_eq!(c.validate.osd_floor_db(Mode::Ft8), -24.0);
        assert_eq!(c.validate.osd_floor_db(Mode::Ft4), -19.0);
        let base = DecoderConfig::baseline();
        assert_eq!(
            base.validate.osd_floor_db(Mode::Ft4),
            base.validate.osd_min_snr_db
        );
        let o = base
            .with_overrides(&["validate.osd_ft4_min_snr_db=-20"])
            .expect("override");
        assert_eq!(o.validate.osd_floor_db(Mode::Ft4), -20.0);
        assert_eq!(o.validate.osd_floor_db(Mode::Ft8), -24.0);
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
        let padded = base
            .with_overrides(&["spectrogram.freq_osr=4", "spectrogram.window_symbols=2"])
            .expect("padded window");
        assert_eq!(padded.spectrogram.window_symbols, Some(2));
        let block = base
            .with_overrides(&[
                "demod.kind=block",
                "demod.ft8_blocks=[1,3]",
                "demod.spectrogram_first=true",
            ])
            .expect("block demodulator");
        assert_eq!(block.demod.blocks(Mode::Ft8), &[1, 3]);
        assert_eq!(block.demod.blocks(Mode::Ft4), &[1, 2, 4]);
        assert_eq!(block.demod.min_sync(Mode::Ft8), 0);
        assert!(block.demod.uses_spectrogram());
        assert!(base.demod.blocks(Mode::Ft8).is_empty());
        for bad in [
            "demod.ft8_blocks=[0]",
            "demod.ft4_blocks=[5]",
            "demod.ft8_blocks=[]",
            "demod.ft8_blocks=3",
            "demod.ft8_min_sync=22",
            "demod.ft4_min_sync=17",
        ] {
            assert!(
                matches!(
                    base.with_overrides(&["demod.kind=block", bad]),
                    Err(ConfigError::Invalid(_))
                ),
                "{bad}"
            );
        }
        let extra = base
            .with_overrides(&[
                "demod.kind=block",
                r#"demod.ft8_extra_sets=[[1,"normalised"],[3,"power"]]"#,
                "demod.ft8_extra_min_sync=9",
            ])
            .expect("extra sets");
        assert_eq!(
            extra.demod.extra_sets(Mode::Ft8),
            &[
                (1, crate::block::BlockScore::Normalised),
                (3, crate::block::BlockScore::Power)
            ]
        );
        assert!(extra.demod.extra_sets(Mode::Ft4).is_empty());
        assert_eq!(extra.demod.extra_min_sync(Mode::Ft8), 9);
        assert!(base.demod.extra_sets(Mode::Ft8).is_empty());
        for bad in [
            r#"demod.ft8_extra_sets=[[0,"normalised"]]"#,
            r#"demod.ft4_extra_sets=[[5,"amplitude"]]"#,
            r#"demod.ft8_extra_sets=[[1,"loud"]]"#,
            "demod.ft8_extra_min_sync=22",
            "demod.ft4_extra_min_sync=17",
        ] {
            assert!(
                matches!(
                    base.with_overrides(&["demod.kind=block", bad]),
                    Err(ConfigError::Invalid(_))
                ),
                "{bad}"
            );
        }
        // Results written before the block demodulator existed still parse.
        let mut old = serde_json::to_value(&base).expect("json");
        let demod = old["demod"].as_object_mut().expect("demod");
        for key in [
            "spectrogram_first",
            "ft8_blocks",
            "ft4_blocks",
            "bp_only_blocks",
            "block_score",
            "ft8_min_sync",
            "ft4_min_sync",
            "ft8_extra_sets",
            "ft4_extra_sets",
            "ft8_extra_min_sync",
            "ft4_extra_min_sync",
            "ft8_weak_min_sync",
            "ft4_weak_min_sync",
            "ft8_weak_grid_sync",
            "ft4_weak_grid_sync",
        ] {
            demod.remove(key);
        }
        old.as_object_mut().expect("config").remove("pairs");
        let search = old["search"].as_object_mut().expect("search");
        search.remove("ft8_weak_score_db");
        search.remove("ft4_weak_score_db");
        let back: DecoderConfig = serde_json::from_value(old).expect("old config");
        assert_eq!(back, base);
        for bad in ["spectrogram.window_symbols=0", "spectrogram.window_symbols=3"] {
            assert!(
                matches!(base.with_overrides(&[bad]), Err(ConfigError::Invalid(_))),
                "{bad}"
            );
        }
    }
}
