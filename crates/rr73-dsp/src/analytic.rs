//! Analytic signal by FFT (discrete Hilbert transform).

use crate::fft::{self, Complex32, FftPlans};

/// Returns the analytic signal of `x`: the real part equals `x` and the imaginary part is
/// its Hilbert transform. Computed over the whole buffer with one FFT, so the edges show
/// the usual circular wrap-around. Non-finite samples read as zero.
pub fn analytic_signal(x: &[f32], plans: &mut FftPlans) -> Vec<Complex32> {
    let n = x.len();
    let mut buf: Vec<Complex32> = x
        .iter()
        .map(|&v| Complex32::new(if v.is_finite() { v } else { 0.0 }, 0.0))
        .collect();
    if n < 2 {
        return buf;
    }
    let mut scratch = Vec::new();
    fft::process(plans.forward(n).as_ref(), &mut buf, &mut scratch);
    // Keep DC (and Nyquist for even n), double positive frequencies, zero negative ones.
    let positive_end = n.div_ceil(2);
    for c in buf.iter_mut().take(positive_end).skip(1) {
        *c *= 2.0;
    }
    let negative_start = if n.is_multiple_of(2) {
        n / 2 + 1
    } else {
        positive_end
    };
    for c in buf.iter_mut().skip(negative_start) {
        *c = Complex32::new(0.0, 0.0);
    }
    fft::process(plans.inverse(n).as_ref(), &mut buf, &mut scratch);
    let inv_n = 1.0 / n as f32;
    for c in &mut buf {
        *c *= inv_n;
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    #[test]
    fn cosine_becomes_complex_exponential() {
        let n = 1200;
        let f = 50.0;
        let x: Vec<f32> = (0..n)
            .map(|i| (2.0 * PI * f * i as f32 / n as f32).cos())
            .collect();
        let a = analytic_signal(&x, &mut FftPlans::new());
        for (i, c) in a.iter().enumerate() {
            let phase = 2.0 * PI * f * i as f32 / n as f32;
            assert!((c.re - phase.cos()).abs() < 1e-3, "re at {i}");
            assert!((c.im - phase.sin()).abs() < 1e-3, "im at {i}");
        }
    }

    #[test]
    fn odd_lengths_and_tiny_inputs_work() {
        let mut plans = FftPlans::new();
        let x: Vec<f32> = (0..1001).map(|i| (0.3 * i as f32).sin()).collect();
        let a = analytic_signal(&x, &mut plans);
        for (c, v) in a.iter().zip(&x) {
            assert!((c.re - v).abs() < 1e-3);
        }
        assert!(analytic_signal(&[], &mut plans).is_empty());
        assert_eq!(
            analytic_signal(&[f32::NAN], &mut plans)[0],
            Complex32::new(0.0, 0.0)
        );
    }
}
