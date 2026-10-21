//! Streaming resampling of a receiver's audio to exactly 12000 Hz, for receivers whose sample
//! clock runs a little off it (a KiwiSDR reporting 11998.93 Hz, 89 ppm slow). Each output sample
//! is a Kaiser-windowed sinc over 32 input samples, the kernel read from a table of 512 phases
//! with linear interpolation between them. The position carries from frame to frame, so frames
//! join with no seam.

/// Taps on each side of an output sample.
const HALF: usize = 16;
/// Kernel phases per input sample in the table.
const PHASES: usize = 512;
/// Kaiser window shape: about 80 dB of side-lobe rejection.
const BETA: f64 = 8.0;

/// Converts a stream at `from_hz` to `to_hz`, for rates within 1 % of each other.
pub struct Stream {
    /// Input samples per output sample.
    step: f64,
    /// `PHASES + 1` rows of `2 * HALF` taps: row p is the kernel for an output p / PHASES of a
    /// sample after the input sample at tap HALF - 1.
    table: Vec<f32>,
    /// Input not yet used, with the HALF - 1 samples before the next output.
    buf: Vec<f32>,
    /// Position of the next output sample in `buf`, in input samples.
    pos: f64,
}

impl Stream {
    /// A resampler from `from_hz` to `to_hz`, Hz.
    pub fn new(from_hz: f64, to_hz: f64) -> Self {
        let mut table = Vec::with_capacity((PHASES + 1) * 2 * HALF);
        for p in 0..=PHASES {
            let frac = p as f64 / PHASES as f64;
            for i in 0..2 * HALF {
                // Distance from the output sample to input tap i.
                let x = i as f64 - (HALF as f64 - 1.0) - frac;
                let w = (x / HALF as f64).clamp(-1.0, 1.0);
                let kaiser = bessel_i0(BETA * (1.0 - w * w).sqrt()) / bessel_i0(BETA);
                table.push((sinc(x) * kaiser) as f32);
            }
        }
        Stream {
            step: from_hz / to_hz,
            table,
            buf: vec![0.0; HALF - 1],
            pos: (HALF - 1) as f64,
        }
    }

    /// Resamples the next frame. Output lags input by HALF samples, which the next frame releases.
    pub fn push(&mut self, input: &[i16]) -> Vec<i16> {
        self.buf.extend(input.iter().map(|&s| f32::from(s)));
        let mut out = Vec::with_capacity((input.len() as f64 / self.step) as usize + 2);
        while (self.pos as usize) + HALF < self.buf.len() {
            let base = self.pos as usize;
            let frac = (self.pos - base as f64) * PHASES as f64;
            let row = frac as usize;
            let t = (frac - row as f64) as f32;
            let lo = &self.table[row * 2 * HALF..(row + 1) * 2 * HALF];
            let hi = &self.table[(row + 1) * 2 * HALF..(row + 2) * 2 * HALF];
            let taps = &self.buf[base + 1 - HALF..=base + HALF];
            let mut acc = 0.0f32;
            for i in 0..2 * HALF {
                acc += taps[i] * (lo[i] + t * (hi[i] - lo[i]));
            }
            out.push(acc.round().clamp(f32::from(i16::MIN), f32::from(i16::MAX)) as i16);
            self.pos += self.step;
        }
        let used = (self.pos as usize + 1).saturating_sub(HALF);
        self.buf.drain(..used);
        self.pos -= used as f64;
        out
    }
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-12 {
        1.0
    } else {
        (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x)
    }
}

/// Modified Bessel function of the first kind, order 0, by its power series.
fn bessel_i0(x: f64) -> f64 {
    let (mut sum, mut term, mut k) = (1.0, 1.0, 1.0);
    while term > 1e-12 * sum {
        term *= (x / (2.0 * k)).powi(2);
        sum += term;
        k += 1.0;
    }
    sum
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1500 Hz tone at `rate`, amplitude 10000, `n` samples from sample `from`.
    fn tone(rate: f64, hz: f64, from: usize, n: usize) -> Vec<i16> {
        (from..from + n)
            .map(|i| (10_000.0 * (2.0 * std::f64::consts::PI * hz * i as f64 / rate).sin()).round() as i16)
            .collect()
    }

    #[test]
    fn a_tone_at_11998_93_hz_comes_out_at_12000_hz_within_60_db() {
        let from = 11_998.927_554;
        let mut s = Stream::new(from, 12_000.0);
        // 10 s in frames of 512, as a KiwiSDR sends them.
        let mut out = Vec::new();
        for k in 0..235 {
            out.extend(s.push(&tone(from, 1500.0, k * 512, 512)));
        }
        let expect = tone(12_000.0, 1500.0, 0, out.len());
        let (mut err, mut sig) = (0.0f64, 0.0f64);
        for i in 100..out.len() {
            err += (f64::from(out[i]) - f64::from(expect[i])).powi(2);
            sig += f64::from(expect[i]).powi(2);
        }
        let db = 10.0 * (err / sig).log10();
        assert!(db < -60.0, "error {db:.1} dB");
        // 120320 input samples make 120330 output samples, less the 16 held back.
        let want = (235.0 * 512.0 * 12_000.0 / from) as usize;
        assert!(
            out.len().abs_diff(want - HALF) <= 1,
            "{} samples, expected {}",
            out.len(),
            want - HALF
        );
    }

    #[test]
    fn tones_across_the_passband_keep_their_level() {
        for hz in [200.0, 1000.0, 2000.0, 2900.0] {
            let from = 12_001.135;
            let mut s = Stream::new(from, 12_000.0);
            let out: Vec<i16> = (0..60)
                .flat_map(|k| s.push(&tone(from, hz, k * 512, 512)))
                .collect();
            let tail = &out[200..];
            let rms = (tail.iter().map(|&v| f64::from(v).powi(2)).sum::<f64>() / tail.len() as f64).sqrt();
            // A sine of amplitude 10000 has an RMS of 7071.
            assert!((rms - 7071.1).abs() < 35.0, "{hz} Hz at RMS {rms:.0}");
        }
    }
}
