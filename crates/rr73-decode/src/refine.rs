//! Refinement before demodulation: a candidate's start and frequency from its Costas arrays,
//! and its symbol levels read at that position.
//!
//! The search places a candidate on its spectrogram grid, which puts the start within half a
//! frame and the frequency within half a bin of the truth, and the spectrogram reads each
//! symbol through a window that spans `freq_osr` symbols. [`BasebandRefine`] cuts the
//! candidate's band from one FFT of the pass's audio and brings it to a complex baseband
//! with `p` samples per symbol (FT8: 200 Hz, 32 per symbol; FT4: 333 Hz, 16 per symbol), the
//! downconversion the QEX paper on FT4 and FT8 describes for WSJT-X. On that baseband it:
//!
//! 1. searches the start around the candidate's, one baseband sample at a time, by the
//!    energy of each sync symbol's tone (insensitive to a frequency error of a fraction of a
//!    tone spacing);
//! 2. searches the frequency by correlating each sync group coherently with its tones and
//!    summing the groups' energies, then interpolates between the steps;
//! 3. searches the start again within two samples with the coherent correlation;
//! 4. reads every symbol's tone levels with a one-symbol rectangular window at that start and
//!    frequency, in dB on the spectrogram's scale (a sine of amplitude A reads A²/4), into a
//!    small grid the demodulator reads in place of the spectrogram.
//!
//! FT8 and FT4 are continuous-phase FSK with a tone spacing of one over the symbol length, so
//! the phase returns to the same value at every symbol boundary relative to the tones: a
//! reference that starts each symbol's tone at phase 0 stays coherent over a sync group.
//!
//! Symbols outside the audio read as erasures (not a number), which the demodulator turns
//! into zero LLRs, as it does for spectrogram frames outside the slot: in a partial slot every
//! symbol that ends after the audio, in a whole slot every symbol whose middle lies after it.
//!
//! Neighbouring grid points of one signal refine to the same position. A candidate whose
//! refined start and frequency repeat one already tried in the pass is reported as a repeat,
//! and the session skips it: its LLRs would be the same.

use std::f64::consts::TAU;
use std::sync::Arc;

use rr73_dsp::fft::Fft;
use rr73_dsp::{Complex32, FftPlans, Spectrogram};
use rr73_ft8::Mode;

use crate::layout::FrameLayout;
use crate::view::{Candidate, SymbolView};

/// Sample rate of slot audio, in Hz.
const FS: f64 = 12_000.0;

/// Refined frequencies closer than this fraction of a tone spacing, at the same start, are
/// the same position.
const REPEAT_SPACINGS: f64 = 0.02;

/// What refining a candidate gave.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refined {
    /// The candidate keeps its grid position; the demodulator reads the spectrogram.
    Grid,
    /// The candidate moved to its refined position and its symbol levels are in the scratch.
    Levels,
    /// The refined position repeats one already tried in this pass.
    Repeat,
}

/// Baseband layout of one mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Geometry {
    mode: Mode,
    /// Baseband samples per symbol.
    p: usize,
    /// Audio samples per baseband sample.
    d: usize,
    /// Baseband samples (inverse FFT length).
    m: usize,
    /// Forward FFT length, `m * d`, even.
    n: usize,
}

impl Geometry {
    fn new(layout: &FrameLayout) -> Self {
        let p = match layout.mode {
            Mode::Ft8 | Mode::Lq8 => 32,
            Mode::Ft4 => 16,
        };
        let d = (layout.samples_per_symbol / p).max(1);
        // The slot and 1 s more, so a band's impulse response cannot wrap the end of the
        // audio onto its start. Even, for the real-input FFT.
        let m = smooth_at_least((layout.slot_samples() + 12_000).div_ceil(d));
        let m = if (m * d) % 2 == 1 {
            smooth_at_least(m + 1)
        } else {
            m
        };
        Self {
            mode: layout.mode,
            p,
            d,
            m,
            n: m * d,
        }
    }

    /// Width of one forward FFT bin, in Hz.
    fn bin_hz(&self) -> f64 {
        FS / self.n as f64
    }

    /// Baseband sample rate, in Hz.
    fn rate(&self) -> f64 {
        FS / self.d as f64
    }
}

/// Smallest number at least `n` with no prime factor above 5 (fast FFT lengths).
fn smooth_at_least(n: usize) -> usize {
    let mut k = n.max(1);
    loop {
        let mut r = k;
        for f in [2, 3, 5] {
            while r.is_multiple_of(f) {
                r /= f;
            }
        }
        if r == 1 {
            return k;
        }
        k += 1;
    }
}

/// `Σ x[i] w[i]` with four independent sums, so the additions do not wait on each other.
#[inline]
fn dot(x: &[Complex32], w: &[Complex32]) -> Complex32 {
    let zero = Complex32::new(0.0, 0.0);
    let mut acc = [zero; 4];
    let n = x.len().min(w.len());
    let (xc, xr) = x[..n].as_chunks::<4>();
    let (wc, wr) = w[..n].as_chunks::<4>();
    for (a, b) in xc.iter().zip(wc) {
        acc[0] += a[0] * b[0];
        acc[1] += a[1] * b[1];
        acc[2] += a[2] * b[2];
        acc[3] += a[3] * b[3];
    }
    let mut s = (acc[0] + acc[1]) + (acc[2] + acc[3]);
    for (a, b) in xr.iter().zip(wr) {
        s += a * b;
    }
    s
}

/// Buffers for [`BasebandRefine`]: the pass's spectrum, the candidate's baseband and the
/// symbol levels the demodulator reads. Sized on first use for a mode.
#[derive(Default)]
pub struct RefineScratch {
    plans: Option<FftPlans>,
    geometry: Option<Geometry>,
    /// Forward FFT of `n / 2` points, for the real-input transform.
    forward: Option<Arc<dyn Fft<f32>>>,
    /// Inverse FFT of `m` points, the baseband.
    inverse: Option<Arc<dyn Fft<f32>>>,
    /// Forward FFT of `p` points, the symbol levels.
    symbol_fft: Option<Arc<dyn Fft<f32>>>,
    /// Band weights over FFT offsets from tone 0, index `offset + m / 2`, scaled by `1 / n`.
    weights: Vec<f32>,
    /// First and last index of `weights` above zero.
    weight_span: (usize, usize),
    /// `e^{-j 2π j k / p}` for tone `j` and sample `k`, tone after tone.
    twiddle: Vec<Complex32>,
    /// `e^{-j 2π k / n}` for `k` up to `n / 2`, to split the real-input transform.
    split: Vec<Complex32>,
    /// The spectrum of the pass's audio, bins 0 to `n / 2`.
    spectrum: Vec<Complex32>,
    band: Vec<Complex32>,
    fft_scratch: Vec<Complex32>,
    /// Per candidate: the frequency correction over the longest sync group,
    /// `e^{-j 2π df k / rate}`.
    rotation: Vec<Complex32>,
    /// Per candidate: sync references with the frequency correction, one per sync symbol.
    references: Vec<Complex32>,
    /// Per candidate: block sums of the sync symbols' correlations.
    blocks: Vec<Complex32>,
    /// Per candidate: every symbol's samples with the frequency correction, then their FFTs.
    rows: Vec<Complex32>,
    metric: Vec<f32>,
    counts: Vec<u32>,
    /// Refined positions tried in this pass: start (baseband sample) and frequency (Hz).
    tried: Vec<(isize, f64)>,
    /// Audio samples the pass's spectrum holds.
    audio_len: usize,
    partial: bool,
    ready: bool,
    /// Symbol levels of the last refined candidate: one row per channel symbol, one value per
    /// tone, in dB; erased symbols hold NaN.
    pub(crate) symbols: Spectrogram,
}

impl std::fmt::Debug for RefineScratch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RefineScratch")
            .field("geometry", &self.geometry)
            .field("ready", &self.ready)
            .finish_non_exhaustive()
    }
}

impl RefineScratch {
    /// Takes the spectrum of `audio` (12 kHz, slot start at sample 0) for the candidates of
    /// one pass, and forgets the positions tried in the last. `partial` marks the start of a
    /// slot still being received.
    pub fn prepare(&mut self, layout: &FrameLayout, audio: &[f32], partial: bool) {
        let g = Geometry::new(layout);
        if self.geometry != Some(g) {
            let plans = self.plans.get_or_insert_with(FftPlans::new);
            self.forward = Some(plans.forward(g.n / 2));
            self.inverse = Some(plans.inverse(g.m));
            self.symbol_fft = Some(plans.forward(g.p));
            let scale = 1.0 / g.n as f32;
            self.weights = band_weights(layout, &g).iter().map(|w| w * scale).collect();
            let first = self.weights.iter().position(|&w| w > 0.0).unwrap_or(0);
            let last = self.weights.iter().rposition(|&w| w > 0.0).unwrap_or(0);
            self.weight_span = (first, last);
            self.twiddle = (0..layout.tones)
                .flat_map(|j| {
                    (0..g.p).map(move |k| {
                        let a = -TAU * (j * k) as f64 / g.p as f64;
                        Complex32::new(a.cos() as f32, a.sin() as f32)
                    })
                })
                .collect();
            self.split = (0..=g.n / 2)
                .map(|k| {
                    let a = -TAU * k as f64 / g.n as f64;
                    Complex32::new(a.cos() as f32, a.sin() as f32)
                })
                .collect();
            self.geometry = Some(g);
        }
        self.tried.clear();
        let len = audio.len().min(g.n);
        let sample = |i: usize| -> f32 {
            match audio.get(i) {
                Some(&x) if i < len && x.is_finite() => x.clamp(
                    -rr73_dsp::spectrogram::SAMPLE_LIMIT,
                    rr73_dsp::spectrogram::SAMPLE_LIMIT,
                ),
                _ => 0.0,
            }
        };
        // A real sequence of n points as n / 2 complex ones (even samples real, odd ones
        // imaginary), one FFT, then the two halves' spectra separated.
        let h = g.n / 2;
        let zero = Complex32::new(0.0, 0.0);
        self.band.clear();
        self.band
            .extend((0..h).map(|i| Complex32::new(sample(2 * i), sample(2 * i + 1))));
        if let Some(f) = &self.forward {
            rr73_dsp::fft::process(f.as_ref(), &mut self.band, &mut self.fft_scratch);
        }
        self.spectrum.clear();
        self.spectrum.resize(h + 1, zero);
        let half = Complex32::new(0.5, 0.0);
        let minus_half_j = Complex32::new(0.0, -0.5);
        for k in 0..=h {
            let z = self.band[k % h];
            let zc = self.band[(h - k) % h].conj();
            self.spectrum[k] = (z + zc) * half + self.split[k] * (z - zc) * minus_half_j;
        }
        self.audio_len = len;
        self.partial = partial;
        self.ready = len > 0;
    }

    /// The symbol levels of the last candidate refined to [`Refined::Levels`]: one frame per
    /// channel symbol, one value per tone, in dB; erased symbols hold NaN.
    pub fn symbols(&self) -> &Spectrogram {
        &self.symbols
    }

    /// Whether the symbol starting at baseband sample `a` lies in the audio.
    fn usable(&self, g: &Geometry, a: isize) -> bool {
        if a < 0 || a as usize + g.p > g.m {
            return false;
        }
        let a = a as usize;
        if self.partial {
            (a + g.p) * g.d <= self.audio_len
        } else {
            (2 * a + g.p) * g.d < 2 * self.audio_len
        }
    }
}

/// Weights of the band cut around a candidate, over FFT offsets from tone 0: flat from 0.75
/// tone spacings below tone 0 to 0.75 above the top tone, then a raised-cosine fall to zero
/// over 0.75 spacings on each side.
fn band_weights(layout: &FrameLayout, g: &Geometry) -> Vec<f32> {
    let spacing = f64::from(layout.tone_spacing_hz);
    let lo = -0.75 * spacing;
    let hi = (layout.tones as f64 - 1.0 + 0.75) * spacing;
    let taper = 0.75 * spacing;
    let half = (g.m / 2) as isize;
    (0..g.m)
        .map(|i| {
            let f = (i as isize - half) as f64 * g.bin_hz();
            let out = if f < lo {
                lo - f
            } else if f > hi {
                f - hi
            } else {
                0.0
            };
            if out >= taper {
                0.0
            } else {
                (0.5 * (1.0 + (std::f64::consts::PI * out / taper).cos())) as f32
            }
        })
        .collect()
}

/// Refines each candidate on a complex baseband of its band and reads its symbol levels there
/// (see the module documentation).
#[derive(Clone, Debug, PartialEq)]
pub struct BasebandRefine {
    /// Report a candidate whose refined position repeats one tried in the pass as
    /// [`Refined::Repeat`].
    pub skip_repeats: bool,
}

impl Default for BasebandRefine {
    fn default() -> Self {
        Self { skip_repeats: true }
    }
}

impl BasebandRefine {
    /// Refines `cand` (found on `view`'s grid) and fills `s.symbols`. Returns
    /// [`Refined::Grid`], leaving `cand` unchanged, when the candidate's band or start lies
    /// outside what the pass's audio holds, and [`Refined::Repeat`] when its refined position
    /// was tried before in the pass.
    pub fn refine(&self, view: &SymbolView<'_>, cand: &mut Candidate, s: &mut RefineScratch) -> Refined {
        let Some(g) = s.geometry.filter(|g| s.ready && g.mode == view.layout.mode) else {
            return Refined::Grid;
        };
        let layout = view.layout;
        let p = g.p;
        let rate = g.rate();
        let spacing = f64::from(layout.tone_spacing_hz);
        let zero = Complex32::new(0.0, 0.0);

        // The band, brought to baseband with tone 0 of the candidate at 0 Hz.
        let k0 = (f64::from(view.freq_hz(cand)) / g.bin_hz()).round() as isize;
        let half = (g.m / 2) as isize;
        let (w0, w1) = s.weight_span;
        if k0 + w0 as isize - half <= 0 || k0 + w1 as isize - half >= (g.n / 2) as isize {
            return Refined::Grid;
        }
        s.band.clear();
        s.band.resize(g.m, zero);
        for i in w0..=w1 {
            let o = i as isize - half;
            s.band[o.rem_euclid(g.m as isize) as usize] = s.spectrum[(k0 + o) as usize] * s.weights[i];
        }
        if let Some(f) = &s.inverse {
            rr73_dsp::fft::process(f.as_ref(), &mut s.band, &mut s.fft_scratch);
        }
        let fm = k0 as f64 * g.bin_hz();

        // 1. Start, by the energy of each sync symbol's tone, with a sliding DFT along the
        // starts: X(t + 1) = (X(t) - x[t] + x[t + p]) e^{j 2π tone / p}.
        let start = (f64::from(view.dt_s(cand)) + f64::from(layout.start_offset_s)) * FS / g.d as f64;
        let t0 = start.round() as isize;
        let reach = (p / (2 * view.time_osr.max(1))) as isize + 2;
        let width = (2 * reach + 1) as usize;
        s.metric.clear();
        s.metric.resize(width, 0.0);
        s.counts.clear();
        s.counts.resize(width, 0);
        for group in &layout.sync {
            for (k, &tone) in group.tones.iter().enumerate() {
                let tone = tone as usize;
                let tw = &s.twiddle[tone * p..(tone + 1) * p];
                let a = -TAU * tone as f64 / p as f64;
                let back = Complex32::new(a.cos() as f32, -a.sin() as f32);
                let offset = ((group.start + k) * p) as isize;
                let mut x: Option<(isize, Complex32)> = None;
                for (i, t) in (t0 - reach..=t0 + reach).enumerate() {
                    let a = t + offset;
                    if a < 0 || a as usize + p > g.m {
                        x = None;
                        continue;
                    }
                    let au = a as usize;
                    let value = match x {
                        Some((prev, v)) if prev + 1 == a => (v - s.band[au - 1] + s.band[au + p - 1]) * back,
                        _ => dot(&s.band[au..au + p], tw),
                    };
                    x = Some((a, value));
                    if s.usable(&g, a) {
                        s.metric[i] += value.norm_sqr();
                        s.counts[i] += 1;
                    }
                }
            }
        }
        let mut best: Option<(f32, isize)> = None;
        for (i, (&e, &n)) in s.metric.iter().zip(&s.counts).enumerate() {
            if n > 0 {
                let e = e / n as f32;
                if best.is_none_or(|(b, _)| e > b) {
                    best = Some((e, t0 - reach + i as isize));
                }
            }
        }
        let Some((_, t1)) = best else {
            return Refined::Grid;
        };

        // 2. Frequency, by coherent correlation over each sync group. Sums over blocks of a
        // quarter symbol keep the cost per frequency step at four products per symbol.
        let q = (p / 4).max(1);
        let per_symbol = p / q;
        s.blocks.clear();
        for group in &layout.sync {
            for (k, &tone) in group.tones.iter().enumerate() {
                let a = t1 + ((group.start + k) * p) as isize;
                if !s.usable(&g, a) {
                    s.blocks.extend(std::iter::repeat_n(zero, per_symbol));
                    continue;
                }
                let a = a as usize;
                let tw = &s.twiddle[tone as usize * p..(tone as usize + 1) * p];
                for b in 0..per_symbol {
                    let r = b * q..(b + 1) * q;
                    let sum = dot(&s.band[a + r.start..a + r.end], &tw[r]);
                    s.blocks.push(sum);
                }
            }
        }
        let span_hz = 0.5 * spacing / view.freq_osr.max(1) as f64 + 0.08 * spacing;
        let step_hz = 0.04 * spacing;
        let steps = (span_hz / step_hz).ceil() as isize;
        s.metric.clear();
        for i in -steps..=steps {
            let turn = -TAU * i as f64 * step_hz * q as f64 / rate;
            let step = Complex32::new(turn.cos() as f32, turn.sin() as f32);
            let mut total = 0.0f32;
            let mut at = 0;
            for group in &layout.sync {
                let len = group.tones.len() * per_symbol;
                let mut rot = Complex32::new(1.0, 0.0);
                let mut sum = zero;
                for b in &s.blocks[at..at + len] {
                    sum += b * rot;
                    rot *= step;
                }
                total += sum.norm_sqr();
                at += len;
            }
            s.metric.push(total);
        }
        let peak = argmax(&s.metric);
        let df = (peak as isize - steps) as f64 * step_hz + step_hz * parabola(&s.metric, peak);

        // 3. Start again, coherently at that frequency: each sync symbol against its tone
        // turned by the frequency correction over its place in the group.
        let longest = layout.sync.iter().map(|g| g.tones.len()).max().unwrap_or(0) * p;
        let step = -TAU * df / rate;
        s.rotation.clear();
        s.rotation.extend((0..longest.max(p)).map(|n| {
            let a = step * n as f64;
            Complex32::new(a.cos() as f32, a.sin() as f32)
        }));
        s.references.clear();
        for group in &layout.sync {
            for (k, &tone) in group.tones.iter().enumerate() {
                let tw = &s.twiddle[tone as usize * p..(tone as usize + 1) * p];
                let rot = &s.rotation[k * p..(k + 1) * p];
                s.references.extend(tw.iter().zip(rot).map(|(w, r)| w * r));
            }
        }
        s.metric.clear();
        for t in t1 - 2..=t1 + 2 {
            let mut total = 0.0f32;
            let mut at = 0;
            for group in &layout.sync {
                let mut sum = zero;
                for k in 0..group.tones.len() {
                    let a = t + ((group.start + k) * p) as isize;
                    if s.usable(&g, a) {
                        let a = a as usize;
                        sum += dot(&s.band[a..a + p], &s.references[(at + k) * p..(at + k + 1) * p]);
                    }
                }
                total += sum.norm_sqr();
                at += group.tones.len();
            }
            s.metric.push(total);
        }
        let peak = argmax(&s.metric);
        let t2 = t1 - 2 + peak as isize;
        let t_frac = parabola(&s.metric, peak);

        let freq = fm + df;
        if self.skip_repeats {
            if s.tried
                .iter()
                .any(|&(t, f)| t == t2 && (f - freq).abs() <= REPEAT_SPACINGS * spacing)
            {
                return Refined::Repeat;
            }
            s.tried.push((t2, freq));
        }

        // 4. Symbol levels with a one-symbol window: each symbol's samples turned by the
        // frequency correction, then a p-point FFT whose first bins are the tones.
        s.rows.clear();
        for sym in 0..layout.symbols {
            let a = t2 + (sym * p) as isize;
            if s.usable(&g, a) {
                let a = a as usize;
                let turned = s.band[a..a + p].iter().zip(&s.rotation[..p]).map(|(x, r)| x * r);
                s.rows.extend(turned);
            } else {
                s.rows.extend(std::iter::repeat_n(zero, p));
            }
        }
        if let Some(f) = &s.symbol_fft {
            // One call transforms every symbol: the buffer holds whole multiples of p.
            let need = f.get_inplace_scratch_len();
            if s.fft_scratch.len() < need {
                s.fft_scratch.resize(need, zero);
            }
            f.process_with_scratch(&mut s.rows, &mut s.fft_scratch[..need]);
        }
        let sps = layout.samples_per_symbol;
        s.symbols.reset(layout.symbols, layout.tones, sps, sps, 12_000);
        let norm = 1.0 / (p * p) as f32;
        for sym in 0..layout.symbols {
            let usable = s.usable(&g, t2 + (sym * p) as isize);
            let Some(row) = s.symbols.frame_mut(sym) else {
                break;
            };
            if !usable {
                row.fill(f32::NAN);
                continue;
            }
            for (level, c) in row.iter_mut().zip(&s.rows[sym * p..sym * p + layout.tones]) {
                *level = 10.0 * (c.norm_sqr() * norm + rr73_dsp::spectrogram::POWER_FLOOR).log10();
            }
        }

        // The candidate at the refined position: the nearest grid point, with the rest as
        // fractions for the reported DT and frequency.
        let hop = view.spec.hop().max(1) as f64;
        let audio_start = (t2 as f64 + t_frac) * g.d as f64;
        let frame = (audio_start + 0.5 * sps as f64) / hop;
        let bw = f64::from(view.spec.bin_width_hz());
        let bins = view.bin_range();
        if bw <= 0.0 || bins.is_empty() {
            return Refined::Grid;
        }
        let bin = freq / bw - view.spec.min_bin() as f64;
        let grid_bin = (bin.round() as i32).clamp(bins.start, bins.end - 1);
        cand.frame = frame.round() as i32;
        cand.frame_frac = (frame - f64::from(cand.frame)) as f32;
        cand.bin = grid_bin;
        cand.bin_frac = (bin - f64::from(grid_bin)) as f32;
        Refined::Levels
    }
}

/// Index of the largest value (the first on ties); 0 when empty.
fn argmax(v: &[f32]) -> usize {
    v.iter()
        .enumerate()
        .fold(
            (0usize, f32::NEG_INFINITY),
            |acc, (i, &x)| if x > acc.1 { (i, x) } else { acc },
        )
        .0
}

/// Offset of a parabola's vertex through `v[i - 1]`, `v[i]`, `v[i + 1]` from `i`, in steps,
/// within half a step; 0 at the ends or without a maximum.
fn parabola(v: &[f32], i: usize) -> f64 {
    if i == 0 || i + 1 >= v.len() {
        return 0.0;
    }
    let (a, b, c) = (f64::from(v[i - 1]), f64::from(v[i]), f64::from(v[i + 1]));
    let den = a - 2.0 * b + c;
    if den < 0.0 {
        (0.5 * (a - c) / den).clamp(-0.5, 0.5)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::test_layouts;
    use crate::search::{CandidateSearch, CostasSearch};
    use crate::testsig;

    #[test]
    fn fft_lengths_are_smooth_and_cover_the_slot() {
        assert_eq!(smooth_at_least(3200), 3200);
        assert_eq!(smooth_at_least(2834), 2880);
        for layout in [test_layouts::ft8(), test_layouts::ft4()] {
            let g = Geometry::new(&layout);
            assert_eq!(g.d * g.p, layout.samples_per_symbol);
            assert!(g.n >= layout.slot_samples() + 12_000, "{g:?}");
            assert_eq!(smooth_at_least(g.m), g.m);
        }
        let g = Geometry::new(&test_layouts::ft8());
        assert_eq!((g.p, g.d, g.m, g.n), (32, 60, 3200, 192_000));
    }

    #[test]
    fn band_is_flat_over_the_tones_and_closed_beyond() {
        let layout = test_layouts::ft8();
        let g = Geometry::new(&layout);
        let w = band_weights(&layout, &g);
        let at = |hz: f64| w[((hz / g.bin_hz()).round() as isize + (g.m / 2) as isize) as usize];
        for hz in [-4.0, 0.0, 21.9, 43.75, 48.0] {
            assert_eq!(at(hz), 1.0, "{hz} Hz");
        }
        for hz in [-9.5, -20.0, 53.5, 80.0] {
            assert_eq!(at(hz), 0.0, "{hz} Hz");
        }
        assert!(at(-7.0) > 0.0 && at(-7.0) < 1.0);
    }

    /// Refines the best search candidate of a rendered signal; returns the view's grid and
    /// the refined candidate's frequency and DT.
    fn refined(layout: &FrameLayout, freq: f64, dt: f64, snr_db: f64, seed: u64) -> (f32, f32, f32, f32) {
        let tones = testsig::random_tones(layout, seed);
        let audio = testsig::render(layout, &tones, freq, dt, snr_db, Some(seed + 100));
        let spec = testsig::spectrogram(layout, &audio);
        let view = SymbolView {
            spec: &spec,
            layout,
            time_osr: 2,
            freq_osr: 2,
            live: &[],
        };
        let mut cands = Vec::new();
        let range = match layout.mode {
            Mode::Ft8 | Mode::Lq8 => view.frame_range(-2.3, 2.5),
            Mode::Ft4 => view.frame_range(-1.0, 1.0),
        };
        CostasSearch {
            max_candidates: 5,
            min_score_db: 1.0,
        }
        .search(&view, range, &mut cands);
        let mut cand = cands[0];
        let (grid_f, grid_dt) = (view.freq_hz(&cand), view.dt_s(&cand));
        let mut s = RefineScratch::default();
        s.prepare(layout, &audio, false);
        assert_eq!(
            BasebandRefine::default().refine(&view, &mut cand, &mut s),
            Refined::Levels
        );
        (grid_f, grid_dt, view.freq_hz(&cand), view.dt_s(&cand))
    }

    #[test]
    fn refinement_finds_start_and_frequency_between_grid_points() {
        let layout = test_layouts::ft8();
        // Offsets chosen to fall between grid points (bins 3.125 Hz, frames 80 ms apart).
        for (k, &(freq, dt)) in [(1001.6, 0.04), (1499.2, 0.37), (2203.9, -0.62), (812.5, 1.13)]
            .iter()
            .enumerate()
        {
            let (gf, gdt, f, d) = refined(&layout, freq, dt, -12.0, k as u64 + 1);
            assert!(
                (f64::from(f) - freq).abs() < 0.25,
                "freq {f} (grid {gf}) for {freq}"
            );
            assert!((f64::from(d) - dt).abs() < 0.008, "dt {d} (grid {gdt}) for {dt}");
        }
    }

    #[test]
    fn refinement_works_for_ft4() {
        let layout = test_layouts::ft4();
        for (k, &(freq, dt)) in [(1003.0, 0.11), (1754.2, -0.23)].iter().enumerate() {
            let (gf, gdt, f, d) = refined(&layout, freq, dt, -6.0, k as u64 + 7);
            assert!(
                (f64::from(f) - freq).abs() < 1.0,
                "freq {f} (grid {gf}) for {freq}"
            );
            assert!((f64::from(d) - dt).abs() < 0.004, "dt {d} (grid {gdt}) for {dt}");
        }
    }

    #[test]
    fn symbol_levels_carry_the_tones_and_erase_symbols_outside_the_audio() {
        let layout = test_layouts::ft8();
        let tones = testsig::random_tones(&layout, 5);
        // DT 2.4 s: the last symbols run past the end of the slot.
        let audio = testsig::render(&layout, &tones, 1234.0, 2.4, -5.0, Some(9));
        let spec = testsig::spectrogram(&layout, &audio);
        let view = SymbolView {
            spec: &spec,
            layout: &layout,
            time_osr: 2,
            freq_osr: 2,
            live: &[],
        };
        let mut cands = Vec::new();
        CostasSearch {
            max_candidates: 3,
            min_score_db: 1.0,
        }
        .search(&view, view.frame_range(-2.3, 2.5), &mut cands);
        let mut cand = cands[0];
        let mut s = RefineScratch::default();
        s.prepare(&layout, &audio, false);
        assert_eq!(
            BasebandRefine::default().refine(&view, &mut cand, &mut s),
            Refined::Levels
        );
        let (mut right, mut erased) = (0, 0);
        for (k, &tone) in tones.iter().enumerate() {
            let row = s.symbols.frame(k).expect("row");
            if row[0].is_nan() {
                erased += 1;
                continue;
            }
            let loudest =
                row.iter().enumerate().fold(
                    (0, f32::NEG_INFINITY),
                    |a, (j, &v)| if v > a.1 { (j, v) } else { a },
                );
            right += usize::from(loudest.0 == tone as usize);
        }
        // Symbol k starts at 0.5 + 2.4 + 0.16 k s; its middle passes 15 s from k = 76.
        assert_eq!(erased, 3, "erased {erased}");
        assert_eq!(right, 76, "right {right}");
    }

    #[test]
    fn noise_and_silence_refine_without_panicking() {
        let layout = test_layouts::ft8();
        let mut s = RefineScratch::default();
        for audio in [
            testsig::noise(180_000, 3),
            vec![0.0; 180_000],
            vec![f32::NAN; 1000],
            Vec::new(),
        ] {
            let spec = testsig::spectrogram(&layout, &audio);
            let view = SymbolView {
                spec: &spec,
                layout: &layout,
                time_osr: 2,
                freq_osr: 2,
                live: &[],
            };
            s.prepare(&layout, &audio, false);
            for (frame, bin) in [(0, 10), (-21, 0), (38, 300), (5, 893)] {
                let mut cand = Candidate::new(frame, bin, 1.0);
                if BasebandRefine::default().refine(&view, &mut cand, &mut s) == Refined::Levels {
                    assert!(view.freq_hz(&cand).is_finite() && view.dt_s(&cand).is_finite());
                }
            }
        }
    }
}
