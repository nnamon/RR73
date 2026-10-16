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

/// Frequency offsets in the table of sync rotations.
const TRIALS: usize = 2 * FREQ_STEPS as usize + 1;

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
    /// The power, the magnitude squared: a strong symbol weighs more.
    Power,
    /// The magnitudes' difference over the larger of the two, in -1 to 1: each symbol weighs
    /// the same whatever its level, so a symbol a strong interferer or a fading peak dominates
    /// cannot outvote the others.
    Normalised,
}

impl BlockScore {
    /// A bit's soft value from the largest block power among the tone sequences with the bit
    /// set (`one`) and with it clear (`zero`).
    fn bit(self, one: f32, zero: f32) -> f32 {
        match self {
            Self::Amplitude => one.sqrt() - zero.sqrt(),
            // Half the log of the power ratio, with a floor for empty tones.
            Self::Log => 0.5 * ((one + 1e-30).ln() - (zero + 1e-30).ln()),
            Self::Power => one - zero,
            Self::Normalised => {
                let (a, b) = (one.sqrt(), zero.sqrt());
                let top = a.max(b);
                if top > 0.0 { (a - b) / top } else { 0.0 }
            }
        }
    }
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
    /// `rotations` by sync symbol, every frequency offset side by side: real and imaginary
    /// parts of offset `q` of sync symbol `j` at `j * TRIALS + q`.
    rot_re: Vec<f32>,
    rot_im: Vec<f32>,
    /// Sync metric of each start offset and frequency offset tried.
    metrics: Vec<f32>,
    /// Tone references at the refined frequency, by sample with the tones side by side: real
    /// and imaginary parts of tone `t` at sample `m` at `m * MAX_TONES + t` (zero beyond the
    /// layout's tones).
    twiddles_re: Vec<f32>,
    twiddles_im: Vec<f32>,
    /// Weight of each slot transform bin cut to baseband, from `taper_from` bins below tone 0.
    taper: Vec<f32>,
    taper_from: i64,
    /// Complex amplitude of each tone in each channel symbol.
    amps: Vec<[Complex32; MAX_TONES]>,
    /// Symbols outside the audio.
    erased: Vec<bool>,
    others: Vec<Complex32>,
    next: Vec<Complex32>,
    /// The GFSK frequency pulse at [`SAMPLES_PER_SYMBOL`] samples per symbol over three
    /// symbols, for the mode in `pulse_for`, in tone spacings.
    pulse: Vec<f64>,
    pulse_for: Option<Mode>,
    /// An interferer's model and its products with the baseband.
    model: Vec<Complex32>,
    products: Vec<Complex64>,
}

/// A signal to remove from a candidate's baseband before refinement: a neighbour whose tones
/// are known or guessed (experiment 0012).
#[derive(Clone, Copy, Debug)]
pub struct Interferer<'a> {
    /// Channel tones, one per symbol of the layout.
    pub tones: &'a [u8],
    /// Frequency of tone 0, in Hz.
    pub freq_hz: f64,
    /// Start of symbol 0, in seconds from the slot start.
    pub start_s: f64,
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
        let nsync = self.sync.len();
        self.rot_re.clear();
        self.rot_im.clear();
        for j in 0..nsync {
            for q in 0..TRIALS {
                let r = self.rotations[q * nsync + j];
                self.rot_re.push(r.re);
                self.rot_im.push(r.im);
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
        self.amplitudes_without(layout, plans, freq_hz, start_s, reach, &[])
    }

    /// As [`BlockWorkspace::amplitudes`], with each of `interferers` removed from the
    /// candidate's baseband before refinement (experiment 0012). With none, the same values.
    pub fn amplitudes_without(
        &mut self,
        layout: &FrameLayout,
        plans: &mut FftPlans,
        freq_hz: f32,
        start_s: f32,
        reach: (f32, f32),
        interferers: &[Interferer<'_>],
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
        for it in interferers {
            self.remove_interferer(layout, g, k0 as f64 * df, it);
        }

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
        sync_metrics(
            &self.sync_corr,
            &self.sync,
            groups,
            (&self.rot_re, &self.rot_im),
            starts,
            trials.clone(),
            &mut self.metrics,
        );
        let qn = trials.end() - trials.start() + 1;
        for i in 0..starts {
            for (q, &m) in trials.clone().zip(&self.metrics[i * qn..(i + 1) * qn]) {
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
        self.twiddles_re.clear();
        self.twiddles_re.resize(SAMPLES_PER_SYMBOL * MAX_TONES, 0.0);
        self.twiddles_im.clear();
        self.twiddles_im.resize(SAMPLES_PER_SYMBOL * MAX_TONES, 0.0);
        for t in 0..tones {
            for m in 0..SAMPLES_PER_SYMBOL {
                let a = -std::f64::consts::TAU * ((t as f64 + q) * m as f64 - t as f64 * late)
                    / SAMPLES_PER_SYMBOL as f64;
                self.twiddles_re[m * MAX_TONES + t] = a.cos() as f32;
                self.twiddles_im[m * MAX_TONES + t] = a.sin() as f32;
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
            let corr = correlate_tones(&self.baseband, b, &self.twiddles_re, &self.twiddles_im);
            for (amp, &c) in self.amps[s].iter_mut().zip(&corr).take(tones) {
                *amp = c * rot;
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

    /// Removes `it` from the baseband, whose 0 Hz lies at `zero_hz` in the audio: rebuilds its
    /// GFSK waveform at the baseband rate (the codec's Gaussian pulse, first and last tones
    /// extended), estimates its complex amplitude as the mean over one symbol of the baseband
    /// times the conjugate model, as the slot subtraction does at 12 kHz, and subtracts the
    /// product. Samples outside the baseband are left out of the mean.
    fn remove_interferer(&mut self, layout: &FrameLayout, g: Geometry, zero_hz: f64, it: &Interferer<'_>) {
        let count = layout.symbols;
        if it.tones.len() != count || count == 0 || !it.freq_hz.is_finite() || !it.start_s.is_finite() {
            return;
        }
        let n = SAMPLES_PER_SYMBOL;
        if self.pulse_for != Some(layout.mode) {
            let bt = f64::from(layout.mode.params().gfsk_bt);
            let k = std::f64::consts::PI * (2.0 / std::f64::consts::LN_2).sqrt();
            self.pulse.clear();
            self.pulse.extend((0..3 * n).map(|i| {
                let t = i as f64 / n as f64 - 1.5;
                (crate::subtract::erf(k * bt * (t + 0.5)) - crate::subtract::erf(k * bt * (t - 0.5))) / 2.0
            }));
            self.pulse_for = Some(layout.mode);
        }
        let rate = g.rate_hz();
        let first = (it.start_s * rate).round() as isize;
        let carrier = std::f64::consts::TAU * (it.freq_hz - zero_hz) / rate;
        let step = std::f64::consts::TAU / n as f64;
        let tone = |i: isize| f64::from(it.tones[i.clamp(0, count as isize - 1) as usize]);
        self.model.clear();
        let mut psi = 0.0f64;
        for s in 0..count as isize {
            let near = [tone(s - 1), tone(s), tone(s + 1)];
            for r in 0..n {
                let dev =
                    near[0] * self.pulse[2 * n + r] + near[1] * self.pulse[n + r] + near[2] * self.pulse[r];
                let (sin, cos) = (psi as f32).sin_cos();
                self.model.push(Complex32::new(cos, sin));
                psi = (psi + carrier + step * dev).rem_euclid(std::f64::consts::TAU);
            }
        }
        let len = self.baseband.len() as isize;
        let inside = |m: usize| {
            let i = first + m as isize;
            (0..len).contains(&i).then_some(i as usize)
        };
        self.products.clear();
        for (m, c) in self.model.iter().enumerate() {
            let x = inside(m).map_or(Complex32::new(0.0, 0.0), |i| self.baseband[i]);
            let p = x * c.conj();
            self.products
                .push(Complex64::new(f64::from(p.re), f64::from(p.im)));
        }
        let total = self.model.len();
        let half = n / 2;
        let (mut lo, mut hi, mut held) = (0usize, 0usize, 0usize);
        let mut sum = Complex64::new(0.0, 0.0);
        for m in 0..total {
            while hi < (m + half + 1).min(total) {
                if inside(hi).is_some() {
                    sum += self.products[hi];
                    held += 1;
                }
                hi += 1;
            }
            while lo < m.saturating_sub(half) {
                if inside(lo).is_some() {
                    sum -= self.products[lo];
                    held -= 1;
                }
                lo += 1;
            }
            if let (Some(i), true) = (inside(m), held > 0) {
                let a = sum / held as f64;
                let a = Complex32::new(a.re as f32, a.im as f32);
                self.baseband[i] -= a * self.model[m];
            }
        }
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
                *b = max_norm_sqr(own, &self.others);
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
                llr[base + i] = score.bit(one, zero);
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

/// The largest `|own + o|^2` over `others`, and 0 when there is none or every value is NaN:
/// equal to folding `f32::max` from 0. Lanes keep their own maxima, which vectorises; a
/// maximum takes no rounding, so the order does not matter.
fn max_norm_sqr(own: Complex32, others: &[Complex32]) -> f32 {
    const LANES: usize = 8;
    let mut lanes = [0.0f32; LANES];
    let (chunks, rest) = others.as_chunks::<LANES>();
    for chunk in chunks {
        for (lane, o) in lanes.iter_mut().zip(chunk) {
            let v = (own + o).norm_sqr();
            if v > *lane {
                *lane = v;
            }
        }
    }
    let mut best = 0.0f32;
    for v in lanes.into_iter().chain(rest.iter().map(|o| (own + o).norm_sqr())) {
        if v > best {
            best = v;
        }
    }
    best
}

/// The sync metric of [`BlockWorkspace::amplitudes`] for each start offset (`starts` rows of
/// `corr`) and each frequency offset in `trials`, into `out` by start, then offset. Equal bit
/// for bit to summing `c * r` per sync group in sync order and adding the groups' powers:
/// the offsets run side by side in lanes, each with its own sums in that order.
fn sync_metrics(
    corr: &[Complex32],
    sync: &[(usize, u8, usize)],
    groups: usize,
    (rot_re, rot_im): (&[f32], &[f32]),
    starts: usize,
    trials: std::ops::RangeInclusive<usize>,
    out: &mut Vec<f32>,
) {
    const GROUPS: usize = 8;
    let nsync = sync.len();
    let (q0, qn) = (*trials.start(), trials.end() - trials.start() + 1);
    out.clear();
    for i in 0..starts {
        let mut re = [[0.0f32; TRIALS]; GROUPS];
        let mut im = [[0.0f32; TRIALS]; GROUPS];
        for (j, (c, &(_, _, g))) in corr[i * nsync..(i + 1) * nsync].iter().zip(sync).enumerate() {
            if g >= GROUPS {
                continue;
            }
            let rr = &rot_re[j * TRIALS + q0..j * TRIALS + q0 + qn];
            let ri = &rot_im[j * TRIALS + q0..j * TRIALS + q0 + qn];
            let (sr, si) = (&mut re[g][..qn], &mut im[g][..qn]);
            for (((sr, si), &rr), &ri) in sr.iter_mut().zip(si.iter_mut()).zip(rr).zip(ri) {
                // `c * r` as num-complex multiplies, then `+=`.
                *sr += c.re * rr - c.im * ri;
                *si += c.re * ri + c.im * rr;
            }
        }
        for k in 0..qn {
            let m: f32 = (0..groups.min(GROUPS))
                .map(|g| Complex32::new(re[g][k], im[g][k]).norm_sqr())
                .sum();
            out.push(m);
        }
    }
}

/// The correlations of the [`SAMPLES_PER_SYMBOL`] baseband samples from `at` with every
/// tone's reference, the tones side by side (see [`BlockWorkspace`]'s `twiddles_re`). Equal
/// bit for bit to [`correlate`] of each tone.
fn correlate_tones(
    baseband: &[Complex32],
    at: isize,
    twiddles_re: &[f32],
    twiddles_im: &[f32],
) -> [Complex32; MAX_TONES] {
    let mut re = [0.0f32; MAX_TONES];
    let mut im = [0.0f32; MAX_TONES];
    let inside = at >= 0 && (at as usize) + SAMPLES_PER_SYMBOL <= baseband.len();
    let rows = twiddles_re
        .as_chunks::<MAX_TONES>()
        .0
        .iter()
        .zip(twiddles_im.as_chunks::<MAX_TONES>().0)
        .take(SAMPLES_PER_SYMBOL);
    for (m, (wr, wi)) in rows.enumerate() {
        let i = at + m as isize;
        let a = if inside {
            baseband[i as usize]
        } else {
            match usize::try_from(i).ok().and_then(|i| baseband.get(i)) {
                Some(&a) => a,
                None => continue,
            }
        };
        // `a * r` as num-complex multiplies, then `+=`, for every tone at once.
        for (((re, im), &wr), &wi) in re.iter_mut().zip(im.iter_mut()).zip(wr).zip(wi) {
            *re += a.re * wr - a.im * wi;
            *im += a.re * wi + a.im * wr;
        }
    }
    std::array::from_fn(|t| Complex32::new(re[t], im[t]))
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

    /// Energy at the sent tones in the candidate's last correlations.
    fn sent_energy(ws: &BlockWorkspace, tones: &[u8]) -> f32 {
        ws.amps()
            .iter()
            .zip(tones)
            .map(|(a, &t)| a[usize::from(t)].norm_sqr())
            .sum()
    }

    /// A signal removed from its own baseband by its tones leaves under 1 % of its energy at
    /// the sent tones (measured: FT8 0.19 %, FT4 0.02 %), and removing nothing gives the values
    /// of `amplitudes`.
    #[test]
    fn a_signal_removed_by_its_tones_leaves_little() {
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
            let start = l.start_offset_s + dt as f32;
            let r = ws
                .amplitudes(l, &mut plans, freq, start, (0.5, 0.5))
                .expect("amplitudes");
            let before = sent_energy(&ws, &tones);
            let amps = ws.amps().to_vec();
            let none = ws
                .amplitudes_without(l, &mut plans, freq, start, (0.5, 0.5), &[])
                .expect("amplitudes");
            assert_eq!(none, r);
            assert_eq!(ws.amps(), &amps[..]);
            let itself = Interferer {
                tones: &tones,
                freq_hz: r.freq_hz,
                start_s: r.start_s,
            };
            ws.amplitudes_without(l, &mut plans, freq, start, (0.5, 0.5), &[itself]);
            let after = sent_energy(&ws, &tones);
            assert!(after < 0.01 * before, "{mode:?}: {after} of {before}");
        }
    }

    /// A stronger neighbour two tone spacings up and 0.3 s later (0.12 s in FT4) spoils a
    /// candidate's soft bits; with the neighbour's tones removed from the candidate's baseband
    /// they carry the sent bits again but for a few that LDPC corrects (measured: FT8 83 to 0 hard
    /// errors, FT4 46 to 6).
    #[test]
    fn removing_a_neighbour_by_its_tones_restores_the_soft_bits() {
        for (mode, late) in [(Mode::Ft8, 0.3), (Mode::Ft4, 0.12)] {
            let l = layout(mode);
            let (a, b) = ("CQ K1ABC FN42", "W9XYZ VK3QRP R-07");
            let (ta, tb) = (tones_for(mode, a), tones_for(mode, b));
            let fa = 1500.0f32;
            let fb = fa + 2.0 * l.tone_spacing_hz;
            let mut audio = slot(mode, a, fa, 0.1, Some(-6.0), 8);
            // The neighbour 6 dB above the candidate.
            let wave = rr73_ft8::synth::gfsk(mode, &tb, fb, 12_000, 2.0);
            let at = ((f64::from(l.start_offset_s) + 0.1 + late) * 12_000.0).round() as usize;
            for (x, w) in audio.iter_mut().skip(at).zip(&wave) {
                *x += w;
            }
            let mut ws = BlockWorkspace::default();
            let mut plans = FftPlans::new();
            ws.prepare(l, &audio, &mut plans);
            let start = l.start_offset_s + 0.1;
            let mut llr = [0.0f32; CODEWORD_BITS];
            ws.amplitudes(l, &mut plans, fa, start, (0.5, 0.5))
                .expect("amplitudes");
            ws.llrs(l, 1, BlockScore::Amplitude, 24.0, &mut llr);
            let spoilt = hard_errors(l, &ta, &llr);
            let neighbour = Interferer {
                tones: &tb,
                freq_hz: f64::from(fb),
                start_s: f64::from(start) + late,
            };
            ws.amplitudes_without(l, &mut plans, fa, start, (0.5, 0.5), &[neighbour])
                .expect("amplitudes");
            ws.llrs(l, 1, BlockScore::Amplitude, 24.0, &mut llr);
            let cleared = hard_errors(l, &ta, &llr);
            assert!(spoilt >= 30 && cleared <= 8, "{mode:?}: {spoilt} to {cleared}");
        }
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

    /// Every score gives the sent bits of a strong signal; the normalised score's bits lie
    /// within -1 to 1 before scaling, so after it every bit has about the same magnitude.
    #[test]
    fn every_score_gives_the_sent_bits_of_a_strong_signal() {
        let l = layout(Mode::Ft8);
        let text = "CQ K1ABC FN42";
        let tones = tones_for(Mode::Ft8, text);
        let audio = slot(Mode::Ft8, text, 1500.0, 0.1, Some(0.0), 6);
        let mut ws = BlockWorkspace::default();
        let mut plans = FftPlans::new();
        ws.prepare(l, &audio, &mut plans);
        ws.amplitudes(l, &mut plans, 1500.0, l.start_offset_s + 0.1, (0.5, 0.5))
            .expect("amplitudes");
        for score in [BlockScore::Power, BlockScore::Normalised] {
            for block in [1, 3] {
                let mut llr = [0.0f32; CODEWORD_BITS];
                ws.llrs(l, block, score, 24.0, &mut llr);
                assert_eq!(hard_errors(l, &tones, &llr), 0, "{score:?} block {block}");
            }
        }
        let mut llr = [0.0f32; CODEWORD_BITS];
        ws.llrs(l, 1, BlockScore::Normalised, 24.0, &mut llr);
        let data = &llr[..l.data.len() * l.bits_per_symbol];
        let (lo, hi) = data.iter().fold((f32::INFINITY, 0.0f32), |(lo, hi), x| {
            (lo.min(x.abs()), hi.max(x.abs()))
        });
        assert!(hi < 1.5 * lo, "magnitudes {lo} to {hi}");
    }

    /// A strong tone over a few symbols gives amplitude scores confident wrong bits there; the
    /// normalised score bounds each symbol's say, so the wrong bits carry less of the total.
    #[test]
    fn normalised_scores_bound_a_burst_of_interference() {
        let l = layout(Mode::Ft8);
        let text = "W9XYZ K1ABC -15";
        let tones = tones_for(Mode::Ft8, text);
        let mut audio = slot(Mode::Ft8, text, 1200.0, 0.0, Some(-5.0), 7);
        // A tone 20 dB above the signal on tone 5's frequency across data symbols 10 to 20.
        let sps = l.samples_per_symbol;
        let start = (l.start_offset_s * 12_000.0) as usize;
        let hz = 1200.0 + 5.0 * f64::from(l.tone_spacing_hz);
        for (i, x) in audio
            .iter_mut()
            .enumerate()
            .take(start + 21 * sps)
            .skip(start + 10 * sps)
        {
            *x += (10.0 * (std::f64::consts::TAU * hz * i as f64 / 12_000.0).sin()) as f32;
        }
        let mut ws = BlockWorkspace::default();
        let mut plans = FftPlans::new();
        ws.prepare(l, &audio, &mut plans);
        ws.amplitudes(l, &mut plans, 1200.0, l.start_offset_s, (0.5, 0.5))
            .expect("amplitudes");
        let bits = crate::testsig::data_bits(l, &tones);
        let mut wrong_share = |score: BlockScore| {
            let mut llr = [0.0f32; CODEWORD_BITS];
            ws.llrs(l, 1, score, 24.0, &mut llr);
            let (mut wrong, mut total) = (0.0f32, 0.0f32);
            for (&b, &x) in bits.iter().zip(&llr) {
                total += x.abs();
                if u8::from(x > 0.0) != b {
                    wrong += x.abs();
                }
            }
            wrong / total
        };
        let (amplitude, normalised) = (
            wrong_share(BlockScore::Amplitude),
            wrong_share(BlockScore::Normalised),
        );
        assert!(
            normalised < 0.5 * amplitude,
            "share of |LLR| on wrong bits: amplitude {amplitude:.3}, normalised {normalised:.3}"
        );
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

    /// [`BlockWorkspace::amplitudes`] as it was before experiment 0009: one sync metric per
    /// start and frequency offset, one correlation per tone.
    impl BlockWorkspace {
        fn llrs_reference(
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
                    llr[base + i] = score.bit(one, zero);
                }
                skip[base..base + bps].fill(false);
            }
            normalise_variance_over(llr, variance, &skip);
        }

        fn amplitudes_reference(
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
            let mut twiddles = Vec::new();
            for t in 0..tones {
                for m in 0..SAMPLES_PER_SYMBOL {
                    let a = -std::f64::consts::TAU * ((t as f64 + q) * m as f64 - t as f64 * late)
                        / SAMPLES_PER_SYMBOL as f64;
                    twiddles.push(Complex32::new(a.cos() as f32, a.sin() as f32));
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
                    let tw = &twiddles[t * SAMPLES_PER_SYMBOL..(t + 1) * SAMPLES_PER_SYMBOL];
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
    }

    #[test]
    fn amplitudes_match_the_reference_bit_for_bit() {
        let mut checked = 0;
        for (mode, text) in [(Mode::Ft8, "CQ K1ABC FN42"), (Mode::Ft4, "W9XYZ K1ABC R-12")] {
            let l = layout(mode);
            let spacing = l.tone_spacing_hz;
            for (seed, snr, dt, cut) in [
                (1u64, Some(-12.0), 0.1, None),
                (2, Some(-20.0), -0.4, None),
                (3, Some(0.0), 0.9, Some(100_000usize)),
                (4, None, 0.0, None),
            ] {
                let mut audio = slot(mode, text, 1234.5, dt, snr, seed);
                if let Some(n) = cut {
                    audio.truncate(n.min(audio.len()));
                }
                let (mut a, mut b) = (BlockWorkspace::default(), BlockWorkspace::default());
                let mut plans = FftPlans::new();
                a.prepare(l, &audio, &mut plans);
                b.prepare(l, &audio, &mut plans);
                for k in 0..24 {
                    let f = 1234.5 + spacing * (k as f32 * 0.37 - 4.0);
                    let t = l.start_offset_s + dt as f32 + l.symbol_s() * (k as f32 * 0.21 - 2.5);
                    let reach = [(0.5, 0.5), (0.25, 0.125), (0.05, 0.5), (0.5, 0.01)][k % 4];
                    let want = a.amplitudes_reference(l, &mut plans, f, t, reach);
                    let got = b.amplitudes(l, &mut plans, f, t, reach);
                    let bits = |r: Option<Refined>| {
                        r.map(|r| (r.freq_hz.to_bits(), r.start_s.to_bits(), r.sync_matched))
                    };
                    assert_eq!(bits(want), bits(got), "{mode:?} seed {seed} candidate {k}");
                    let amp_bits = |w: &BlockWorkspace| {
                        w.amps
                            .iter()
                            .flat_map(|s| s.iter().map(|c| (c.re.to_bits(), c.im.to_bits())))
                            .collect::<Vec<_>>()
                    };
                    assert!(amp_bits(&a) == amp_bits(&b), "{mode:?} seed {seed} candidate {k}");
                    assert_eq!(a.erased, b.erased);
                    checked += usize::from(got.is_some());
                }
            }
        }
        assert!(checked > 150, "{checked}");
    }

    #[test]
    fn llrs_match_the_reference_bit_for_bit() {
        let mut checked = 0;
        for (mode, text) in [(Mode::Ft8, "CQ K1ABC FN42"), (Mode::Ft4, "W9XYZ K1ABC R-12")] {
            let l = layout(mode);
            for (seed, snr, cut) in [
                (1u64, Some(-14.0), None),
                (2, Some(-22.0), Some(110_000usize)),
                (3, None, None),
            ] {
                let mut audio = slot(mode, text, 1500.0, 0.2, snr, seed);
                if let Some(n) = cut {
                    audio.truncate(n.min(audio.len()));
                }
                let mut ws = BlockWorkspace::default();
                let mut plans = FftPlans::new();
                ws.prepare(l, &audio, &mut plans);
                for k in 0..6 {
                    let f = 1500.0 + l.tone_spacing_hz * (k as f32 * 0.7 - 2.0);
                    if ws
                        .amplitudes(l, &mut plans, f, l.start_offset_s + 0.2, (0.5, 0.5))
                        .is_none()
                    {
                        continue;
                    }
                    if k == 5 {
                        // A NaN amplitude, as hostile audio could give.
                        ws.amps[10][3] = Complex32::new(f32::NAN, 0.0);
                    }
                    for block in 1..=MAX_BLOCK {
                        for score in [BlockScore::Amplitude, BlockScore::Log] {
                            let (mut want, mut got) = ([0.0f32; CODEWORD_BITS], [0.0f32; CODEWORD_BITS]);
                            ws.llrs_reference(l, block, score, 24.0, &mut want);
                            ws.llrs(l, block, score, 24.0, &mut got);
                            let bits = |v: &[f32]| v.iter().map(|x| x.to_bits()).collect::<Vec<_>>();
                            assert!(
                                bits(&want) == bits(&got),
                                "{mode:?} seed {seed} candidate {k} block {block}"
                            );
                            checked += 1;
                        }
                    }
                }
            }
        }
        assert!(checked > 200, "{checked}");
    }

    #[test]
    fn max_norm_sqr_equals_the_fold() {
        let own = Complex32::new(0.3, -1.2);
        for n in [0usize, 1, 7, 8, 9, 64, 65, 512] {
            let mut others: Vec<Complex32> = (0..n)
                .map(|i| Complex32::new((i as f32 * 0.37).sin() * 3.0, (i as f32 * 0.11).cos()))
                .collect();
            if n > 3 {
                others[2] = Complex32::new(f32::NAN, 1.0);
            }
            let want = others.iter().map(|o| (own + o).norm_sqr()).fold(0.0f32, f32::max);
            assert_eq!(max_norm_sqr(own, &others).to_bits(), want.to_bits(), "{n}");
        }
        let nan = [Complex32::new(f32::NAN, 0.0); 9];
        assert_eq!(max_norm_sqr(own, &nan), 0.0);
    }
}
