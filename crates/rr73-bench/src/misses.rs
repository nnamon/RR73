//! `rr73-bench misses`: where the reference decodes a run misses are lost.
//!
//! Each recorded slot is decoded as `run` decodes it (the preset and any `--then` stages) with
//! the session's candidate trace on. Every reference entry the run does not match is then
//! placed in one class:
//!
//! - `hashed`: the reference prints a callsign from its hash table (`<K1ABC>`), which a decoder
//!   that sees one slot cannot resolve.
//! - `elsewhere`: the run decoded the same text in the slot, outside the match tolerance.
//! - `unpackable`: the text does not pack, so the transmitted codeword is unknown.
//! - `dt-range`: the entry's DT lies outside every stage's search range.
//! - `search`: no candidate of any stage or pass lay within 3.2 Hz and 0.09 s of the entry.
//! - `other-text`: a candidate there decoded as a different message.
//! - `failed`: candidates lay there and none decoded.
//!
//! For each miss the transmitted codeword is rebuilt from the text and the spectrogram cells
//! within 5 Hz and 0.25 s of the entry are read as the demodulator reads them. The position
//! with the fewest hard errors against the codeword is the genie position; at it the stage's
//! belief propagation and OSD are run. This is measured on the original audio and on the
//! residual left after subtracting every decode of the run, on the preset's grid (2 frames
//! per symbol, 2 bins per tone spacing) and on the finest later-stage grid (8 and 4, 2-symbol
//! window): a miss that decodes at the genie position on the residual was lost by the search
//! or the grid, one that decodes on the original audio only was damaged by subtraction.

use std::path::PathBuf;

use rayon::prelude::*;
use rr73_corpus::{Entry, SlotMode, Tolerance, discover, match_entries, normalise_text, read_slot};
use rr73_decode::block::{BlockScore, BlockWorkspace};
use rr73_decode::demod::{Demodulator, MaxLogDemod};
use rr73_decode::layout::{CODEWORD_BITS, FrameLayout};
use rr73_decode::ldpc::{LdpcDecoder, LdpcScratch, ParityGraph, SumProduct};
use rr73_decode::refine::{BasebandRefine, RefineScratch, Refined};
use rr73_decode::search::CostasSearch;
use rr73_decode::stages::Subtractor;
use rr73_decode::subtract::{ModelSubtract, SubtractScratch};
use rr73_decode::view::SymbolView;
use rr73_decode::{
    Candidate, CandidateTrace, Decode, DecodeContext, DecodeSession, DecoderConfig, Pipeline, SlotAudio,
    Stage, TraceOutcome,
};
use rr73_dsp::{FftPlans, Spectrogram, SpectrogramConfig, SpectrogramPlan};
use rr73_ft8::{CallsignHashes, Message, Mode};
use serde::Serialize;

/// Options of `rr73-bench misses`.
#[derive(Clone, Debug)]
pub struct MissOptions {
    /// Preset of the first stage.
    pub preset: String,
    /// Overrides of the first stage.
    pub overrides: Vec<String>,
    /// Later stages, as for `run --then`.
    pub then: Vec<String>,
    /// Corpus paths; slots without a reference list are skipped.
    pub paths: Vec<PathBuf>,
    /// Threads (default all CPUs).
    pub threads: Option<usize>,
    /// Reference key, as for `run`.
    pub reference: Option<String>,
    /// Decode each search, failed and other-text miss again with every other reference entry
    /// subtracted ([`Miss::oracle`]).
    pub oracle: bool,
}

/// Distance in frequency within which a candidate counts as near an entry, in Hz.
const NEAR_HZ: f32 = 3.2;
/// Distance in DT within which a candidate counts as near an entry, in seconds.
const NEAR_S: f32 = 0.09;
/// Genie search half-widths around the entry: frequency in Hz and DT in seconds.
const GENIE_HZ: f32 = 5.0;
const GENIE_S: f32 = 0.25;

/// What the genie position gives on one audio and grid.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Genie {
    /// Fewest hard errors against the transmitted codeword over the positions searched.
    pub hard_errors: u32,
    /// Frequency of that position, in Hz.
    pub freq_hz: f32,
    /// DT of that position, in seconds.
    pub dt_s: f32,
    /// Sync score there, in dB.
    pub score: f32,
    /// Belief propagation (25 iterations) returns the transmitted codeword there.
    pub bp: bool,
    /// The first stage's LDPC decoder (BP, then OSD in the OSD presets) returns it.
    pub ldpc: bool,
}

/// What the block demodulator (`demod.kind=block`) makes of a miss at its reference
/// position: refined within half a symbol and half a tone spacing, as from a candidate.
#[derive(Clone, Debug, Default, Serialize)]
pub struct BlockGenie {
    /// Sync symbols on their sent tone at the refined position (of 21 in FT8, 16 in FT4).
    pub sync_matched: usize,
    /// Hard errors against the transmitted codeword, for each block length of the stage.
    pub hard_errors: Vec<u32>,
    /// The stage's LDPC decoder returns the codeword from one of the block sets.
    pub ldpc: bool,
}

/// The candidate nearest a missed entry.
#[derive(Clone, Debug, Serialize)]
pub struct NearCandidate {
    /// Stage index.
    pub stage: usize,
    /// Pass within the stage.
    pub pass: u32,
    /// Frequency difference to the entry, in Hz.
    pub df_hz: f32,
    /// DT difference to the entry, in seconds.
    pub ddt_s: f32,
    /// Sync score, in dB.
    pub score: f32,
    /// What decoding made of it.
    pub outcome: String,
}

/// One missed reference entry.
#[derive(Clone, Debug, Serialize)]
pub struct Miss {
    /// Slot WAV path.
    pub path: String,
    /// Reference text, frequency (Hz), DT (s) and SNR (dB).
    pub text: String,
    /// Reference frequency, in Hz.
    pub freq_hz: f64,
    /// Reference DT, in seconds.
    pub dt_s: f64,
    /// Reference SNR, in dB.
    pub snr_db: f64,
    /// Class, see the module documentation.
    pub class: String,
    /// Frequency difference to the nearest other reference entry in the slot, in Hz.
    pub neighbour_hz: Option<f64>,
    /// Other reference entries within 50 Hz (overlapping FT8 bands).
    pub overlapping_refs: usize,
    /// Decodes of the run within 50 Hz.
    pub overlapping_decodes: usize,
    /// Candidates within 3.2 Hz and 0.09 s, over every stage and pass.
    pub near_candidates: usize,
    /// The nearest of them.
    pub nearest: Option<NearCandidate>,
    /// Genie on the original audio, preset grid.
    pub orig_grid: Option<Genie>,
    /// Genie on the original audio, fine grid.
    pub orig_fine: Option<Genie>,
    /// Genie on the residual, preset grid.
    pub resid_grid: Option<Genie>,
    /// Genie on the residual, fine grid.
    pub resid_fine: Option<Genie>,
    /// Genie on the original audio: the fine grid's genie position refined on a baseband
    /// (`refine.kind=baseband`), with the symbol levels read there.
    pub orig_refined: Option<Genie>,
    /// The same on the residual.
    pub resid_refined: Option<Genie>,
    /// The block demodulator at the reference position on the original audio.
    pub orig_block: Option<BlockGenie>,
    /// The same on the residual.
    pub resid_block: Option<BlockGenie>,
    /// The same on the original audio with every other reference entry subtracted (with
    /// `--oracle`).
    pub oracle_block: Option<BlockGenie>,
    /// With `--oracle`: whether the stages decode the entry from the original audio with every
    /// other reference entry subtracted, strongest first. A miss that decodes there was lost
    /// to its neighbours: ones the run did not decode, or the residue of ones it did.
    pub oracle: Option<bool>,
}

/// Counts for one slot.
#[derive(Clone, Debug, Default, Serialize)]
pub struct SlotCounts {
    /// Slot path.
    pub path: String,
    /// Reference entries.
    pub expected: usize,
    /// Entries matched.
    pub matched: usize,
}

/// The whole report.
#[derive(Clone, Debug, Serialize)]
pub struct MissReport {
    /// Preset and stages.
    pub preset: String,
    /// Overrides of the first stage.
    pub overrides: Vec<String>,
    /// Later stages.
    pub then: Vec<String>,
    /// Per-slot counts.
    pub slots: Vec<SlotCounts>,
    /// Every missed entry.
    pub misses: Vec<Miss>,
}

/// The spectrogram grids the genie reads: the preset's and the finest later stage's.
const GRIDS: [(usize, usize, Option<usize>); 2] = [(2, 2, None), (8, 4, Some(2))];

/// Runs the analysis and returns the report.
pub fn misses(opts: &MissOptions) -> Result<MissReport, String> {
    let first = DecoderConfig::preset(&opts.preset)
        .and_then(|c| c.with_overrides(&opts.overrides))
        .map_err(|e| e.to_string())?;
    let mut stages = vec![(opts.preset.clone(), first)];
    for spec in &opts.then {
        stages.push(crate::run::stage_spec(spec)?);
    }
    let files = discover(&opts.paths).map_err(|e| e.to_string())?;
    let threads = opts
        .threads
        .unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1))
        .max(1);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .build()
        .map_err(|e| e.to_string())?;
    let reference = opts.reference.as_deref();
    let per_slot: Vec<Option<(SlotCounts, Vec<Miss>)>> = pool.install(|| {
        files
            .par_iter()
            .map(|f| {
                let slot = read_slot(f).ok()?;
                let mode = match slot.meta.mode {
                    SlotMode::Ft8 => Mode::Ft8,
                    SlotMode::Ft4 => Mode::Ft4,
                    _ => return None,
                };
                let expected = slot.meta.expected(reference);
                if expected.is_empty() || slot.meta.truth.is_some() {
                    return None;
                }
                Some(analyse_slot(
                    &f.wav.display().to_string(),
                    &slot.samples,
                    mode,
                    expected,
                    &stages,
                    opts.oracle,
                ))
            })
            .collect()
    });
    let mut slots = Vec::new();
    let mut all = Vec::new();
    for (counts, m) in per_slot.into_iter().flatten() {
        slots.push(counts);
        all.extend(m);
    }
    slots.sort_by(|a, b| a.path.cmp(&b.path));
    all.sort_by(|a, b| a.path.cmp(&b.path).then(a.freq_hz.total_cmp(&b.freq_hz)));
    Ok(MissReport {
        preset: opts.preset.clone(),
        overrides: opts.overrides.clone(),
        then: opts.then.clone(),
        slots,
        misses: all,
    })
}

fn analyse_slot(
    path: &str,
    samples: &[f32],
    mode: Mode,
    expected: &[Entry],
    stages: &[(String, DecoderConfig)],
    oracle: bool,
) -> (SlotCounts, Vec<Miss>) {
    let layout = rr73_decode::pipeline::layout(mode);
    let audio = SlotAudio::new(samples, mode);
    let session_stages = stages
        .iter()
        .map(|(name, c)| Stage::new(name.clone(), c.clone()))
        .collect();
    let mut session = DecodeSession::with_context(&audio, session_stages, DecodeContext::new());
    session.set_trace(true);
    session.run_to_end();
    let decodes = session.decodes().to_vec();
    let trace: Vec<CandidateTrace> = session.trace().to_vec();

    let entries: Vec<Entry> = decodes
        .iter()
        .map(|d| Entry {
            text: d.text.clone(),
            freq_hz: f64::from(d.freq_hz),
            dt_s: f64::from(d.dt_s),
            snr_db: f64::from(d.snr_db),
        })
        .collect();
    let score = match_entries(&entries, expected, Tolerance::default());

    // The residual with every decode removed, in the order found, as the session subtracts.
    let sub = &stages[0].1.subtract;
    let subtractor = ModelSubtract {
        smooth_s: sub.smooth_s,
        refine: sub.refine,
    };
    let mut residual = samples.to_vec();
    subtractor.subtract(layout, &mut residual, &decodes, &mut SubtractScratch::default());

    let mut plans = FftPlans::new();
    let specs: Vec<[Spectrogram; 2]> = GRIDS
        .iter()
        .map(|&(t, f, w)| {
            [
                spectrogram(layout, samples, t, f, w, &mut plans),
                spectrogram(layout, &residual, t, f, w, &mut plans),
            ]
        })
        .collect();
    let graph = ParityGraph::ft8();
    let pipeline = Pipeline::from_config(&stages[0].1);
    let mut refiners = [RefineScratch::default(), RefineScratch::default()];
    refiners[0].prepare(layout, samples, false);
    refiners[1].prepare(layout, &residual, false);
    // The block demodulator on both audios, and the reference entries as decodes for the oracle.
    let demod = &stages[0].1.demod;
    let blocks: Vec<u8> = demod.blocks(mode).to_vec();
    let mut block_ws = [BlockWorkspace::default(), BlockWorkspace::default()];
    block_ws[0].prepare(layout, samples, &mut plans);
    block_ws[1].prepare(layout, &residual, &mut plans);
    let references: Vec<(usize, Decode)> = if oracle {
        expected
            .iter()
            .enumerate()
            .filter_map(|(k, e)| reference_decode(e).map(|d| (k, d)))
            .collect()
    } else {
        Vec::new()
    };
    let decoded_texts: Vec<String> = decodes.iter().map(|d| normalise_text(&d.text)).collect();
    let (dt_lo, dt_hi) = stages
        .iter()
        .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), (_, c)| {
            let (a, b) = match mode {
                Mode::Ft8 => (c.search.ft8_dt_min_s, c.search.ft8_dt_max_s),
                Mode::Ft4 => (c.search.ft4_dt_min_s, c.search.ft4_dt_max_s),
            };
            (lo.min(a), hi.max(b))
        });

    let mut out = Vec::new();
    for (j, e) in expected.iter().enumerate() {
        if score.entry_match[j].is_some() {
            continue;
        }
        let text = normalise_text(&e.text);
        let freq = e.freq_hz as f32;
        let dt = e.dt_s as f32;
        let neighbour_hz = expected
            .iter()
            .enumerate()
            .filter(|&(k, _)| k != j)
            .map(|(_, o)| (o.freq_hz - e.freq_hz).abs())
            .min_by(f64::total_cmp);
        let overlapping_refs = expected
            .iter()
            .enumerate()
            .filter(|&(k, o)| k != j && (o.freq_hz - e.freq_hz).abs() < 50.0)
            .count();
        let overlapping_decodes = decodes
            .iter()
            .filter(|d| (f64::from(d.freq_hz) - e.freq_hz).abs() < 50.0)
            .count();
        let near: Vec<&CandidateTrace> = trace
            .iter()
            .filter(|c| (c.freq_hz - freq).abs() <= NEAR_HZ && (c.dt_s - dt).abs() <= NEAR_S)
            .collect();
        let nearest = near
            .iter()
            .min_by(|a, b| {
                let d =
                    |c: &CandidateTrace| (c.freq_hz - freq).abs() / NEAR_HZ + (c.dt_s - dt).abs() / NEAR_S;
                d(a).total_cmp(&d(b))
            })
            .map(|c| NearCandidate {
                stage: c.stage,
                pass: c.pass,
                df_hz: c.freq_hz - freq,
                ddt_s: c.dt_s - dt,
                score: c.score,
                outcome: outcome_name(c.outcome).into(),
            });
        let codeword = codeword_for(mode, &e.text);
        let class = if text.contains('<') {
            "hashed"
        } else if decoded_texts.contains(&text) {
            "elsewhere"
        } else if codeword.is_none() {
            "unpackable"
        } else if dt < dt_lo - NEAR_S || dt > dt_hi + NEAR_S {
            "dt-range"
        } else if near.is_empty() {
            "search"
        } else if near.iter().any(|c| matches!(c.outcome, TraceOutcome::Decoded(_))) {
            "other-text"
        } else {
            "failed"
        };
        let genie = |grid: usize, which: usize| {
            codeword.as_ref().map(|cw| {
                let (t, f, _) = GRIDS[grid];
                let view = SymbolView {
                    spec: &specs[grid][which],
                    layout,
                    time_osr: t,
                    freq_osr: f,
                    live: &[],
                };
                genie_at(&view, cw, freq, dt, graph, pipeline.ldpc.as_ref())
            })
        };
        let orig_fine = genie(1, 0);
        let resid_fine = genie(1, 1);
        let mut refined = |which: usize, at: &Option<Genie>| -> Option<Genie> {
            let (cw, at) = (codeword.as_ref()?, at.as_ref()?);
            let (t, f, _) = GRIDS[1];
            let view = SymbolView {
                spec: &specs[1][which],
                layout,
                time_osr: t,
                freq_osr: f,
                live: &[],
            };
            Some(genie_refined(
                &view,
                cw,
                at,
                &mut refiners[which],
                graph,
                pipeline.ldpc.as_ref(),
            ))
        };
        let orig_refined = refined(0, &orig_fine);
        let resid_refined = refined(1, &resid_fine);
        let block = |ws: &mut BlockWorkspace, plans: &mut FftPlans| {
            codeword.as_ref().and_then(|cw| {
                block_genie(
                    layout,
                    ws,
                    plans,
                    cw,
                    (freq, dt),
                    &blocks,
                    (demod.block_score, demod.llr_variance),
                    graph,
                    pipeline.ldpc.as_ref(),
                )
            })
        };
        let orig_block = block(&mut block_ws[0], &mut plans);
        let resid_block = block(&mut block_ws[1], &mut plans);
        let (mut oracle_block, mut oracle_found) = (None, None);
        if oracle && matches!(class, "search" | "failed" | "other-text") {
            // Every other reference entry subtracted, strongest first, as a decoder that found
            // them all would subtract them.
            let mut others: Vec<Decode> = references
                .iter()
                .filter(|(k, _)| *k != j)
                .map(|(_, d)| d.clone())
                .collect();
            others.sort_by(|a, b| b.snr_db.total_cmp(&a.snr_db));
            let mut audio = samples.to_vec();
            subtractor.subtract(layout, &mut audio, &others, &mut SubtractScratch::default());
            let mut ws = BlockWorkspace::default();
            ws.prepare(layout, &audio, &mut plans);
            oracle_block = block(&mut ws, &mut plans);
            let session_stages = stages
                .iter()
                .map(|(name, c)| Stage::new(name.clone(), c.clone()))
                .collect();
            let mut s = DecodeSession::with_context(
                &SlotAudio::new(&audio, mode),
                session_stages,
                DecodeContext::new(),
            );
            s.run_to_end();
            oracle_found = Some(s.decodes().iter().any(|d| {
                normalise_text(&d.text) == text
                    && (f64::from(d.freq_hz) - e.freq_hz).abs() <= 10.0
                    && (f64::from(d.dt_s) - e.dt_s).abs() <= 0.5
            }));
        }
        out.push(Miss {
            path: path.to_string(),
            text: e.text.clone(),
            freq_hz: e.freq_hz,
            dt_s: e.dt_s,
            snr_db: e.snr_db,
            class: class.into(),
            neighbour_hz,
            overlapping_refs,
            overlapping_decodes,
            near_candidates: near.len(),
            nearest,
            orig_grid: genie(0, 0),
            orig_fine,
            resid_grid: genie(0, 1),
            resid_fine,
            orig_refined,
            resid_refined,
            orig_block,
            resid_block,
            oracle_block,
            oracle: oracle_found,
        });
    }
    (
        SlotCounts {
            path: path.to_string(),
            expected: expected.len(),
            matched: score.matched,
        },
        out,
    )
}

fn outcome_name(o: TraceOutcome) -> &'static str {
    match o {
        TraceOutcome::NoCodeword => "no-codeword",
        TraceOutcome::Rejected => "rejected",
        TraceOutcome::Duplicate => "duplicate",
        TraceOutcome::BelowFloor => "below-floor",
        TraceOutcome::Decoded(_) => "decoded",
        TraceOutcome::NoSync => "no-sync",
        TraceOutcome::Repeat => "repeat",
    }
}

/// The codeword `text` is sent as, or `None` when it does not pack.
pub fn codeword_for(mode: Mode, text: &str) -> Option<[u8; CODEWORD_BITS]> {
    let message = Message::parse(text).ok()?;
    let payload = rr73_ft8::message::pack(&message, &mut CallsignHashes::new()).ok()?;
    Some(rr73_ft8::tones::codeword(mode, &payload))
}

/// A spectrogram of `samples` on a grid of `time_osr` frames per symbol and `freq_osr` bins
/// per tone spacing, laid out as the decoder lays it out.
fn spectrogram(
    layout: &FrameLayout,
    samples: &[f32],
    time_osr: usize,
    freq_osr: usize,
    window_symbols: Option<usize>,
    plans: &mut FftPlans,
) -> Spectrogram {
    let mut spec = Spectrogram::new();
    let Ok(mut config) = SpectrogramConfig::oversampled(
        layout.samples_per_symbol,
        time_osr,
        freq_osr,
        200.0,
        3000.0,
        12_000,
    ) else {
        return spec;
    };
    if let Some(w) = window_symbols {
        config.window_len = (w * layout.samples_per_symbol).min(config.fft_size);
    }
    let frames = samples.len().div_ceil(config.hop);
    if let Ok(mut plan) = SpectrogramPlan::new(config, plans) {
        plan.compute(samples, frames, &mut spec);
    }
    spec
}

/// The position within [`GENIE_HZ`] and [`GENIE_S`] of `freq`, `dt` whose LLRs disagree least
/// with `codeword`, and what the decoders make of the LLRs there.
fn genie_at(
    view: &SymbolView<'_>,
    codeword: &[u8; CODEWORD_BITS],
    freq: f32,
    dt: f32,
    graph: &ParityGraph,
    ldpc: &dyn LdpcDecoder,
) -> Genie {
    let demod = MaxLogDemod { variance: 24.0 };
    let frames = view.frame_range(dt - GENIE_S, dt + GENIE_S);
    let bw = view.spec.bin_width_hz();
    let bins = view.bin_range();
    if bw <= 0.0 || bins.is_empty() {
        return Genie::default();
    }
    let min_bin = view.spec.min_bin() as f32;
    let lo = (((freq - GENIE_HZ) / bw - min_bin).ceil() as i32).max(bins.start);
    let hi = (((freq + GENIE_HZ) / bw - min_bin).floor() as i32).min(bins.end - 1);
    let mut llr = [0.0f32; CODEWORD_BITS];
    let mut best: Option<(u32, f32, Candidate)> = None;
    for frame in frames {
        for bin in lo..=hi {
            let cand = Candidate::new(frame, bin, 0.0);
            demod.llrs(view, &cand, &mut llr);
            let errors = llr
                .iter()
                .zip(codeword)
                .filter(|&(&l, &b)| u8::from(l > 0.0) != b)
                .count() as u32;
            let score = CostasSearch::score(view, frame, bin).unwrap_or(f32::NEG_INFINITY);
            let better = match best {
                None => true,
                Some((e, s, _)) => errors < e || (errors == e && score > s),
            };
            if better {
                best = Some((errors, score, cand));
            }
        }
    }
    let Some((hard_errors, score, cand)) = best else {
        return Genie::default();
    };
    demod.llrs(view, &cand, &mut llr);
    let mut scratch = LdpcScratch::default();
    let mut cw = [0u8; CODEWORD_BITS];
    let bp = SumProduct { max_iterations: 25 }
        .decode(graph, &llr, &mut scratch, &mut cw)
        .converged
        && cw == *codeword;
    let full = ldpc.decode(graph, &llr, &mut scratch, &mut cw).converged && cw == *codeword;
    Genie {
        hard_errors,
        freq_hz: view.freq_hz(&cand),
        dt_s: view.dt_s(&cand),
        score,
        bp,
        ldpc: full,
    }
}

/// Refines the genie position `at` on `view`'s grid with [`BasebandRefine`] and decodes the
/// symbol levels read there.
fn genie_refined(
    view: &SymbolView<'_>,
    codeword: &[u8; CODEWORD_BITS],
    at: &Genie,
    scratch: &mut RefineScratch,
    graph: &ParityGraph,
    ldpc: &dyn LdpcDecoder,
) -> Genie {
    let bw = view.spec.bin_width_hz();
    if bw <= 0.0 {
        return Genie::default();
    }
    let frame = view.frame_for_dt(at.dt_s).round() as i32;
    let bin = (at.freq_hz / bw - view.spec.min_bin() as f32).round() as i32;
    let mut cand = Candidate::new(frame, bin, at.score);
    let refiner = BasebandRefine { skip_repeats: false };
    if refiner.refine(view, &mut cand, scratch) != Refined::Levels {
        return Genie::default();
    }
    let symbols = SymbolView {
        spec: scratch.symbols(),
        layout: view.layout,
        time_osr: 1,
        freq_osr: 1,
        live: &[],
    };
    let mut llr = [0.0f32; CODEWORD_BITS];
    MaxLogDemod { variance: 24.0 }.llrs(&symbols, &Candidate::new(0, 0, 0.0), &mut llr);
    let hard_errors = llr
        .iter()
        .zip(codeword)
        .filter(|&(&l, &b)| u8::from(l > 0.0) != b)
        .count() as u32;
    let mut s = LdpcScratch::default();
    let mut cw = [0u8; CODEWORD_BITS];
    let bp = SumProduct { max_iterations: 25 }
        .decode(graph, &llr, &mut s, &mut cw)
        .converged
        && cw == *codeword;
    let full = ldpc.decode(graph, &llr, &mut s, &mut cw).converged && cw == *codeword;
    Genie {
        hard_errors,
        freq_hz: view.freq_hz(&cand),
        dt_s: view.dt_s(&cand),
        score: at.score,
        bp,
        ldpc: full,
    }
}

/// The breakdown tables printed after the analysis.
pub fn render(report: &MissReport) -> String {
    let expected: usize = report.slots.iter().map(|s| s.expected).sum();
    let matched: usize = report.slots.iter().map(|s| s.matched).sum();
    let mut out = format!(
        "{} slots, {expected} reference decodes, {matched} matched, {} missed\n\n",
        report.slots.len(),
        report.misses.len()
    );
    let classes = [
        "hashed",
        "elsewhere",
        "unpackable",
        "dt-range",
        "search",
        "other-text",
        "failed",
    ];
    // Genie outcome on the residual: decodes on the preset grid, only on the fine grid, only
    // on the original audio (subtraction damage), or nowhere.
    let genie_class = |m: &Miss| -> &'static str {
        let ok = |g: &Option<Genie>| g.as_ref().is_some_and(|g| g.ldpc);
        if m.resid_grid.is_none() {
            "-"
        } else if ok(&m.resid_grid) {
            "grid"
        } else if ok(&m.resid_fine) {
            "fine"
        } else if ok(&m.resid_refined) {
            "refined"
        } else if ok(&m.orig_grid) || ok(&m.orig_fine) || ok(&m.orig_refined) {
            "orig-only"
        } else {
            "none"
        }
    };
    out.push_str(&format!(
        "{:<12} {:>6} {:>8} {:>8} {:>9} {:>11} {:>8}\n",
        "class", "misses", "g:grid", "g:fine", "g:refined", "g:orig-only", "g:none"
    ));
    for c in classes {
        let ms: Vec<&Miss> = report.misses.iter().filter(|m| m.class == c).collect();
        let count = |g: &str| ms.iter().filter(|m| genie_class(m) == g).count();
        out.push_str(&format!(
            "{:<12} {:>6} {:>8} {:>8} {:>9} {:>11} {:>8}\n",
            c,
            ms.len(),
            count("grid"),
            count("fine"),
            count("refined"),
            count("orig-only"),
            count("none")
        ));
    }
    let buckets = |title: &str, edges: &[f64], value: &dyn Fn(&Miss) -> Option<f64>| -> String {
        let mut s = format!("\n{title}\n{:<14}", "class");
        let label = |i: usize| -> String {
            if i == 0 {
                format!("<{}", edges[0])
            } else if i == edges.len() {
                format!(">={}", edges[edges.len() - 1])
            } else {
                format!("{}..{}", edges[i - 1], edges[i])
            }
        };
        for i in 0..=edges.len() {
            s.push_str(&format!(" {:>9}", label(i)));
        }
        s.push_str(&format!(" {:>9}\n", "none"));
        for c in classes {
            s.push_str(&format!("{c:<14}"));
            let mut counts = vec![0usize; edges.len() + 2];
            for m in report.misses.iter().filter(|m| m.class == c) {
                match value(m) {
                    Some(v) => counts[edges.iter().filter(|&&e| v >= e).count()] += 1,
                    None => counts[edges.len() + 1] += 1,
                }
            }
            for n in counts {
                s.push_str(&format!(" {n:>9}"));
            }
            s.push('\n');
        }
        s
    };
    out.push_str(&buckets(
        "Reference SNR, dB",
        &[-20.0, -16.0, -12.0, -6.0],
        &|m| Some(m.snr_db),
    ));
    out.push_str(&buckets("Reference DT, s", &[-0.5, 0.5, 1.5, 2.5], &|m| {
        Some(m.dt_s)
    }));
    out.push_str(&buckets(
        "Nearest other reference entry, Hz",
        &[10.0, 25.0, 50.0],
        &|m| m.neighbour_hz,
    ));
    out.push_str(&buckets(
        "Genie hard errors on the residual, preset grid",
        &[20.0, 30.0, 40.0, 55.0],
        &|m| m.resid_grid.as_ref().map(|g| f64::from(g.hard_errors)),
    ));
    out.push_str(&buckets(
        "Genie hard errors on the residual, fine grid",
        &[20.0, 30.0, 40.0, 55.0],
        &|m| m.resid_fine.as_ref().map(|g| f64::from(g.hard_errors)),
    ));
    out.push_str(&buckets(
        "Genie hard errors on the residual, refined",
        &[20.0, 30.0, 40.0, 55.0],
        &|m| m.resid_refined.as_ref().map(|g| f64::from(g.hard_errors)),
    ));
    out.push_str(&buckets(
        "Genie sync score on the residual, preset grid, dB",
        &[0.0, 2.0, 5.0, 8.0],
        &|m| m.resid_grid.as_ref().map(|g| f64::from(g.score)),
    ));
    out.push_str(&buckets(
        "Block demodulator at the reference position, fewest hard errors over the block sets, residual",
        &[20.0, 30.0, 40.0, 55.0],
        &|m| {
            m.resid_block
                .as_ref()
                .and_then(|b| b.hard_errors.iter().min().map(|&e| f64::from(e)))
        },
    ));
    // Block demodulator and oracle outcomes by the nearest other reference entry.
    let ok = |b: &Option<BlockGenie>| b.as_ref().is_some_and(|b| b.ldpc);
    out.push_str(&format!(
        "\nBlock demodulator decodes at the reference position, and the oracle\n{:<12} {:>8} {:>6} {:>7} {:>8} {:>8} {:>8}\n",
        "class", "neighbour", "misses", "b:orig", "b:resid", "b:oracle", "oracle"
    ));
    for c in ["search", "other-text", "failed"] {
        for (label, lo, hi) in [
            ("<10 Hz", 0.0, 10.0),
            ("10..25", 10.0, 25.0),
            ("25..50", 25.0, 50.0),
            (">=50", 50.0, f64::INFINITY),
        ] {
            let ms: Vec<&Miss> = report
                .misses
                .iter()
                .filter(|m| m.class == c)
                .filter(|m| {
                    let n = m.neighbour_hz.unwrap_or(f64::INFINITY);
                    n >= lo && n < hi
                })
                .collect();
            if ms.is_empty() {
                continue;
            }
            let count = |f: &dyn Fn(&Miss) -> bool| ms.iter().filter(|m| f(m)).count();
            let oracle = if ms.iter().any(|m| m.oracle.is_some()) {
                count(&|m| m.oracle == Some(true)).to_string()
            } else {
                "-".to_string()
            };
            out.push_str(&format!(
                "{:<12} {:>8} {:>6} {:>7} {:>8} {:>8} {:>8}\n",
                c,
                label,
                ms.len(),
                count(&|m| ok(&m.orig_block)),
                count(&|m| ok(&m.resid_block)),
                count(&|m| ok(&m.oracle_block)),
                oracle
            ));
        }
    }
    out
}

/// A reference entry as a decode, for subtraction: its message, payload, frequency, DT and
/// SNR. `None` for text that does not pack.
fn reference_decode(e: &Entry) -> Option<Decode> {
    let message = Message::parse(&e.text).ok()?;
    let payload = rr73_ft8::message::pack(&message, &mut CallsignHashes::new()).ok()?;
    Some(Decode {
        text: e.text.clone(),
        message,
        payload,
        freq_hz: e.freq_hz as f32,
        dt_s: e.dt_s as f32,
        snr_db: e.snr_db as f32,
        pass: 0,
        ldpc_iterations: 0,
        hard_errors: 0,
        score: 0.0,
        osd: false,
        osd_distance: 0.0,
        ap: None,
        block: None,
    })
}

/// The block demodulator at a reference position `at` (frequency in Hz, DT in seconds):
/// refined within half a symbol and half a tone spacing, then soft bits for each of `blocks`
/// with `score` (score kind and LLR variance), their hard errors against `codeword`, and
/// whether `ldpc` returns it from one of them. `None` with no block lengths or no band.
#[allow(clippy::too_many_arguments)]
fn block_genie(
    layout: &FrameLayout,
    ws: &mut BlockWorkspace,
    plans: &mut FftPlans,
    codeword: &[u8; CODEWORD_BITS],
    at: (f32, f32),
    blocks: &[u8],
    score: (BlockScore, f32),
    graph: &ParityGraph,
    ldpc: &dyn LdpcDecoder,
) -> Option<BlockGenie> {
    if blocks.is_empty() {
        return None;
    }
    let refined = ws.amplitudes(layout, plans, at.0, at.1 + layout.start_offset_s, (0.5, 0.5))?;
    let mut llr = [0.0f32; CODEWORD_BITS];
    let mut scratch = LdpcScratch::default();
    let mut cw = [0u8; CODEWORD_BITS];
    let mut hard_errors = Vec::new();
    let mut decoded = false;
    for &n in blocks {
        ws.llrs(layout, usize::from(n), score.0, score.1, &mut llr);
        hard_errors.push(
            llr.iter()
                .zip(codeword)
                .filter(|&(&l, &b)| u8::from(l > 0.0) != b)
                .count() as u32,
        );
        if !decoded && ldpc.decode(graph, &llr, &mut scratch, &mut cw).converged && cw == *codeword {
            decoded = true;
        }
    }
    Some(BlockGenie {
        sync_matched: refined.sync_matched,
        hard_errors,
        ldpc: decoded,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codewords_come_from_the_text_and_hashed_calls_pack() {
        let cw = codeword_for(Mode::Ft8, "CQ K1ABC FN42").expect("packs");
        let payload = rr73_ft8::message::pack(
            &Message::parse("CQ K1ABC FN42").expect("parse"),
            &mut CallsignHashes::new(),
        )
        .expect("pack");
        assert_eq!(cw, rr73_ft8::tones::codeword(Mode::Ft8, &payload));
        assert!(codeword_for(Mode::Ft8, "").is_none());
    }

    #[test]
    fn a_signal_the_run_decodes_is_not_a_miss_and_an_absent_one_is_a_search_miss() {
        use rr73_chansim::{Noise, Scene, SimSignal, render};
        let scene = Scene {
            mode: Mode::Ft8,
            signals: vec![SimSignal::new("CQ K1ABC FN42", 1500.0, 0.2, -10.0)],
            noise: Noise::Awgn,
        };
        let (samples, _) = render(&scene, 7).expect("render");
        let expected = [
            Entry {
                text: "CQ K1ABC FN42".into(),
                freq_hz: 1500.0,
                dt_s: 0.2,
                snr_db: -10.0,
            },
            Entry {
                text: "CQ W9XYZ EN52".into(),
                freq_hz: 900.0,
                dt_s: 0.1,
                snr_db: -30.0,
            },
        ];
        let stages = vec![(
            "subtract-3-osd2".to_string(),
            DecoderConfig::preset("subtract-3-osd2").expect("preset"),
        )];
        let (counts, misses) = analyse_slot("x.wav", &samples, Mode::Ft8, &expected, &stages, true);
        assert_eq!((counts.expected, counts.matched), (2, 1));
        assert_eq!(misses.len(), 1);
        let m = &misses[0];
        assert_eq!(m.text, "CQ W9XYZ EN52");
        // Nothing was sent there: the genie finds noise, far from decodable.
        assert!(
            m.resid_grid
                .as_ref()
                .is_some_and(|g| !g.ldpc && g.hard_errors > 40)
        );
        assert!(m.class == "search" || m.class == "failed", "{}", m.class);
        // With the decoded signal subtracted as an oracle would, there is still nothing to decode,
        // and the block demodulator finds no codeword there either.
        assert_eq!(m.oracle, Some(false));
        assert!(
            m.orig_block
                .as_ref()
                .is_some_and(|b| !b.ldpc && b.hard_errors.len() == 2)
        );
        assert!(m.oracle_block.as_ref().is_some_and(|b| !b.ldpc));
    }
}
