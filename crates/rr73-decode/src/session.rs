//! A decoding session: one slot decoded stage by stage, in small steps that a caller can
//! stop between.
//!
//! Each stage is a [`DecoderConfig`] run on the residual left by every earlier decode: a
//! stage that subtracts first removes the decodes of earlier stages still in the audio, its
//! passes subtract what they find before searching again, and decodes already found in the
//! slot are dropped as duplicates, so a stage returns only new decodes. A session with one
//! stage gives exactly what [`crate::decode`] gives for that configuration.
//!
//! [`DecodeSession::step`] does one bounded unit of work: set up a stage or pass and compute
//! its spectrogram, search 8 frames of candidate positions, try 16 candidates, or subtract 2
//! decodes. A caller that must stop for a new slot stops between steps; everything already
//! returned stays valid.

use rr73_dsp::{SpectrogramConfig, SpectrogramPlan};
use rr73_ft8::Mode;

use crate::clock::Stopwatch;
use crate::config::{DecoderConfig, SubtractKind};
use crate::layout::FrameLayout;
use crate::ldpc::ParityGraph;
use crate::pipeline::{DecodeContext, Pipeline, SAMPLE_RATE, SlotAudio, layout};
use crate::report::{Decode, DecodeReport, DecodeStats, StageTimings};
use crate::snr::SnrScale;
use crate::validate::Rejection;
use crate::view::{Candidate, SymbolView, frame_range};

/// Candidate positions searched per step, in spectrogram frames.
const SEARCH_FRAMES_PER_STEP: i32 = 8;
/// Candidates tried per step.
const CANDIDATES_PER_STEP: usize = 16;
/// Decodes subtracted per step.
const SUBTRACTIONS_PER_STEP: usize = 2;

/// One stage of a session.
#[derive(Debug)]
pub struct Stage {
    /// Name used in reports, such as the preset name.
    pub name: String,
    /// The configuration the stage runs.
    pub config: DecoderConfig,
    pipeline: Pipeline,
}

impl Stage {
    /// A stage running `config`.
    pub fn new(name: impl Into<String>, config: DecoderConfig) -> Self {
        let pipeline = Pipeline::from_config(&config);
        Self {
            name: name.into(),
            config,
            pipeline,
        }
    }

    /// A stage running the named preset.
    pub fn preset(name: &str) -> Result<Self, crate::ConfigError> {
        Ok(Self::new(name, DecoderConfig::preset(name)?))
    }
}

/// What one step did.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct StepOutcome {
    /// Decodes found by this step (new in the slot).
    pub decodes: Vec<Decode>,
    /// Index of the stage the step worked on.
    pub stage: usize,
    /// `true` when this step finished its stage.
    pub stage_done: bool,
    /// `true` when every stage has finished; further steps do nothing.
    pub done: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Phase {
    /// Subtract decodes left over from earlier stages, then start pass 1.
    StartStage,
    /// Compute the spectrogram of the residual for a pass.
    StartPass,
    /// Search candidate frames from this frame onward.
    Search(i32),
    /// Try candidates from this index onward.
    Candidates(usize),
    /// Subtract this pass's decodes from this index onward.
    Subtract(usize),
    /// Every stage has run.
    Done,
}

/// Geometry of the stage being run.
#[derive(Clone, Copy, Debug)]
struct StageGeometry {
    frames: usize,
    first_frame: i32,
    last_frame: i32,
    snr: SnrScale,
}

/// A slot being decoded stage by stage.
pub struct DecodeSession {
    layout: &'static FrameLayout,
    graph: &'static ParityGraph,
    stages: Vec<Stage>,
    audio: Vec<f32>,
    partial: bool,
    ctx: DecodeContext,
    stage: usize,
    pass: u32,
    phase: Phase,
    geometry: Option<StageGeometry>,
    decodes: Vec<Decode>,
    stage_of: Vec<usize>,
    subtracted: usize,
    pass_start: usize,
    stats: DecodeStats,
    timings: StageTimings,
    stage_seconds: Vec<f64>,
}

impl std::fmt::Debug for DecodeSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DecodeSession")
            .field(
                "stages",
                &self.stages.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            )
            .field("stage", &self.stage)
            .field("phase", &self.phase)
            .field("decodes", &self.decodes.len())
            .finish_non_exhaustive()
    }
}

impl DecodeSession {
    /// A session over `audio` (copied) running `stages` in order, with a fresh context.
    pub fn new(audio: &SlotAudio<'_>, stages: Vec<Stage>) -> Self {
        Self::with_context(audio, stages, DecodeContext::new())
    }

    /// As [`DecodeSession::new`], reusing `ctx` (its buffers and callsign hashes). Get it
    /// back with [`DecodeSession::into_context`].
    pub fn with_context(audio: &SlotAudio<'_>, stages: Vec<Stage>, ctx: DecodeContext) -> Self {
        Self::with_parts(audio, stages, ctx, layout(audio.mode), ParityGraph::ft8())
    }

    /// As [`DecodeSession::with_context`] with an explicit frame layout and parity graph
    /// (tests use hand-written ones).
    pub fn with_parts(
        audio: &SlotAudio<'_>,
        stages: Vec<Stage>,
        mut ctx: DecodeContext,
        layout: &'static FrameLayout,
        graph: &'static ParityGraph,
    ) -> Self {
        ctx.ws.seen.clear();
        // The context's audio buffer becomes the residual, so a reused context allocates
        // nothing here.
        let mut residual = std::mem::take(&mut ctx.ws.audio);
        residual.clear();
        residual.extend_from_slice(audio.samples);
        let count = stages.len();
        Self {
            layout,
            graph,
            stages,
            audio: residual,
            partial: audio.partial,
            ctx,
            stage: 0,
            pass: 0,
            phase: if count == 0 {
                Phase::Done
            } else {
                Phase::StartStage
            },
            geometry: None,
            decodes: Vec::new(),
            stage_of: Vec::new(),
            subtracted: 0,
            pass_start: 0,
            stats: DecodeStats::default(),
            timings: StageTimings::default(),
            stage_seconds: vec![0.0; count],
        }
    }

    /// The mode being decoded.
    pub fn mode(&self) -> Mode {
        self.layout.mode
    }

    /// `true` when every stage has run.
    pub fn is_done(&self) -> bool {
        self.phase == Phase::Done
    }

    /// Index of the stage the next step works on (the stage count when done).
    pub fn stage(&self) -> usize {
        self.stage
    }

    /// Number of stages.
    pub fn stage_count(&self) -> usize {
        self.stages.len()
    }

    /// Every decode so far, in the order found.
    pub fn decodes(&self) -> &[Decode] {
        &self.decodes
    }

    /// For each decode in [`DecodeSession::decodes`], the stage that found it.
    pub fn decode_stages(&self) -> &[usize] {
        &self.stage_of
    }

    /// Wall time spent in each stage so far, in seconds (zero on wasm32).
    pub fn stage_seconds(&self) -> &[f64] {
        &self.stage_seconds
    }

    /// Counters and stage timings so far, with the decodes so far.
    pub fn report(&self) -> DecodeReport {
        let mut timings = self.timings;
        timings.total_s = self.stage_seconds.iter().sum();
        DecodeReport {
            decodes: self.decodes.clone(),
            stats: self.stats,
            timings,
        }
    }

    /// Ends the session and returns its context for reuse.
    pub fn into_context(self) -> DecodeContext {
        let mut ctx = self.ctx;
        ctx.ws.audio = self.audio;
        ctx
    }

    /// Runs steps until the current stage finishes and returns its decodes, or `None` when
    /// every stage has already run.
    pub fn next_stage(&mut self) -> Option<Vec<Decode>> {
        if self.is_done() {
            return None;
        }
        let mut found = Vec::new();
        loop {
            let out = self.step();
            found.extend(out.decodes);
            if out.stage_done || out.done {
                return Some(found);
            }
        }
    }

    /// Runs every remaining stage.
    pub fn run_to_end(&mut self) {
        while !self.is_done() {
            self.step();
        }
    }

    /// Does one bounded unit of work.
    pub fn step(&mut self) -> StepOutcome {
        let stage = self.stage;
        if self.phase == Phase::Done {
            return StepOutcome {
                stage,
                done: true,
                ..StepOutcome::default()
            };
        }
        let sw = Stopwatch::start();
        let mut out = StepOutcome {
            stage,
            ..StepOutcome::default()
        };
        match self.phase {
            Phase::StartStage => self.start_stage(),
            Phase::StartPass => self.start_pass(),
            Phase::Search(from) => self.search(from),
            Phase::Candidates(from) => self.candidates(from, &mut out.decodes),
            Phase::Subtract(from) => self.subtract(from),
            Phase::Done => {}
        }
        if let Some(s) = self.stage_seconds.get_mut(stage) {
            *s += sw.elapsed_s();
        }
        out.stage_done = self.stage != stage || self.phase == Phase::Done;
        out.done = self.phase == Phase::Done;
        out
    }

    fn finish_stage(&mut self) {
        self.stage += 1;
        self.geometry = None;
        self.phase = if self.stage < self.stages.len() {
            Phase::StartStage
        } else {
            Phase::Done
        };
    }

    /// Subtracts decodes that earlier stages left in the audio with this stage's subtractor,
    /// then sets up the stage's spectrogram and search range.
    fn start_stage(&mut self) {
        let from = self.subtracted;
        let stage = &self.stages[self.stage];
        if stage.config.subtract.kind != SubtractKind::None && from < self.decodes.len() {
            let sw = Stopwatch::start();
            for d in &self.decodes[from..] {
                stage.pipeline.subtractor.subtract(
                    self.layout,
                    &mut self.audio,
                    std::slice::from_ref(d),
                    &mut self.ctx.ws.subtract,
                );
            }
            self.timings.subtract_s += sw.elapsed_s();
            self.subtracted = self.decodes.len();
        }

        let config = &self.stages[self.stage].config;
        let sp = &config.spectrogram;
        let Ok(mut spec_config) = SpectrogramConfig::oversampled(
            self.layout.samples_per_symbol,
            sp.time_osr,
            sp.freq_osr,
            sp.freq_min_hz,
            sp.freq_max_hz,
            SAMPLE_RATE,
        ) else {
            self.finish_stage();
            return;
        };
        spec_config.window = sp.window;
        let ws = &mut self.ctx.ws;
        if ws.plan.as_ref().is_none_or(|(p, _)| *p.config() != spec_config) {
            let window = spec_config.window.build(spec_config.fft_size);
            let scale = SnrScale::new(self.layout, spec_config.fft_size, &window);
            ws.plan = SpectrogramPlan::new(spec_config.clone(), &mut ws.plans)
                .ok()
                .map(|p| (p, scale));
        }
        let Some((_, snr)) = ws.plan.as_ref() else {
            self.finish_stage();
            return;
        };
        let (dt_min, dt_max) = match self.layout.mode {
            Mode::Ft8 => (config.search.ft8_dt_min_s, config.search.ft8_dt_max_s),
            Mode::Ft4 => (config.search.ft4_dt_min_s, config.search.ft4_dt_max_s),
        };
        let hop = spec_config.hop;
        let range = frame_range(self.layout, hop, dt_min, dt_max);
        // Frames up to the last symbol of the latest candidate, and no further than the audio.
        let last_needed =
            i64::from(*range.end()) + ((self.layout.symbols.saturating_sub(1)) * sp.time_osr) as i64;
        let available = if self.partial {
            // Frame t covers samples up to t * hop + fft_size / 2.
            match self.audio.len().checked_sub(spec_config.fft_size / 2) {
                Some(room) => room / hop + 1,
                None => 0,
            }
        } else {
            self.audio.len().div_ceil(hop)
        };
        self.geometry = Some(StageGeometry {
            frames: (available as i64).min(last_needed + 1).max(0) as usize,
            first_frame: *range.start(),
            last_frame: *range.end(),
            snr: *snr,
        });
        self.pass = 0;
        self.phase = Phase::StartPass;
    }

    fn start_pass(&mut self) {
        let Some(g) = self.geometry else {
            self.finish_stage();
            return;
        };
        self.pass += 1;
        self.pass_start = self.decodes.len();
        let ws = &mut self.ctx.ws;
        let sw = Stopwatch::start();
        if let Some((plan, _)) = ws.plan.as_mut() {
            plan.compute(&self.audio, g.frames, &mut ws.spec);
        }
        self.timings.spectrogram_s += sw.elapsed_s();
        ws.candidates.clear();
        self.phase = Phase::Search(g.first_frame);
    }

    fn view(&self) -> SymbolView<'_> {
        let sp = &self.stages[self.stage].config.spectrogram;
        SymbolView {
            spec: &self.ctx.ws.spec,
            layout: self.layout,
            time_osr: sp.time_osr,
            freq_osr: sp.freq_osr,
        }
    }

    /// Searches up to [`SEARCH_FRAMES_PER_STEP`] frames and merges their best candidates
    /// into the pass's list. The best `max_candidates` of the union of per-chunk best lists
    /// are the best of the whole range, so chunking does not change the result.
    fn search(&mut self, from: i32) {
        let Some(g) = self.geometry else {
            self.finish_stage();
            return;
        };
        let to = (from + SEARCH_FRAMES_PER_STEP - 1).min(g.last_frame);
        let sw = Stopwatch::start();
        let mut chunk = std::mem::take(&mut self.ctx.ws.chunk);
        {
            let view = self.view();
            self.stages[self.stage]
                .pipeline
                .search
                .search(&view, from..=to, &mut chunk);
        }
        let max = self.stages[self.stage].config.search.max_candidates;
        let list = &mut self.ctx.ws.candidates;
        list.extend_from_slice(&chunk);
        list.sort_by(crate::search::best_first);
        list.truncate(max);
        self.ctx.ws.chunk = chunk;
        self.timings.search_s += sw.elapsed_s();
        if to >= g.last_frame {
            self.stats.candidates += self.ctx.ws.candidates.len() as u32;
            self.phase = Phase::Candidates(0);
        } else {
            self.phase = Phase::Search(to + 1);
        }
    }

    /// Tries up to [`CANDIDATES_PER_STEP`] candidates.
    fn candidates(&mut self, from: usize, found: &mut Vec<Decode>) {
        let Some(g) = self.geometry else {
            self.finish_stage();
            return;
        };
        let total = self.ctx.ws.candidates.len();
        let to = (from + CANDIDATES_PER_STEP).min(total);
        let stage = &self.stages[self.stage];
        let config = &stage.config;
        let pipeline = &stage.pipeline;
        let sp = &config.spectrogram;
        let DecodeContext { hashes, ws } = &mut self.ctx;
        let view = SymbolView {
            spec: &ws.spec,
            layout: self.layout,
            time_osr: sp.time_osr,
            freq_osr: sp.freq_osr,
        };
        let stats = &mut self.stats;
        let timings = &mut self.timings;
        for i in from..to {
            let mut cand: Candidate = ws.candidates[i];
            let sw = Stopwatch::start();
            pipeline.refine.refine(&view, &mut cand);
            timings.refine_s += sw.elapsed_s();

            let sw = Stopwatch::start();
            pipeline.demod.llrs(&view, &cand, &mut ws.llr);
            timings.demod_s += sw.elapsed_s();

            let sw = Stopwatch::start();
            stats.ldpc_attempts += 1;
            let outcome = pipeline
                .ldpc
                .decode(self.graph, &ws.llr, &mut ws.ldpc, &mut ws.codeword);
            timings.ldpc_s += sw.elapsed_s();
            if !outcome.converged {
                continue;
            }
            stats.ldpc_converged += 1;
            stats.osd_codewords += u32::from(outcome.osd);

            let sw = Stopwatch::start();
            let valid = match pipeline
                .validator
                .validate(self.layout.mode, &ws.codeword, &outcome, hashes)
            {
                Ok(v) => v,
                Err(r) => {
                    match r {
                        Rejection::Crc => stats.crc_failures += 1,
                        Rejection::ZeroPayload => stats.zero_payloads += 1,
                        Rejection::Unpack(_) => stats.unpack_failures += 1,
                        Rejection::Implausible => stats.implausible += 1,
                    }
                    timings.validate_s += sw.elapsed_s();
                    continue;
                }
            };
            if pipeline.validator.is_duplicate(&valid, &ws.seen) {
                stats.duplicates += 1;
                timings.validate_s += sw.elapsed_s();
                continue;
            }
            let tones = rr73_ft8::tones::from_payload(self.layout.mode, &valid.payload);
            let snr_db = g.snr.estimate(&view, &cand, &tones, &mut ws.noise);
            // An OSD codeword claiming an SNR below what decoding reaches is noise.
            if outcome.osd && snr_db < config.validate.osd_min_snr_db {
                stats.implausible += 1;
                timings.validate_s += sw.elapsed_s();
                continue;
            }
            ws.seen.push(valid.payload);
            hashes.learn(&valid.message);
            let decode = Decode {
                text: valid.text,
                message: valid.message,
                payload: valid.payload,
                freq_hz: view.freq_hz(&cand),
                dt_s: view.dt_s(&cand),
                snr_db,
                pass: self.pass,
                ldpc_iterations: outcome.iterations,
                hard_errors: outcome.hard_errors,
                score: cand.score,
                osd: outcome.osd,
                osd_distance: outcome.distance,
            };
            found.push(decode.clone());
            self.decodes.push(decode);
            self.stage_of.push(self.stage);
            timings.validate_s += sw.elapsed_s();
        }
        if to < total {
            self.phase = Phase::Candidates(to);
            return;
        }
        // A pass that found nothing new leaves the residual as it was: the stage ends. So
        // does the last pass, whose decodes the next stage subtracts first.
        let passes = config.passes.max(1);
        if self.pass >= passes || self.decodes.len() == self.pass_start {
            self.finish_stage();
        } else {
            self.phase = Phase::Subtract(self.pass_start);
        }
    }

    /// Subtracts up to [`SUBTRACTIONS_PER_STEP`] of this pass's decodes.
    fn subtract(&mut self, from: usize) {
        let to = (from + SUBTRACTIONS_PER_STEP).min(self.decodes.len());
        let sw = Stopwatch::start();
        let pipeline = &self.stages[self.stage].pipeline;
        pipeline.subtractor.subtract(
            self.layout,
            &mut self.audio,
            &self.decodes[from..to],
            &mut self.ctx.ws.subtract,
        );
        self.timings.subtract_s += sw.elapsed_s();
        if self.stages[self.stage].config.subtract.kind != SubtractKind::None {
            self.subtracted = to;
        }
        self.phase = if to < self.decodes.len() {
            Phase::Subtract(to)
        } else {
            Phase::StartPass
        };
    }
}
