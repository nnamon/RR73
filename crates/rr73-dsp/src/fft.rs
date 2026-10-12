//! FFT plans.
//!
//! A thin layer over `rustfft` that caches plans by size and direction. Plans are shared
//! (`Arc`) and stateless; callers own the buffers and scratch space, so processing with an
//! existing plan does not allocate.

use std::sync::Arc;

pub use rustfft::Fft;
pub use rustfft::num_complex::Complex32;
use rustfft::{FftDirection, FftPlanner};

/// A cache of forward and inverse complex FFT plans for `f32`.
pub struct FftPlans {
    planner: FftPlanner<f32>,
}

impl Default for FftPlans {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for FftPlans {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("FftPlans")
    }
}

impl FftPlans {
    /// Creates an empty cache.
    pub fn new() -> Self {
        Self {
            planner: FftPlanner::new(),
        }
    }

    /// Returns the forward (time to frequency, `e^{-j...}`) plan for `len` points.
    pub fn forward(&mut self, len: usize) -> Arc<dyn Fft<f32>> {
        self.planner.plan_fft(len, FftDirection::Forward)
    }

    /// Returns the inverse plan for `len` points. The inverse is unnormalised: a forward then
    /// inverse transform scales the data by `len`.
    pub fn inverse(&mut self, len: usize) -> Arc<dyn Fft<f32>> {
        self.planner.plan_fft(len, FftDirection::Inverse)
    }
}

/// Transforms `buffer` in place with `plan`, using `scratch` (resized on first use only).
pub fn process(plan: &dyn Fft<f32>, buffer: &mut [Complex32], scratch: &mut Vec<Complex32>) {
    let need = plan.get_inplace_scratch_len();
    if scratch.len() < need {
        scratch.resize(need, Complex32::new(0.0, 0.0));
    }
    if buffer.len() != plan.len() || buffer.is_empty() {
        return;
    }
    plan.process_with_scratch(buffer, &mut scratch[..need]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forward_then_inverse_scales_by_length() {
        let mut plans = FftPlans::new();
        let n = 360;
        let fwd = plans.forward(n);
        let inv = plans.inverse(n);
        let input: Vec<Complex32> = (0..n)
            .map(|i| Complex32::new((i as f32 * 0.37).sin(), (i as f32 * 0.11).cos()))
            .collect();
        let mut buf = input.clone();
        let mut scratch = Vec::new();
        process(fwd.as_ref(), &mut buf, &mut scratch);
        process(inv.as_ref(), &mut buf, &mut scratch);
        for (a, b) in input.iter().zip(&buf) {
            assert!((a * n as f32 - b).norm() < 1e-2, "{a} {b}");
        }
    }

    #[test]
    fn tone_lands_in_its_bin() {
        let mut plans = FftPlans::new();
        let n = 64;
        let fwd = plans.forward(n);
        let mut buf: Vec<Complex32> = (0..n)
            .map(|i| {
                Complex32::new(
                    (2.0 * std::f32::consts::PI * 5.0 * i as f32 / n as f32).cos(),
                    0.0,
                )
            })
            .collect();
        let mut scratch = Vec::new();
        process(fwd.as_ref(), &mut buf, &mut scratch);
        assert!((buf[5].norm() - n as f32 / 2.0).abs() < 1e-3);
        assert!(buf[6].norm() < 1e-3);
    }

    #[test]
    fn wrong_length_buffer_is_ignored() {
        let mut plans = FftPlans::new();
        let fwd = plans.forward(16);
        let mut buf = vec![Complex32::new(1.0, 0.0); 8];
        let mut scratch = Vec::new();
        process(fwd.as_ref(), &mut buf, &mut scratch);
        assert!(buf.iter().all(|c| *c == Complex32::new(1.0, 0.0)));
    }
}
