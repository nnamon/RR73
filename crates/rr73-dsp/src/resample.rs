//! Rational sample-rate conversion with a Kaiser-windowed sinc polyphase filter.
//!
//! The rate ratio is reduced to `up / down`. The prototype low-pass runs at `up * from_hz`
//! with its passband edge at 0.4 and its stopband edge at 0.5 of the lower of the two rates,
//! and at least 80 dB of stopband attenuation. Output sample `n` is aligned in time with
//! input position `n * from_hz / to_hz` (the filter delay is compensated).

use crate::DspError;

/// Stopband attenuation of the prototype filter, in dB.
const ATTENUATION_DB: f64 = 80.0;
/// Passband edge as a fraction of the lower sample rate.
const PASS_EDGE: f64 = 0.4;
/// Stopband edge as a fraction of the lower sample rate.
const STOP_EDGE: f64 = 0.5;

/// A one-shot rational resampler. Building one designs the filter; processing does not
/// allocate beyond the output buffer.
#[derive(Clone, Debug)]
pub struct Resampler {
    from_hz: u32,
    to_hz: u32,
    up: usize,
    down: usize,
    /// Taps per polyphase branch (even).
    taps: usize,
    /// `up` branches of `taps` coefficients: `bank[p * taps + i] = h[p + i * up]`.
    bank: Vec<f32>,
}

impl Resampler {
    /// Designs a resampler from `from_hz` to `to_hz`. Both rates must be non-zero and their
    /// reduced ratio at most 1000 / 1000.
    pub fn new(from_hz: u32, to_hz: u32) -> Result<Self, DspError> {
        if from_hz == 0 || to_hz == 0 {
            return Err(DspError::InvalidParameter("sample rates must be non-zero"));
        }
        let g = gcd(from_hz as usize, to_hz as usize);
        let up = to_hz as usize / g;
        let down = from_hz as usize / g;
        if up > 1000 || down > 1000 {
            return Err(DspError::InvalidParameter(
                "rate ratio too complex (reduced terms above 1000)",
            ));
        }
        if up == 1 && down == 1 {
            return Ok(Self {
                from_hz,
                to_hz,
                up,
                down,
                taps: 0,
                bank: Vec::new(),
            });
        }
        let upsampled_hz = f64::from(from_hz) * up as f64;
        let low = f64::from(from_hz.min(to_hz));
        let transition = (STOP_EDGE - PASS_EDGE) * low / upsampled_hz * 2.0 * std::f64::consts::PI;
        let cutoff = 0.5 * (PASS_EDGE + STOP_EDGE) * low / upsampled_hz; // cycles per sample
        let beta = 0.1102 * (ATTENUATION_DB - 8.7);
        let min_len = ((ATTENUATION_DB - 7.95) / (2.285 * transition)).ceil() as usize + 1;
        let taps = min_len.div_ceil(2 * up).max(1) * 2;
        let len = taps * up;
        let centre = (len / 2) as f64;
        let i0_beta = bessel_i0(beta);
        let mut proto = vec![0.0f64; len];
        for (k, h) in proto.iter_mut().enumerate() {
            let x = k as f64 - centre;
            let r = x / centre;
            let w = if r.abs() <= 1.0 {
                bessel_i0(beta * (1.0 - r * r).sqrt()) / i0_beta
            } else {
                0.0
            };
            *h = 2.0 * cutoff * sinc(2.0 * cutoff * x) * w * up as f64;
        }
        let mut bank = vec![0.0f32; len];
        for p in 0..up {
            for i in 0..taps {
                bank[p * taps + i] = proto[p + i * up] as f32;
            }
        }
        Ok(Self {
            from_hz,
            to_hz,
            up,
            down,
            taps,
            bank,
        })
    }

    /// Input rate in Hz.
    pub fn from_hz(&self) -> u32 {
        self.from_hz
    }

    /// Output rate in Hz.
    pub fn to_hz(&self) -> u32 {
        self.to_hz
    }

    /// Number of output samples for `input_len` input samples: `ceil(input_len * to / from)`.
    pub fn output_len(&self, input_len: usize) -> usize {
        (input_len * self.up).div_ceil(self.down)
    }

    /// Resamples `input` into `out` (cleared first). Samples beyond the input read as zero;
    /// non-finite samples read as zero.
    pub fn process(&self, input: &[f32], out: &mut Vec<f32>) {
        out.clear();
        let n_out = self.output_len(input.len());
        out.reserve(n_out);
        if self.taps == 0 {
            out.extend(input.iter().map(|&x| if x.is_finite() { x } else { 0.0 }));
            return;
        }
        let offset = self.taps * self.up / 2;
        for n in 0..n_out {
            let q = n * self.down + offset;
            let phase = q % self.up;
            let j0 = (q / self.up) as isize;
            let branch = &self.bank[phase * self.taps..(phase + 1) * self.taps];
            let mut acc = 0.0f32;
            for (i, &h) in branch.iter().enumerate() {
                let j = j0 - i as isize;
                if j < 0 {
                    break;
                }
                if let Some(&x) = input.get(j as usize)
                    && x.is_finite()
                {
                    acc += h * x;
                }
            }
            out.push(acc);
        }
    }
}

fn gcd(mut a: usize, mut b: usize) -> usize {
    while b != 0 {
        let t = a % b;
        a = b;
        b = t;
    }
    a
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-12 {
        1.0
    } else {
        let px = std::f64::consts::PI * x;
        px.sin() / px
    }
}

/// Modified Bessel function of the first kind, order 0, by its power series.
fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let half = x / 2.0;
    for k in 1..64 {
        term *= half / k as f64;
        let t2 = term * term;
        sum += t2;
        if t2 < sum * 1e-17 {
            break;
        }
    }
    sum
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    fn sine(freq: f64, rate: u32, secs: f64) -> Vec<f32> {
        let n = (secs * f64::from(rate)) as usize;
        (0..n)
            .map(|i| (2.0 * PI * freq * i as f64 / f64::from(rate)).sin() as f32)
            .collect()
    }

    /// Amplitude and phase error of `y` against a unit sine at `freq`, ignoring the edges.
    fn fit(y: &[f32], freq: f64, rate: u32) -> (f64, f64) {
        let lo = y.len() / 10;
        let hi = y.len() - lo;
        let (mut amp2, mut err2) = (0.0, 0.0);
        for (i, &v) in y.iter().enumerate().take(hi).skip(lo) {
            let want = (2.0 * PI * freq * i as f64 / f64::from(rate)).sin();
            amp2 += f64::from(v) * f64::from(v);
            err2 += (f64::from(v) - want).powi(2);
        }
        let n = (hi - lo) as f64;
        ((2.0 * amp2 / n).sqrt(), (err2 / n).sqrt())
    }

    #[test]
    fn passband_tone_survives_common_rates() {
        for from in [48_000u32, 44_100, 6_400, 24_000, 8_000] {
            let r = Resampler::new(from, 12_000).expect("resampler");
            let mut y = Vec::new();
            r.process(&sine(1000.0, from, 1.0), &mut y);
            assert_eq!(y.len(), 12_000, "{from}");
            let (amp, err) = fit(&y, 1000.0, 12_000);
            assert!((amp - 1.0).abs() < 1e-3, "{from}: amplitude {amp}");
            assert!(err < 2e-3, "{from}: rms error {err} (time alignment)");
        }
    }

    #[test]
    fn stopband_tone_is_attenuated_by_70_db() {
        // 7 kHz at 48 kHz would alias to 5 kHz at 12 kHz.
        let r = Resampler::new(48_000, 12_000).expect("resampler");
        let mut y = Vec::new();
        r.process(&sine(7000.0, 48_000, 1.0), &mut y);
        let rms = (y[1000..11_000].iter().map(|v| f64::from(*v).powi(2)).sum::<f64>() / 10_000.0).sqrt();
        assert!(20.0 * (rms * 2f64.sqrt()).log10() < -70.0, "rms {rms}");
    }

    #[test]
    fn identity_rate_copies_and_cleans() {
        let r = Resampler::new(12_000, 12_000).expect("resampler");
        let mut y = Vec::new();
        r.process(&[1.0, f32::NAN, -2.0], &mut y);
        assert_eq!(y, vec![1.0, 0.0, -2.0]);
    }

    #[test]
    fn bad_rates_are_rejected_and_empty_input_is_fine() {
        assert!(Resampler::new(0, 12_000).is_err());
        assert!(Resampler::new(12_000, 0).is_err());
        assert!(Resampler::new(44_101, 12_000).is_err());
        let r = Resampler::new(48_000, 12_000).expect("resampler");
        let mut y = vec![1.0];
        r.process(&[], &mut y);
        assert!(y.is_empty());
        r.process(&[f32::INFINITY; 100], &mut y);
        assert!(y.iter().all(|v| *v == 0.0));
    }

    #[test]
    fn bessel_matches_reference_values() {
        assert!((bessel_i0(0.0) - 1.0).abs() < 1e-12);
        assert!((bessel_i0(1.0) - 1.266_065_877_752_008_4).abs() < 1e-12);
        assert!((bessel_i0(2.0) - 2.279_585_302_336_067).abs() < 1e-12);
        assert!((bessel_i0(5.0) - 27.239_871_823_604_44).abs() < 1e-10);
    }
}
