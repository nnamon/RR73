//! Statistics over scored slots: SNR50 fitting, recall by SNR step, and percentiles.

use serde::{Deserialize, Serialize};

/// A logistic fit of decode probability against SNR:
/// `p(snr) = 1 / (1 + exp(-slope_per_db * (snr - snr50_db)))`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Snr50 {
    /// SNR at which half of the signals decode, in dB (2500 Hz reference).
    pub snr50_db: f64,
    /// Logistic slope, per dB.
    pub slope_per_db: f64,
    /// SNR span from 10 % to 90 % decode probability, in dB.
    pub width_10_90_db: f64,
    /// Number of signals in the fit.
    pub signals: usize,
    /// `true` when `snr50_db` lies outside the range of SNRs measured.
    pub extrapolated: bool,
}

/// Ridge penalty on the slope. It keeps the fit finite when decodes and failures separate
/// perfectly by SNR and has no visible effect otherwise.
const SLOPE_RIDGE: f64 = 1e-3;

/// Fits [`Snr50`] by maximum likelihood (Newton's method) to `(snr_db, decoded)` points.
/// Returns `None` with fewer than two distinct SNRs, when every point has the same outcome,
/// or when decoding does not get more likely with SNR.
pub fn fit_snr50(points: &[(f64, bool)]) -> Option<Snr50> {
    let points: Vec<(f64, bool)> = points.iter().copied().filter(|(x, _)| x.is_finite()).collect();
    let n = points.len();
    if n < 2 {
        return None;
    }
    let successes = points.iter().filter(|p| p.1).count();
    if successes == 0 || successes == n {
        return None;
    }
    let (lo, hi) = points
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
            (lo.min(p.0), hi.max(p.0))
        });
    if hi - lo <= 0.0 {
        return None;
    }
    let mean = points.iter().map(|p| p.0).sum::<f64>() / n as f64;
    let rate = successes as f64 / n as f64;
    let mut a = (rate / (1.0 - rate)).ln();
    let mut b = 0.0f64;
    for _ in 0..200 {
        let (mut ga, mut gb, mut haa, mut hab, mut hbb) = (0.0, -SLOPE_RIDGE * b, 0.0, 0.0, SLOPE_RIDGE);
        for &(x, y) in &points {
            let xc = x - mean;
            let p = 1.0 / (1.0 + (-(a + b * xc)).exp());
            let r = f64::from(u8::from(y)) - p;
            let w = p * (1.0 - p);
            ga += r;
            gb += r * xc;
            haa += w;
            hab += w * xc;
            hbb += w * xc * xc;
        }
        let det = haa * hbb - hab * hab;
        if !(det.is_finite() && det > 0.0) {
            break;
        }
        // Newton step on the (concave) log-likelihood: delta = H^-1 g with H positive here.
        let mut da = (hbb * ga - hab * gb) / det;
        let mut db = (haa * gb - hab * ga) / det;
        let scale = (da.abs().max(db.abs()) / 5.0).max(1.0);
        da /= scale;
        db /= scale;
        a += da;
        b += db;
        if da.abs() < 1e-10 && db.abs() < 1e-10 {
            break;
        }
    }
    if !(a.is_finite() && b.is_finite()) || b <= 0.0 {
        return None;
    }
    let snr50 = mean - a / b;
    if !snr50.is_finite() {
        return None;
    }
    Some(Snr50 {
        snr50_db: snr50,
        slope_per_db: b,
        width_10_90_db: 2.0 * 9f64.ln() / b,
        signals: n,
        extrapolated: snr50 < lo || snr50 > hi,
    })
}

/// Decode counts at one SNR step.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Step {
    /// SNR of the step, in dB (rounded to 0.1 dB).
    pub snr_db: f64,
    /// Signals at this SNR.
    pub signals: usize,
    /// Signals decoded.
    pub decoded: usize,
}

/// Groups `(snr_db, decoded)` points by SNR rounded to 0.1 dB, in increasing SNR.
pub fn recall_steps(points: &[(f64, bool)]) -> Vec<Step> {
    let mut keyed: Vec<(i64, bool)> = points
        .iter()
        .filter(|p| p.0.is_finite())
        .map(|&(x, y)| ((x * 10.0).round() as i64, y))
        .collect();
    keyed.sort_by_key(|k| k.0);
    let mut steps: Vec<Step> = Vec::new();
    for (k, y) in keyed {
        let snr = k as f64 / 10.0;
        match steps.last_mut() {
            Some(s) if s.snr_db == snr => {
                s.signals += 1;
                s.decoded += usize::from(y);
            }
            _ => steps.push(Step {
                snr_db: snr,
                signals: 1,
                decoded: usize::from(y),
            }),
        }
    }
    steps
}

/// Value at percentile `p` (0 to 100) of `values` by the nearest-rank method, or `None`
/// for an empty slice. Non-finite values are ignored.
pub fn percentile(values: &[f64], p: f64) -> Option<f64> {
    let mut v: Vec<f64> = values.iter().copied().filter(|x| x.is_finite()).collect();
    if v.is_empty() {
        return None;
    }
    v.sort_by(f64::total_cmp);
    let p = p.clamp(0.0, 100.0);
    let rank = ((p / 100.0) * v.len() as f64).ceil() as usize;
    Some(v[rank.clamp(1, v.len()) - 1])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic points drawn from a known logistic curve.
    fn logistic_points(snr50: f64, slope: f64, per_step: usize) -> Vec<(f64, bool)> {
        let mut out = Vec::new();
        let mut state = 12345u64;
        for step in -28..=-8 {
            let x = f64::from(step);
            let p = 1.0 / (1.0 + (-slope * (x - snr50)).exp());
            for _ in 0..per_step {
                state = state
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                let u = (state >> 11) as f64 / (1u64 << 53) as f64;
                out.push((x, u < p));
            }
        }
        out
    }

    #[test]
    fn recovers_a_known_curve() {
        let fit = fit_snr50(&logistic_points(-19.5, 1.2, 400)).expect("fit");
        assert!((fit.snr50_db + 19.5).abs() < 0.1, "{fit:?}");
        assert!((fit.slope_per_db - 1.2).abs() < 0.15, "{fit:?}");
        assert!(!fit.extrapolated);
        assert_eq!(fit.signals, 21 * 400);
    }

    #[test]
    fn perfect_separation_gives_the_midpoint() {
        let mut pts = Vec::new();
        for x in -28..=-8 {
            pts.push((f64::from(x), x >= -20));
        }
        let fit = fit_snr50(&pts).expect("fit");
        assert!((fit.snr50_db + 20.5).abs() < 0.05, "{fit:?}");
    }

    #[test]
    fn degenerate_inputs_give_none() {
        assert!(fit_snr50(&[]).is_none());
        assert!(fit_snr50(&[(-10.0, true), (-12.0, true)]).is_none());
        assert!(fit_snr50(&[(-10.0, true), (-10.0, false)]).is_none());
        // Decoding gets less likely with SNR: no meaningful SNR50.
        assert!(fit_snr50(&[(-20.0, true), (-10.0, false), (-21.0, true), (-9.0, false)]).is_none());
        assert!(fit_snr50(&[(f64::NAN, true), (-10.0, false)]).is_none());
    }

    #[test]
    fn steps_group_by_tenth_of_a_db() {
        let steps = recall_steps(&[(-10.0, true), (-10.04, false), (-12.0, true), (f64::NAN, true)]);
        assert_eq!(
            steps,
            vec![
                Step {
                    snr_db: -12.0,
                    signals: 1,
                    decoded: 1
                },
                Step {
                    snr_db: -10.0,
                    signals: 2,
                    decoded: 1
                },
            ]
        );
    }

    #[test]
    fn percentiles_use_nearest_rank() {
        let v: Vec<f64> = (1..=10).map(f64::from).collect();
        assert_eq!(percentile(&v, 50.0), Some(5.0));
        assert_eq!(percentile(&v, 90.0), Some(9.0));
        assert_eq!(percentile(&v, 99.0), Some(10.0));
        assert_eq!(percentile(&v, 0.0), Some(1.0));
        assert_eq!(percentile(&[], 50.0), None);
        assert_eq!(percentile(&[f64::NAN, 3.0], 50.0), Some(3.0));
    }
}
