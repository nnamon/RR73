//! The decoder pipeline: spectrogram, search, refine, demodulate, LDPC, validate, subtract.

use std::sync::OnceLock;

use rr73_dsp::{FftPlans, Spectrogram, SpectrogramConfig, SpectrogramPlan};
use rr73_ft8::{CallsignHashes, Mode, Payload};

use crate::clock::Stopwatch;
use crate::config::{DecoderConfig, DemodKind, LdpcKind, RefineKind, SearchKind, SubtractKind, ValidateKind};
use crate::demod::{Demodulator, MaxLogDemod};
use crate::layout::{CODEWORD_BITS, FrameLayout};
use crate::ldpc::{LdpcDecoder, LdpcScratch, MinSum, ParityGraph, SumProduct};
use crate::report::{Decode, DecodeReport, DecodeStats, StageTimings};
use crate::search::{CandidateSearch, CostasSearch};
use crate::snr::SnrScale;
use crate::stages::{NoRefine, NoSubtract, Subtractor, SyncRefine};
use crate::validate::{CrcUnpack, Rejection, Validator};
use crate::view::{Candidate, SymbolView, frame_range};

/// Sample rate the decoder expects, in Hz.
pub const SAMPLE_RATE: u32 = 12_000;

/// One slot of audio to decode.
#[derive(Clone, Copy, Debug)]
pub struct SlotAudio<'a> {
    /// Samples at 12 kHz. Sample 0 is the slot start. Any length is accepted; a full slot
    /// is 180000 samples (FT8) or 90000 (FT4).
    pub samples: &'a [f32],
    /// Mode.
    pub mode: Mode,
    /// Slot start in seconds since the Unix epoch (UTC), when known. Informational.
    pub start_utc_s: Option<f64>,
}

impl<'a> SlotAudio<'a> {
    /// Audio for one slot of `mode` with an unknown start time.
    pub fn new(samples: &'a [f32], mode: Mode) -> Self {
        Self {
            samples,
            mode,
            start_utc_s: None,
        }
    }
}

/// State kept between decodes: callsign hashes and reusable buffers. One context per
/// thread; reuse it across slots so buffers and FFT plans are allocated once.
pub struct DecodeContext {
    /// Callsigns seen in full, used to resolve hashed callsigns. Decoding adds to it.
    pub hashes: CallsignHashes,
    ws: Workspace,
}

impl Default for DecodeContext {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for DecodeContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DecodeContext")
            .field("hashes", &self.hashes)
            .finish_non_exhaustive()
    }
}

impl DecodeContext {
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
    plan: Option<(SpectrogramPlan, SnrScale)>,
    spec: Spectrogram,
    candidates: Vec<Candidate>,
    llr: [f32; CODEWORD_BITS],
    codeword: [u8; CODEWORD_BITS],
    ldpc: LdpcScratch,
    noise: Vec<f32>,
    audio: Vec<f32>,
    seen: Vec<Payload>,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            plans: FftPlans::new(),
            plan: None,
            spec: Spectrogram::new(),
            candidates: Vec::new(),
            llr: [0.0; CODEWORD_BITS],
            codeword: [0; CODEWORD_BITS],
            ldpc: LdpcScratch::default(),
            noise: Vec::new(),
            audio: Vec::new(),
            seen: Vec::new(),
        }
    }
}

/// The stage implementations for one configuration.
pub struct Pipeline {
    /// Candidate search.
    pub search: Box<dyn CandidateSearch>,
    /// Refinement.
    pub refine: Box<dyn SyncRefine>,
    /// Demodulator.
    pub demod: Box<dyn Demodulator>,
    /// LDPC decoder.
    pub ldpc: Box<dyn LdpcDecoder>,
    /// Validator.
    pub validator: Box<dyn Validator>,
    /// Subtractor.
    pub subtractor: Box<dyn Subtractor>,
}

impl std::fmt::Debug for Pipeline {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pipeline")
            .field("search", &self.search.name())
            .field("refine", &self.refine.name())
            .field("demod", &self.demod.name())
            .field("ldpc", &self.ldpc.name())
            .field("validator", &self.validator.name())
            .field("subtractor", &self.subtractor.name())
            .finish()
    }
}

impl Pipeline {
    /// Builds the stages a configuration names.
    pub fn from_config(config: &DecoderConfig) -> Self {
        let search: Box<dyn CandidateSearch> = match config.search.kind {
            SearchKind::Costas => Box::new(CostasSearch {
                max_candidates: config.search.max_candidates,
                min_score_db: config.search.min_score_db,
            }),
        };
        let refine: Box<dyn SyncRefine> = match config.refine.kind {
            RefineKind::None => Box::new(NoRefine),
        };
        let demod: Box<dyn Demodulator> = match config.demod.kind {
            DemodKind::MaxLog => Box::new(MaxLogDemod {
                variance: config.demod.llr_variance,
            }),
        };
        let ldpc: Box<dyn LdpcDecoder> = match config.ldpc.kind {
            LdpcKind::SumProduct => Box::new(SumProduct {
                max_iterations: config.ldpc.max_iterations,
            }),
            LdpcKind::MinSum => Box::new(MinSum {
                max_iterations: config.ldpc.max_iterations,
                scale: config.ldpc.min_sum_scale,
            }),
        };
        let validator: Box<dyn Validator> = match config.validate.kind {
            ValidateKind::CrcUnpack => Box::new(CrcUnpack),
        };
        let subtractor: Box<dyn Subtractor> = match config.subtract.kind {
            SubtractKind::None => Box::new(NoSubtract),
        };
        Self {
            search,
            refine,
            demod,
            ldpc,
            validator,
            subtractor,
        }
    }

    /// Runs the pipeline over `samples` for `layout`, decoding codewords on `graph`.
    pub fn run(
        &self,
        samples: &[f32],
        layout: &FrameLayout,
        graph: &ParityGraph,
        config: &DecoderConfig,
        ctx: &mut DecodeContext,
    ) -> DecodeReport {
        let total = Stopwatch::start();
        let mut stats = DecodeStats::default();
        let mut timings = StageTimings::default();
        let mut decodes: Vec<Decode> = Vec::new();
        let DecodeContext { hashes, ws } = ctx;

        let sp = &config.spectrogram;
        let Ok(mut spec_config) = SpectrogramConfig::oversampled(
            layout.samples_per_symbol,
            sp.time_osr,
            sp.freq_osr,
            sp.freq_min_hz,
            sp.freq_max_hz,
            SAMPLE_RATE,
        ) else {
            return DecodeReport {
                decodes,
                stats,
                timings,
            };
        };
        spec_config.window = sp.window;
        if ws.plan.as_ref().is_none_or(|(p, _)| *p.config() != spec_config) {
            let window = spec_config.window.build(spec_config.fft_size);
            let scale = SnrScale::new(layout, spec_config.fft_size, &window);
            ws.plan = SpectrogramPlan::new(spec_config.clone(), &mut ws.plans)
                .ok()
                .map(|p| (p, scale));
        }
        let Some((plan, snr_scale)) = ws.plan.as_mut() else {
            return DecodeReport {
                decodes,
                stats,
                timings,
            };
        };
        let snr_scale = *snr_scale;

        let (dt_min, dt_max) = match layout.mode {
            Mode::Ft8 => (config.search.ft8_dt_min_s, config.search.ft8_dt_max_s),
            Mode::Ft4 => (config.search.ft4_dt_min_s, config.search.ft4_dt_max_s),
        };
        let hop = spec_config.hop;
        let range = frame_range(layout, hop, dt_min, dt_max);
        // Frames up to the last symbol of the latest candidate, and no further than the audio.
        let last_needed = i64::from(*range.end()) + ((layout.symbols.saturating_sub(1)) * sp.time_osr) as i64;
        let frames = (samples.len().div_ceil(hop) as i64).min(last_needed + 1).max(0) as usize;

        let passes = config.passes.max(1);
        if passes > 1 {
            ws.audio.clear();
            ws.audio.extend_from_slice(samples);
        }
        ws.seen.clear();

        for pass in 1..=passes {
            let audio: &[f32] = if passes > 1 { &ws.audio } else { samples };
            let sw = Stopwatch::start();
            plan.compute(audio, frames, &mut ws.spec);
            timings.spectrogram_s += sw.elapsed_s();

            let view = SymbolView {
                spec: &ws.spec,
                layout,
                time_osr: sp.time_osr,
                freq_osr: sp.freq_osr,
            };
            let sw = Stopwatch::start();
            self.search.search(&view, range.clone(), &mut ws.candidates);
            timings.search_s += sw.elapsed_s();
            stats.candidates += ws.candidates.len() as u32;

            let pass_start = decodes.len();
            for &found in ws.candidates.iter() {
                let mut cand = found;
                let sw = Stopwatch::start();
                self.refine.refine(&view, &mut cand);
                timings.refine_s += sw.elapsed_s();

                let sw = Stopwatch::start();
                self.demod.llrs(&view, &cand, &mut ws.llr);
                timings.demod_s += sw.elapsed_s();

                let sw = Stopwatch::start();
                stats.ldpc_attempts += 1;
                let outcome = self.ldpc.decode(graph, &ws.llr, &mut ws.ldpc, &mut ws.codeword);
                timings.ldpc_s += sw.elapsed_s();
                if !outcome.converged {
                    continue;
                }
                stats.ldpc_converged += 1;

                let sw = Stopwatch::start();
                let valid = match self.validator.validate(layout.mode, &ws.codeword, hashes) {
                    Ok(v) => v,
                    Err(r) => {
                        match r {
                            Rejection::Crc => stats.crc_failures += 1,
                            Rejection::ZeroPayload => stats.zero_payloads += 1,
                            Rejection::Unpack(_) => stats.unpack_failures += 1,
                        }
                        timings.validate_s += sw.elapsed_s();
                        continue;
                    }
                };
                if self.validator.is_duplicate(&valid, &ws.seen) {
                    stats.duplicates += 1;
                    timings.validate_s += sw.elapsed_s();
                    continue;
                }
                ws.seen.push(valid.payload);
                let tones = rr73_ft8::tones::from_payload(layout.mode, &valid.payload);
                let snr_db = snr_scale.estimate(&view, &cand, &tones, &mut ws.noise);
                decodes.push(Decode {
                    text: valid.text,
                    message: valid.message,
                    payload: valid.payload,
                    freq_hz: view.freq_hz(&cand),
                    dt_s: view.dt_s(&cand),
                    snr_db,
                    pass,
                    ldpc_iterations: outcome.iterations,
                    hard_errors: outcome.hard_errors,
                    score: cand.score,
                });
                timings.validate_s += sw.elapsed_s();
            }

            if pass < passes {
                let sw = Stopwatch::start();
                self.subtractor
                    .subtract(layout, &mut ws.audio, &decodes[pass_start..]);
                timings.subtract_s += sw.elapsed_s();
            }
        }
        timings.total_s = total.elapsed_s();
        DecodeReport {
            decodes,
            stats,
            timings,
        }
    }
}

/// The layout of `mode`, built once per process.
pub fn layout(mode: Mode) -> &'static FrameLayout {
    static FT8: OnceLock<FrameLayout> = OnceLock::new();
    static FT4: OnceLock<FrameLayout> = OnceLock::new();
    match mode {
        Mode::Ft8 => FT8.get_or_init(|| FrameLayout::new(Mode::Ft8)),
        Mode::Ft4 => FT4.get_or_init(|| FrameLayout::new(Mode::Ft4)),
    }
}

/// Decodes one slot with the stages and parameters of `config`.
///
/// Never panics on sample values: non-finite samples read as zero, silence and noise give
/// no decodes, and buffers of any length (including empty) are accepted.
pub fn decode(audio: &SlotAudio<'_>, config: &DecoderConfig, ctx: &mut DecodeContext) -> DecodeReport {
    Pipeline::from_config(config).run(audio.samples, layout(audio.mode), ParityGraph::ft8(), config, ctx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::test_layouts;
    use crate::testsig;

    /// A sparse random graph over 174 bits (83 checks of 6 bits): random hard decisions
    /// never satisfy it, so these tests exercise everything up to the validator without the
    /// codec's tables.
    fn toy_graph() -> ParityGraph {
        let mut rng = testsig::Rng::new(77);
        let checks: Vec<Vec<u16>> = (0..83)
            .map(|_| {
                let mut row: Vec<u16> = Vec::new();
                while row.len() < 6 {
                    let b = (rng.next_u64() % 174) as u16;
                    if !row.contains(&b) {
                        row.push(b);
                    }
                }
                row
            })
            .collect();
        ParityGraph::new(174, &checks).expect("graph")
    }

    fn run(samples: &[f32], config: &DecoderConfig, ctx: &mut DecodeContext) -> DecodeReport {
        Pipeline::from_config(config).run(samples, &test_layouts::ft8(), &toy_graph(), config, ctx)
    }

    #[test]
    fn hostile_audio_never_panics_or_decodes() {
        let config = DecoderConfig::baseline();
        let mut ctx = DecodeContext::new();
        let mut clipped = testsig::noise(180_000, 3);
        for x in &mut clipped {
            *x = x.signum();
        }
        let mut mixed = testsig::noise(180_000, 4);
        mixed[1000] = f32::NAN;
        mixed[2000] = f32::INFINITY;
        mixed[3000] = f32::NEG_INFINITY;
        mixed[4000] = 1e30;
        let cases: Vec<(&str, Vec<f32>)> = vec![
            ("empty", Vec::new()),
            ("one sample", vec![0.5]),
            ("short", testsig::noise(1000, 1)),
            ("silence", vec![0.0; 180_000]),
            ("nan", vec![f32::NAN; 180_000]),
            ("infinity", vec![f32::INFINITY; 180_000]),
            ("huge", vec![1e30; 180_000]),
            ("clipped", clipped),
            ("mixed", mixed),
            ("ten slots", testsig::noise(1_800_000, 2)),
        ];
        for (name, samples) in cases {
            let r = run(&samples, &config, &mut ctx);
            assert!(r.decodes.is_empty(), "{name}");
            assert_eq!(r.stats.ldpc_converged, 0, "{name}");
            assert!(
                r.stats.candidates as usize <= config.search.max_candidates,
                "{name}"
            );
            assert!(r.timings.total_s >= r.timings.spectrogram_s, "{name}");
        }
    }

    #[test]
    fn long_input_is_cut_to_the_frames_candidates_can_reach() {
        let config = DecoderConfig::baseline();
        let mut ctx = DecodeContext::new();
        run(&testsig::noise(1_800_000, 2), &config, &mut ctx);
        // DT up to 2.5 s puts the last symbol near 15.6 s: frame 38 + 78 * 2 = 194.
        assert_eq!(ctx.ws.spec.frames(), 195);
        run(&testsig::noise(180_000, 2), &config, &mut ctx);
        assert_eq!(ctx.ws.spec.frames(), 188);
    }

    #[test]
    fn noise_produces_candidates_and_ldpc_attempts() {
        let config = DecoderConfig::baseline();
        let mut ctx = DecodeContext::new();
        let r = run(&testsig::noise(180_000, 9), &config, &mut ctx);
        assert!(r.stats.candidates > 0);
        assert_eq!(r.stats.ldpc_attempts, r.stats.candidates);
    }

    #[test]
    fn context_follows_configuration_changes_and_passes() {
        let mut ctx = DecodeContext::new();
        let audio = testsig::noise(180_000, 5);
        let base = DecoderConfig::baseline();
        run(&audio, &base, &mut ctx);
        let bins_2x = ctx.ws.spec.bins();
        let wide = base
            .with_overrides(&["spectrogram.freq_osr=4", "passes=2", "ldpc.kind=min-sum"])
            .expect("config");
        let r = run(&audio, &wide, &mut ctx);
        assert_eq!(ctx.ws.spec.bins(), bins_2x * 2);
        // Without subtraction both passes see the same audio and find the same candidates.
        assert!(r.stats.candidates > 0);
        assert_eq!(r.stats.candidates % 2, 0);
        assert_eq!(r.stats.ldpc_attempts, r.stats.candidates);
    }
}
