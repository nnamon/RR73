//! Soft bits from noncoherent detection of blocks of symbols (experiment 0008).
//!
//! FT8 and FT4 are continuous-phase FSK with modulation index 1: each tone completes a whole
//! number of cycles per symbol relative to tone 0, so the correlations of consecutive symbols
//! with their sent tones share one phase, apart from the rotation a frequency error adds. The
//! Gaussian smoothing bends the phase only during the transitions between tones. Detection
//! over a block of N symbols scores every tone sequence over the block by the magnitude of the
//! sum of its complex correlations; a bit's LLR is the best score among the sequences with the
//! bit set minus the best among those with it clear (max-log). The method follows the
//! description in Franke, Somerville and Taylor, "The FT4 and FT8 Communication Protocols",
//! QEX July/August 2020, section 6; the code is written from that description.
//!
//! Per decoding pass, [`BlockWorkspace::prepare`] transforms the residual audio once. Per
//! candidate, [`BlockWorkspace::amplitudes`] cuts the band around the candidate to a complex
//! baseband of 30 samples per symbol, refines the start and the frequency from the sync
//! symbols, and correlates every symbol with every tone. [`BlockWorkspace::llrs`] then gives
//! the soft bits for one block length.

use rr73_dsp::FftPlans;
use rr73_dsp::fft::{self, Complex32, Complex64};
use rr73_ft8::Mode;

use crate::demod::normalise_variance_over;
use crate::layout::{CODEWORD_BITS, FrameLayout};

/// Baseband samples per symbol.
pub const SAMPLES_PER_SYMBOL: usize = 30;

/// Longest block, in symbols.
pub const MAX_BLOCK: usize = 4;

/// Largest number of tones of a layout (FT8).
const MAX_TONES: usize = 8;

/// Most start offsets tried on each side of the candidate, in baseband samples (half a
/// symbol).
const START_STEPS: isize = (SAMPLES_PER_SYMBOL / 2) as isize;

/// Steps of the frequency search per tone spacing.
const FREQ_DIVISIONS: usize = 32;

/// Most frequency offsets tried on each side of the candidate, in steps (half a spacing).
const FREQ_STEPS: isize = (FREQ_DIVISIONS / 2) as isize;

/// Tone spacings kept flat on each side of the signal's tones when the band is cut out.
const PASSBAND_SPACINGS: f64 = 1.5;

/// Tone spacings of the raised-cosine taper beyond the flat part.
const TAPER_SPACINGS: f64 = 1.0;

/// Sizes of the slot transform and of the baseband for one mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Geometry {
    /// Points of the slot transform: the smallest `3 * 2^k` audio samples that hold the slot
    /// and a sixteenth more, sizes the FFT handles fastest.
    pub slot_fft: usize,
    /// Baseband samples over the same time: [`SAMPLES_PER_SYMBOL`] per symbol.
    pub baseband_len: usize,
}

impl Geometry {
    /// The geometry of `layout`: a 196 608-point slot transform and 3072 baseband samples at
    /// 187.5 Hz for FT8, 98 304 and 5120 at 625 Hz for FT4. `None` when the symbol length
    /// does not divide the transform into whole baseband samples.
    pub fn new(layout: &FrameLayout) -> Option<Self> {
        let need = layout.slot_samples() + layout.slot_samples() / 16;
        let mut slot_fft = 3usize;
        while slot_fft < need {
            slot_fft *= 2;
        }
        let total = slot_fft * SAMPLES_PER_SYMBOL;
        let sps = layout.samples_per_symbol.max(1);
        total.is_multiple_of(sps).then(|| Self {
            slot_fft,
            baseband_len: total / sps,
        })
    }

    /// Baseband sample rate, in Hz.
    pub fn rate_hz(&self) -> f64 {
        12_000.0 * self.baseband_len as f64 / self.slot_fft as f64
    }

    /// Audio samples (12 kHz) per baseband sample.
    pub fn audio_per_sample(&self) -> f64 {
        self.slot_fft as f64 / self.baseband_len as f64
    }
}

/// How a tone sequence's block correlation becomes the score that the max-log LLR compares.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlockScore {
    /// The magnitude of the sum of the complex amplitudes (QEX 2020).
    #[default]
    Amplitude,
    /// Its logarithm: a strong interferer moves an LLR by the log of its level over the
    /// signal's, as the spectrogram's dB magnitudes do.
    Log,
}

/// Where the refinement put a candidate.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Refined {
    /// Frequency of tone 0, in Hz.
    pub freq_hz: f64,
    /// Start of symbol 0, in seconds from the slot start.
    pub start_s: f64,
    /// Sync symbols inside the audio whose strongest tone is the sent one.
    pub sync_matched: usize,
}

/// Buffers for block detection, reused across candidates and slots. Sized on first use.
#[derive(Default)]
pub struct BlockWorkspace {
    /// Mode and geometry of the prepared slot transform.
    prepared: Option<(Mode, Geometry)>,
    /// Transform of the residual audio of the pass.
    spectrum: Vec<Complex32>,
    /// Audio samples the transform holds; symbols beyond them are erased.
    audio_len: usize,
    fft_scratch: Vec<Complex32>,
    /// Audio sample pairs as complex values, then their transform.
    packed: Vec<Complex32>,
    baseband: Vec<Complex32>,
    /// Sync symbols of the layout: channel symbol, tone and group.
    sync: Vec<(usize, u8, usize)>,
    /// Known tone of each channel symbol (sync symbols), or `None`.
    known: Vec<Option<u8>>,
    /// Mode the two tables above and `rotations` belong to.
    tables_for: Option<Mode>,
    /// `e^{-j2π q (s + 1/2)}` for each frequency offset `q` tried and each sync symbol `s`.
    rotations: Vec<Complex32>,
    /// `e^{-j2π t m / 30}` for each tone `t` and sample `m` of a symbol.
    tone_twiddles: Vec<Complex32>,
    /// Sync correlations for each start offset tried.
    sync_corr: Vec<Complex32>,
    /// Tone references at the refined frequency.
    twiddles: Vec<Complex32>,
    /// Weight of each slot transform bin cut to baseband, from `taper_from` bins below tone 0.
    taper: Vec<f32>,
    taper_from: i64,
    /// Complex amplitude of each tone in each channel symbol.
    amps: Vec<[Complex32; MAX_TONES]>,
    /// Symbols outside the audio.
    erased: Vec<bool>,
    others: Vec<Complex32>,
    next: Vec<Complex32>,
}

impl std::fmt::Debug for BlockWorkspace {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BlockWorkspace")
            .field("prepared", &self.prepared)
            .field("audio_len", &self.audio_len)
            .finish_non_exhaustive()
    }
}

impl BlockWorkspace {
    /// Transforms `audio` (12 kHz, sample 0 at the slot start) for candidates of `layout`.
    /// Audio past the transform's length is ignored, and non-finite samples read as zero.
    pub fn prepare(&mut self, layout: &FrameLayout, audio: &[f32], plans: &mut FftPlans) {
        self.prepared = None;
        let Some(g) = Geometry::new(layout) else {
            return;
        };
        let n = g.slot_fft;
        let h = n / 2;
        // A real transform through a complex one of half the length: even samples in the
        // real part, odd samples in the imaginary part.
        let clean = |x: Option<&f32>| match x {
            Some(&x) if x.is_finite() => x.clamp(-1e6, 1e6),
            _ => 0.0,
        };
        self.packed.clear();
        self.packed
            .extend((0..h).map(|i| Complex32::new(clean(audio.get(2 * i)), clean(audio.get(2 * i + 1)))));
        let plan = plans.forward(h);
        fft::process(plan.as_ref(), &mut self.packed, &mut self.fft_scratch);
        // X[k] = E[k] + e^{-j2πk/n} O[k], with E and O the transforms of the even and odd
        // samples, from Z[k] and conj(Z[h - k]).
        self.spectrum.clear();
        self.spectrum.resize(h, Complex32::new(0.0, 0.0));
        let step = -std::f64::consts::TAU / n as f64;
        let rot = Complex64::new(step.cos(), step.sin());
        let mut w = Complex64::new(1.0, 0.0);
        for k in 0..h {
            if k.is_multiple_of(1024) {
                let a = step * k as f64;
                w = Complex64::new(a.cos(), a.sin());
            }
            let z = self.packed[k];
            let c = self.packed[(h - k) % h].conj();
            let even = (z + c) * 0.5;
            let odd = (z - c) * Complex32::new(0.0, -0.5);
            let wf = Complex32::new(w.re as f32, w.im as f32);
            self.spectrum[k] = even + wf * odd;
            w *= rot;
        }
        self.audio_len = audio.len().min(n);
        self.prepared = Some((layout.mode, g));
    }

    /// Builds the tables that depend on the layout only.
    fn tables(&mut self, layout: &FrameLayout) {
        if self.tables_for == Some(layout.mode) && self.known.len() == layout.symbols {
            return;
        }
        self.sync.clear();
        self.known.clear();
        self.known.resize(layout.symbols, None);
        for (g, group) in layout.sync.iter().enumerate() {
            for (k, &tone) in group.tones.iter().enumerate() {
                let s = group.start + k;
                if s < layout.symbols {
                    self.sync.push((s, tone, g));
                    self.known[s] = Some(tone);
                }
            }
        }
        self.rotations.clear();
        for q in -FREQ_STEPS..=FREQ_STEPS {
            let q = q as f64 / FREQ_DIVISIONS as f64;
            for &(s, _, _) in &self.sync {
                let a = -std::f64::consts::TAU * q * (s as f64 + 0.5);
                self.rotations
                    .push(Complex32::new(a.cos() as f32, a.sin() as f32));
            }
        }
        let tones = layout.tones.min(MAX_TONES);
        self.tone_twiddles.clear();
        for t in 0..tones {
            for m in 0..SAMPLES_PER_SYMBOL {
                let a = -std::f64::consts::TAU * (t * m) as f64 / SAMPLES_PER_SYMBOL as f64;
                self.tone_twiddles
                    .push(Complex32::new(a.cos() as f32, a.sin() as f32));
            }
        }
        // The band's weights: flat from 1.5 spacings below tone 0 to 1.5 above the top tone,
        // then a raised cosine over one more spacing.
        let n1 = Geometry::new(layout).map_or(1, |g| g.slot_fft);
        let df = 12_000.0 / n1 as f64;
        let spacing = f64::from(layout.tone_spacing_hz);
        let flat_lo = -PASSBAND_SPACINGS * spacing;
        let flat_hi = ((tones - 1) as f64 + PASSBAND_SPACINGS) * spacing;
        let edge = TAPER_SPACINGS * spacing;
        self.taper_from = ((flat_lo - edge) / df).floor() as i64;
        let to = ((flat_hi + edge) / df).ceil() as i64;
        self.taper.clear();
        for j in self.taper_from..=to {
            let f = j as f64 * df;
            let beyond = if f < flat_lo {
                (flat_lo - f) / edge
            } else if f > flat_hi {
                (f - flat_hi) / edge
            } else {
                0.0
            };
            let w = if beyond >= 1.0 {
                0.0
            } else {
                0.5 * (1.0 + (std::f64::consts::PI * beyond).cos())
            };
            self.taper.push(w as f32);
        }
        self.tables_for = Some(layout.mode);
    }

    /// Cuts the band of a candidate with tone 0 at `freq_hz` and symbol 0 starting `start_s`
    /// seconds into the slot to baseband, refines start and frequency, and correlates every
    /// symbol with every tone. The start is searched within `reach.0` symbols and the
    /// frequency within `reach.1` tone spacings of the candidate (each at most a half).
    /// Returns `None` when the slot was not prepared for this mode or the band holds no
    /// signal at all.
    pub fn amplitudes(
        &mut self,
        layout: &FrameLayout,
        plans: &mut FftPlans,
        freq_hz: f32,
        start_s: f32,
        reach: (f32, f32),
    ) -> Option<Refined> {
        let (mode, g) = self.prepared?;
        if mode != layout.mode || !freq_hz.is_finite() || !start_s.is_finite() {
            return None;
        }
        self.tables(layout);
        let tones = layout.tones.min(MAX_TONES);
        let n1 = g.slot_fft;
        let len = g.baseband_len;
        let df = 12_000.0 / n1 as f64;
        let spacing = f64::from(layout.tone_spacing_hz);

        // The band around the tones, tone 0 shifted to 0 Hz.
        let k0 = (f64::from(freq_hz) / df).round() as i64;
        self.baseband.clear();
        self.baseband.resize(len, Complex32::new(0.0, 0.0));
        let scale = 1.0 / n1 as f32;
        let half = (n1 / 2) as i64;
        for (i, &w) in self.taper.iter().enumerate() {
            let j = self.taper_from + i as i64;
            let src = k0 + j;
            if w == 0.0 || src <= 0 || src >= half {
                continue;
            }
            let at = j.rem_euclid(len as i64) as usize;
            self.baseband[at] = self.spectrum[src as usize] * (w * scale);
        }
        let inv = plans.inverse(len);
        fft::process(inv.as_ref(), &mut self.baseband, &mut self.fft_scratch);

        // Start and frequency: the coherent power of each sync group, summed over groups.
        let rate = g.rate_hz();
        let n0 = (f64::from(start_s) * rate).round() as isize;
        let sps = SAMPLES_PER_SYMBOL as isize;
        let steps = |r: f32, per: usize, most: isize| -> isize {
            let r = if r.is_finite() { r.clamp(0.0, 0.5) } else { 0.5 };
            ((r * per as f32).ceil() as isize).clamp(1, most)
        };
        let start_steps = steps(reach.0, SAMPLES_PER_SYMBOL, START_STEPS);
        let freq_steps = steps(reach.1, FREQ_DIVISIONS, FREQ_STEPS);
        let nsync = self.sync.len();
        let starts = (2 * start_steps + 1) as usize;
        self.sync_corr.clear();
        self.sync_corr.resize(starts * nsync, Complex32::new(0.0, 0.0));
        // A sliding transform: moving the window one sample later drops the first sample,
        // adds the next and turns tone `t` by `e^{j2π t / 30}`.
        let sample = |i: isize| -> Complex32 {
            usize::try_from(i)
                .ok()
                .and_then(|i| self.baseband.get(i))
                .copied()
                .unwrap_or_default()
        };
        for (j, &(s, tone, _)) in self.sync.iter().enumerate() {
            let t = usize::from(tone);
            let tw = &self.tone_twiddles[t * SAMPLES_PER_SYMBOL..][..SAMPLES_PER_SYMBOL];
            let turn = self.tone_twiddles[t * SAMPLES_PER_SYMBOL + 1].conj();
            let mut at = n0 - start_steps + sps * s as isize;
            let mut c = correlate(&self.baseband, at, tw);
            for i in 0..starts {
                if i > 0 {
                    c = (c - sample(at) + sample(at + sps)) * turn;
                    at += 1;
                }
                self.sync_corr[i * nsync + j] = c;
            }
        }
        let groups = layout.sync.len();
        let metric = |corr: &[Complex32], rot: &[Complex32], sync: &[(usize, u8, usize)]| -> f32 {
            let mut sums = [Complex32::new(0.0, 0.0); 8];
            for ((c, r), &(_, _, g)) in corr.iter().zip(rot).zip(sync) {
                if let Some(s) = sums.get_mut(g) {
                    *s += c * r;
                }
            }
            sums.iter().take(groups).map(|s| s.norm_sqr()).sum()
        };
        let mut best = (0.0f32, 0usize, 0usize);
        let trials = (FREQ_STEPS - freq_steps) as usize..=(FREQ_STEPS + freq_steps) as usize;
        for i in 0..starts {
            let corr = &self.sync_corr[i * nsync..(i + 1) * nsync];
            for q in trials.clone() {
                let m = metric(corr, &self.rotations[q * nsync..(q + 1) * nsync], &self.sync);
                if m > best.0 {
                    best = (m, i, q);
                }
            }
        }
        if !(best.0 > 0.0 && best.0.is_finite()) {
            return None;
        }
        let (_, bi, bq) = best;
        let corr = &self.sync_corr[bi * nsync..(bi + 1) * nsync];
        let at = |q: usize| metric(corr, &self.rotations[q * nsync..(q + 1) * nsync], &self.sync);
        let frac = if bq > *trials.start() && bq < *trials.end() {
            let (a, b, c) = (at(bq - 1), best.0, at(bq + 1));
            let den = a - 2.0 * b + c;
            if den < 0.0 {
                (0.5 * (a - c) / den).clamp(-0.5, 0.5)
            } else {
                0.0
            }
        } else {
            0.0
        };
        let q = (bq as f64 - FREQ_STEPS as f64 + f64::from(frac)) / FREQ_DIVISIONS as f64;
        let tau = bi as isize - start_steps;
        let first = n0 + tau;
        // The start between baseband samples, from the sync amplitude at the neighbouring
        // starts (a correlation peak is a triangle in time). A window `f` samples early turns
        // tone `t` by `-2π t f / 30`; the references below turn it back, so that consecutive
        // symbols on different tones stay in phase.
        let amplitude = |i: usize| {
            let corr = &self.sync_corr[i * nsync..(i + 1) * nsync];
            metric(corr, &self.rotations[bq * nsync..(bq + 1) * nsync], &self.sync).sqrt()
        };
        let late = if bi > 0 && bi + 1 < starts {
            let (a, b, c) = (amplitude(bi - 1), best.0.sqrt(), amplitude(bi + 1));
            if a > c && b > c {
                -0.5 * (a - c) / (b - c)
            } else if c > a && b > a {
                0.5 * (c - a) / (b - a)
            } else {
                0.0
            }
        } else {
            0.0
        };
        let late = late.clamp(-0.5, 0.5) as f64;

        // Tone references shifted by the frequency offset, `q` tone spacings.
        self.twiddles.clear();
        for t in 0..tones {
            for m in 0..SAMPLES_PER_SYMBOL {
                let a = -std::f64::consts::TAU * ((t as f64 + q) * m as f64 - t as f64 * late)
                    / SAMPLES_PER_SYMBOL as f64;
                self.twiddles.push(Complex32::new(a.cos() as f32, a.sin() as f32));
            }
        }
        self.amps.clear();
        self.amps
            .resize(layout.symbols, [Complex32::new(0.0, 0.0); MAX_TONES]);
        self.erased.clear();
        self.erased.resize(layout.symbols, true);
        let mut sync_matched = 0;
        for s in 0..layout.symbols {
            let b = first + sps * s as isize;
            let audio_from = b as f64 * g.audio_per_sample();
            let audio_to = (b + sps) as f64 * g.audio_per_sample();
            if audio_from < -0.5 || audio_to > self.audio_len as f64 + 0.5 {
                continue;
            }
            self.erased[s] = false;
            let a = -std::f64::consts::TAU * q * s as f64;
            let rot = Complex32::new(a.cos() as f32, a.sin() as f32);
            for t in 0..tones {
                let tw = &self.twiddles[t * SAMPLES_PER_SYMBOL..(t + 1) * SAMPLES_PER_SYMBOL];
                self.amps[s][t] = correlate(&self.baseband, b, tw) * rot;
            }
            if let Some(k) = self.known[s] {
                let own = self.amps[s][usize::from(k).min(tones - 1)].norm_sqr();
                if own > 0.0 && self.amps[s][..tones].iter().all(|a| a.norm_sqr() <= own) {
                    sync_matched += 1;
                }
            }
        }
        Some(Refined {
            freq_hz: k0 as f64 * df + q * spacing,
            start_s: (first as f64 + late) / rate,
            sync_matched,
        })
    }

    /// Complex amplitude of each tone in each channel symbol, from the last call to
    /// [`BlockWorkspace::amplitudes`]. Blocks read only the known tone of a sync symbol.
    pub fn amps(&self) -> &[[Complex32; MAX_TONES]] {
        &self.amps
    }

    /// Writes the 174 LLRs of the last candidate for blocks of `block` symbols (1 to
    /// [`MAX_BLOCK`]) with `score`, scaled to variance `variance` over the symbols inside the
    /// audio. Erased symbols give 0.
    pub fn llrs(
        &mut self,
        layout: &FrameLayout,
        block: usize,
        score: BlockScore,
        variance: f32,
        llr: &mut [f32; CODEWORD_BITS],
    ) {
        llr.fill(0.0);
        let mut skip = [true; CODEWORD_BITS];
        if self.amps.len() != layout.symbols || self.erased.len() != layout.symbols {
            return;
        }
        self.tables(layout);
        let block = block.clamp(1, MAX_BLOCK);
        let before = (block - 1) / 2;
        let after = block - 1 - before;
        let tones = layout.tones.min(MAX_TONES).min(layout.gray.len());
        let bps = layout.bits_per_symbol;
        for (k, &sym) in layout.data.iter().enumerate() {
            let base = k * bps;
            if base + bps > CODEWORD_BITS {
                break;
            }
            if sym >= layout.symbols || self.erased[sym] {
                continue;
            }
            // Sums over every tone sequence of the other symbols in the block.
            self.others.clear();
            self.others.push(Complex32::new(0.0, 0.0));
            let from = sym.saturating_sub(before);
            let to = (sym + after).min(layout.symbols - 1);
            for p in from..=to {
                if p == sym || self.erased[p] {
                    continue;
                }
                match self.known[p] {
                    Some(t) => {
                        let v = self.amps[p][usize::from(t)];
                        for o in &mut self.others {
                            *o += v;
                        }
                    }
                    None => {
                        self.next.clear();
                        for o in &self.others {
                            for t in 0..tones {
                                self.next.push(o + self.amps[p][t]);
                            }
                        }
                        std::mem::swap(&mut self.others, &mut self.next);
                    }
                }
            }
            let mut best = [0.0f32; MAX_TONES];
            for (t, b) in best.iter_mut().enumerate().take(tones) {
                let own = self.amps[sym][t];
                *b = self
                    .others
                    .iter()
                    .map(|o| (own + o).norm_sqr())
                    .fold(0.0f32, f32::max);
            }
            for i in 0..bps {
                let mask = 1usize << (bps - 1 - i);
                let (mut one, mut zero) = (0.0f32, 0.0f32);
                for (v, &tone) in layout.gray.iter().enumerate().take(tones) {
                    let b = best[usize::from(tone).min(MAX_TONES - 1)];
                    if v & mask != 0 {
                        one = one.max(b);
                    } else {
                        zero = zero.max(b);
                    }
                }
                llr[base + i] = match score {
                    BlockScore::Amplitude => one.sqrt() - zero.sqrt(),
                    // Half the log of the power ratio, with a floor for empty tones.
                    BlockScore::Log => 0.5 * ((one + 1e-30).ln() - (zero + 1e-30).ln()),
                };
            }
            skip[base..base + bps].fill(false);
        }
        normalise_variance_over(llr, variance, &skip);
    }
}

/// Correlation of one symbol of baseband samples from `at` with `reference`; samples outside the
/// baseband read as zero.
#[inline]
fn correlate(baseband: &[Complex32], at: isize, reference: &[Complex32]) -> Complex32 {
    let mut acc = Complex32::new(0.0, 0.0);
    if at >= 0 && (at as usize) + reference.len() <= baseband.len() {
        let x = &baseband[at as usize..at as usize + reference.len()];
        for (a, r) in x.iter().zip(reference) {
            acc += a * r;
        }
    } else {
        for (m, r) in reference.iter().enumerate() {
            let i = at + m as isize;
            if i >= 0
                && let Some(a) = baseband.get(i as usize)
            {
                acc += a * r;
            }
        }
    }
    acc
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

    /// The codec's waveform of `text` with tone 0 at `freq_hz`, starting `dt_s` after the
    /// nominal start, in a slot of zeros or of white noise at `snr_db` (2500 Hz).
    fn slot(mode: Mode, text: &str, freq_hz: f32, dt_s: f64, snr_db: Option<f64>, seed: u64) -> Vec<f32> {
        let l = layout(mode);
        let tones = tones_for(mode, text);
        let wave = rr73_ft8::synth::gfsk(mode, &tones, freq_hz, 12_000, 1.0);
        let mut out = match snr_db {
            Some(snr) => {
                // Signal power 1/2; noise power in 2500 Hz of a 6000 Hz band.
                let sigma = (0.5 / 10f64.powf(snr / 10.0) * 6000.0 / 2500.0).sqrt() as f32;
                crate::testsig::noise(l.slot_samples(), seed)
                    .into_iter()
                    .map(|x| x * sigma)
                    .collect()
            }
            None => vec![0.0f32; l.slot_samples()],
        };
        let start = ((f64::from(l.start_offset_s) + dt_s) * 12_000.0).round() as isize;
        for (i, &w) in wave.iter().enumerate() {
            let n = start + i as isize;
            if n >= 0
                && let Some(x) = out.get_mut(n as usize)
            {
                *x += w;
            }
        }
        out
    }

    #[test]
    fn geometry_matches_the_documented_sizes() {
        let ft8 = Geometry::new(layout(Mode::Ft8)).expect("FT8");
        assert_eq!((ft8.slot_fft, ft8.baseband_len), (196_608, 3072));
        assert!((ft8.rate_hz() - 187.5).abs() < 1e-9);
        assert!((ft8.audio_per_sample() - 64.0).abs() < 1e-9);
        let ft4 = Geometry::new(layout(Mode::Ft4)).expect("FT4");
        assert_eq!((ft4.slot_fft, ft4.baseband_len), (98_304, 5120));
        assert!((ft4.rate_hz() - 625.0).abs() < 1e-9);
    }

    /// The real transform through a half-length complex one equals the direct transform.
    #[test]
    fn slot_transform_matches_a_direct_transform() {
        let l = layout(Mode::Ft4);
        let audio = crate::testsig::noise(90_000, 11);
        let mut ws = BlockWorkspace::default();
        let mut plans = FftPlans::new();
        ws.prepare(l, &audio, &mut plans);
        let n = Geometry::new(l).expect("FT4").slot_fft;
        let mut direct: Vec<Complex32> = (0..n)
            .map(|i| Complex32::new(audio.get(i).copied().unwrap_or(0.0), 0.0))
            .collect();
        let plan = plans.forward(n);
        fft::process(plan.as_ref(), &mut direct, &mut Vec::new());
        let scale = direct.iter().map(|c| c.norm()).fold(0.0f32, f32::max);
        for k in [1usize, 2, 777, 20_000, 49_151] {
            assert!((ws.spectrum[k] - direct[k]).norm() < 1e-4 * scale, "bin {k}");
        }
    }

    /// With the codec's waveform and no noise, the refinement finds the start and the
    /// frequency, and the sent tone's correlation keeps its phase from symbol to symbol:
    /// GFSK's smoothing moves it by at most 0.10 rad in FT8 and 0.22 rad in FT4 here.
    #[test]
    fn sent_tones_share_one_phase() {
        for (mode, text, freq, dt) in [
            (Mode::Ft8, "CQ K1ABC FN42", 1234.56f32, 0.37),
            (Mode::Ft4, "W9XYZ K1ABC R-12", 987.6, -0.21),
        ] {
            let l = layout(mode);
            let tones = tones_for(mode, text);
            let audio = slot(mode, text, freq, dt, None, 0);
            let mut ws = BlockWorkspace::default();
            let mut plans = FftPlans::new();
            ws.prepare(l, &audio, &mut plans);
            let spacing = l.tone_spacing_hz;
            // Start the candidate a fifth of a symbol and a fifth of a spacing off.
            let start = l.start_offset_s + dt as f32 + 0.2 * l.symbol_s();
            let r = ws
                .amplitudes(l, &mut plans, freq - 0.2 * spacing, start, (0.5, 0.5))
                .expect("amplitudes");
            assert!(
                (r.freq_hz - f64::from(freq)).abs() < 0.02 * f64::from(spacing),
                "{mode:?}: {} Hz",
                r.freq_hz
            );
            let true_start = f64::from(l.start_offset_s) + dt;
            let step = f64::from(l.symbol_s()) / SAMPLES_PER_SYMBOL as f64;
            assert!(
                (r.start_s - true_start).abs() <= 0.6 * step,
                "{mode:?}: start {} against {true_start}",
                r.start_s
            );
            let sync: usize = l.sync.iter().map(|g| g.tones.len()).sum();
            assert_eq!(r.sync_matched, sync, "{mode:?}");
            let amps = ws.amps();
            let sent = |s: usize| amps[s][usize::from(tones[s])];
            // Phase step between consecutive symbols, all 79 or 105 of them.
            let worst = (1..l.symbols)
                .map(|s| (sent(s) * sent(s - 1).conj()).arg().abs())
                .fold(0.0f32, f32::max);
            for &s in &l.data {
                let c = sent(s);
                // The sent tone holds nearly all the symbol's energy.
                let others: f32 = (0..l.tones)
                    .filter(|&t| t != usize::from(tones[s]))
                    .map(|t| amps[s][t].norm_sqr())
                    .sum();
                assert!(others < 0.05 * c.norm_sqr(), "{mode:?} symbol {s}");
            }
            let limit = match mode {
                Mode::Ft8 => 0.12,
                Mode::Ft4 => 0.3,
            };
            assert!(worst < limit, "{mode:?}: phase step up to {worst} rad");
        }
    }

    fn hard_errors(l: &FrameLayout, tones: &[u8], llr: &[f32; CODEWORD_BITS]) -> usize {
        let bits = crate::testsig::data_bits(l, tones);
        bits.iter()
            .zip(llr.iter())
            .filter(|&(&b, &x)| u8::from(x > 0.0) != b)
            .count()
    }

    #[test]
    fn strong_signal_gives_the_sent_bits_for_every_block_length() {
        for (mode, text) in [(Mode::Ft8, "CQ K1ABC FN42"), (Mode::Ft4, "CQ K1ABC FN42")] {
            let l = layout(mode);
            let tones = tones_for(mode, text);
            let audio = slot(mode, text, 1500.0, 0.1, Some(0.0), 5);
            let mut ws = BlockWorkspace::default();
            let mut plans = FftPlans::new();
            ws.prepare(l, &audio, &mut plans);
            ws.amplitudes(l, &mut plans, 1500.0, l.start_offset_s + 0.1, (0.5, 0.5))
                .expect("amplitudes");
            for block in 1..=MAX_BLOCK {
                let mut llr = [0.0f32; CODEWORD_BITS];
                ws.llrs(l, block, BlockScore::Amplitude, 24.0, &mut llr);
                assert_eq!(hard_errors(l, &tones, &llr), 0, "{mode:?} block {block}");
                let mean = llr.iter().sum::<f32>() / 174.0;
                let var = llr.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / 174.0;
                assert!(
                    (var - 24.0).abs() < 0.05,
                    "{mode:?} block {block}: variance {var}"
                );
            }
        }
    }

    /// Near the decoding threshold, longer blocks make fewer hard errors than single
    /// symbols: summed over 8 slots, at -19 dB in FT8 and -15 dB in FT4.
    #[test]
    fn longer_blocks_make_fewer_hard_errors_on_weak_signals() {
        for (mode, snr, long) in [(Mode::Ft8, -19.0, 3), (Mode::Ft4, -15.0, 4)] {
            let l = layout(mode);
            let text = "W9XYZ K1ABC -15";
            let tones = tones_for(mode, text);
            let mut ws = BlockWorkspace::default();
            let mut plans = FftPlans::new();
            let (mut single, mut block) = (0, 0);
            for seed in 0..8 {
                let audio = slot(mode, text, 1200.0, 0.0, Some(snr), 100 + seed);
                ws.prepare(l, &audio, &mut plans);
                ws.amplitudes(l, &mut plans, 1200.0, l.start_offset_s, (0.5, 0.5))
                    .expect("amplitudes");
                let mut llr = [0.0f32; CODEWORD_BITS];
                ws.llrs(l, 1, BlockScore::Amplitude, 24.0, &mut llr);
                single += hard_errors(l, &tones, &llr);
                ws.llrs(l, long, BlockScore::Amplitude, 24.0, &mut llr);
                block += hard_errors(l, &tones, &llr);
            }
            assert!(
                (block as f64) < 0.8 * single as f64,
                "{mode:?}: {single} errors with 1 symbol, {block} with {long}"
            );
        }
    }

    /// A weak signal keeps most sync symbols on their sent tone; refined positions in noise
    /// keep few, though the refinement picks the best of about a thousand trials.
    #[test]
    fn sync_count_separates_signals_from_noise() {
        for (mode, snr) in [(Mode::Ft8, -20.0), (Mode::Ft4, -16.0)] {
            let l = layout(mode);
            let mut ws = BlockWorkspace::default();
            let mut plans = FftPlans::new();
            let audio = slot(mode, "CQ K1ABC FN42", 1500.0, 0.0, Some(snr), 9);
            ws.prepare(l, &audio, &mut plans);
            let signal = ws
                .amplitudes(l, &mut plans, 1500.0, l.start_offset_s, (0.5, 0.5))
                .expect("signal")
                .sync_matched;
            ws.prepare(l, &crate::testsig::noise(l.slot_samples(), 21), &mut plans);
            let noise: Vec<usize> = (0..40)
                .filter_map(|k| {
                    let f = 300.0 + 55.0 * k as f32;
                    let t = l.start_offset_s + 0.04 * (k % 7) as f32 - 0.12;
                    ws.amplitudes(l, &mut plans, f, t, (0.5, 0.5))
                })
                .map(|r| r.sync_matched)
                .collect();
            // Chance alone matches 1 in 8 FT8 or 1 in 4 FT4 sync symbols: 2.6 or 4 of them.
            let mean = noise.iter().sum::<usize>() as f64 / noise.len() as f64;
            let (signal_min, noise_mean) = match mode {
                Mode::Ft8 => (10, 4.0),
                Mode::Ft4 => (11, 6.0),
            };
            assert_eq!(noise.len(), 40);
            assert!(
                signal >= signal_min && noise.iter().all(|&n| n < signal) && mean < noise_mean,
                "{mode:?}: signal {signal}, noise {noise:?}"
            );
        }
    }

    #[test]
    fn symbols_beyond_the_audio_are_erased() {
        let l = layout(Mode::Ft8);
        let text = "CQ K1ABC FN42";
        let mut audio = slot(Mode::Ft8, text, 1500.0, 0.0, Some(-5.0), 3);
        // Keep the first 10 s: symbols from 59 on (9.5 s + 0.5 s offset) are cut.
        audio.truncate(120_000);
        let mut ws = BlockWorkspace::default();
        let mut plans = FftPlans::new();
        ws.prepare(l, &audio, &mut plans);
        ws.amplitudes(l, &mut plans, 1500.0, l.start_offset_s, (0.5, 0.5))
            .expect("amplitudes");
        for block in [1, 3] {
            let mut llr = [0.0f32; CODEWORD_BITS];
            ws.llrs(l, block, BlockScore::Amplitude, 24.0, &mut llr);
            for (k, &sym) in l.data.iter().enumerate() {
                let bits = &llr[3 * k..3 * k + 3];
                let cut = (sym + 1) * 1920 + 6000 > 120_000;
                assert_eq!(bits.iter().all(|&x| x == 0.0), cut, "block {block} symbol {sym}");
            }
        }
    }

    #[test]
    fn hostile_input_gives_no_amplitudes_or_finite_ones() {
        let l = layout(Mode::Ft8);
        let mut ws = BlockWorkspace::default();
        let mut plans = FftPlans::new();
        let mut llr = [1.0f32; CODEWORD_BITS];
        // Not prepared.
        assert!(ws.amplitudes(l, &mut plans, 1500.0, 0.5, (0.5, 0.5)).is_none());
        ws.llrs(l, 2, BlockScore::Amplitude, 24.0, &mut llr);
        assert!(llr.iter().all(|&x| x == 0.0));
        for audio in [
            Vec::new(),
            vec![0.0f32; 180_000],
            vec![f32::NAN; 180_000],
            vec![1e30f32; 1000],
        ] {
            ws.prepare(l, &audio, &mut plans);
            for (f, t) in [
                (1500.0, 0.5),
                (-20.0, 0.5),
                (5900.0, 0.5),
                (1500.0, -100.0),
                (1500.0, f32::NAN),
            ] {
                if ws.amplitudes(l, &mut plans, f, t, (0.5, 0.5)).is_some() {
                    ws.llrs(l, 3, BlockScore::Amplitude, 24.0, &mut llr);
                    assert!(llr.iter().all(|x| x.is_finite()));
                }
            }
        }
        // A prepared FT8 slot gives nothing for an FT4 candidate.
        ws.prepare(l, &vec![0.1f32; 180_000], &mut plans);
        assert!(
            ws.amplitudes(layout(Mode::Ft4), &mut plans, 1500.0, 0.5, (0.5, 0.5))
                .is_none()
        );
    }
}
