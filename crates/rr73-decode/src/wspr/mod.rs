//! WSPR decoder pipeline. Each stage is a trait with named implementations, chosen by
//! [`WsprConfig`], as in the FT8 pipeline.
//!
//! ```text
//! 120 s of 12 kHz audio
//!   -> Downconverter      one FFT, 375 Hz complex baseband around 1500 Hz
//!   -> SymbolSpectrogram  one-symbol rectangular window, quarter-symbol hop, 0.73 Hz bins
//!   -> WsprSearch         sync correlation over frequency, start and drift -> candidates
//!   -> WsprRefine         start, frequency and drift from tone correlations
//!   -> WsprDemod          tone powers to log-likelihood ratios         -> [f32; 162]
//!   -> SequentialDecoder  Fano algorithm over the K = 32 code           -> 81 bits
//!   -> WsprValidator      unpack, plausibility, re-encoding, SNR
//!   -> subtraction of each decode from the baseband, next pass
//!   -> WsprReport
//! ```
//!
//! Conventions: audio at 12 kHz with sample 0 at the slot start (an even UTC minute);
//! frequencies are signal centres in Hz of audio (midway between tones 1 and 2); DT in
//! seconds from the nominal start, 1 s into the slot; drift in Hz per second; SNR in dB in
//! 2500 Hz. The stage timings and counters reuse the FT8 report types: `ldpc_s`,
//! `ldpc_attempts` and `ldpc_converged` count the sequential decoder.

pub mod baseband;
pub mod config;
pub mod demod;
pub mod fano;
pub mod refine;
pub mod search;
pub mod validate;

use rr73_dsp::FftPlans;
use rr73_dsp::fft::Complex32;
use rr73_wspr::code::{CODE_BITS, INPUT_BITS, deinterleave};
use rr73_wspr::{CallsignHashes, Message, SYMBOLS, TRANSMISSION_S};
use serde::Serialize;

pub use config::{WSPR_PRESETS, WsprConfig, is_wspr_preset};
pub use search::WsprCandidate;

use crate::clock::Stopwatch;
use crate::report::{DecodeStats, StageTimings};
use baseband::{Downconverter, RATE_HZ, SYMBOL_SAMPLES, SymbolSpectrogram};
use config::{FanoKind, WsprDemodKind, WsprRefineKind, WsprSearchKind, WsprValidateKind};
use demod::{BlockDemod, NoncoherentDemod, SoftSymbols, WsprDemod};
use fano::{Fano, SequentialDecoder};
use refine::{CoherentRefine, GridRefine, NoRefine, ToneCorrelator, ToneCorrs, TonePowers, WsprRefine};
use search::{SearchScratch, SyncSearch, WsprSearch};
use validate::{UnpackValidator, WsprRejection, WsprValidator};

/// After subtraction, candidates within this distance (Hz) and 1 s of an earlier pass's
/// decode are skipped: the residue of a subtracted signal decoded once as a false message
/// (`docs/experiments/0004-wspr.md`).
pub const SUBTRACTED_GUARD_HZ: f32 = 2.0;

/// One decoded WSPR message.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct WsprDecode {
    /// Message text as WSJT-X shows it: `K1ABC FN42 37`, `PJ4/K1ABC 33`, `<K1ABC> FN42AB 37`.
    pub text: String,
    /// The unpacked message.
    #[serde(skip)]
    pub message: Message,
    /// Signal centre (midway between tones 1 and 2), in Hz of audio.
    pub freq_hz: f32,
    /// Start of the transmission minus the nominal start (1 s into the slot), in seconds.
    pub dt_s: f32,
    /// Frequency drift, in Hz per second.
    pub drift_hz_per_s: f32,
    /// Signal-to-noise ratio in 2500 Hz, in dB.
    pub snr_db: f32,
    /// Sync score of the refined candidate, in standard deviations above noise.
    pub score: f32,
    /// Fano decoder steps taken.
    pub cycles: u32,
    /// Path metric of the decoded path, in bits.
    pub metric: f32,
    /// Data bits on which the re-encoded message disagrees with the hard decisions (of 162).
    pub hard_errors: u32,
    /// Decoding pass that found it, from 1.
    pub pass: u32,
}

/// Everything one call to [`decode_wspr`] returns.
#[derive(Clone, Debug, PartialEq)]
pub struct WsprReport {
    /// Decodes in the order found: by pass, then by candidate score.
    pub decodes: Vec<WsprDecode>,
    /// Counters. `ldpc_attempts` and `ldpc_converged` count Fano runs and decoded paths;
    /// `implausible` counts paths rejected by the plausibility, hard-error or SNR checks;
    /// `duplicates` counts candidates on a signal already decoded and repeated messages.
    pub stats: DecodeStats,
    /// Per-stage wall time. `spectrogram_s` includes downconversion; `ldpc_s` is the Fano
    /// decoder.
    pub timings: StageTimings,
}

/// The stage implementations for one configuration.
pub struct WsprPipeline {
    /// Candidate search.
    pub search: Box<dyn WsprSearch>,
    /// Refinement.
    pub refine: Box<dyn WsprRefine>,
    /// Demodulators, tried in order until one gives a valid message.
    pub demods: Vec<Box<dyn WsprDemod>>,
    /// Sequential decoder.
    pub decoder: Box<dyn SequentialDecoder>,
    /// Validator.
    pub validator: Box<dyn WsprValidator>,
}

impl std::fmt::Debug for WsprPipeline {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WsprPipeline")
            .field("search", &self.search.name())
            .field("refine", &self.refine.name())
            .field(
                "demods",
                &self.demods.iter().map(|d| d.name()).collect::<Vec<_>>(),
            )
            .field("decoder", &self.decoder.name())
            .field("validator", &self.validator.name())
            .finish()
    }
}

/// State kept between decodes: callsign hashes for type 3 messages and reusable buffers.
/// One context per thread; reuse it across slots.
pub struct WsprContext {
    /// Callsigns seen in full, used to resolve type 3 messages. Decoding adds to it.
    pub hashes: CallsignHashes,
    ws: Workspace,
}

impl Default for WsprContext {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for WsprContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WsprContext")
            .field("hashes", &self.hashes.len())
            .finish_non_exhaustive()
    }
}

impl WsprContext {
    /// A context with an empty hash table.
    pub fn new() -> Self {
        Self {
            hashes: CallsignHashes::new(),
            ws: Workspace::default(),
        }
    }
}

struct Workspace {
    plans: FftPlans,
    down: Downconverter,
    bb: Vec<Complex32>,
    spec: SymbolSpectrogram,
    buf: Vec<Complex32>,
    scratch: Vec<Complex32>,
    search: SearchScratch,
    candidates: Vec<WsprCandidate>,
    corr: ToneCorrelator,
    powers: Box<TonePowers>,
    corrs: Box<ToneCorrs>,
    soft: SoftSymbols,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            plans: FftPlans::new(),
            down: Downconverter::default(),
            bb: Vec::new(),
            spec: SymbolSpectrogram::default(),
            buf: Vec::new(),
            scratch: Vec::new(),
            search: SearchScratch::default(),
            candidates: Vec::new(),
            corr: ToneCorrelator::default(),
            powers: Box::new([[0.0; 4]; SYMBOLS]),
            corrs: Box::new([[Complex32::new(0.0, 0.0); 4]; SYMBOLS]),
            soft: SoftSymbols::default(),
        }
    }
}

impl WsprPipeline {
    /// Builds the stages a configuration names.
    pub fn from_config(config: &WsprConfig) -> Self {
        let search: Box<dyn WsprSearch> = match config.search.kind {
            WsprSearchKind::Sync => Box::new(SyncSearch {
                params: config.search.clone(),
            }),
        };
        let refine: Box<dyn WsprRefine> = match config.refine.kind {
            WsprRefineKind::None => Box::new(NoRefine),
            WsprRefineKind::Grid => Box::new(GridRefine),
            WsprRefineKind::Coherent => Box::new(CoherentRefine {
                block: config.refine.block,
            }),
        };
        let demods: Vec<Box<dyn WsprDemod>> = match config.demod.kind {
            WsprDemodKind::Noncoherent => vec![Box::new(NoncoherentDemod {
                llr_scale: config.demod.llr_scale,
            })],
            WsprDemodKind::Block => config
                .demod
                .blocks
                .iter()
                .map(|&block| {
                    Box::new(BlockDemod {
                        block,
                        llr_scale: config.demod.llr_scale,
                    }) as Box<dyn WsprDemod>
                })
                .collect(),
        };
        let decoder: Box<dyn SequentialDecoder> = match config.fano.kind {
            FanoKind::Fano => Box::new(Fano {
                max_cycles_per_bit: config.fano.max_cycles_per_bit,
                delta: config.fano.delta,
                bias: config.fano.bias,
            }),
        };
        let validator: Box<dyn WsprValidator> = match config.validate.kind {
            WsprValidateKind::Unpack => Box::new(UnpackValidator {
                max_hard_errors: config.validate.max_hard_errors,
                min_snr_db: config.validate.min_snr_db,
            }),
        };
        Self {
            search,
            refine,
            demods,
            decoder,
            validator,
        }
    }

    /// Decodes one 120 s slot of 12 kHz audio in up to `passes` passes, skipping candidates
    /// within `guard_hz` and 1 s of a decode.
    pub fn run(&self, samples: &[f32], passes: u32, guard_hz: f32, ctx: &mut WsprContext) -> WsprReport {
        let total = Stopwatch::start();
        let mut stats = DecodeStats::default();
        let mut timings = StageTimings::default();
        let mut decodes: Vec<WsprDecode> = Vec::new();
        let WsprContext { hashes, ws } = ctx;

        let sw = Stopwatch::start();
        ws.down.run(samples, &mut ws.plans, &mut ws.bb);
        timings.spectrogram_s += sw.elapsed_s();

        let mut bits = [0u8; INPUT_BITS];
        for pass in 1..=passes.max(1) {
            let sw = Stopwatch::start();
            ws.spec
                .compute(&ws.bb, &mut ws.plans, &mut ws.buf, &mut ws.scratch);
            timings.spectrogram_s += sw.elapsed_s();

            let sw = Stopwatch::start();
            self.search.search(&ws.spec, &mut ws.candidates, &mut ws.search);
            timings.search_s += sw.elapsed_s();
            stats.candidates += ws.candidates.len() as u32;

            let pass_start = decodes.len();
            let mut found: Vec<(WsprCandidate, [u8; SYMBOLS])> = Vec::new();
            for &c in ws.candidates.iter() {
                // A candidate on a signal already decoded in this slot.
                // Decodes of this pass are still in the audio, so candidates near them in
                // frequency, at any start, are their sidelobes. Earlier passes' decodes are
                // subtracted; what remains within a tone and a half of them is residue.
                let near = decodes.iter().enumerate().any(|(n, d)| {
                    let df = (d.freq_hz - c.centre_hz()).abs();
                    if n >= pass_start {
                        df < guard_hz
                    } else {
                        df < SUBTRACTED_GUARD_HZ && (d.dt_s - c.dt_s()).abs() < 1.0
                    }
                });
                if near {
                    stats.duplicates += 1;
                    continue;
                }
                let mut cand = c;
                let sw = Stopwatch::start();
                self.refine
                    .refine(&ws.corr, &ws.bb, &mut cand, &mut ws.powers, &mut ws.corrs);
                timings.refine_s += sw.elapsed_s();

                let sw = Stopwatch::start();
                ws.corr.correlations(&ws.bb, &cand, &mut ws.corrs, &mut ws.powers);
                timings.demod_s += sw.elapsed_s();
                // Each demodulator in turn until one gives a valid message: long blocks win
                // on phase-stable signals, single symbols on signals whose phase wanders.
                for demod in &self.demods {
                    let sw = Stopwatch::start();
                    demod.soft(&ws.corrs, &ws.powers, &mut ws.soft);
                    let llr_code: [f32; CODE_BITS] = deinterleave(&ws.soft.llr);
                    timings.demod_s += sw.elapsed_s();

                    let sw = Stopwatch::start();
                    stats.ldpc_attempts += 1;
                    let outcome = self.decoder.decode(&llr_code, &mut bits);
                    timings.ldpc_s += sw.elapsed_s();
                    if !outcome.decoded {
                        continue;
                    }
                    stats.ldpc_converged += 1;

                    let sw = Stopwatch::start();
                    let valid = match self.validator.validate(&bits, &ws.powers, &ws.soft, hashes) {
                        Ok(v) => v,
                        Err(r) => {
                            match r {
                                WsprRejection::Unpack => stats.unpack_failures += 1,
                                WsprRejection::Implausible | WsprRejection::Weak => stats.implausible += 1,
                            }
                            timings.validate_s += sw.elapsed_s();
                            continue;
                        }
                    };
                    let text = valid.message.to_string();
                    if decodes.iter().any(|d| d.text == text) {
                        stats.duplicates += 1;
                    } else {
                        hashes.learn(&valid.message);
                        let noise = ws.soft.noise.max(f32::MIN_POSITIVE);
                        let score = refine::sync_sum(&ws.powers) / (noise * 25.455_844);
                        found.push((cand, valid.symbols));
                        decodes.push(WsprDecode {
                            text,
                            message: valid.message,
                            freq_hz: cand.centre_hz(),
                            dt_s: cand.dt_s(),
                            drift_hz_per_s: (f64::from(cand.drift_hz) / TRANSMISSION_S) as f32,
                            snr_db: valid.snr_db,
                            score,
                            cycles: outcome.cycles,
                            metric: outcome.metric,
                            hard_errors: valid.hard_errors,
                            pass,
                        });
                    }
                    timings.validate_s += sw.elapsed_s();
                    break;
                }
            }
            if pass == passes || decodes.len() == pass_start {
                break;
            }
            let sw = Stopwatch::start();
            for (cand, symbols) in &found {
                subtract(&mut ws.bb, cand, symbols);
            }
            timings.subtract_s += sw.elapsed_s();
        }
        timings.total_s = total.elapsed_s();
        WsprReport {
            decodes,
            stats,
            timings,
        }
    }
}

/// Removes a decoded signal from the baseband: in each symbol, the projection of the samples
/// on the sent tone (its complex amplitude over the symbol) is subtracted.
pub fn subtract(bb: &mut [Complex32], cand: &WsprCandidate, symbols: &[u8; SYMBOLS]) {
    for (i, &s) in symbols.iter().enumerate() {
        let f = f64::from(cand.tone0_at(i)) + f64::from(s) * RATE_HZ / SYMBOL_SAMPLES as f64;
        let step = std::f64::consts::TAU * f / RATE_HZ;
        let start = i64::from(cand.start) + (i * SYMBOL_SAMPLES) as i64;
        let tone = |n: usize| {
            let ph = step * n as f64;
            Complex32::new(ph.cos() as f32, ph.sin() as f32)
        };
        let mut acc = Complex32::new(0.0, 0.0);
        let mut count = 0usize;
        for n in 0..SYMBOL_SAMPLES {
            let idx = start + n as i64;
            if idx >= 0
                && let Some(&x) = bb.get(idx as usize)
            {
                acc += x * tone(n).conj();
                count += 1;
            }
        }
        if count == 0 {
            continue;
        }
        let a = acc / count as f32;
        for n in 0..SYMBOL_SAMPLES {
            let idx = start + n as i64;
            if idx >= 0
                && let Some(x) = bb.get_mut(idx as usize)
            {
                *x -= a * tone(n);
            }
        }
    }
}

/// Decodes one WSPR slot with the stages and parameters of `config`.
///
/// `samples` is 12 kHz mono audio with sample 0 at the start of an even UTC minute; 120 s
/// (1 440 000 samples) is a full slot, shorter input is padded with silence and longer input
/// cut. Never panics on sample values: non-finite samples read as zero.
pub fn decode_wspr(samples: &[f32], config: &WsprConfig, ctx: &mut WsprContext) -> WsprReport {
    WsprPipeline::from_config(config).run(samples, config.passes, config.search.guard_hz, ctx)
}

#[cfg(test)]
mod tests;
