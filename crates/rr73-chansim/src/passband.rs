//! A receiver's audio passband: the filter that shapes everything a radio delivers, signals
//! and noise alike.
//!
//! The gain is 1 inside the passband and falls along a raised cosine at each edge, reaching
//! one half (-6 dB) at the edge frequency and the stopband level at half the skirt beyond it.
//! The filter acts on the whole slot by one FFT, so it adds no delay. Applied after
//! rendering, it keeps each signal's SNR against the noise at its own frequency: a signal on
//! the skirt is attenuated together with the noise around it, as in a receiver whose noise
//! comes from the antenna.

use rr73_dsp::fft::{self, Complex32, FftPlans};
use serde::{Deserialize, Serialize};

/// A receiver passband.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Passband {
    /// Lower edge, where the gain is -6 dB, in Hz.
    pub low_hz: f64,
    /// Upper edge, where the gain is -6 dB, in Hz.
    pub high_hz: f64,
    /// Width of each skirt from full gain to the stopband, centred on the edge, in Hz.
    pub skirt_hz: f64,
    /// Gain beyond the skirts, in dB.
    pub stop_db: f64,
}

impl Passband {
    /// Amplitude gain at `hz` (0 to 1).
    pub fn gain(&self, hz: f64) -> f64 {
        let hz = hz.abs();
        let stop = 10f64.powf(self.stop_db / 20.0);
        let half = self.skirt_hz.max(1e-9) / 2.0;
        let edge = |distance: f64| {
            // distance: Hz past the edge (negative inside the passband).
            if distance <= -half {
                1.0
            } else if distance >= half {
                stop
            } else {
                let g = 0.5 + 0.5 * (std::f64::consts::PI * (distance + half) / (2.0 * half)).cos();
                g.max(stop)
            }
        };
        edge(self.low_hz - hz) * edge(hz - self.high_hz)
    }

    /// Filters `samples` (at `sample_rate` Hz) in place.
    pub fn apply(&self, samples: &mut [f32], sample_rate: f64) {
        let n = samples.len();
        if n == 0 {
            return;
        }
        let mut plans = FftPlans::new();
        let mut buf: Vec<Complex32> = samples.iter().map(|&x| Complex32::new(x, 0.0)).collect();
        let mut scratch = Vec::new();
        fft::process(plans.forward(n).as_ref(), &mut buf, &mut scratch);
        for (k, c) in buf.iter_mut().enumerate() {
            // Bin k and bin n - k are the same frequency of opposite sign.
            let f = k.min(n - k) as f64 * sample_rate / n as f64;
            *c *= self.gain(f) as f32;
        }
        fft::process(plans.inverse(n).as_ref(), &mut buf, &mut scratch);
        let scale = 1.0 / n as f32;
        for (x, c) in samples.iter_mut().zip(&buf) {
            *x = c.re * scale;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gain_is_unity_inside_half_at_the_edges_and_low_beyond() {
        let p = Passband {
            low_hz: 300.0,
            high_hz: 2900.0,
            skirt_hz: 200.0,
            stop_db: -80.0,
        };
        assert!((p.gain(1500.0) - 1.0).abs() < 1e-12);
        assert!((p.gain(2900.0) - 0.5).abs() < 1e-9);
        assert!((p.gain(300.0) - 0.5).abs() < 1e-9);
        assert!((p.gain(2800.0) - 1.0).abs() < 1e-9);
        assert!((p.gain(3000.0) - 1e-4).abs() < 1e-9);
        assert!(p.gain(2950.0) < 0.5 && p.gain(2950.0) > 1e-4);
        assert_eq!(p.gain(-1500.0), p.gain(1500.0));
    }

    #[test]
    fn filtering_passes_tones_inside_and_removes_tones_outside() {
        let p = Passband {
            low_hz: 300.0,
            high_hz: 2900.0,
            skirt_hz: 100.0,
            stop_db: -100.0,
        };
        let n = 12_000;
        let tone = |hz: f64| -> Vec<f32> {
            (0..n)
                .map(|i| (2.0 * std::f64::consts::PI * hz * i as f64 / 12_000.0).sin() as f32)
                .collect()
        };
        let power = |x: &[f32]| x.iter().map(|&v| f64::from(v) * f64::from(v)).sum::<f64>() / x.len() as f64;
        for (hz, want) in [(1500.0, 1.0), (2900.0, 0.25), (3100.0, 0.0), (100.0, 0.0)] {
            let mut x = tone(hz);
            let before = power(&x);
            p.apply(&mut x, 12_000.0);
            let ratio = power(&x) / before;
            assert!((ratio - want).abs() < 1e-3, "{hz} Hz: {ratio}");
        }
    }
}
