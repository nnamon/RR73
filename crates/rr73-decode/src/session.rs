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
use crate::block::Interferer;
use crate::clock::Stopwatch;
use crate::config::{DecoderConfig, DemodKind, SubtractKind};
use crate::layout::FrameLayout;
use crate::ldpc::{LdpcDecoder, LdpcOutcome, LdpcScratch, ParityGraph};
use crate::pipeline::{DecodeContext, Pipeline, SAMPLE_RATE, SlotAudio, Workspace, layout};
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

/// Most channel symbols of a layout (FT4).
const MAX_SYMBOLS: usize = 105;

/// A candidate of the pass that got block soft bits (experiment 0012): one that failed, kept for
/// a retry with its neighbours removed and as a neighbour of other retries, or one that
/// decoded, kept to be removed from its neighbours' retries.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Tried {
    /// The search position, from which a retry refines again.
    cand: Candidate,
    /// Tone 0 at the refined position, in Hz.
    freq_hz: f64,
    /// Start of symbol 0 at the refined position, in seconds from the slot start.
    start_s: f64,
    /// Sync symbols on their sent tone there.
    sync: usize,
    /// Channel tones: the hard decisions of its soft bits, or the message's when `known` is set.
    tones: [u8; MAX_SYMBOLS],
    /// Sync strong enough to serve as a hypothesis.
    hypothesis: bool,
    /// Decoded, in the pass or by a retry: `tones` are the message's.
    known: bool,
    /// Decoded by a retry, here or as the signal of another record.
    done: bool,
    /// Times queued for a retry.
    queued: u8,
}

impl Tried {
    /// `true` when `other` is the same signal: within a quarter tone spacing and a quarter
    /// symbol.
    fn same_signal(&self, other: &Tried, layout: &FrameLayout) -> bool {
        (self.freq_hz - other.freq_hz).abs() < 0.25 * f64::from(layout.tone_spacing_hz)
            && (self.start_s - other.start_s).abs() < 0.25 * f64::from(layout.symbol_s())
    }

    /// `true` when the two signals share spectrum: their base tones lie closer than the
    /// signal's bandwidth.
    fn overlaps(&self, other: &Tried, layout: &FrameLayout) -> bool {
        (self.freq_hz - other.freq_hz).abs() < (layout.tones as f32 * layout.tone_spacing_hz) as f64
    }

    /// The signal as an interferer to remove from a neighbour's baseband.
    fn interferer(&self, layout: &FrameLayout) -> Interferer<'_> {
        Interferer {
            tones: &self.tones[..layout.symbols.min(MAX_SYMBOLS)],
            freq_hz: self.freq_hz,
            start_s: self.start_s,
        }
    }
}

/// Most decoded neighbours removed for one retry.
const MAX_KNOWN: usize = 4;

/// Most neighbours removed for one retry: decoded ones and up to four hypotheses.
const MAX_INTERFERERS: usize = MAX_KNOWN + 4;

/// Channel tones from the hard decisions of `llr` (positive for bit 1): sync symbols at
/// their known tones, ramp symbols at tone 0, data symbols Gray-mapped.
fn hard_tones(layout: &FrameLayout, llr: &[f32; crate::layout::CODEWORD_BITS], out: &mut [u8; MAX_SYMBOLS]) {
    out.fill(0);
    for g in &layout.sync {
        for (k, &t) in g.tones.iter().enumerate() {
            if let Some(o) = out.get_mut(g.start + k) {
                *o = t;
            }
        }
    }
    let bps = layout.bits_per_symbol;
    for (k, &sym) in layout.data.iter().enumerate() {
        let bits = &llr[(k * bps).min(llr.len())..((k + 1) * bps).min(llr.len())];
        let v = bits
            .iter()
            .fold(0usize, |acc, &l| (acc << 1) | usize::from(l > 0.0));
        if let (Some(o), Some(&t)) = (out.get_mut(sym), layout.gray.get(v)) {
            *o = t;
        }
    }
}

/// Sync symbols of `cand` whose sent tone is the strongest of the symbol's tones on the
/// spectrogram's grid.
fn grid_sync(view: &SymbolView<'_>, cand: &Candidate) -> usize {
    let layout = view.layout;
    let mut n = 0;
    for g in &layout.sync {
        for (k, &sent) in g.tones.iter().enumerate() {
            let Some(row) = view.row(view.symbol_frame(cand.frame, g.start + k)) else {
                continue;
            };
            let level = |t: usize| {
                usize::try_from(view.tone_bin(cand.bin, t))
                    .ok()
                    .and_then(|b| row.get(b))
                    .copied()
                    .unwrap_or(f32::NEG_INFINITY)
            };
            let own = level(usize::from(sent));
            if own.is_finite() && (0..layout.tones).all(|t| level(t) <= own) {
                n += 1;
            }
        }
    }
    n
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
    /// Retry the pass's failed candidates under their neighbours from this one onward
    /// (experiment 0012).
    Pairs(usize),
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
            Phase::Pairs(_) => "pairs",
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
            Phase::Pairs(k) => self.pairs(k, &mut out.decodes),
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
        ws.tried.clear();
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
        // With weak candidates in one mode only, the search took the lower floor of the two.
        let config = &self.stages[self.stage].config;
        if config.search.ft8_weak_score_db.is_some() || config.search.ft4_weak_score_db.is_some() {
            let floor = config.score_floor_db(self.layout.mode);
            chunk.retain(|c| c.score >= floor);
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
        let pairs_on = pairs_enabled(config);
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
            // Where the block demodulator put the candidate, when it gave soft bits.
            let mut block_at = None;
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
                // A weak candidate first needs its sync tones to stand out on the search grid,
                // which costs no baseband.
                let weak = cand.score < config.search.min_score_db;
                let at = if weak && grid_sync(&view, &cand) < config.demod.weak_grid_sync(mode) {
                    None
                } else {
                    ws.block
                        .amplitudes(self.layout, &mut ws.plans, view.freq_hz(&cand), start_s, reach)
                };
                let matched = at.map(|r| r.sync_matched);
                let ready = matched.is_some_and(|m| m >= config.block_min_sync(mode, cand.score));
                if ready {
                    block_at = at;
                }
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
                // Kept for retries under an overlapping signal at the end of the pass.
                if let Some(at) = block_at.filter(|_| pairs_on) {
                    let (hyp_sync, target_sync) = config.pairs.min_sync(mode);
                    if at.sync_matched >= hyp_sync.min(target_sync) {
                        let mut failed = Tried {
                            cand,
                            freq_hz: at.freq_hz,
                            start_s: at.start_s,
                            sync: at.sync_matched,
                            tones: [0; MAX_SYMBOLS],
                            hypothesis: at.sync_matched >= hyp_sync,
                            known: false,
                            done: false,
                            queued: 0,
                        };
                        ws.block.llrs(
                            self.layout,
                            usize::from(config.pairs.block),
                            crate::block::BlockScore::Amplitude,
                            config.demod.llr_variance,
                            &mut ws.llr_alt,
                        );
                        hard_tones(self.layout, &ws.llr_alt, &mut failed.tones);
                        ws.tried.push(failed);
                    }
                }
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
            // A decode's refined place and tones, so the pass's retries can remove it from its
            // neighbours.
            if let Some(at) = block_at.filter(|_| pairs_on && found_by.is_none()) {
                let mut known = Tried {
                    cand,
                    freq_hz: at.freq_hz,
                    start_s: at.start_s,
                    sync: at.sync_matched,
                    tones: [0; MAX_SYMBOLS],
                    hypothesis: false,
                    known: true,
                    done: true,
                    queued: 0,
                };
                let n = tones.len().min(MAX_SYMBOLS);
                known.tones[..n].copy_from_slice(&tones[..n]);
                ws.tried.push(known);
            }
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
        if pairs_on {
            self.plan_pairs();
            self.phase = Phase::Pairs(0);
        } else {
            self.end_pass();
        }
    }

    /// After the pass's candidates and retries: a pass that found nothing new leaves the
    /// residual as it was, so the stage ends. So does the last pass, whose decodes the next
    /// stage subtracts first.
    fn end_pass(&mut self) {
        let passes = self.stages[self.stage].config.passes.max(1);
        if self.pass >= passes || self.decodes.len() == self.pass_start {
            self.finish_stage();
        } else {
            self.phase = Phase::Subtract(self.pass_start);
        }
    }

    /// Queues the pass's failed candidates for retries under their neighbours: one per
    /// signal, strongest sync first, at most `pairs.max_retries`.
    fn plan_pairs(&mut self) {
        let config = &self.stages[self.stage].config;
        let layout = self.layout;
        let (_, target_sync) = config.pairs.min_sync(layout.mode);
        // Decoded neighbours alone call for a retry only in the stage's last pass: a later pass
        // would see them subtracted.
        let last = self.pass >= config.passes.max(1);
        let ws = &mut self.ctx.ws;
        ws.pair_order.clear();
        ws.pair_order
            .extend((0..ws.tried.len()).filter(|&i| !ws.tried[i].done && ws.tried[i].sync >= target_sync));
        let failed = &ws.tried;
        ws.pair_order.sort_by(|&a, &b| {
            failed[b]
                .sync
                .cmp(&failed[a].sync)
                .then(failed[b].cand.score.total_cmp(&failed[a].cand.score))
        });
        let mut kept = 0;
        for k in 0..ws.pair_order.len() {
            let i = ws.pair_order[k];
            let repeat = ws.pair_order[..kept]
                .iter()
                .any(|&j| ws.tried[j].same_signal(&ws.tried[i], layout));
            // A candidate with no neighbour to remove is not worth a retry.
            let alone = !ws.tried.iter().any(|f| {
                (f.hypothesis || (f.known && last))
                    && f.overlaps(&ws.tried[i], layout)
                    && !f.same_signal(&ws.tried[i], layout)
            });
            // A failed place of a signal the pass decoded elsewhere.
            let decoded = ws
                .tried
                .iter()
                .any(|f| f.known && f.same_signal(&ws.tried[i], layout));
            if !repeat && !alone && !decoded && kept < config.pairs.max_retries {
                ws.pair_order[kept] = i;
                ws.tried[i].queued = 1;
                kept += 1;
            }
        }
        ws.pair_order.truncate(kept);
    }

    /// Retries queued candidate `k` with its neighbours removed from its baseband (one
    /// retry per step), then ends the pass.
    fn pairs(&mut self, k: usize, found: &mut Vec<Decode>) {
        let Some(&j) = self.ctx.ws.pair_order.get(k) else {
            self.end_pass();
            return;
        };
        self.phase = Phase::Pairs(k + 1);
        let layout = self.layout;
        let config = &self.stages[self.stage].config;
        let most = usize::from(config.pairs.max_interferers).min(MAX_INTERFERERS - MAX_KNOWN);
        let (max_retries, target_sync) = (config.pairs.max_retries, config.pairs.min_sync(layout.mode).1);
        let ws = &mut self.ctx.ws;
        let target = ws.tried[j];
        if target.done {
            return;
        }
        // The neighbours to remove: decoded ones first, then hypotheses, each by sync.
        let mut with = [0usize; MAX_INTERFERERS];
        let mut n = 0;
        for (known, room) in [(true, MAX_KNOWN), (false, most)] {
            let until = (n + room).min(MAX_INTERFERERS);
            while n < until {
                let failed = &ws.tried;
                let next = (0..failed.len())
                    .filter(|&i| {
                        let f = &failed[i];
                        let usable = if known {
                            f.known
                        } else {
                            f.hypothesis && !f.done && !f.known
                        };
                        usable
                            && f.overlaps(&target, layout)
                            && !f.same_signal(&target, layout)
                            && !with[..n].iter().any(|&w| failed[w].same_signal(f, layout))
                    })
                    .max_by(|&a, &b| failed[a].sync.cmp(&failed[b].sync).then(b.cmp(&a)));
                let Some(i) = next else {
                    break;
                };
                with[n] = i;
                n += 1;
            }
        }
        if n == 0 {
            return;
        }
        self.stats.pair_retries += 1;
        let Some(by) = self.retry(j, &with[..n], found) else {
            return;
        };
        // A decode changes what its neighbours see: queue again those already tried.
        let ws = &mut self.ctx.ws;
        let decoded = ws.tried[by];
        for i in 0..ws.tried.len() {
            let f = ws.tried[i];
            if ws.pair_order.len() >= max_retries {
                break;
            }
            if f.done || f.queued != 1 || f.sync < target_sync || !f.overlaps(&decoded, layout) {
                continue;
            }
            if ws
                .pair_order
                .iter()
                .skip(k + 1)
                .any(|&q| ws.tried[q].same_signal(&f, layout))
            {
                continue;
            }
            ws.tried[i].queued = 2;
            ws.pair_order.push(i);
        }
    }

    /// Gives failed candidate `j` its block sets again with the signals of the records `with`
    /// removed from its baseband, and keeps a decode as [`DecodeSession::candidates`] does. When
    /// the message also matches the hard decisions of an overlapping failed candidate far above
    /// chance, both carry it (a transmitter's distortion copies a signal some tone spacings
    /// away), and the decode goes to the one with the stronger sync. Returns the record whose
    /// signal decoded.
    fn retry(&mut self, j: usize, with: &[usize], found: &mut Vec<Decode>) -> Option<usize> {
        let g = self.geometry?;
        let layout = self.layout;
        let mode = layout.mode;
        let stage = &self.stages[self.stage];
        let (config, pipeline) = (&stage.config, &stage.pipeline);
        let sp = &config.spectrogram;
        let blocks = config.demod.blocks(mode);
        let extra = config.demod.extra_sets(mode);
        let DecodeContext { hashes, ws, .. } = &mut self.ctx;
        let Workspace {
            block,
            plans,
            spec,
            live,
            llr_alt,
            ldpc,
            codeword,
            seen,
            noise,
            floor,
            tried: failed,
            ..
        } = ws;
        let (spec, live, floor): (&rr73_dsp::Spectrogram, &[bool], &crate::passband::NoiseFloor) =
            (spec, live, floor);
        let view = SymbolView {
            spec,
            layout,
            time_osr: sp.time_osr,
            freq_osr: sp.freq_osr,
            live: if config.demod.skip_silent_frames {
                live
            } else {
                &[]
            },
        };
        let cand = failed[j].cand;
        let record = |trace: &mut Option<Vec<CandidateTrace>>, at: &Candidate, outcome: TraceOutcome| {
            if let Some(t) = trace.as_mut() {
                t.push(CandidateTrace {
                    stage: self.stage,
                    pass: self.pass,
                    freq_hz: view.freq_hz(at),
                    dt_s: view.dt_s(at),
                    score: at.score,
                    outcome,
                });
            }
        };
        let sw = Stopwatch::start();
        let interferers: [Interferer<'_>; MAX_INTERFERERS] = std::array::from_fn(|i| {
            let f = &failed[with.get(i).copied().unwrap_or(j)];
            f.interferer(layout)
        });
        let start_s = view.dt_s(&cand) + layout.start_offset_s;
        let reach = (1.0 / sp.time_osr as f32, 1.0 / sp.freq_osr as f32);
        let matched = block
            .amplitudes_without(
                layout,
                plans,
                view.freq_hz(&cand),
                start_s,
                reach,
                &interferers[..with.len().min(MAX_INTERFERERS)],
            )
            .map(|r| r.sync_matched);
        self.timings.refine_s += sw.elapsed_s();
        let Some(m) = matched.filter(|&m| m >= config.demod.min_sync(mode)) else {
            record(&mut self.trace, &cand, TraceOutcome::NoSync);
            return None;
        };
        let tried = if m >= config.demod.extra_min_sync(mode) {
            blocks.len() + extra.len()
        } else {
            blocks.len()
        };
        let sets = blocks
            .iter()
            .map(|&n| (n, config.demod.block_score))
            .chain(extra.iter().copied());
        let (mut outcome, mut valid, mut by_block) = (LdpcOutcome::default(), None, None);
        for (n, score) in sets.take(tried) {
            let sw = Stopwatch::start();
            block.llrs(layout, usize::from(n), score, config.demod.llr_variance, llr_alt);
            self.timings.demod_s += sw.elapsed_s();
            let decoder: &dyn LdpcDecoder = if config.demod.bp_only_blocks.contains(&n) {
                &pipeline.bp_only
            } else {
                pipeline.ldpc.as_ref()
            };
            (outcome, valid) = attempt(
                pipeline,
                decoder,
                self.graph,
                mode,
                llr_alt,
                ldpc,
                codeword,
                hashes,
                &mut self.stats,
                &mut self.timings,
            );
            if valid.is_some() {
                by_block = Some(n);
                break;
            }
        }
        let Some(valid) = valid else {
            let outcome = if outcome.converged {
                TraceOutcome::Rejected
            } else {
                TraceOutcome::NoCodeword
            };
            record(&mut self.trace, &cand, outcome);
            return None;
        };
        let sw = Stopwatch::start();
        if pipeline.validator.is_duplicate(&valid, seen) {
            self.stats.duplicates += 1;
            self.timings.validate_s += sw.elapsed_s();
            record(&mut self.trace, &cand, TraceOutcome::Duplicate);
            return None;
        }
        let tones = rr73_ft8::tones::from_payload(mode, &valid.payload);
        // The neighbour whose hard decisions match the message's data symbols far above chance
        // (one symbol in `layout.tones`): six standard deviations above it, 23 of 58 symbols in
        // FT8 and 46 of 87 in FT4, which no unrelated message reaches.
        let n = layout.data.len() as f64;
        let p = 1.0 / layout.tones as f64;
        let least = n * p + 6.0 * (n * p * (1.0 - p)).sqrt();
        let agree = |f: &Tried| {
            let same = layout
                .data
                .iter()
                .filter(|&&s| tones.get(s).is_some_and(|&t| f.tones.get(s) == Some(&t)))
                .count();
            same as f64 >= least
        };
        // Of the target and the neighbours carrying the same message, the strongest sync is the
        // signal; the others are copies of it, as a transmitter's distortion makes.
        let target = failed[j];
        let by = (0..failed.len())
            .filter(|&w| {
                let f = &failed[w];
                w == j
                    || (!f.known
                        && !f.done
                        && f.overlaps(&target, layout)
                        && !f.same_signal(&target, layout)
                        && agree(f))
            })
            .max_by(|&a, &b| failed[a].sync.cmp(&failed[b].sync).then((a == j).cmp(&(b == j))))
            .unwrap_or(j);
        let at = failed[by].cand;
        // The neighbours removed from the baseband are still in the spectrogram: the signal is
        // read only at symbols whose tone no neighbour's tone comes within 1.5 spacings of.
        let me = failed[by];
        let near: [Option<&Tried>; MAX_INTERFERERS + 1] = std::array::from_fn(|i| match with.get(i) {
            Some(&w) => Some(&failed[w]),
            None if i == with.len() && by != j => Some(&failed[j]),
            None => None,
        });
        let clear = |k: usize| {
            let Some(&t) = tones.get(k) else {
                return true;
            };
            let spacing = f64::from(layout.tone_spacing_hz);
            let symbol = f64::from(layout.symbol_s());
            let hz = me.freq_hz + f64::from(t) * spacing;
            let s = me.start_s + k as f64 * symbol;
            near.iter().flatten().all(|n| {
                let from = ((s - n.start_s) / symbol).floor();
                [from, from + 1.0].iter().all(|&q| {
                    let q = q as isize;
                    match usize::try_from(q)
                        .ok()
                        .and_then(|q| n.tones.get(q).filter(|_| q < layout.symbols))
                    {
                        Some(&u) => (n.freq_hz + f64::from(u) * spacing - hz).abs() >= 1.5 * spacing,
                        None => true,
                    }
                })
            })
        };
        let kept = (0..layout.symbols).filter(|&k| clear(k)).count();
        let snr_db = if kept >= layout.symbols / 4 {
            g.snr
                .estimate_where(&view, &at, &tones, live, floor.db(), &clear, noise)
        } else {
            g.snr.estimate(&view, &at, &tones, live, floor.db(), noise)
        };
        if outcome.osd && snr_db < config.validate.osd_floor_db(mode) {
            self.stats.implausible += 1;
            self.timings.validate_s += sw.elapsed_s();
            record(&mut self.trace, &at, TraceOutcome::BelowFloor);
            return None;
        }
        seen.push(valid.payload);
        hashes.learn(&valid.message);
        let decode = Decode {
            text: valid.text,
            message: valid.message,
            payload: valid.payload,
            freq_hz: view.freq_hz(&at),
            dt_s: view.dt_s(&at),
            snr_db,
            pass: self.pass,
            ldpc_iterations: outcome.iterations,
            hard_errors: outcome.hard_errors,
            score: at.score,
            osd: outcome.osd,
            osd_distance: outcome.distance,
            ap: None,
            block: by_block,
        };
        record(&mut self.trace, &at, TraceOutcome::Decoded(self.decodes.len()));
        found.push(decode.clone());
        self.decodes.push(decode);
        self.stage_of.push(self.stage);
        self.timings.validate_s += sw.elapsed_s();
        // The signal is known now: its records are done, and it is removed exactly from the
        // neighbours retried after it.
        let me = failed[by];
        for f in failed.iter_mut() {
            if f.same_signal(&me, layout) {
                f.done = true;
            }
        }
        let f = &mut failed[by];
        f.known = true;
        f.tones[..tones.len().min(MAX_SYMBOLS)].copy_from_slice(&tones[..tones.len().min(MAX_SYMBOLS)]);
        Some(by)
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

/// `true` when `config` retries failed candidates under overlapping signals: it asks for them,
/// and the block demodulator and the model subtraction they need are in use.
fn pairs_enabled(config: &DecoderConfig) -> bool {
    config.pairs.enabled
        && config.demod.kind == DemodKind::Block
        && config.subtract.kind == SubtractKind::Model
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
