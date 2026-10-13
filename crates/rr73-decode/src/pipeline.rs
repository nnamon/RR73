//! The decoder pipeline: spectrogram, search, refine, demodulate, LDPC, validate, subtract.

use std::sync::OnceLock;

use rr73_dsp::{FftPlans, Spectrogram, SpectrogramPlan};
use rr73_ft8::{CallsignHashes, Mode, Payload};

use crate::clock::Stopwatch;
use crate::config::{DecoderConfig, DemodKind, LdpcKind, RefineKind, SearchKind, SubtractKind, ValidateKind};
use crate::demod::{Demodulator, MaxLogDemod};
use crate::layout::{CODEWORD_BITS, FrameLayout};
use crate::ldpc::{LdpcDecoder, LdpcScratch, MinSum, ParityGraph, SumProduct};
use crate::osd::{BpOsd, OsdParams};
use crate::report::DecodeReport;
use crate::search::{CandidateSearch, CostasSearch};
use crate::session::{DecodeSession, Stage};
use crate::snr::SnrScale;
use crate::stages::{NoRefine, NoSubtract, Subtractor, SyncRefine};
use crate::subtract::{ModelSubtract, SubtractScratch};
use crate::validate::{CrcUnpack, Validator};
use crate::view::Candidate;

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
    /// `true` when `samples` is the start of a slot still being received. The spectrogram
    /// then keeps only frames whose window lies wholly inside the audio, so symbols cut by
    /// the end of the audio count as missing (zero LLRs) instead of as weak.
    pub partial: bool,
}

impl<'a> SlotAudio<'a> {
    /// Audio for one slot of `mode` with an unknown start time.
    pub fn new(samples: &'a [f32], mode: Mode) -> Self {
        Self {
            samples,
            mode,
            start_utc_s: None,
            partial: false,
        }
    }

    /// The first part of a slot still being received (see [`SlotAudio::partial`]).
    pub fn partial(samples: &'a [f32], mode: Mode) -> Self {
        Self {
            partial: true,
            ..Self::new(samples, mode)
        }
    }
}

/// State kept between decodes: callsign hashes and reusable buffers. One context per
/// thread; reuse it across slots so buffers and FFT plans are allocated once.
pub struct DecodeContext {
    /// Callsigns seen in full, used to resolve hashed callsigns. Decoding adds to it.
    pub hashes: CallsignHashes,
    pub(crate) ws: Workspace,
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

pub(crate) struct Workspace {
    pub(crate) plans: FftPlans,
    pub(crate) plan: Option<(SpectrogramPlan, SnrScale)>,
    pub(crate) spec: Spectrogram,
    pub(crate) candidates: Vec<Candidate>,
    pub(crate) llr: [f32; CODEWORD_BITS],
    pub(crate) codeword: [u8; CODEWORD_BITS],
    pub(crate) ldpc: LdpcScratch,
    pub(crate) noise: Vec<f32>,
    pub(crate) audio: Vec<f32>,
    pub(crate) seen: Vec<Payload>,
    pub(crate) subtract: SubtractScratch,
    pub(crate) chunk: Vec<Candidate>,
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
            subtract: SubtractScratch::default(),
            chunk: Vec::new(),
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
            LdpcKind::BpOsd => Box::new(BpOsd {
                bp: SumProduct {
                    max_iterations: config.ldpc.max_iterations,
                },
                osd: OsdParams {
                    order: config.ldpc.osd_order,
                    window: config.ldpc.osd_window,
                    source: config.ldpc.osd_source,
                    max_hard_errors: config.ldpc.osd_max_hard_errors,
                    max_distance: config.ldpc.osd_max_distance,
                    erasures_as_errors: config.ldpc.osd_erasures_as_errors,
                },
            }),
        };
        let validator: Box<dyn Validator> = match config.validate.kind {
            ValidateKind::CrcUnpack => Box::new(CrcUnpack {
                osd_messages: config.validate.osd_messages,
            }),
        };
        let subtractor: Box<dyn Subtractor> = match config.subtract.kind {
            SubtractKind::None => Box::new(NoSubtract),
            SubtractKind::Model => Box::new(ModelSubtract {
                smooth_s: config.subtract.smooth_s,
                refine: config.subtract.refine,
            }),
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

    /// Runs `config` over `audio` for `layout`, decoding codewords on `graph`, as a
    /// one-stage [`DecodeSession`].
    pub fn run(
        audio: &SlotAudio<'_>,
        layout: &'static FrameLayout,
        graph: &'static ParityGraph,
        config: &DecoderConfig,
        ctx: &mut DecodeContext,
    ) -> DecodeReport {
        let total = Stopwatch::start();
        let stage = Stage::new("main", config.clone());
        let mut session = DecodeSession::with_parts(audio, vec![stage], std::mem::take(ctx), layout, graph);
        session.run_to_end();
        let mut report = session.report();
        *ctx = session.into_context();
        report.timings.total_s = total.elapsed_s();
        report
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
    Pipeline::run(audio, layout(audio.mode), ParityGraph::ft8(), config, ctx)
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
        static LAYOUT: OnceLock<FrameLayout> = OnceLock::new();
        static GRAPH: OnceLock<ParityGraph> = OnceLock::new();
        let layout = LAYOUT.get_or_init(test_layouts::ft8);
        let graph = GRAPH.get_or_init(toy_graph);
        Pipeline::run(&SlotAudio::new(samples, Mode::Ft8), layout, graph, config, ctx)
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
        // Pass 1 decodes nothing from noise, so pass 2 does not run.
        let one = run(
            &audio,
            &wide.with_overrides(&["passes=1"]).expect("config"),
            &mut ctx,
        );
        assert!(r.stats.candidates > 0);
        assert_eq!(r.stats.candidates, one.stats.candidates);
        assert_eq!(r.stats.ldpc_attempts, r.stats.candidates);
    }
}
