//! A decoding session: one slot decoded stage by stage, in small steps that a caller can
//! stop between.
//!
//! Each stage is a [`DecoderConfig`] run on the residual left by every earlier decode: a
//! stage that subtracts first removes the decodes of earlier stages still in the audio, its
//! passes subtract what they find before searching again, and decodes already found in the
//! slot are dropped as duplicates, so a stage returns only new decodes. A session with one
//! stage gives exactly what [`crate::decode`] gives for that configuration.
//!
//! [`DecodeSession::step`] does one bounded unit of work: set up a stage or a pass, compute
//! 16 spectrogram frames, transform the pass's audio for the block demodulator, search 4
//! frames of candidate positions, try 4 candidates (4 sets of soft bits, at least one
//! candidate, with the block demodulator, which tries several per candidate), or subtract 1
//! decode. A caller that must stop for a new slot stops between steps; everything already
//! returned stays valid. On an M4 the longest step does about 4 ms of work in a browser
//! worker (experiment 0009).

use rr73_dsp::{SpectrogramConfig, SpectrogramPlan};
use rr73_ft8::Mode;

use crate::ap::{self, ApKind, Hypothesis};
use crate::clock::Stopwatch;
use crate::config::{DecoderConfig, DemodKind, SubtractKind};
use crate::layout::FrameLayout;
use crate::ldpc::{LdpcDecoder, LdpcOutcome, LdpcScratch, ParityGraph};
use crate::pipeline::{DecodeContext, Pipeline, SAMPLE_RATE, SlotAudio, layout};
use crate::refine::Refined;
use crate::report::{Decode, DecodeReport, DecodeStats, StageTimings};
use crate::snr::SnrScale;
use crate::validate::{Rejection, Validated};
use crate::view::{Candidate, SymbolView, frame_range};

/// Spectrogram frames computed per step (even, so frames pair as in one pass).
const SPECTROGRAM_FRAMES_PER_STEP: usize = 16;
/// Candidate positions searched per step, in spectrogram frames.
const SEARCH_FRAMES_PER_STEP: i32 = 4;
/// Candidates tried per step.
const CANDIDATES_PER_STEP: usize = 4;
/// Decodes subtracted per step.
const SUBTRACTIONS_PER_STEP: usize = 1;

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

    /// A stage from a preset name followed by `key=value` overrides, separated by spaces:
    /// `"subtract-3-osd2 spectrogram.time_osr=4"`. The trimmed text names the stage.
    pub fn parse(spec: &str) -> Result<Self, crate::ConfigError> {
        let mut words = spec.split_whitespace();
        let preset = words
            .next()
            .ok_or_else(|| crate::ConfigError::UnknownPreset(String::new()))?;
        let overrides: Vec<&str> = words.collect();
        let config = DecoderConfig::preset(preset)?.with_overrides(&overrides)?;
        Ok(Self::new(spec.trim(), config))
    }

    /// The stages of a plan: stage specs (see [`Stage::parse`]) separated by `;`, such as
    /// `"subtract-3-osd2; subtract-3-osd2 spectrogram.time_osr=4"`.
    pub fn plan(plan: &str) -> Result<Vec<Self>, crate::ConfigError> {
        plan.split(';')
            .filter(|s| !s.trim().is_empty())
            .map(Self::parse)
            .collect()
    }
}

/// What became of one candidate, recorded while tracing is on
/// ([`DecodeSession::set_trace`]). The bench uses it to tell search misses from candidates
/// that failed to decode.
#[derive(Clone, Debug, PartialEq)]
pub struct CandidateTrace {
    /// Stage index.
    pub stage: usize,
    /// Pass within the stage, from 1.
    pub pass: u32,
    /// Base-tone frequency after refinement, in Hz.
    pub freq_hz: f32,
    /// DT after refinement, in seconds.
    pub dt_s: f32,
    /// Sync score, in dB.
    pub score: f32,
    /// What decoding made of it.
    pub outcome: TraceOutcome,
}

/// The fate of a traced candidate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TraceOutcome {
    /// No codeword: belief propagation and OSD failed, and no a priori hypothesis held.
    NoCodeword,
    /// A codeword the validator refused (CRC, unpack, plausibility).
    Rejected,
    /// A message already decoded in the slot.
    Duplicate,
    /// An OSD or AP codeword whose SNR lies below its floor.
    BelowFloor,
    /// A new decode: its index in [`DecodeSession::decodes`].
    Decoded(usize),
    /// No soft bits tried: too few sync symbols matched for the block demodulator.
    NoSync,
    /// Skipped: refinement moved it to a position already tried in the pass.
    Repeat,
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
    /// Start a pass on the residual.
    StartPass,
    /// Compute spectrogram frames from this one onward.
    Spectrogram(usize),
    /// Transform the pass's audio for block detection (`crate::block`).
    Baseband,
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
    /// A priori hypotheses from the context's QSO, built once per slot.
    hyps: Vec<Hypothesis>,
    /// Candidate records, kept only while tracing is on.
    trace: Option<Vec<CandidateTrace>>,
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
        // Silence is found once, in the input: subtraction writes small non-zero values into
        // silent samples that a subtracted signal spans, so later passes cannot find it.
        crate::silence::silent_runs(audio.samples, &mut ctx.ws.silent);
        // The context's audio buffer becomes the residual, so a reused context allocates
        // nothing here.
        let mut residual = std::mem::take(&mut ctx.ws.audio);
        residual.clear();
        residual.extend_from_slice(audio.samples);
        let count = stages.len();
        let hyps = ctx
            .ap
            .as_ref()
            .map(|c| ap::hypotheses(audio.mode, c))
            .unwrap_or_default();
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
            hyps,
            trace: None,
        }
    }

    /// Turns the candidate trace on or off. On, every candidate tried from then on is
    /// recorded with its fate ([`DecodeSession::trace`]); off, the records are dropped.
    pub fn set_trace(&mut self, on: bool) {
        self.trace = if on { Some(Vec::new()) } else { None };
    }

    /// The candidates tried while tracing was on, in order.
    pub fn trace(&self) -> &[CandidateTrace] {
        self.trace.as_deref().unwrap_or(&[])
    }

    /// The audio as the next step sees it: the slot with the decodes subtracted so far.
    pub fn residual(&self) -> &[f32] {
        &self.audio
    }

    /// The mode being decoded.
    pub fn mode(&self) -> Mode {
        self.layout.mode
    }

    /// `true` when every stage has run.
    pub fn is_done(&self) -> bool {
        self.phase == Phase::Done
    }

    /// The kind of work the next step does: `start-stage` (subtract earlier stages' decodes
    /// and set up), `start-pass`, `spectrogram`, `search`, `candidates`, `subtract` or `done`.
    pub fn next_step_kind(&self) -> &'static str {
        match self.phase {
            Phase::StartStage => "start-stage",
            Phase::StartPass => "start-pass",
            Phase::Spectrogram(_) => "spectrogram",
            Phase::Baseband => "baseband",
            Phase::Search(_) => "search",
            Phase::Candidates(_) => "candidates",
            Phase::Subtract(_) => "subtract",
            Phase::Done => "done",
        }
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

    /// Wall time spent in each stage so far, in seconds (zero on wasm32 without a clock from
    /// [`crate::set_clock`]).
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
        let start = self.decodes.len();
        loop {
            let out = self.step();
            if out.stage_done || out.done {
                // The stage's decodes as they stand at its end, hashes resolved.
                return Some(self.decodes[start..].to_vec());
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
            Phase::Spectrogram(from) => self.spectrogram(from),
            Phase::Baseband => self.baseband(),
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
        self.resolve_hashes();
        self.stage += 1;
        self.geometry = None;
        self.phase = if self.stage < self.stages.len() {
            Phase::StartStage
        } else {
            Phase::Done
        };
    }

    /// Renders again, with every callsign the slot has taught so far, the decodes that show an
    /// unresolved hash (`<...>`): a message decoded before the message that carries its
    /// callsign in full. Runs at the end of each stage, so [`DecodeSession::next_stage`] and
    /// [`DecodeSession::decodes`] give the resolved text; decodes a step returned earlier keep
    /// the text they had.
    fn resolve_hashes(&mut self) {
        for d in &mut self.decodes {
            if !d.text.contains("<...>") {
                continue;
            }
            if let Ok(message) = rr73_ft8::message::unpack(&d.payload, &self.ctx.hashes) {
                let text = message.to_string();
                if text != d.text {
                    d.text = text;
                    d.message = message;
                }
            }
        }
    }

    /// Subtracts up to [`SUBTRACTIONS_PER_STEP`] decodes that earlier stages left in the
    /// audio, with this stage's subtractor; once none are left, sets up the stage's
    /// spectrogram and search range.
    fn start_stage(&mut self) {
        let from = self.subtracted;
        let stage = &self.stages[self.stage];
        if stage.config.subtract.kind != SubtractKind::None && from < self.decodes.len() {
            // A bounded share per step; the phase stays until none are left.
            let to = (from + SUBTRACTIONS_PER_STEP).min(self.decodes.len());
            let sw = Stopwatch::start();
            stage.pipeline.subtractor.subtract(
                self.layout,
                &mut self.audio,
                &self.decodes[from..to],
                &mut self.ctx.ws.subtract,
            );
            self.timings.subtract_s += sw.elapsed_s();
            self.subtracted = to;
            return;
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
        if let Some(w) = sp.window_symbols {
            spec_config.window_len = (w * self.layout.samples_per_symbol).min(spec_config.fft_size);
        }
        // The window sits in the middle of the frame with zero padding around it.
        let pad = (spec_config.fft_size - spec_config.window_len) / 2;
        let ws = &mut self.ctx.ws;
        if ws.plan.as_ref().is_none_or(|(p, _)| *p.config() != spec_config) {
            let mut window = vec![0.0; spec_config.fft_size];
            spec_config
                .window
                .fill(&mut window[pad..pad + spec_config.window_len]);
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
            // The window of frame t ends at sample t * hop + reach.
            let reach = (pad + spec_config.window_len).saturating_sub(spec_config.fft_size / 2);
            match self.audio.len().checked_sub(reach) {
                Some(room) => room / hop + 1,
                None => 0,
            }
        } else {
            self.audio.len().div_ceil(hop)
        };
        let frames = (available as i64).min(last_needed + 1).max(0) as usize;
        crate::silence::live_frames_from_runs(&ws.silent, &spec_config, frames, &mut ws.live);
        self.geometry = Some(StageGeometry {
            frames,
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
        if let Some((plan, _)) = ws.plan.as_ref() {
            plan.begin(g.frames, &mut ws.spec);
        }
        ws.candidates.clear();
        self.phase = Phase::Spectrogram(0);
    }

    /// Computes up to [`SPECTROGRAM_FRAMES_PER_STEP`] frames of the pass's spectrogram.
    fn spectrogram(&mut self, from: usize) {
        let Some(g) = self.geometry else {
            self.finish_stage();
            return;
        };
        let to = (from + SPECTROGRAM_FRAMES_PER_STEP).min(g.frames);
        let ws = &mut self.ctx.ws;
        let sw = Stopwatch::start();
        if let Some((plan, _)) = ws.plan.as_mut() {
            plan.compute_frames(&self.audio, from..to, &mut ws.spec);
        }
        if to >= g.frames {
            // The pass's noise floor, for SNR estimates at a passband edge.
            let config = &self.stages[self.stage].config;
            if config.snr.passband {
                ws.floor.compute(&ws.spec, &ws.live, config.spectrogram.time_osr);
            } else {
                ws.floor.clear();
            }
        }
        self.timings.spectrogram_s += sw.elapsed_s();
        self.phase = if to < g.frames {
            Phase::Spectrogram(to)
        } else if self.stages[self.stage].config.demod.kind == DemodKind::Block {
            Phase::Baseband
        } else {
            Phase::Search(g.first_frame)
        };
    }

    /// Transforms the pass's audio once for the block demodulator.
    fn baseband(&mut self) {
        let Some(g) = self.geometry else {
            self.finish_stage();
            return;
        };
        let sw = Stopwatch::start();
        let ws = &mut self.ctx.ws;
        ws.block.prepare(self.layout, &self.audio, &mut ws.plans);
        self.timings.baseband_s += sw.elapsed_s();
        self.phase = Phase::Search(g.first_frame);
    }

    /// The spectrogram as the search reads it.
    fn view(&self) -> SymbolView<'_> {
        let config = &self.stages[self.stage].config;
        let sp = &config.spectrogram;
        SymbolView {
            spec: &self.ctx.ws.spec,
            layout: self.layout,
            time_osr: sp.time_osr,
            freq_osr: sp.freq_osr,
            live: if config.search.skip_silent_frames {
                &self.ctx.ws.live
            } else {
                &[]
            },
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

    /// Tries up to [`CANDIDATES_PER_STEP`] candidates, fewer when each tries several sets of
    /// soft bits.
    fn candidates(&mut self, from: usize, found: &mut Vec<Decode>) {
        let Some(g) = self.geometry else {
            self.finish_stage();
            return;
        };
        let total = self.ctx.ws.candidates.len();
        let stage = &self.stages[self.stage];
        let config = &stage.config;
        let pipeline = &stage.pipeline;
        let sp = &config.spectrogram;
        let blocks = config.demod.blocks(self.layout.mode);
        let extra = config.demod.extra_sets(self.layout.mode);
        let spectrogram_llrs = config.demod.uses_spectrogram();
        let sets = usize::from(spectrogram_llrs) + blocks.len() + extra.len();
        let min_sync = config.demod.min_sync(self.layout.mode);
        let to = (from + (CANDIDATES_PER_STEP / sets.max(1)).max(1)).min(total);
        let DecodeContext {
            hashes,
            ap: ap_ctx,
            ws,
        } = &mut self.ctx;
        let hyps: &[Hypothesis] = if config.ap.enabled { &self.hyps } else { &[] };
        let dx_hz = ap_ctx.as_ref().and_then(|c| c.dx_hz);
        let view = SymbolView {
            spec: &ws.spec,
            layout: self.layout,
            time_osr: sp.time_osr,
            freq_osr: sp.freq_osr,
            live: if config.demod.skip_silent_frames {
                &ws.live
            } else {
                &[]
            },
        };
        if from == 0 {
            let sw = Stopwatch::start();
            pipeline
                .refine
                .prepare(self.layout, &self.audio, self.partial, &mut ws.refine);
            self.timings.refine_s += sw.elapsed_s();
        }
        let stats = &mut self.stats;
        let timings = &mut self.timings;
        let mode = self.layout.mode;
        let trace = &mut self.trace;
        let (stage_index, pass) = (self.stage, self.pass);
        for i in from..to {
            let mut cand: Candidate = ws.candidates[i];
            let sw = Stopwatch::start();
            let refined = pipeline.refine.refine(&view, &mut cand, &mut ws.refine);
            timings.refine_s += sw.elapsed_s();
            if refined == Refined::Repeat {
                if let Some(t) = trace.as_mut() {
                    t.push(CandidateTrace {
                        stage: stage_index,
                        pass,
                        freq_hz: view.freq_hz(&cand),
                        dt_s: view.dt_s(&cand),
                        score: cand.score,
                        outcome: TraceOutcome::Repeat,
                    });
                }
                continue;
            }

            // The first set of soft bits goes to `ws.llr`, which a priori decoding reads;
            // later sets to `ws.llr_alt`.
            let mut outcome = LdpcOutcome::default();
            let mut valid = None;
            let mut by_block = None;
            if spectrogram_llrs {
                let sw = Stopwatch::start();
                if refined == Refined::Levels {
                    // Symbol levels read at the refined position: one row per symbol, one
                    // value per tone.
                    let symbols = SymbolView {
                        spec: &ws.refine.symbols,
                        layout: self.layout,
                        time_osr: 1,
                        freq_osr: 1,
                        live: &[],
                    };
                    pipeline
                        .demod
                        .llrs(&symbols, &Candidate::new(0, 0, cand.score), &mut ws.llr);
                } else {
                    pipeline.demod.llrs(&view, &cand, &mut ws.llr);
                }
                timings.demod_s += sw.elapsed_s();
                (outcome, valid) = attempt(
                    pipeline,
                    pipeline.ldpc.as_ref(),
                    self.graph,
                    mode,
                    &ws.llr,
                    &mut ws.ldpc,
                    &mut ws.codeword,
                    hashes,
                    stats,
                    timings,
                );
            }
            if valid.is_none() && !blocks.is_empty() {
                let sw = Stopwatch::start();
                let start_s = view.dt_s(&cand) + self.layout.start_offset_s;
                // Search one grid step either way.
                let reach = (1.0 / sp.time_osr as f32, 1.0 / sp.freq_osr as f32);
                // Candidates whose sync symbols mostly lose to other tones get no block sets.
                let matched = ws
                    .block
                    .amplitudes(self.layout, &mut ws.plans, view.freq_hz(&cand), start_s, reach)
                    .map(|r| r.sync_matched);
                let ready = matched.is_some_and(|m| m >= min_sync);
                // The extra sets only for candidates whose sync stands well above chance.
                let tried = if !ready {
                    0
                } else if matched.is_some_and(|m| m >= config.demod.extra_min_sync(self.layout.mode)) {
                    blocks.len() + extra.len()
                } else {
                    blocks.len()
                };
                timings.refine_s += sw.elapsed_s();
                if !ready && !spectrogram_llrs {
                    // No soft bits, so nothing for a priori decoding either.
                    if let Some(t) = trace.as_mut() {
                        t.push(CandidateTrace {
                            stage: stage_index,
                            pass,
                            freq_hz: view.freq_hz(&cand),
                            dt_s: view.dt_s(&cand),
                            score: cand.score,
                            outcome: TraceOutcome::NoSync,
                        });
                    }
                    continue;
                }
                let block_sets = blocks
                    .iter()
                    .map(|&n| (n, config.demod.block_score))
                    .chain(extra.iter().copied());
                for (k, (n, score)) in block_sets.enumerate().take(tried) {
                    let llr = if k == 0 && !spectrogram_llrs {
                        &mut ws.llr
                    } else {
                        &mut ws.llr_alt
                    };
                    let sw = Stopwatch::start();
                    ws.block
                        .llrs(self.layout, usize::from(n), score, config.demod.llr_variance, llr);
                    timings.demod_s += sw.elapsed_s();
                    let ldpc: &dyn LdpcDecoder = if config.demod.bp_only_blocks.contains(&n) {
                        &pipeline.bp_only
                    } else {
                        pipeline.ldpc.as_ref()
                    };
                    (outcome, valid) = attempt(
                        pipeline,
                        ldpc,
                        self.graph,
                        mode,
                        llr,
                        &mut ws.ldpc,
                        &mut ws.codeword,
                        hashes,
                        stats,
                        timings,
                    );
                    if valid.is_some() {
                        by_block = Some(n);
                        break;
                    }
                }
            }
            // A candidate that did not decode is tried with what the QSO under way lets the
            // decoder expect.
            let mut found_by: Option<ApKind> = None;
            if valid.is_none() && !hyps.is_empty() {
                let sw = Stopwatch::start();
                let near = dx_hz.is_some_and(|hz| (view.freq_hz(&cand) - hz).abs() <= config.ap.width_hz);
                if let Some((v, o, kind)) = ap::try_hypotheses(
                    hyps,
                    &config.ap,
                    near,
                    &ws.llr,
                    &mut ws.ap_llr,
                    &mut ws.codeword,
                    self.graph,
                    pipeline.ldpc.as_ref(),
                    config.ldpc.max_iterations,
                    &mut ws.ldpc,
                    pipeline.validator.as_ref(),
                    self.layout.mode,
                    hashes,
                ) {
                    valid = Some(v);
                    outcome = o;
                    found_by = Some(kind);
                }
                timings.ldpc_s += sw.elapsed_s();
            }
            let mut record = |outcome: TraceOutcome| {
                if let Some(t) = trace.as_mut() {
                    t.push(CandidateTrace {
                        stage: stage_index,
                        pass,
                        freq_hz: view.freq_hz(&cand),
                        dt_s: view.dt_s(&cand),
                        score: cand.score,
                        outcome,
                    });
                }
            };
            let Some(valid) = valid else {
                record(if outcome.converged {
                    TraceOutcome::Rejected
                } else {
                    TraceOutcome::NoCodeword
                });
                continue;
            };
            let sw = Stopwatch::start();
            if pipeline.validator.is_duplicate(&valid, &ws.seen) {
                stats.duplicates += 1;
                timings.validate_s += sw.elapsed_s();
                record(TraceOutcome::Duplicate);
                continue;
            }
            let tones = rr73_ft8::tones::from_payload(self.layout.mode, &valid.payload);
            let snr_db = g
                .snr
                .estimate(&view, &cand, &tones, &ws.live, ws.floor.db(), &mut ws.noise);
            // An OSD codeword claiming an SNR below what decoding reaches is noise; an AP decode
            // has its own floor.
            if (found_by.is_none() && outcome.osd && snr_db < config.validate.osd_floor_db(self.layout.mode))
                || (found_by.is_some() && snr_db < config.ap.min_snr_db)
            {
                stats.implausible += 1;
                timings.validate_s += sw.elapsed_s();
                record(TraceOutcome::BelowFloor);
                continue;
            }
            ws.seen.push(valid.payload);
            hashes.learn(&valid.message);
            stats.ap_decodes += u32::from(found_by.is_some());
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
                ap: found_by,
                block: if found_by.is_some() { None } else { by_block },
            };
            record(TraceOutcome::Decoded(self.decodes.len()));
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

/// Decodes one set of soft bits with `decoder`, then validates a codeword with the stage's
/// validator.
#[allow(clippy::too_many_arguments)]
fn attempt(
    pipeline: &Pipeline,
    decoder: &dyn LdpcDecoder,
    graph: &ParityGraph,
    mode: Mode,
    llr: &[f32; crate::layout::CODEWORD_BITS],
    ldpc: &mut LdpcScratch,
    codeword: &mut [u8; crate::layout::CODEWORD_BITS],
    hashes: &mut rr73_ft8::CallsignHashes,
    stats: &mut DecodeStats,
    timings: &mut StageTimings,
) -> (LdpcOutcome, Option<Validated>) {
    let sw = Stopwatch::start();
    stats.ldpc_attempts += 1;
    let outcome = decoder.decode(graph, llr, ldpc, codeword);
    timings.ldpc_s += sw.elapsed_s();
    if !outcome.converged {
        return (outcome, None);
    }
    stats.ldpc_converged += 1;
    stats.osd_codewords += u32::from(outcome.osd);
    let sw = Stopwatch::start();
    let valid = match pipeline.validator.validate(mode, codeword, &outcome, hashes) {
        Ok(v) => Some(v),
        Err(r) => {
            match r {
                Rejection::Crc => stats.crc_failures += 1,
                Rejection::ZeroPayload => stats.zero_payloads += 1,
                Rejection::Unpack(_) => stats.unpack_failures += 1,
                Rejection::Implausible => stats.implausible += 1,
            }
            None
        }
    };
    timings.validate_s += sw.elapsed_s();
    (outcome, valid)
}
