//! Tone powers per symbol, and refinement of a candidate's start, frequency and drift.
//!
//! For each symbol the baseband is mixed down by the candidate's tone 0 frequency in that
//! symbol and correlated over the symbol's 256 samples with the 4 tones, which then complete
//! 0, 1, 2 and 3 cycles: a matched filter for each tone. The refinement maximises the sync
//! score computed from these powers by a coordinate search over start time, frequency and
//! drift with shrinking steps.

use rr73_dsp::fft::Complex32;
use rr73_wspr::SYMBOLS;
use rr73_wspr::code::SYNC;

use super::baseband::{RATE_HZ, SYMBOL_SAMPLES};
use super::search::WsprCandidate;

/// Powers of the 4 tones in each of the 162 symbols, `|correlation|²` with the baseband's
/// scale.
pub type TonePowers = [[f32; 4]; SYMBOLS];

/// Complex correlations of the 4 tones in each of the 162 symbols.
pub type ToneCorrs = [[Complex32; 4]; SYMBOLS];

/// Correlates candidates with the 4 tones. Holds the per-tone twiddle factors.
#[derive(Clone, Debug)]
pub struct ToneCorrelator {
    twiddle: Vec<[Complex32; 4]>,
}

impl Default for ToneCorrelator {
    fn default() -> Self {
        let twiddle = (0..SYMBOL_SAMPLES)
            .map(|n| {
                std::array::from_fn(|k| {
                    let ph = -std::f64::consts::TAU * (k * n) as f64 / SYMBOL_SAMPLES as f64;
                    Complex32::new(ph.cos() as f32, ph.sin() as f32)
                })
            })
            .collect();
        Self { twiddle }
    }
}

impl ToneCorrelator {
    /// Complex correlation of symbol `i` of `cand` with the 4 tones. The phase reference is
    /// the symbol's first sample. Samples outside the baseband read as zero.
    fn symbol(&self, bb: &[Complex32], cand: &WsprCandidate, i: usize) -> [Complex32; 4] {
        let f = f64::from(cand.tone0_at(i));
        let step = -std::f64::consts::TAU * f / RATE_HZ;
        let start = i64::from(cand.start) + (i * SYMBOL_SAMPLES) as i64;
        let mut acc = [Complex32::new(0.0, 0.0); 4];
        let rot = Complex32::new(step.cos() as f32, step.sin() as f32);
        // Restart the oscillator every 64 samples to keep f32 rounding small.
        for chunk in 0..SYMBOL_SAMPLES / 64 {
            let n = chunk * 64;
            let ph = step * n as f64;
            let mut z = Complex32::new(ph.cos() as f32, ph.sin() as f32);
            for m in n..n + 64 {
                let idx = start + m as i64;
                if idx >= 0
                    && let Some(&x) = bb.get(idx as usize)
                {
                    let y = x * z;
                    let w = &self.twiddle[m];
                    acc[0] += y * w[0];
                    acc[1] += y * w[1];
                    acc[2] += y * w[2];
                    acc[3] += y * w[3];
                }
                z *= rot;
            }
        }
        acc
    }

    /// Tone powers of `cand` in `bb` (375 Hz baseband). Symbols that fall outside the
    /// baseband, wholly or partly, read the missing samples as zero.
    pub fn powers(&self, bb: &[Complex32], cand: &WsprCandidate, out: &mut TonePowers) {
        for (i, row) in out.iter_mut().enumerate() {
            let c = self.symbol(bb, cand, i);
            for k in 0..4 {
                row[k] = c[k].norm_sqr();
            }
        }
    }

    /// Complex tone correlations of `cand`, rotated so that a phase-continuous signal at the
    /// candidate's frequency keeps one phase across symbols: with a modulation index of 1,
    /// every tone advances the phase by `2 pi f0 T` per symbol modulo whole cycles, where
    /// `f0` is tone 0's frequency, so the rotation does not depend on the data. Also writes
    /// the powers.
    pub fn correlations(
        &self,
        bb: &[Complex32],
        cand: &WsprCandidate,
        out: &mut ToneCorrs,
        powers: &mut TonePowers,
    ) {
        let t = SYMBOL_SAMPLES as f64 / RATE_HZ;
        let mut phase = 0.0f64;
        for i in 0..SYMBOLS {
            let c = self.symbol(bb, cand, i);
            let back = Complex32::new(phase.cos() as f32, -phase.sin() as f32);
            for k in 0..4 {
                out[i][k] = c[k] * back;
                powers[i][k] = c[k].norm_sqr();
            }
            phase = (phase + std::f64::consts::TAU * f64::from(cand.tone0_at(i)) * t)
                .rem_euclid(std::f64::consts::TAU);
        }
    }
}

/// The sync score of tone powers: `sum of ±((P1 + P3) - (P0 + P2))` with the sync bit's sign.
pub fn sync_sum(p: &TonePowers) -> f32 {
    p.iter()
        .zip(SYNC.iter())
        .map(|(row, &s)| {
            let d = row[1] + row[3] - row[0] - row[2];
            if s == 1 { d } else { -d }
        })
        .sum()
}

/// Improves a candidate's start, frequency and drift before demodulation.
pub trait WsprRefine {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Adjusts `cand` in place, using `powers` and `corrs` as scratch.
    fn refine(
        &self,
        corr: &ToneCorrelator,
        bb: &[Complex32],
        cand: &mut WsprCandidate,
        powers: &mut TonePowers,
        corrs: &mut ToneCorrs,
    );
}

/// Keeps the search grid position.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NoRefine;

impl WsprRefine for NoRefine {
    fn name(&self) -> &'static str {
        "none"
    }

    fn refine(
        &self,
        _: &ToneCorrelator,
        _: &[Complex32],
        _: &mut WsprCandidate,
        _: &mut TonePowers,
        _: &mut ToneCorrs,
    ) {
    }
}

/// Coordinate search with shrinking steps.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GridRefine;

impl WsprRefine for GridRefine {
    fn name(&self) -> &'static str {
        "grid"
    }

    fn refine(
        &self,
        corr: &ToneCorrelator,
        bb: &[Complex32],
        cand: &mut WsprCandidate,
        powers: &mut TonePowers,
        _corrs: &mut ToneCorrs,
    ) {
        grid_rounds(corr, bb, cand, powers, &GRID_ROUNDS);
    }
}

/// Rounds of the power-based coordinate search: start step in samples, frequency step in Hz,
/// drift step in Hz, and steps each way.
const GRID_ROUNDS: [(i32, f32, f32, i32); 3] = [(16, 0.2, 0.25, 2), (4, 0.06, 0.1, 2), (1, 0.02, 0.04, 2)];

fn grid_rounds(
    corr: &ToneCorrelator,
    bb: &[Complex32],
    cand: &mut WsprCandidate,
    powers: &mut TonePowers,
    rounds: &[(i32, f32, f32, i32)],
) {
    {
        let mut eval = |c: &WsprCandidate| {
            corr.powers(bb, c, powers);
            sync_sum(powers)
        };
        let mut best = eval(cand);
        for &(dt, df, dd, n) in rounds {
            for axis in 0..3 {
                let origin = *cand;
                for k in -n..=n {
                    if k == 0 {
                        continue;
                    }
                    let mut c = origin;
                    match axis {
                        0 => c.start += dt * k,
                        1 => c.tone0_hz += df * k as f32,
                        _ => c.drift_hz += dd * k as f32,
                    }
                    let v = eval(&c);
                    if v > best {
                        best = v;
                        *cand = c;
                    }
                }
            }
        }
    }
}

/// Power-based coordinate search for start time, then a phase-coherent search for frequency
/// and drift. A phase-continuous signal keeps one phase across symbols once the correlations
/// are rotated for its frequency (see [`ToneCorrelator::correlations`]); a residual frequency
/// error turns that phase by `2 pi df T` per symbol. The second stage rotates the correlations
/// for trial frequency and drift offsets and keeps the offsets that maximise the energy of
/// coherent sums over blocks of `block` symbols, each block taking its best data pattern.
#[derive(Clone, Debug, PartialEq)]
pub struct CoherentRefine {
    /// Symbols per block of the coherence metric, 1 to 8.
    pub block: usize,
}

impl CoherentRefine {
    /// The coherence metric of `corrs` after removing a frequency offset `df` (Hz) and a drift
    /// offset `dd` (Hz over the transmission).
    fn metric(&self, corrs: &ToneCorrs, df: f32, dd: f32) -> f32 {
        let t = (SYMBOL_SAMPLES as f64 / RATE_HZ) as f32;
        let tau = std::f32::consts::TAU;
        let block = self.block.clamp(1, 8);
        let mut total = 0.0;
        let mut rot = [[Complex32::new(0.0, 0.0); 2]; 8];
        let mut i = 0;
        while i < SYMBOLS {
            let n = block.min(SYMBOLS - i);
            for j in 0..n {
                let k = (i + j) as f32;
                // Phase at the start of symbol k: the sum over earlier symbols m of
                // 2 pi T (df + dd (m - 80.5) / 162).
                let ph = tau * t * (df * k + dd / SYMBOLS as f32 * (k * (k - 1.0) / 2.0 - 80.5 * k));
                let back = Complex32::new(ph.cos(), -ph.sin());
                let s = usize::from(SYNC[i + j]);
                rot[j] = [corrs[i + j][s] * back, corrs[i + j][s + 2] * back];
            }
            let mut best = 0.0f32;
            for h in 0..(1usize << n) {
                let mut sum = Complex32::new(0.0, 0.0);
                for (j, r) in rot.iter().enumerate().take(n) {
                    sum += r[(h >> j) & 1];
                }
                best = best.max(sum.norm_sqr());
            }
            total += best;
            i += n;
        }
        total
    }
}

impl CoherentRefine {
    /// Frequency and drift offsets that maximise the metric, searched axis by axis.
    fn offsets(&self, corrs: &ToneCorrs, passes: &[(u8, f32, i32)]) -> (f32, f32) {
        let (mut df, mut dd) = (0.0f32, 0.0f32);
        let mut best = self.metric(corrs, df, dd);
        for &(axis, step, n) in passes {
            let (f0, d0) = (df, dd);
            for k in -n..=n {
                let (f, d) = if axis == 0 {
                    (f0 + step * k as f32, d0)
                } else {
                    (f0, d0 + step * k as f32)
                };
                let v = self.metric(corrs, f, d);
                if v > best {
                    best = v;
                    (df, dd) = (f, d);
                }
            }
        }
        (df, dd)
    }
}

impl WsprRefine for CoherentRefine {
    fn name(&self) -> &'static str {
        "coherent"
    }

    fn refine(
        &self,
        corr: &ToneCorrelator,
        bb: &[Complex32],
        cand: &mut WsprCandidate,
        powers: &mut TonePowers,
        corrs: &mut ToneCorrs,
    ) {
        // Coarse start, frequency and drift from powers; frequency and drift from coherence.
        grid_rounds(corr, bb, cand, powers, &GRID_ROUNDS[..1]);
        corr.correlations(bb, cand, corrs, powers);
        let (df, dd) = self.offsets(corrs, &[(0, 0.02, 15), (1, 0.1, 8), (0, 0.005, 4)]);
        cand.tone0_hz += df;
        cand.drift_hz += dd;
        // Start from coherence: 4-sample steps over ±32, then single samples.
        for (step, n) in [(4, 8), (1, 3)] {
            let origin = *cand;
            corr.correlations(bb, &origin, corrs, powers);
            let mut best = self.metric(corrs, 0.0, 0.0);
            for k in -n..=n {
                if k == 0 {
                    continue;
                }
                let mut c = origin;
                c.start += step * k;
                corr.correlations(bb, &c, corrs, powers);
                let v = self.metric(corrs, 0.0, 0.0);
                if v > best {
                    best = v;
                    *cand = c;
                }
            }
        }
        corr.correlations(bb, cand, corrs, powers);
        let (df, dd) = self.offsets(corrs, &[(0, 0.004, 5), (1, 0.03, 6), (0, 0.002, 3)]);
        cand.tone0_hz += df;
        cand.drift_hz += dd;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone_signal(tone0_hz: f64, start: usize, symbols: &[u8]) -> Vec<Complex32> {
        let mut bb = vec![Complex32::new(0.0, 0.0); 45_000];
        let mut ph = 0.0f64;
        for (i, &s) in symbols.iter().enumerate() {
            let f = tone0_hz + f64::from(s) * RATE_HZ / SYMBOL_SAMPLES as f64;
            for n in 0..SYMBOL_SAMPLES {
                if let Some(x) = bb.get_mut(start + i * SYMBOL_SAMPLES + n) {
                    *x = Complex32::new(ph.cos() as f32, ph.sin() as f32);
                }
                ph += std::f64::consts::TAU * f / RATE_HZ;
            }
        }
        bb
    }

    #[test]
    fn powers_pick_the_sent_tone() {
        let symbols: Vec<u8> = (0..SYMBOLS).map(|i| (SYNC[i] + 2 * (i % 2) as u8) % 4).collect();
        let bb = tone_signal(-20.0, 375, &symbols);
        let cand = WsprCandidate {
            tone0_hz: -20.0,
            start: 375,
            drift_hz: 0.0,
            score: 0.0,
        };
        let mut p = [[0.0f32; 4]; SYMBOLS];
        ToneCorrelator::default().powers(&bb, &cand, &mut p);
        for (i, row) in p.iter().enumerate() {
            let sent = usize::from(symbols[i]);
            assert!((row[sent] - 65_536.0).abs() < 50.0, "{i}: {row:?}");
            for k in (0..4).filter(|&k| k != sent) {
                assert!(row[k] < 1.0, "{i}: {row:?}");
            }
        }
        assert!((sync_sum(&p) - 162.0 * 65_536.0).abs() < 162.0 * 100.0);
    }

    #[test]
    fn grid_refine_recovers_an_offset_candidate() {
        let symbols: Vec<u8> = (0..SYMBOLS)
            .map(|i| SYNC[i] + 2 * ((i * 7 / 3) % 2) as u8)
            .collect();
        let bb = tone_signal(12.3, 400, &symbols);
        let mut cand = WsprCandidate {
            tone0_hz: 12.0,
            start: 384,
            drift_hz: 0.25,
            score: 0.0,
        };
        let mut p = [[0.0f32; 4]; SYMBOLS];
        let mut c = [[Complex32::new(0.0, 0.0); 4]; SYMBOLS];
        GridRefine.refine(&ToneCorrelator::default(), &bb, &mut cand, &mut p, &mut c);
        assert!((cand.tone0_hz - 12.3).abs() < 0.03, "{cand:?}");
        assert!((cand.start - 400).abs() <= 1, "{cand:?}");
        assert!(cand.drift_hz.abs() < 0.06, "{cand:?}");
    }
}
