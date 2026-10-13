//! Candidate search: the sync vector correlated with the symbol spectrogram over frequency,
//! start time and drift.
//!
//! For tone 0 at spectrogram bin `b` (0.732 Hz units), tones 0 to 3 sit at `b`, `b + 2`,
//! `b + 4` and `b + 6`. In symbol `i` the sync bit selects tones 0 and 2 (bit 0) or 1 and 3
//! (bit 1), whatever the data bit. The score sums, over the 162 symbols,
//! `±((P1 + P3) - (P0 + P2))` with the sign of the sync bit, read at the symbol's frame and
//! at the bin the drift hypothesis moves tone 0 to. Powers are in units of the noise per bin,
//! so on noise each term has variance 4 and the score is divided by `sqrt(4 * 162)`: it reads
//! as standard deviations above noise.

use rr73_wspr::code::SYNC;
use rr73_wspr::{SYMBOLS, TONE_SPACING_HZ};

use super::baseband::{
    CENTRE_HZ, HOP, RATE_HZ, SPEC_BIN_HZ, SPEC_HALF_BINS, SYMBOL_SAMPLES, SymbolSpectrogram,
};
use super::config::WsprSearchParams;

/// A candidate signal.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WsprCandidate {
    /// Tone 0 frequency at the middle of the transmission, in Hz from the baseband centre
    /// (1500 Hz of audio).
    pub tone0_hz: f32,
    /// Start of symbol 0, in baseband samples (375 Hz) from the slot start. May be negative.
    pub start: i32,
    /// Drift over the whole transmission (162 symbols), in Hz.
    pub drift_hz: f32,
    /// Sync score, in standard deviations above noise.
    pub score: f32,
}

impl WsprCandidate {
    /// Centre frequency (midway between tones 1 and 2) in Hz of audio.
    pub fn centre_hz(&self) -> f32 {
        (CENTRE_HZ + f64::from(self.tone0_hz) + 1.5 * TONE_SPACING_HZ) as f32
    }

    /// DT: start minus the nominal start (1 s into the slot), in seconds.
    pub fn dt_s(&self) -> f32 {
        (f64::from(self.start) / RATE_HZ - rr73_wspr::START_OFFSET_S) as f32
    }

    /// Tone 0 frequency in symbol `i`, in Hz from the baseband centre.
    pub fn tone0_at(&self, i: usize) -> f32 {
        self.tone0_hz + self.drift_hz * (i as f32 - 80.5) / SYMBOLS as f32
    }
}

/// Finds candidate signals.
pub trait WsprSearch {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Writes candidates, best first, into `out`, using `scratch` for working buffers.
    fn search(&self, spec: &SymbolSpectrogram, out: &mut Vec<WsprCandidate>, scratch: &mut SearchScratch);
}

/// Working buffers of the search.
#[derive(Clone, Debug, Default)]
pub struct SearchScratch {
    diff: Vec<f32>,
    acc: Vec<f32>,
    best: Vec<f32>,
    best_drift: Vec<f32>,
}

/// Sync correlation search.
#[derive(Clone, Debug, PartialEq)]
pub struct SyncSearch {
    /// Parameters.
    pub params: WsprSearchParams,
}

/// Standard deviation of the raw score on noise: 4 unit-variance powers per symbol.
const NOISE_SD: f32 = 25.455_844; // sqrt(4 * 162)

impl WsprSearch for SyncSearch {
    fn name(&self) -> &'static str {
        "sync"
    }

    fn search(&self, spec: &SymbolSpectrogram, out: &mut Vec<WsprCandidate>, scratch: &mut SearchScratch) {
        out.clear();
        let p = &self.params;
        let bins = SymbolSpectrogram::BINS;
        if spec.frames == 0 {
            return;
        }
        // Tone-0 bins whose centre lies in the search range.
        let centre_to_tone0 = 1.5 * TONE_SPACING_HZ;
        let to_bin = |audio_hz: f32| {
            ((f64::from(audio_hz) - CENTRE_HZ - centre_to_tone0) / SPEC_BIN_HZ).round() as i32
        };
        let b_lo = to_bin(p.freq_min_hz).max(-SPEC_HALF_BINS);
        let b_hi = to_bin(p.freq_max_hz).min(SPEC_HALF_BINS - 6);
        if b_hi < b_lo {
            return;
        }
        let nf = (b_hi - b_lo + 1) as usize;
        // Frame offsets: symbol i of a candidate starting at frame t is frame t + 4 i.
        let step = (SYMBOL_SAMPLES / HOP) as i64;
        let to_frame =
            |dt: f32| ((f64::from(dt) + rr73_wspr::START_OFFSET_S) * RATE_HZ / HOP as f64).round() as i64;
        let (t_lo, t_hi) = (to_frame(p.dt_min_s), to_frame(p.dt_max_s));
        let nt = (t_hi - t_lo + 1).max(0) as usize;

        // diff[t][b] = (P1 + P3) - (P0 + P2) for tone 0 at bin b, over the whole bin range;
        // bins whose upper tones fall outside read the missing powers as 0.
        scratch.diff.clear();
        scratch.diff.resize(spec.frames * bins, 0.0);
        for t in 0..spec.frames {
            for k in 0..bins {
                let b = k as i32 - SPEC_HALF_BINS;
                let ti = t as i64;
                scratch.diff[t * bins + k] =
                    spec.get(ti, b + 2) + spec.get(ti, b + 6) - spec.get(ti, b) - spec.get(ti, b + 4);
            }
        }

        scratch.best.clear();
        scratch.best.resize(nt * nf, f32::NEG_INFINITY);
        scratch.best_drift.clear();
        scratch.best_drift.resize(nt * nf, 0.0);
        let steps = (p.drift_max_hz / p.drift_step_hz).floor() as i32;
        let mut shifts = [0i32; SYMBOLS];
        for ds in -steps..=steps {
            let drift = ds as f32 * p.drift_step_hz;
            for (i, s) in shifts.iter_mut().enumerate() {
                *s = (f64::from(drift) * (i as f64 - 80.5) / SYMBOLS as f64 / SPEC_BIN_HZ).round() as i32;
            }
            for ti in 0..nt {
                let t0 = t_lo + ti as i64;
                scratch.acc.clear();
                scratch.acc.resize(nf, 0.0);
                for i in 0..SYMBOLS {
                    let t = t0 + step * i as i64;
                    if t < 0 || t as usize >= spec.frames {
                        continue;
                    }
                    let row = &scratch.diff[t as usize * bins..(t as usize + 1) * bins];
                    let sign = if SYNC[i] == 1 { 1.0 } else { -1.0 };
                    let first = b_lo + shifts[i] + SPEC_HALF_BINS;
                    for (f, a) in scratch.acc.iter_mut().enumerate() {
                        let k = first + f as i32;
                        if k >= 0 && (k as usize) < bins {
                            *a += sign * row[k as usize];
                        }
                    }
                }
                let best = &mut scratch.best[ti * nf..(ti + 1) * nf];
                let best_drift = &mut scratch.best_drift[ti * nf..(ti + 1) * nf];
                for f in 0..nf {
                    if scratch.acc[f] > best[f] {
                        best[f] = scratch.acc[f];
                        best_drift[f] = drift;
                    }
                }
            }
        }

        // Local maxima over 3 start times and 5 bins, best first.
        let min_raw = p.min_score * NOISE_SD;
        for ti in 0..nt {
            for f in 0..nf {
                let v = scratch.best[ti * nf + f];
                if v.is_nan() || v < min_raw {
                    continue;
                }
                let mut peak = true;
                'n: for dt in -1i64..=1 {
                    for df in -2i64..=2 {
                        let (a, b) = (ti as i64 + dt, f as i64 + df);
                        if (dt, df) == (0, 0) || a < 0 || b < 0 || a >= nt as i64 || b >= nf as i64 {
                            continue;
                        }
                        let w = scratch.best[a as usize * nf + b as usize];
                        // Ties go to the earlier position.
                        if w > v || (w == v && (a, b) < (ti as i64, f as i64)) {
                            peak = false;
                            break 'n;
                        }
                    }
                }
                if peak {
                    out.push(WsprCandidate {
                        tone0_hz: ((b_lo + f as i32) as f64 * SPEC_BIN_HZ) as f32,
                        start: ((t_lo + ti as i64) * HOP as i64) as i32,
                        drift_hz: scratch.best_drift[ti * nf + f],
                        score: v / NOISE_SD,
                    });
                }
            }
        }
        out.sort_by(|a, b| b.score.total_cmp(&a.score));
        out.truncate(p.max_candidates);
    }
}
