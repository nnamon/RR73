//! Short-time power spectrum with configurable FFT size, hop, window and bin range.
//!
//! Frame `t` is centred on sample `t * hop`: it covers samples
//! `[t * hop - fft_size / 2, t * hop + fft_size / 2)`, and samples outside the input read as
//! zero. Bin `k` of the FFT has its centre at `k * sample_rate / fft_size` Hz. Only bins in
//! `[min_bin, max_bin)` are stored, so stored bin `b` is FFT bin `min_bin + b`.
//!
//! Power is `|X|^2 / (sum of window)^2`. A sine of amplitude `A` centred on a bin reads
//! `A^2 / 4` with any window. For a Hann window spanning the frame this is the scaling
//! ft8_lib uses (`2 / nfft` applied to the windowed samples). In dB the value is
//! `10 log10(power + 1e-12)`, so digital silence reads -120 dB.
//!
//! Two real frames share one complex FFT (one in the real part, one in the imaginary part),
//! which halves the transform count.

use std::sync::Arc;

use crate::DspError;
use crate::fft::{Complex32, Fft, FftPlans};
use crate::window::{self, WindowKind};

/// Output scale of a spectrogram.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Scale {
    /// `10 log10(power + 1e-12)`, in dB relative to the power of a full-scale sine over 2.
    #[default]
    Db,
    /// Linear power.
    Power,
}

/// Power floor added before taking logarithms, so silence maps to -120 dB.
pub const POWER_FLOOR: f32 = 1e-12;

/// Spectrogram parameters. Sizes are in samples at `sample_rate`.
#[derive(Clone, Debug, PartialEq)]
pub struct SpectrogramConfig {
    /// FFT length in samples.
    pub fft_size: usize,
    /// Samples between frame centres.
    pub hop: usize,
    /// Window shape.
    pub window: WindowKind,
    /// Window length in samples, at most `fft_size`. The window sits in the middle of the
    /// frame and the rest of the frame is zero padding.
    pub window_len: usize,
    /// Output scale.
    pub scale: Scale,
    /// First FFT bin stored (inclusive).
    pub min_bin: usize,
    /// FFT bin after the last one stored (exclusive), at most `fft_size / 2 + 1`.
    pub max_bin: usize,
    /// Sample rate of the input, in Hz.
    pub sample_rate: u32,
}

impl SpectrogramConfig {
    /// Builds the oversampled layout used by FSK decoders: `symbol_samples` per symbol, frames
    /// every `symbol_samples / time_osr` samples, FFT of `symbol_samples * freq_osr` points
    /// (bins `1 / freq_osr` of the symbol rate apart), a window spanning the whole FFT, and
    /// bins covering `[min_hz, max_hz]` rounded outwards to whole tone spacings.
    pub fn oversampled(
        symbol_samples: usize,
        time_osr: usize,
        freq_osr: usize,
        min_hz: f32,
        max_hz: f32,
        sample_rate: u32,
    ) -> Result<Self, DspError> {
        if symbol_samples == 0 || time_osr == 0 || freq_osr == 0 || sample_rate == 0 {
            return Err(DspError::InvalidParameter(
                "oversampled spectrogram needs non-zero sizes",
            ));
        }
        if !symbol_samples.is_multiple_of(time_osr) {
            return Err(DspError::InvalidParameter(
                "time_osr must divide the symbol length",
            ));
        }
        if !(min_hz.is_finite() && max_hz.is_finite()) || min_hz < 0.0 || max_hz <= min_hz {
            return Err(DspError::InvalidParameter(
                "frequency range must satisfy 0 <= min < max",
            ));
        }
        let fft_size = symbol_samples * freq_osr;
        // Whole tone spacings, as in ft8_lib: from floor(min / spacing) up to and including
        // floor(max / spacing), each split into freq_osr bins.
        let spacing_hz = sample_rate as f32 / symbol_samples as f32;
        let nyquist_bin = fft_size / 2 + 1;
        let min_bin = ((min_hz / spacing_hz).floor() as usize * freq_osr).min(nyquist_bin);
        let max_bin = (((max_hz / spacing_hz).floor() as usize + 1) * freq_osr).min(nyquist_bin);
        if min_bin >= max_bin {
            return Err(DspError::InvalidParameter(
                "frequency range is above the Nyquist frequency",
            ));
        }
        Ok(Self {
            fft_size,
            hop: symbol_samples / time_osr,
            window: WindowKind::Hann,
            window_len: fft_size,
            scale: Scale::Db,
            min_bin,
            max_bin,
            sample_rate,
        })
    }

    /// Width of one FFT bin in Hz.
    pub fn bin_hz(&self) -> f32 {
        self.sample_rate as f32 / self.fft_size as f32
    }

    /// Number of frames whose centres lie in `[0, len)` samples.
    pub fn frames_for(&self, len: usize) -> usize {
        if self.hop == 0 { 0 } else { len.div_ceil(self.hop) }
    }

    fn validate(&self) -> Result<(), DspError> {
        if self.fft_size == 0 || self.hop == 0 || self.sample_rate == 0 {
            return Err(DspError::InvalidParameter(
                "fft_size, hop and sample_rate must be non-zero",
            ));
        }
        if self.window_len == 0 || self.window_len > self.fft_size {
            return Err(DspError::InvalidParameter("window_len must be in 1..=fft_size"));
        }
        if self.min_bin >= self.max_bin || self.max_bin > self.fft_size / 2 + 1 {
            return Err(DspError::InvalidParameter(
                "bin range must satisfy min < max <= fft_size/2 + 1",
            ));
        }
        Ok(())
    }
}

/// A computed spectrogram: `frames` rows of `bins` values, row-major.
#[derive(Clone, Debug, Default)]
pub struct Spectrogram {
    frames: usize,
    bins: usize,
    min_bin: usize,
    hop: usize,
    fft_size: usize,
    sample_rate: u32,
    scale: Scale,
    data: Vec<f32>,
}

impl Spectrogram {
    /// Creates an empty spectrogram whose storage is filled by [`SpectrogramPlan::compute`].
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of frames.
    pub fn frames(&self) -> usize {
        self.frames
    }

    /// Number of stored bins per frame.
    pub fn bins(&self) -> usize {
        self.bins
    }

    /// Output scale of the values.
    pub fn scale(&self) -> Scale {
        self.scale
    }

    /// Samples between frame centres.
    pub fn hop(&self) -> usize {
        self.hop
    }

    /// FFT length in samples.
    pub fn fft_size(&self) -> usize {
        self.fft_size
    }

    /// FFT bin index of stored bin 0.
    pub fn min_bin(&self) -> usize {
        self.min_bin
    }

    /// Sample rate of the input, in Hz.
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// All values, row-major (`frame * bins + bin`).
    pub fn data(&self) -> &[f32] {
        &self.data
    }

    /// The values of frame `t`, or `None` past the end.
    pub fn frame(&self, t: usize) -> Option<&[f32]> {
        if t < self.frames {
            Some(&self.data[t * self.bins..(t + 1) * self.bins])
        } else {
            None
        }
    }

    /// The value at frame `t`, stored bin `b`, or `None` outside the spectrogram. Signed
    /// indices let callers probe positions before the first frame.
    pub fn get(&self, t: isize, b: isize) -> Option<f32> {
        if t < 0 || b < 0 {
            return None;
        }
        let (t, b) = (t as usize, b as usize);
        if t < self.frames && b < self.bins {
            Some(self.data[t * self.bins + b])
        } else {
            None
        }
    }

    /// Width of one bin in Hz.
    pub fn bin_width_hz(&self) -> f32 {
        if self.fft_size == 0 {
            return 0.0;
        }
        self.sample_rate as f32 / self.fft_size as f32
    }

    /// Centre frequency of stored bin `b` (fractional values allowed), in Hz.
    pub fn bin_hz(&self, b: f32) -> f32 {
        (self.min_bin as f32 + b) * self.bin_width_hz()
    }

    /// Centre time of frame `t` (fractional and negative values allowed), in seconds from
    /// the first input sample.
    pub fn frame_time_s(&self, t: f32) -> f32 {
        if self.sample_rate == 0 {
            return 0.0;
        }
        t * self.hop as f32 / self.sample_rate as f32
    }

    /// Converts a stored value to linear power, whatever the scale.
    pub fn to_power(&self, value: f32) -> f32 {
        match self.scale {
            Scale::Power => value,
            Scale::Db => 10f32.powf(value / 10.0),
        }
    }
}

/// A reusable plan: FFT, window and buffers for one [`SpectrogramConfig`].
pub struct SpectrogramPlan {
    config: SpectrogramConfig,
    fft: Arc<dyn Fft<f32>>,
    /// Window of `fft_size` values: the analysis window centred, zeros around it.
    window: Vec<f32>,
    norm: f32,
    buf: Vec<Complex32>,
    scratch: Vec<Complex32>,
}

impl std::fmt::Debug for SpectrogramPlan {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SpectrogramPlan")
            .field("config", &self.config)
            .finish()
    }
}

impl SpectrogramPlan {
    /// Builds a plan. Fails on inconsistent sizes.
    pub fn new(config: SpectrogramConfig, plans: &mut FftPlans) -> Result<Self, DspError> {
        config.validate()?;
        let fft = plans.forward(config.fft_size);
        let mut window = vec![0.0; config.fft_size];
        let pad = (config.fft_size - config.window_len) / 2;
        config.window.fill(&mut window[pad..pad + config.window_len]);
        let sum = window::sum(&window);
        let norm = if sum > 0.0 {
            (1.0 / (sum * sum)) as f32
        } else {
            0.0
        };
        let scratch = vec![Complex32::new(0.0, 0.0); fft.get_inplace_scratch_len()];
        Ok(Self {
            buf: vec![Complex32::new(0.0, 0.0); config.fft_size],
            config,
            fft,
            window,
            norm,
            scratch,
        })
    }

    /// The configuration this plan was built from.
    pub fn config(&self) -> &SpectrogramConfig {
        &self.config
    }

    /// Computes `frames` frames of `samples` into `out`, reusing its storage. Non-finite
    /// samples read as zero and finite ones are clamped to [`SAMPLE_LIMIT`]. Frames whose window lies wholly outside the input hold the
    /// floor value (-120 dB or 0 power).
    pub fn compute(&mut self, samples: &[f32], frames: usize, out: &mut Spectrogram) {
        let bins = self.config.max_bin - self.config.min_bin;
        out.frames = frames;
        out.bins = bins;
        out.min_bin = self.config.min_bin;
        out.hop = self.config.hop;
        out.fft_size = self.config.fft_size;
        out.sample_rate = self.config.sample_rate;
        out.scale = self.config.scale;
        out.data.clear();
        out.data.resize(frames * bins, 0.0);

        let mut t = 0;
        while t < frames {
            let pair = t + 1 < frames;
            self.load(samples, t, pair);
            self.fft.process_with_scratch(&mut self.buf, &mut self.scratch);
            self.store(t, pair, out);
            t += if pair { 2 } else { 1 };
        }
    }

    /// Windows frame `t` into the real part of the buffer and, when `pair`, frame `t + 1`
    /// into the imaginary part.
    fn load(&mut self, samples: &[f32], t: usize, pair: bool) {
        let n = self.config.fft_size;
        let half = (n / 2) as isize;
        let start_a = (t * self.config.hop) as isize - half;
        let start_b = start_a + self.config.hop as isize;
        for (i, (c, &w)) in self.buf.iter_mut().zip(&self.window).enumerate() {
            let re = w * sample_at(samples, start_a + i as isize);
            let im = if pair {
                w * sample_at(samples, start_b + i as isize)
            } else {
                0.0
            };
            *c = Complex32::new(re, im);
        }
    }

    /// Separates the two real spectra and writes the stored bins of frames `t` and `t + 1`.
    fn store(&self, t: usize, pair: bool, out: &mut Spectrogram) {
        let n = self.config.fft_size;
        let bins = out.bins;
        let scale = self.config.scale;
        for (b, k) in (self.config.min_bin..self.config.max_bin).enumerate() {
            let z = self.buf[k];
            let zc = self.buf[(n - k) % n].conj();
            // X_a = (Z[k] + conj(Z[N-k])) / 2, X_b = (Z[k] - conj(Z[N-k])) / 2j.
            let xa = (z + zc) * 0.5;
            let pa = xa.norm_sqr() * self.norm;
            out.data[t * bins + b] = to_scale(pa, scale);
            if pair {
                let d = (z - zc) * 0.5;
                let pb = d.norm_sqr() * self.norm;
                out.data[(t + 1) * bins + b] = to_scale(pb, scale);
            }
        }
    }
}

/// Largest sample magnitude used; larger finite values are clamped so powers stay finite.
pub const SAMPLE_LIMIT: f32 = 1e6;

#[inline]
fn sample_at(samples: &[f32], i: isize) -> f32 {
    if i < 0 {
        return 0.0;
    }
    match samples.get(i as usize) {
        Some(&x) if x.is_finite() => x.clamp(-SAMPLE_LIMIT, SAMPLE_LIMIT),
        _ => 0.0,
    }
}

#[inline]
fn to_scale(power: f32, scale: Scale) -> f32 {
    match scale {
        Scale::Power => power,
        Scale::Db => 10.0 * (power + POWER_FLOOR).log10(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    fn ft8_config() -> SpectrogramConfig {
        SpectrogramConfig::oversampled(1920, 2, 2, 200.0, 3000.0, 12_000).expect("config")
    }

    fn tone(freq: f32, amp: f32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| amp * (2.0 * PI * freq * i as f32 / 12_000.0).sin())
            .collect()
    }

    fn compute(config: SpectrogramConfig, samples: &[f32]) -> Spectrogram {
        let mut plans = FftPlans::new();
        let frames = config.frames_for(samples.len());
        let mut plan = SpectrogramPlan::new(config, &mut plans).expect("plan");
        let mut out = Spectrogram::new();
        plan.compute(samples, frames, &mut out);
        out
    }

    #[test]
    fn oversampled_layout_matches_ft8_numbers() {
        let c = ft8_config();
        assert_eq!(c.fft_size, 3840);
        assert_eq!(c.hop, 960);
        assert!((c.bin_hz() - 3.125).abs() < 1e-6);
        assert_eq!(c.min_bin, 64);
        assert_eq!(c.max_bin, 962);
        assert_eq!(c.frames_for(180_000), 188);
    }

    #[test]
    fn bin_centred_sine_reads_amplitude_squared_over_four() {
        // 1000 Hz is bin 320 at 3.125 Hz per bin; stored bin 320 - 64.
        let s = compute(ft8_config(), &tone(1000.0, 0.5, 180_000));
        let b = (320 - s.min_bin()) as isize;
        let t = 90;
        let db = s.get(t, b).expect("cell");
        let expected = 10.0 * (0.25f32 / 4.0).log10();
        assert!((db - expected).abs() < 0.01, "{db} vs {expected}");
        assert!((s.bin_hz(b as f32) - 1000.0).abs() < 1e-3);
        // Hann sidelobes: 3 bins away the level is far below the peak.
        let far = s.get(t, b + 3).expect("cell");
        assert!(db - far > 30.0, "{db} {far}");
    }

    #[test]
    fn paired_frames_match_single_frame_transforms() {
        // An odd frame count exercises both the paired and the unpaired path.
        let samples: Vec<f32> = (0..20_000)
            .map(|i| ((i * 7919) % 1000) as f32 / 1000.0 - 0.5)
            .collect();
        let mut config = ft8_config();
        config.scale = Scale::Power;
        let s = compute(config.clone(), &samples);
        assert_eq!(s.frames() % 2, 1);
        let mut plans = FftPlans::new();
        let fft = plans.forward(config.fft_size);
        let w = WindowKind::Hann.build(config.fft_size);
        let norm = 1.0 / window::sum(&w).powi(2);
        for t in [0usize, 1, s.frames() - 1] {
            let start = (t * config.hop) as isize - (config.fft_size / 2) as isize;
            let mut buf: Vec<Complex32> = (0..config.fft_size)
                .map(|i| Complex32::new(w[i] * sample_at(&samples, start + i as isize), 0.0))
                .collect();
            fft.process(&mut buf);
            for b in [0usize, 100, s.bins() - 1] {
                let want = buf[config.min_bin + b].norm_sqr() as f64 * norm;
                let got = f64::from(s.get(t as isize, b as isize).expect("cell"));
                assert!(
                    (got - want).abs() <= 1e-4 * want.max(1e-9),
                    "t {t} b {b}: {got} vs {want}"
                );
            }
        }
    }

    #[test]
    fn hostile_input_gives_finite_output() {
        let mut samples = tone(1500.0, 1.0, 50_000);
        samples[100] = f32::NAN;
        samples[200] = f32::INFINITY;
        samples[300] = f32::NEG_INFINITY;
        for x in samples.iter_mut().skip(1000).take(1000) {
            *x = 1e30;
        }
        let s = compute(ft8_config(), &samples);
        assert!(s.data().iter().all(|v| v.is_finite()));
        let silence = compute(ft8_config(), &vec![0.0; 10_000]);
        assert!(silence.data().iter().all(|&v| (v + 120.0).abs() < 1e-3));
        let empty = compute(ft8_config(), &[]);
        assert_eq!(empty.frames(), 0);
        assert!(empty.frame(0).is_none());
        assert!(empty.get(-1, 0).is_none());
    }

    #[test]
    fn frames_beyond_input_hold_the_floor() {
        let config = ft8_config();
        let mut plans = FftPlans::new();
        let mut plan = SpectrogramPlan::new(config, &mut plans).expect("plan");
        let mut out = Spectrogram::new();
        plan.compute(&tone(1000.0, 1.0, 960), 10, &mut out);
        assert_eq!(out.frames(), 10);
        let last = out.frame(9).expect("frame");
        assert!(last.iter().all(|&v| (v + 120.0).abs() < 1e-3));
    }

    #[test]
    fn invalid_configs_are_rejected() {
        let mut plans = FftPlans::new();
        assert!(SpectrogramConfig::oversampled(0, 2, 2, 200.0, 3000.0, 12_000).is_err());
        assert!(SpectrogramConfig::oversampled(1920, 7, 2, 200.0, 3000.0, 12_000).is_err());
        assert!(SpectrogramConfig::oversampled(1920, 2, 2, 3000.0, 200.0, 12_000).is_err());
        let mut c = ft8_config();
        c.window_len = c.fft_size + 1;
        assert!(SpectrogramPlan::new(c, &mut plans).is_err());
        let mut c = ft8_config();
        c.max_bin = c.fft_size;
        assert!(SpectrogramPlan::new(c, &mut plans).is_err());
    }

    #[test]
    fn short_window_is_zero_padded_and_centred() {
        let mut c = ft8_config();
        c.window_len = 1920;
        c.scale = Scale::Power;
        let s = compute(c, &tone(1000.0, 1.0, 40_000));
        let b = (320 - s.min_bin()) as isize;
        let p = s.get(20, b).expect("cell");
        assert!((p - 0.25).abs() < 1e-3, "{p}");
    }
}
