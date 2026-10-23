//! Sine and cosine of an f64 angle rounded to f32, equal bit for bit to rounding the f64
//! sine and cosine of the platform's maths library: [`sin_cos_f32`] returns
//! `(a.sin() as f32, a.cos() as f32)`.
//!
//! The angle is reduced by the nearest multiple of π/2 in three parts, and Taylor
//! polynomials on |r| ≤ π/4 give both values to a few units in the last place of an f64,
//! from one reduction. Rounding to f32 is monotonic, so when the f64 values `MARGIN` either
//! side of such a value, relative, round to the same f32, every f64 within them does,
//! the maths library's included: glibc and musl, which Rust's WebAssembly target uses, give
//! sine and cosine within 1 unit in the last place, 2^-52 relative, and `MARGIN` is 2^-44.
//! Where the two ends round apart, about once in a million values, or the angle is near
//! zero, near a zero of the sine or cosine, beyond 2^20 or not finite, the maths library
//! gives the value.

/// Relative distance either side of the polynomial value that every value of the maths
/// library lies within.
const MARGIN: f64 = 1.0 / (1u64 << 44) as f64;

/// π/2 in three parts: `PIO2_1` and `PIO2_2` sum to the f64 nearest π/2, `PIO2_1` keeps its
/// 33 leading bits so that `k * PIO2_1` is exact for |k| below 2^20, and `PIO2_3` is the
/// rest of π/2.
const PIO2_1: f64 = f64::from_bits(std::f64::consts::FRAC_PI_2.to_bits() & !((1 << 20) - 1));
const PIO2_2: f64 = std::f64::consts::FRAC_PI_2 - PIO2_1;
const PIO2_3: f64 = 6.123_233_995_736_766e-17;

/// Taylor coefficients of `(sin r - r) / r^3` and `(cos r - 1) / r^2` in powers of `r^2`.
const SIN: [f64; 8] = [
    -1.0 / 6.0,
    1.0 / 120.0,
    -1.0 / 5040.0,
    1.0 / 362_880.0,
    -1.0 / 39_916_800.0,
    1.0 / 6_227_020_800.0,
    -1.0 / 1_307_674_368_000.0,
    1.0 / 355_687_428_096_000.0,
];
const COS: [f64; 9] = [
    -1.0 / 2.0,
    1.0 / 24.0,
    -1.0 / 720.0,
    1.0 / 40_320.0,
    -1.0 / 3_628_800.0,
    1.0 / 479_001_600.0,
    -1.0 / 87_178_291_200.0,
    1.0 / 20_922_789_888_000.0,
    -1.0 / 6_402_373_705_728_000.0,
];

/// `(a.sin() as f32, a.cos() as f32)`, bit for bit.
pub fn sin_cos_f32(a: f64) -> (f32, f32) {
    fast(a).unwrap_or_else(|| (a.sin() as f32, a.cos() as f32))
}

/// Both values from the polynomials, or `None` where they might round apart from the maths
/// library's.
#[inline]
fn fast(a: f64) -> Option<(f32, f32)> {
    let size = a.abs();
    if !(1.0 / (1u64 << 20) as f64..=(1u64 << 20) as f64).contains(&size) {
        return None;
    }
    let k = (a * std::f64::consts::FRAC_2_PI).round();
    let r = ((a - k * PIO2_1) - k * PIO2_2) - k * PIO2_3;
    // Near a zero of the sine or cosine the reduction's absolute error could matter.
    if r.abs() < 1.0 / (1u64 << 40) as f64 {
        return None;
    }
    let z = r * r;
    let ps = SIN.iter().rev().fold(0.0, |acc, &c| acc * z + c);
    let pc = COS.iter().rev().fold(0.0, |acc, &c| acc * z + c);
    let s = r + r * z * ps;
    let c = 1.0 + z * pc;
    let (sin, cos) = match (k as i64).rem_euclid(4) {
        0 => (s, c),
        1 => (c, -s),
        2 => (-s, -c),
        _ => (-c, s),
    };
    Some((round(sin)?, round(cos)?))
}

/// `v` rounded to f32 when every f64 within `MARGIN` of it rounds the same way.
#[inline]
fn round(v: f64) -> Option<f32> {
    let d = 2.0 * MARGIN * v.abs();
    let (lo, hi) = ((v - d) as f32, (v + d) as f32);
    (lo == hi && lo != 0.0).then_some(lo)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Checks one angle; `true` when a non-zero angle fell back to the maths library.
    fn check(a: f64) -> bool {
        let want = (a.sin() as f32, a.cos() as f32);
        let got = sin_cos_f32(a);
        assert_eq!(
            (want.0.to_bits(), want.1.to_bits()),
            (got.0.to_bits(), got.1.to_bits()),
            "angle {a:e}"
        );
        a != 0.0 && fast(a).is_none()
    }

    #[test]
    fn the_first_two_parts_sum_to_half_pi() {
        assert_eq!(PIO2_1 + PIO2_2, std::f64::consts::FRAC_PI_2);
        assert_eq!(PIO2_1.to_bits() & ((1 << 20) - 1), 0);
        // The f64 nearest π/2 falls short of π/2 by about 6.12e-17, which PIO2_3 holds: the
        // cosine of that f64 is the shortfall.
        assert!((std::f64::consts::FRAC_PI_2.cos() - PIO2_3).abs() < 1e-30);
    }

    /// The block demodulator's twiddles and symbol rotations over their whole range, and
    /// a dense sweep of every angle they can take.
    #[test]
    fn matches_the_maths_library_bit_for_bit() {
        let mut fallbacks = 0usize;
        let mut count = 0usize;
        let mut state = 42u64;
        let mut uniform = || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (state >> 11) as f64 / (1u64 << 53) as f64
        };
        for _ in 0..2_000_000 {
            let q = uniform() - 0.5;
            let late = uniform() - 0.5;
            let t = (uniform() * 8.0).floor();
            let m = (uniform() * 30.0).floor();
            let a = -std::f64::consts::TAU * ((t + q) * m - t * late) / 30.0;
            fallbacks += usize::from(check(a));
            let s = (uniform() * 105.0).floor();
            fallbacks += usize::from(check(-std::f64::consts::TAU * q * s));
            count += 2;
        }
        for i in -400_000..=400_000 {
            fallbacks += usize::from(check(f64::from(i) * 7.3e-4));
            count += 1;
        }
        assert!(fallbacks * 100_000 < count, "{fallbacks} of {count} fell back");
    }

    #[test]
    fn edges_fall_back_to_the_maths_library() {
        let half_pi = std::f64::consts::FRAC_PI_2;
        for a in [
            0.0,
            -0.0,
            1e-300,
            -1e-7,
            1.0 / (1u64 << 20) as f64,
            half_pi,
            -half_pi,
            std::f64::consts::PI,
            2.0 * std::f64::consts::PI,
            100.0 * half_pi,
            (1u64 << 20) as f64,
            1e7,
            -1e300,
            f64::MAX,
            f64::MIN_POSITIVE,
        ] {
            check(a);
            check(a.next_up());
            check(a.next_down());
        }
        assert!(sin_cos_f32(f64::NAN).0.is_nan() && sin_cos_f32(f64::NAN).1.is_nan());
        assert!(sin_cos_f32(f64::INFINITY).0.is_nan());
        assert!(fast(half_pi).is_none() && fast(0.0).is_none() && fast(f64::NAN).is_none());
    }
}
