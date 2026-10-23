//! Signal subtraction: rebuild each decoded signal and remove it from the slot audio, so the
//! next pass sees what lies under it.
//!
//! The model is the complex form of the transmitted GFSK waveform, `c(k) = e^{jφ(k)}`, with
//! the same phase as `rr73_ft8::synth::gfsk` (whose output is `sin φ(k)`): the frequency
//! deviation is the sum of Gaussian-smoothed rectangular pulses, one per symbol, truncated to
//! three symbols, with the first and last tones extended by one symbol (QEX 2020, section 5).
//! A test checks the model against the codec sample by sample.
//!
//! For a received real signal `x = Re{A(t) c(t)} + rest`, the product `x · conj(c)` equals
//! `A/2` plus a term at twice the carrier frequency plus everything else mixed down. A moving
//! average over `smooth` samples keeps `A/2`, so `A(t)` follows fading and a small frequency
//! error; `Re{A(t) c(t)}` is then subtracted.
//!
//! Subtraction is only as good as the model's timing and frequency. The decoder's grid puts
//! the start within a quarter symbol (40 ms for FT8) and the frequency within a quarter tone
//! spacing, so the optional refinement first searches the start on a 5 ms grid (interpolated
//! to about 1 ms) by matching the known tones against the audio mixed down and decimated to
//! 32 samples per symbol, then measures the frequency error from the phase drift of the
//! per-symbol correlations.

use std::sync::OnceLock;

use rr73_dsp::Complex64;
use rr73_ft8::Mode;

use crate::layout::FrameLayout;
use crate::report::Decode;
use crate::stages::Subtractor;

/// Sample rate of slot audio, in Hz.
const FS: f64 = 12_000.0;

/// Decimated samples per symbol used by the refinement search.
const REFINE_SAMPLES_PER_SYMBOL: usize = 32;

/// Samples between exact recomputations of the model's carrier and modulation phase.
const RESYNC: usize = 1920;

/// Samples per block of [`Model::fill`].
const MODEL_BLOCK: usize = 256;

/// Buffers reused across subtractions. Sized on first use; the largest holds one sample per
/// block of the refinement search (about 2500 values for FT8).
#[derive(Clone, Debug, Default)]
pub struct SubtractScratch {
    products: Vec<Complex64>,
    models: Vec<Complex64>,
    blocks: Vec<Complex64>,
    reference: Vec<Complex64>,
    scores: Vec<f64>,
}

/// Subtracts decodes with the complex GFSK model.
#[derive(Clone, Debug, PartialEq)]
pub struct ModelSubtract {
    /// Length of the moving average that estimates the complex amplitude, in seconds.
    pub smooth_s: f32,
    /// Refine each signal's start and frequency from its known tones before subtracting.
    pub refine: bool,
}

impl Subtractor for ModelSubtract {
    fn name(&self) -> &'static str {
        "model"
    }

    fn subtract(
        &self,
        layout: &FrameLayout,
        audio: &mut [f32],
        decodes: &[Decode],
        scratch: &mut SubtractScratch,
    ) {
        let smooth = ((f64::from(self.smooth_s) * FS).round() as usize).max(1);
        for d in decodes {
            let tones = rr73_ft8::tones::from_payload(layout.mode, &d.payload);
            let start = ((f64::from(d.dt_s) + f64::from(layout.start_offset_s)) * FS).round() as isize;
            let mut signal = Placement {
                start,
                freq_hz: f64::from(d.freq_hz),
            };
            if self.refine {
                signal = refine(layout, &tones, audio, signal, scratch);
            }
            remove(layout, &tones, audio, signal, smooth, scratch);
        }
    }
}

/// Where a signal sits in the slot.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placement {
    /// Sample of the start of symbol 0 (may be negative).
    pub start: isize,
    /// Base-tone frequency, in Hz.
    pub freq_hz: f64,
}

/// The frequency pulse of `mode` at 12 kHz, over three symbols: `p[i]` for
/// `t = i / n - 1.5` symbols, in tone spacings.
fn pulse(mode: Mode, n: usize, bt: f64) -> &'static [f64] {
    static FT8: OnceLock<Vec<f64>> = OnceLock::new();
    static FT4: OnceLock<Vec<f64>> = OnceLock::new();
    let build = || {
        let k = std::f64::consts::PI * (2.0 / std::f64::consts::LN_2).sqrt();
        (0..3 * n)
            .map(|i| {
                let t = i as f64 / n as f64 - 1.5;
                (erf(k * bt * (t + 0.5)) - erf(k * bt * (t - 0.5))) / 2.0
            })
            .collect()
    };
    match mode {
        Mode::Ft8 => FT8.get_or_init(build),
        Mode::Ft4 => FT4.get_or_init(build),
    }
}

/// Running sums of [`pulse`]: `cum[j]` is the sum of the first `j` values (`3n + 1` entries).
fn pulse_sums(mode: Mode, n: usize, bt: f64) -> &'static [f64] {
    static FT8: OnceLock<Vec<f64>> = OnceLock::new();
    static FT4: OnceLock<Vec<f64>> = OnceLock::new();
    let build = || {
        let p = pulse(mode, n, bt);
        let mut acc = 0.0;
        let mut out = Vec::with_capacity(p.len() + 1);
        out.push(0.0);
        for v in p {
            acc += v;
            out.push(acc);
        }
        out
    };
    match mode {
        Mode::Ft8 => FT8.get_or_init(build),
        Mode::Ft4 => FT4.get_or_init(build),
    }
}

/// Fills `out` with `θ(k)` at `k = d/2, d/2 + d, ...` (the centres of blocks of `d` samples)
/// for every whole block of a transmission of `tones`. Uses the pulse's running sums, so the
/// cost is one product per block and three per symbol.
fn phase_at_block_centres(layout: &FrameLayout, tones: &[u8], d: usize, out: &mut Vec<f64>) {
    out.clear();
    let n = layout.samples_per_symbol;
    let count = tones.len();
    if count == 0 || n == 0 || d == 0 {
        return;
    }
    let cum = pulse_sums(layout.mode, n, f64::from(layout.mode.params().gfsk_bt));
    let step = std::f64::consts::TAU / n as f64;
    let (s0, s1, s2) = (cum[n], cum[2 * n] - cum[n], cum[3 * n] - cum[2 * n]);
    let tone = |i: isize| f64::from(tones[i.clamp(0, count as isize - 1) as usize]);
    let blocks = count * n / d;
    let mut theta = 0.0;
    let mut k = d / 2;
    for s in 0..count {
        let (prev, here, next) = (tone(s as isize - 1), tone(s as isize), tone(s as isize + 1));
        while k < (s + 1) * n && out.len() < blocks {
            let r = k - s * n;
            let within = prev * (cum[2 * n + r] - cum[2 * n]) + here * (cum[n + r] - cum[n]) + next * cum[r];
            out.push(theta + step * within);
            k += d;
        }
        theta += step * (prev * s2 + here * s1 + next * s0);
    }
}

/// The modulation phase `θ(k)` of a transmission, sample by sample, without the carrier:
/// `θ(0) = 0`, `θ(k + 1) = θ(k) + 2π dev(k) / n`, where `dev(k)` sums the pulses of the
/// previous, current and next symbol (first and last tones extended).
pub struct Phase<'a> {
    tones: &'a [u8],
    pulse: &'static [f64],
    n: usize,
    step: f64,
    symbol: usize,
    within: usize,
    near: [f64; 3],
    theta: f64,
}

impl<'a> Phase<'a> {
    /// Starts at sample 0 of `tones` in `layout`'s mode.
    pub fn new(layout: &FrameLayout, tones: &'a [u8]) -> Self {
        let n = layout.samples_per_symbol.max(1);
        let mut p = Self {
            tones,
            pulse: pulse(layout.mode, n, f64::from(layout.mode.params().gfsk_bt)),
            n,
            step: std::f64::consts::TAU / n as f64,
            symbol: 0,
            within: 0,
            near: [0.0; 3],
            theta: 0.0,
        };
        p.load();
        p
    }

    /// Samples in the transmission.
    pub fn len(&self) -> usize {
        self.tones.len() * self.n
    }

    /// `true` for an empty tone list.
    pub fn is_empty(&self) -> bool {
        self.tones.is_empty()
    }

    fn load(&mut self) {
        let count = self.tones.len() as isize;
        if count == 0 {
            return;
        }
        let tone = |i: isize| f64::from(self.tones[i.clamp(0, count - 1) as usize]);
        let s = self.symbol as isize;
        self.near = [tone(s - 1), tone(s), tone(s + 1)];
    }

    /// Returns `θ` at the current sample and the step to the next one, then advances.
    #[inline]
    pub fn advance(&mut self) -> (f64, f64) {
        let n = self.n;
        let r = self.within;
        let dev = self.near[0] * self.pulse[2 * n + r]
            + self.near[1] * self.pulse[n + r]
            + self.near[2] * self.pulse[r];
        let delta = self.step * dev;
        let theta = self.theta;
        self.theta += delta;
        self.within += 1;
        if self.within == n {
            self.within = 0;
            self.symbol += 1;
            self.load();
        }
        (theta, delta)
    }
}

/// The complex model `c(k) = e^{j(2π f k / fs + θ(k))}`, sample by sample. The phase advances
/// by a rotation per sample (`e^{jδ}` by its Taylor series, exact to 1e-12 for the steps of
/// FT8 and FT4) and is recomputed exactly every 1920 samples so rounding cannot drift.
struct Model<'a> {
    phase: Phase<'a>,
    w: f64,
    carrier_step: Complex64,
    carrier: Complex64,
    modulation: Complex64,
    k: usize,
    until_resync: usize,
}

impl<'a> Model<'a> {
    fn new(layout: &FrameLayout, tones: &'a [u8], freq_hz: f64) -> Self {
        let w = std::f64::consts::TAU * freq_hz / FS;
        Self {
            phase: Phase::new(layout, tones),
            w,
            carrier_step: Complex64::new(w.cos(), w.sin()),
            carrier: Complex64::new(1.0, 0.0),
            modulation: Complex64::new(1.0, 0.0),
            k: 0,
            until_resync: 0,
        }
    }

    /// Returns `c(k)` and advances. Carrier and modulation rotate separately, which keeps
    /// the two multiplication chains independent. [`Model::fill`] gives the same values a
    /// block at a time; this stays as its reference.
    #[cfg(test)]
    fn advance(&mut self) -> Complex64 {
        let (theta, delta) = self.phase.advance();
        if self.until_resync == 0 {
            self.resync(theta);
        }
        self.until_resync -= 1;
        let out = self.carrier * self.modulation;
        let d2 = delta * delta;
        let rot = Complex64::new(
            1.0 - d2 / 2.0 + d2 * d2 / 24.0,
            delta * (1.0 - d2 / 6.0 + d2 * d2 / 120.0),
        );
        self.modulation *= rot;
        self.carrier *= self.carrier_step;
        self.k += 1;
        out
    }

    /// Sets carrier and modulation exactly at sample `k`, whose modulation phase is `theta`.
    fn resync(&mut self, theta: f64) {
        let a = (self.w * self.k as f64).rem_euclid(std::f64::consts::TAU);
        self.carrier = Complex64::new(a.cos(), a.sin());
        self.modulation = Complex64::new(theta.cos(), theta.sin());
        self.until_resync = RESYNC;
    }

    /// Writes the next `out.len()` values of `c(k)` and advances past them, equal bit for
    /// bit to calling [`Model::advance`] for each. Within a block that stays in one symbol
    /// and before the next resync, the phase steps and their rotations are independent per
    /// sample and run as slice operations, which vectorise; only the phase sum and the two
    /// rotation chains run sample by sample.
    fn fill(&mut self, out: &mut [Complex64]) {
        let mut done = 0;
        let mut block = Block::default();
        while done < out.len() {
            let len = self.begin_block(out.len() - done, &mut block);
            let steps = block.delta[..len]
                .iter()
                .zip(&block.rot_re[..len])
                .zip(&block.rot_im[..len]);
            for (o, ((&d, &re), &im)) in out[done..done + len].iter_mut().zip(steps) {
                *o = self.carrier * self.modulation;
                self.modulation *= Complex64::new(re, im);
                self.carrier *= self.carrier_step;
                self.phase.theta += d;
            }
            self.end_block(len);
            done += len;
        }
    }

    /// Starts a block of at most `most` samples that stays in one symbol and before the next
    /// resync: resyncs when one is due and writes the block's phase steps and their
    /// rotations to `block`. Returns the block's length. The caller runs the chains over it
    /// as [`Model::fill`] does, then calls [`Model::end_block`].
    fn begin_block(&mut self, most: usize, block: &mut Block) -> usize {
        if self.until_resync == 0 {
            self.resync(self.phase.theta);
        }
        let p = &self.phase;
        let n = p.n;
        let r = p.within;
        let len = most.min(n - r).min(self.until_resync).min(MODEL_BLOCK);
        let [n0, n1, n2] = p.near;
        let (prev, here, next) = (
            &p.pulse[2 * n + r..2 * n + r + len],
            &p.pulse[n + r..n + r + len],
            &p.pulse[r..r + len],
        );
        for (((d, &a), &b), &c) in block.delta[..len].iter_mut().zip(prev).zip(here).zip(next) {
            *d = p.step * (n0 * a + n1 * b + n2 * c);
        }
        for ((re, im), &d) in block.rot_re[..len]
            .iter_mut()
            .zip(&mut block.rot_im[..len])
            .zip(&block.delta[..len])
        {
            let d2 = d * d;
            *re = 1.0 - d2 / 2.0 + d2 * d2 / 24.0;
            *im = d * (1.0 - d2 / 6.0 + d2 * d2 / 120.0);
        }
        len
    }

    /// Ends a block of `len` samples begun with [`Model::begin_block`].
    fn end_block(&mut self, len: usize) {
        let p = &mut self.phase;
        p.within += len;
        if p.within == p.n {
            p.within = 0;
            p.symbol += 1;
            p.load();
        }
        self.k += len;
        self.until_resync -= len;
    }
}

/// The phase steps of one block of [`Model`] and their rotations.
struct Block {
    delta: [f64; MODEL_BLOCK],
    rot_re: [f64; MODEL_BLOCK],
    rot_im: [f64; MODEL_BLOCK],
}

impl Default for Block {
    fn default() -> Self {
        Self {
            delta: [0.0; MODEL_BLOCK],
            rot_re: [0.0; MODEL_BLOCK],
            rot_im: [0.0; MODEL_BLOCK],
        }
    }
}

/// Estimates the complex amplitude of the model of `tones` at `at` in `audio` with a moving
/// average of `smooth` samples and subtracts the rebuilt signal. The model and its products
/// with the audio are computed for the whole span first: the window reads samples ahead of
/// the one being subtracted, which are still unchanged.
fn remove(
    layout: &FrameLayout,
    tones: &[u8],
    audio: &mut [f32],
    at: Placement,
    smooth: usize,
    scratch: &mut SubtractScratch,
) {
    let mut model = Model::new(layout, tones, at.freq_hz);
    let total = model.phase.len() as isize;
    let first = (-at.start).clamp(0, total) as usize;
    let last = (audio.len() as isize - at.start).clamp(0, total) as usize;
    if first >= last {
        return;
    }
    let span = last - first;
    // The samples before the audio, then the span.
    scratch.models.clear();
    scratch.models.resize(first.max(span), Complex64::new(0.0, 0.0));
    model.fill(&mut scratch.models[..first]);
    let half = smooth / 2;
    let offset = at.start + first as isize;
    let audio = &mut audio[offset as usize..offset as usize + span];
    if half >= MODEL_BLOCK && span > 2 * half + 2 {
        remove_fused(&mut model, audio, half, scratch);
        return;
    }
    model.fill(&mut scratch.models[..span]);
    scratch.models.truncate(span);
    scratch.products.clear();
    scratch.products.extend(
        scratch
            .models
            .iter()
            .zip(audio.iter())
            .map(|(c, &x)| c.conj() * f64::from(x)),
    );
    let (models, products) = (&scratch.models, &scratch.products);
    let mut window = Window {
        lo: 0,
        hi: 0,
        sum: Complex64::new(0.0, 0.0),
        scale: 0.0,
        scale_for: usize::MAX,
    };
    // Where the window holds 2 half + 1 samples, each step adds one product and drops one,
    // in that order, and the scale stays: a loop without bounds checks. The edges take the
    // general step.
    let steady = (half + 1).min(span)..span.saturating_sub(half + 1).max((half + 1).min(span));
    for k in 0..steady.start {
        window.step(k, half, products);
        let rebuilt = (window.sum * models[k]).re * window.scale;
        audio[k] = (f64::from(audio[k]) - rebuilt) as f32;
    }
    if !steady.is_empty() {
        let adds = &products[steady.start + half..steady.end + half];
        let drops = &products[steady.start - half - 1..steady.end - half - 1];
        let (mut sum, scale) = (window.sum, window.scale);
        let rows = adds.iter().zip(drops).zip(&models[steady.clone()]);
        for (((&add, &drop), &model), x) in rows.zip(&mut audio[steady.clone()]) {
            sum += add;
            sum -= drop;
            let rebuilt = (sum * model).re * scale;
            *x = (f64::from(*x) - rebuilt) as f32;
        }
        window.sum = sum;
        window.hi = steady.end + half;
        window.lo = steady.end - half - 1;
    }
    for k in steady.end..span {
        window.step(k, half, products);
        let rebuilt = (window.sum * models[k]).re * window.scale;
        audio[k] = (f64::from(audio[k]) - rebuilt) as f32;
    }
}

/// [`remove`] when the window reaches at least [`MODEL_BLOCK`] samples either side and
/// the span holds a steady part: the model of the span is computed `half` samples ahead of
/// the moving sum in the same loop, so the model's rotation chains and the sum's chain
/// overlap. `model` stands at the start of the span. Every value comes from the same
/// operations in the same order as computing the model and its products over the whole
/// span first: a product is taken before the sample it reads is subtracted from.
fn remove_fused(model: &mut Model<'_>, audio: &mut [f32], half: usize, scratch: &mut SubtractScratch) {
    let span = audio.len();
    let zero = Complex64::new(0.0, 0.0);
    scratch.models.clear();
    scratch.models.resize(span, zero);
    scratch.products.clear();
    scratch.products.resize(span, zero);
    let steady = half + 1..span - half - 1;
    // The model and products that the steps before the steady part read.
    let ahead = steady.start + half;
    model.fill(&mut scratch.models[..ahead]);
    let made = scratch.products[..ahead]
        .iter_mut()
        .zip(&scratch.models[..ahead])
        .zip(audio.iter());
    for ((p, c), &x) in made {
        *p = c.conj() * f64::from(x);
    }
    let mut window = Window {
        lo: 0,
        hi: 0,
        sum: zero,
        scale: 0.0,
        scale_for: usize::MAX,
    };
    for (k, y) in audio.iter_mut().enumerate().take(steady.start) {
        window.step(k, half, &scratch.products);
        let rebuilt = (window.sum * scratch.models[k]).re * window.scale;
        *y = (f64::from(*y) - rebuilt) as f32;
    }
    // Each step makes the model and product at `k + half`, adds that product, drops the one
    // at `k - half - 1` and subtracts at `k`.
    let (mut sum, scale) = (window.sum, window.scale);
    let mut block = Block::default();
    let mut k = steady.start;
    while k < steady.end {
        let len = model.begin_block(steady.end - k, &mut block);
        let j = k + half;
        let (models_done, models_new) = scratch.models.split_at_mut(j);
        let (products_done, products_new) = scratch.products.split_at_mut(j);
        let (audio_done, audio_ahead) = audio.split_at_mut(j);
        let (mut carrier, mut modulation, carrier_step) =
            (model.carrier, model.modulation, model.carrier_step);
        let mut theta = model.phase.theta;
        let made = models_new[..len]
            .iter_mut()
            .zip(&mut products_new[..len])
            .zip(&audio_ahead[..len]);
        let steps = block.delta[..len]
            .iter()
            .zip(&block.rot_re[..len])
            .zip(&block.rot_im[..len]);
        let rows = audio_done[k..k + len]
            .iter_mut()
            .zip(&models_done[k..k + len])
            .zip(&products_done[k - half - 1..k - half - 1 + len]);
        for ((((m, p), &x), ((&d, &re), &im)), ((y, &c), &drop)) in made.zip(steps).zip(rows) {
            let ahead = carrier * modulation;
            *m = ahead;
            let add = ahead.conj() * f64::from(x);
            *p = add;
            modulation *= Complex64::new(re, im);
            carrier *= carrier_step;
            theta += d;
            sum += add;
            sum -= drop;
            let rebuilt = (sum * c).re * scale;
            *y = (f64::from(*y) - rebuilt) as f32;
        }
        (model.carrier, model.modulation, model.phase.theta) = (carrier, modulation, theta);
        model.end_block(len);
        k += len;
    }
    window.sum = sum;
    window.hi = steady.end + half;
    window.lo = steady.end - half - 1;
    let from = steady.end + half;
    model.fill(&mut scratch.models[from..]);
    let made = scratch.products[from..]
        .iter_mut()
        .zip(&scratch.models[from..])
        .zip(&audio[from..]);
    for ((p, c), &x) in made {
        *p = c.conj() * f64::from(x);
    }
    for (k, y) in audio.iter_mut().enumerate().skip(steady.end) {
        window.step(k, half, &scratch.products);
        let rebuilt = (window.sum * scratch.models[k]).re * window.scale;
        *y = (f64::from(*y) - rebuilt) as f32;
    }
}

/// The moving sum of [`remove`]: products `lo..hi` summed in the order they entered.
struct Window {
    lo: usize,
    hi: usize,
    sum: Complex64,
    scale: f64,
    scale_for: usize,
}

impl Window {
    /// Moves the window to sample `k`: adds the products up to `k + half`, then drops those
    /// before `k - half`, and sets the scale to 2 over the samples held.
    fn step(&mut self, k: usize, half: usize, products: &[Complex64]) {
        let want_hi = (k + half + 1).min(products.len());
        while self.hi < want_hi {
            self.sum += products[self.hi];
            self.hi += 1;
        }
        let want_lo = k.saturating_sub(half);
        while self.lo < want_lo {
            self.sum -= products[self.lo];
            self.lo += 1;
        }
        if self.hi - self.lo != self.scale_for {
            self.scale_for = self.hi - self.lo;
            self.scale = 2.0 / self.scale_for as f64;
        }
    }
}

/// Refines the start and frequency of a signal whose modulation phase is in
/// `scratch.theta`, by matching it against `audio`. Returns the input when the audio does
/// not cover the signal.
pub fn refine(
    layout: &FrameLayout,
    tones: &[u8],
    audio: &[f32],
    coarse: Placement,
    scratch: &mut SubtractScratch,
) -> Placement {
    let n = layout.samples_per_symbol;
    let d = (n / REFINE_SAMPLES_PER_SYMBOL).max(1);
    let total = tones.len() * n;
    if total == 0 || audio.is_empty() {
        return coarse;
    }
    // Mix down around the middle of the signal's tones and sum blocks of d samples.
    let centre = coarse.freq_hz + 0.5 * (layout.tones as f64 - 1.0) * f64::from(layout.tone_spacing_hz);
    let radius = (n / 2) as isize;
    let from_block = (coarse.start - radius).div_euclid(d as isize);
    let to_block = (coarse.start + total as isize + radius).div_euclid(d as isize) + 1;
    let w = -std::f64::consts::TAU * centre / FS;
    // Oscillator over one block, and the block-to-block rotation (exact every 64 blocks).
    scratch.models.clear();
    scratch.models.extend((0..d).map(|i| {
        let a = w * i as f64;
        Complex64::new(a.cos(), a.sin())
    }));
    let block_step = Complex64::new((w * d as f64).cos(), (w * d as f64).sin());
    let mut block_osc = Complex64::new(1.0, 0.0);
    scratch.blocks.clear();
    for (j, b) in (from_block..to_block).enumerate() {
        let s0 = b * d as isize;
        if j % 64 == 0 {
            let a = (w * s0 as f64).rem_euclid(std::f64::consts::TAU);
            block_osc = Complex64::new(a.cos(), a.sin());
        }
        let mut sum = Complex64::new(0.0, 0.0);
        if s0 >= 0 && s0 as usize + d <= audio.len() {
            let chunk = &audio[s0 as usize..s0 as usize + d];
            for (x, o) in chunk.iter().zip(&scratch.models) {
                sum += o * f64::from(*x);
            }
        } else {
            for (i, o) in scratch.models.iter().enumerate() {
                let idx = s0 + i as isize;
                if idx >= 0
                    && let Some(&x) = audio.get(idx as usize)
                {
                    sum += o * f64::from(x);
                }
            }
        }
        scratch.blocks.push(sum * block_osc);
        block_osc *= block_step;
    }
    // The model at block centres, relative to the mixing frequency.
    let offset = std::f64::consts::TAU * (coarse.freq_hz - centre) / FS;
    phase_at_block_centres(layout, tones, d, &mut scratch.scores);
    scratch.reference.clear();
    for (m, theta) in scratch.scores.iter().enumerate() {
        let phi = theta + offset * (m * d + d / 2) as f64;
        scratch.reference.push(Complex64::new(phi.cos(), -phi.sin()));
    }
    let per_symbol = (n / d).max(1);
    let metric = |shift: isize, blocks: &[Complex64], reference: &[Complex64]| -> f64 {
        let mut energy = 0.0;
        for (seg, chunk) in reference.chunks(per_symbol).enumerate() {
            let mut s = Complex64::new(0.0, 0.0);
            for (i, r) in chunk.iter().enumerate() {
                let b = shift + (seg * per_symbol + i) as isize;
                if let Some(y) = usize::try_from(b).ok().and_then(|b| blocks.get(b)) {
                    s += y * r;
                }
            }
            energy += s.norm_sqr();
        }
        energy
    };
    // Shifts are in blocks, relative to the first mixed-down block.
    let nominal = coarse.start.div_euclid(d as isize) - from_block;
    let span = radius / d as isize;
    let mut best = (f64::NEG_INFINITY, nominal);
    scratch.scores.clear();
    for shift in (nominal - span)..=(nominal + span) {
        let e = metric(shift, &scratch.blocks, &scratch.reference);
        scratch.scores.push(e);
        if e > best.0 {
            best = (e, shift);
        }
    }
    if !best.0.is_finite() || best.0 <= 0.0 {
        return coarse;
    }
    let at = (best.1 - (nominal - span)) as usize;
    let scores = &scratch.scores;
    let frac = if at > 0 && at + 1 < scores.len() {
        let (a, b, c) = (scores[at - 1], scores[at], scores[at + 1]);
        let den = a - 2.0 * b + c;
        if den < 0.0 {
            (0.5 * (a - c) / den).clamp(-0.5, 0.5)
        } else {
            0.0
        }
    } else {
        0.0
    };
    let start = ((from_block + best.1) as f64 + frac) * d as f64;

    // Frequency error from the phase drift between consecutive symbols.
    let mut drift = Complex64::new(0.0, 0.0);
    let mut previous: Option<Complex64> = None;
    for (seg, chunk) in scratch.reference.chunks(per_symbol).enumerate() {
        let mut s = Complex64::new(0.0, 0.0);
        for (i, r) in chunk.iter().enumerate() {
            let b = best.1 + (seg * per_symbol + i) as isize;
            if let Some(y) = usize::try_from(b).ok().and_then(|b| scratch.blocks.get(b)) {
                s += y * r;
            }
        }
        if let Some(p) = previous {
            drift += s * p.conj();
        }
        previous = Some(s);
    }
    let symbol_s = n as f64 / FS;
    let df = if drift.norm_sqr() > 0.0 {
        drift.arg() / (std::f64::consts::TAU * symbol_s)
    } else {
        0.0
    };
    Placement {
        start: start.round() as isize,
        freq_hz: coarse.freq_hz + df,
    }
}

/// The error function, to about 1e-15 absolute (series with positive terms).
pub(crate) fn erf(x: f64) -> f64 {
    let a = x.abs();
    if a >= 6.0 {
        return x.signum();
    }
    let a2 = a * a;
    let mut term = a;
    let mut sum = a;
    let mut n = 0.0;
    while term > sum * 1e-17 {
        n += 1.0;
        term *= 2.0 * a2 / (2.0 * n + 1.0);
        sum += term;
    }
    (2.0 / std::f64::consts::PI.sqrt() * (-a2).exp() * sum).copysign(x)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::layout;

    fn tones_for(mode: Mode, text: &str) -> Vec<u8> {
        let msg = rr73_ft8::Message::parse(text).expect("parse");
        let payload = rr73_ft8::message::pack(&msg, &mut rr73_ft8::CallsignHashes::new()).expect("pack");
        rr73_ft8::tones::from_payload(mode, &payload)
    }

    #[test]
    fn block_centre_phase_matches_the_sample_by_sample_phase() {
        for mode in [Mode::Ft8, Mode::Ft4] {
            let l = layout(mode);
            let tones = tones_for(mode, "W9XYZ K1ABC RR73");
            let mut centres = Vec::new();
            phase_at_block_centres(l, &tones, 60, &mut centres);
            let mut phase = Phase::new(l, &tones);
            let all: Vec<f64> = (0..phase.len()).map(|_| phase.advance().0).collect();
            assert_eq!(centres.len(), all.len() / 60);
            for (m, theta) in centres.iter().enumerate() {
                assert!((theta - all[m * 60 + 30]).abs() < 1e-9, "{mode:?} block {m}");
            }
        }
    }

    #[test]
    fn model_matches_the_codec_waveform() {
        for mode in [Mode::Ft8, Mode::Ft4] {
            let l = layout(mode);
            let tones = tones_for(mode, "CQ K1ABC FN42");
            let wave = rr73_ft8::synth::gfsk(mode, &tones, 1234.5, 12_000, 1.0);
            let mut model = Model::new(l, &tones, 1234.5);
            assert_eq!(model.phase.len(), wave.len());
            let values: Vec<Complex64> = (0..wave.len()).map(|_| model.advance()).collect();
            // Skip the amplitude ramps (one symbol for FT4, T/8 for FT8).
            let skip = l.samples_per_symbol;
            let worst = values[skip..values.len() - skip]
                .iter()
                .zip(&wave[skip..wave.len() - skip])
                .map(|(c, &s)| (c.im - f64::from(s)).abs())
                .fold(0.0f64, f64::max);
            assert!(worst < 1e-4, "{mode:?}: {worst}");
        }
    }

    fn rendered(snr_db: f64, noise: bool) -> (Vec<f32>, Vec<u8>) {
        use rr73_chansim::{Noise, Scene, SimSignal, render};
        let scene = Scene {
            mode: Mode::Ft8,
            signals: vec![SimSignal::new("CQ K1ABC FN42", 1500.3, 0.23, snr_db)],
            noise: if noise { Noise::Awgn } else { Noise::None },
        };
        (
            render(&scene, 3).expect("render").0,
            tones_for(Mode::Ft8, "CQ K1ABC FN42"),
        )
    }

    /// The rendered signal's start sample: (0.5 + 0.23) s at 12 kHz.
    const START: isize = 8760;

    fn power(x: &[f32]) -> f64 {
        x.iter().map(|&v| f64::from(v).powi(2)).sum::<f64>()
    }

    #[test]
    fn exact_placement_removes_the_signal() {
        let (mut audio, tones) = rendered(10.0, false);
        let before = power(&audio);
        let at = Placement {
            start: START,
            freq_hz: 1500.3,
        };
        remove(
            layout(Mode::Ft8),
            &tones,
            &mut audio,
            at,
            1920,
            &mut SubtractScratch::default(),
        );
        let after = power(&audio);
        assert!(10.0 * (after / before).log10() < -30.0, "{before} {after}");
    }

    #[test]
    fn refinement_recovers_start_and_frequency() {
        let (audio, tones) = rendered(-5.0, true);
        let mut s = SubtractScratch::default();
        for (dstart, dfreq) in [(400isize, 1.4), (-450, -1.5), (0, 0.0), (37, 0.7)] {
            let coarse = Placement {
                start: START + dstart,
                freq_hz: 1500.3 + dfreq,
            };
            let fine = refine(layout(Mode::Ft8), &tones, &audio, coarse, &mut s);
            assert!(
                (fine.start - START).abs() <= 48,
                "start {} for offset {dstart}",
                fine.start
            );
            assert!(
                (fine.freq_hz - 1500.3).abs() <= 0.1,
                "freq {} for offset {dfreq}",
                fine.freq_hz
            );
        }
    }

    #[test]
    fn refinement_makes_coarse_subtraction_deep() {
        let l = layout(Mode::Ft8);
        let mut depth = Vec::new();
        for refine_first in [false, true] {
            let (mut audio, tones) = rendered(10.0, false);
            let before = power(&audio);
            let mut s = SubtractScratch::default();
            let mut at = Placement {
                start: START + 300,
                freq_hz: 1500.3 + 1.2,
            };
            if refine_first {
                at = refine(l, &tones, &audio, at, &mut s);
            }
            remove(l, &tones, &mut audio, at, 1920, &mut s);
            depth.push(10.0 * (power(&audio) / before).log10());
        }
        assert!(depth[1] < -25.0, "{depth:?}");
        assert!(depth[1] < depth[0] - 6.0, "{depth:?}");
    }

    #[test]
    fn edges_and_empty_inputs_are_safe() {
        let l = layout(Mode::Ft8);
        let mut s = SubtractScratch::default();
        let tones = tones_for(Mode::Ft8, "CQ K1ABC FN42");
        for start in [-200_000isize, -100_000, -5, 170_000, 1_000_000] {
            let mut audio = vec![0.1f32; 180_000];
            let at = Placement {
                start,
                freq_hz: 1000.0,
            };
            remove(l, &tones, &mut audio, at, 1920, &mut s);
            assert!(audio.iter().all(|v| v.is_finite()));
            assert!(refine(l, &tones, &audio, at, &mut s).freq_hz.is_finite());
        }
        let at = Placement {
            start: 0,
            freq_hz: 1000.0,
        };
        let mut empty: Vec<f32> = Vec::new();
        remove(l, &tones, &mut empty, at, 1920, &mut s);
        assert_eq!(refine(l, &tones, &empty, at, &mut s), at);
        let mut audio = vec![0.1f32; 1000];
        remove(l, &[], &mut audio, at, 1920, &mut s);
        assert_eq!(refine(l, &[], &audio, at, &mut s), at);
        assert!(audio.iter().all(|&v| v == 0.1));
    }

    /// [`remove`] as it was before experiment 0009, with ring buffers and the model sample by
    /// sample.
    ///
    /// Estimates the complex amplitude of the model of `tones` at `at` in `audio` with a moving
    /// average of `smooth` samples and subtracts the rebuilt signal. Works in one pass with ring
    /// buffers of `smooth + 2` values: the window reads samples ahead of the one being
    /// subtracted, which are still unchanged.
    fn remove_reference(
        layout: &FrameLayout,
        tones: &[u8],
        audio: &mut [f32],
        at: Placement,
        smooth: usize,
        scratch: &mut SubtractScratch,
    ) {
        let mut model = Model::new(layout, tones, at.freq_hz);
        let total = model.phase.len() as isize;
        let first = (-at.start).clamp(0, total) as usize;
        let last = (audio.len() as isize - at.start).clamp(0, total) as usize;
        if first >= last {
            return;
        }
        for _ in 0..first {
            model.advance();
        }
        let half = smooth / 2;
        let ring = smooth + 2;
        scratch.products.clear();
        scratch.products.resize(ring, Complex64::new(0.0, 0.0));
        scratch.models.clear();
        scratch.models.resize(ring, Complex64::new(0.0, 0.0));
        let offset = at.start + first as isize;
        let span = last - first;
        let audio = &mut audio[offset as usize..offset as usize + span];
        // Ring positions of the window's ends and of the sample being subtracted.
        let (mut lo, mut hi) = (0usize, 0usize);
        let (mut lo_at, mut hi_at, mut k_at) = (0usize, 0usize, 0usize);
        let wrap = |i: &mut usize| {
            *i += 1;
            if *i == ring {
                *i = 0;
            }
        };
        let mut sum = Complex64::new(0.0, 0.0);
        let mut scale = 0.0;
        let mut scale_for = usize::MAX;
        for k in 0..span {
            let want_hi = (k + half + 1).min(span);
            while hi < want_hi {
                let c = model.advance();
                let p = c.conj() * f64::from(audio[hi]);
                scratch.products[hi_at] = p;
                scratch.models[hi_at] = c;
                sum += p;
                hi += 1;
                wrap(&mut hi_at);
            }
            let want_lo = k.saturating_sub(half);
            while lo < want_lo {
                sum -= scratch.products[lo_at];
                lo += 1;
                wrap(&mut lo_at);
            }
            if hi - lo != scale_for {
                scale_for = hi - lo;
                scale = 2.0 / scale_for as f64;
            }
            let rebuilt = (sum * scratch.models[k_at]).re * scale;
            audio[k] = (f64::from(audio[k]) - rebuilt) as f32;
            wrap(&mut k_at);
        }
    }

    #[test]
    fn remove_matches_the_reference_bit_for_bit() {
        let mut checked = 0;
        for mode in [Mode::Ft8, Mode::Ft4] {
            let layout = crate::pipeline::layout(mode);
            let tones = tones_for(mode, "CQ K1ABC FN42");
            let slot = layout.slot_samples();
            let total = (tones.len() * layout.samples_per_symbol) as isize;
            let base: Vec<f32> = crate::testsig::noise(slot, 7)
                .iter()
                .enumerate()
                .map(|(i, x)| x + 0.5 * (i as f32 * 0.071).sin())
                .collect();
            let mut scratch = SubtractScratch::default();
            for (start, len) in [
                (6000isize, slot),
                (0, slot),
                (-5000, slot),
                (-total + 10, slot),
                (slot as isize - 3000, slot),
                (1234, 100_000.min(slot)),
                // Spans just longer than the preset's window, at the end and at the start.
                (slot as isize - 1925, slot),
                (-total + 1924, slot),
                (2000, 500),
                (-total - 5, slot),
                (slot as isize + 5, slot),
            ] {
                // Windows below, at and above the fused removal's least half-width of 256
                // samples, and the preset's 1920.
                for (freq_hz, smooth) in [
                    (1234.56, 1920usize),
                    (377.0, 1),
                    (2950.25, 961),
                    (1500.0, 4000),
                    (811.5, 511),
                    (2003.0, 512),
                    (640.25, 515),
                ] {
                    let mut want = base[..len].to_vec();
                    let mut got = want.clone();
                    let at = Placement { start, freq_hz };
                    remove_reference(layout, &tones, &mut want, at, smooth, &mut scratch);
                    remove(layout, &tones, &mut got, at, smooth, &mut scratch);
                    let bits = |v: &[f32]| v.iter().map(|x| x.to_bits()).collect::<Vec<_>>();
                    assert!(
                        bits(&want) == bits(&got),
                        "{mode:?} start {start} length {len} smooth {smooth}"
                    );
                    checked += 1;
                }
            }
        }
        assert_eq!(checked, 154);
    }

    #[test]
    fn model_fill_matches_advance_bit_for_bit() {
        for mode in [Mode::Ft8, Mode::Ft4] {
            let layout = crate::pipeline::layout(mode);
            let tones = tones_for(mode, "W9XYZ K1ABC R-12");
            let total = tones.len() * layout.samples_per_symbol;
            let mut a = Model::new(layout, &tones, 1500.5);
            let want: Vec<Complex64> = (0..total).map(|_| a.advance()).collect();
            // Uneven pieces cross symbol, block and resync boundaries.
            let mut b = Model::new(layout, &tones, 1500.5);
            let mut got = vec![Complex64::new(0.0, 0.0); total];
            let mut at = 0;
            for piece in [1usize, 255, 256, 257, 1919, 1920, 1921, 7, 3000].iter().cycle() {
                let to = (at + piece).min(total);
                b.fill(&mut got[at..to]);
                at = to;
                if at == total {
                    break;
                }
            }
            let bits = |v: &[Complex64]| {
                v.iter()
                    .map(|c| (c.re.to_bits(), c.im.to_bits()))
                    .collect::<Vec<_>>()
            };
            assert!(bits(&want) == bits(&got), "{mode:?}");
            assert_eq!(a.phase.theta.to_bits(), b.phase.theta.to_bits());
        }
    }
}
