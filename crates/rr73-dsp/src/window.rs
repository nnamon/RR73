//! Analysis windows.
//!
//! All windows are periodic (DFT-even): `w[i]` uses `i / len`, so a window of length `n`
//! tiles exactly with hop `n / 2` for Hann.

use std::f64::consts::PI;

/// Window shape used before an FFT.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WindowKind {
    /// All ones.
    Rectangular,
    /// Hann (raised cosine), `sin^2(pi i / n)`.
    #[default]
    Hann,
    /// Hamming, `0.54 - 0.46 cos(2 pi i / n)`.
    Hamming,
    /// Blackman, three-term with coefficients 0.42, 0.5, 0.08.
    Blackman,
}

impl WindowKind {
    /// Returns the window value at index `i` of a periodic window of length `len`.
    pub fn value(self, i: usize, len: usize) -> f32 {
        if len == 0 {
            return 0.0;
        }
        let x = i as f64 / len as f64;
        let v = match self {
            WindowKind::Rectangular => 1.0,
            WindowKind::Hann => {
                let s = (PI * x).sin();
                s * s
            }
            WindowKind::Hamming => 0.54 - 0.46 * (2.0 * PI * x).cos(),
            WindowKind::Blackman => 0.42 - 0.5 * (2.0 * PI * x).cos() + 0.08 * (4.0 * PI * x).cos(),
        };
        v as f32
    }

    /// Fills `out` with the periodic window of length `out.len()`.
    pub fn fill(self, out: &mut [f32]) {
        let len = out.len();
        for (i, w) in out.iter_mut().enumerate() {
            *w = self.value(i, len);
        }
    }

    /// Returns a new periodic window of length `len`.
    pub fn build(self, len: usize) -> Vec<f32> {
        let mut w = vec![0.0; len];
        self.fill(&mut w);
        w
    }
}

/// Sum of window values (coherent gain times length).
pub fn sum(window: &[f32]) -> f64 {
    window.iter().map(|&w| f64::from(w)).sum()
}

/// Sum of squared window values (noise power gain times length).
pub fn sum_squares(window: &[f32]) -> f64 {
    window.iter().map(|&w| f64::from(w) * f64::from(w)).sum()
}

/// Equivalent noise bandwidth of a window, in FFT bins of a transform the size of the window.
pub fn enbw_bins(window: &[f32]) -> f64 {
    let s = sum(window);
    if s == 0.0 {
        return 0.0;
    }
    window.len() as f64 * sum_squares(window) / (s * s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hann_is_periodic_and_symmetric() {
        let w = WindowKind::Hann.build(8);
        assert_eq!(w[0], 0.0);
        assert!((w[4] - 1.0).abs() < 1e-6);
        for i in 1..8 {
            assert!((w[i] - w[8 - i]).abs() < 1e-6, "index {i}");
        }
    }

    #[test]
    fn enbw_matches_textbook_values() {
        let n = 4096;
        let cases = [
            (WindowKind::Rectangular, 1.0),
            (WindowKind::Hann, 1.5),
            (WindowKind::Hamming, 1.3628),
            (WindowKind::Blackman, 1.7268),
        ];
        for (kind, expected) in cases {
            let got = enbw_bins(&kind.build(n));
            assert!((got - expected).abs() < 1e-3, "{kind:?}: {got}");
        }
    }

    #[test]
    fn empty_window_is_harmless() {
        assert!(WindowKind::Hann.build(0).is_empty());
        assert_eq!(enbw_bins(&[]), 0.0);
        assert_eq!(WindowKind::Blackman.value(0, 0), 0.0);
    }
}
