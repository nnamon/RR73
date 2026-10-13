//! Ordered-statistics decoding (OSD) for the (174,91) code, run when belief propagation
//! fails (Fossorier and Lin, "Soft-decision decoding of linear block codes based on ordered
//! statistics", IEEE Trans. Inf. Theory, 1995).
//!
//! The code bits are sorted by reliability. Gauss-Jordan elimination of the generator matrix
//! in that column order finds the 91 most reliable independent positions (the information
//! set). Order 0 re-encodes their hard decisions. Orders 1 and 2 also flip one or two of the
//! `window` least reliable information positions. Each candidate's distance is the sum of
//! the reliabilities of the bits where it disagrees with the hard decisions; candidates are
//! tried from the closest, and the first whose CRC-14 checks and whose hard errors and
//! distance stay within the limits is returned.
//!
//! Every attempt yields some codeword, so the CRC alone passes about 1 random candidate in
//! 16384. The limits, and the validator's plausibility checks on OSD decodes, are what keep
//! false decodes out; `docs/experiments/0002-osd.md` sets them on noise.
//!
//! Codewords are packed MSB first into three `u64` words: code bit `i` is bit `63 - i % 64`
//! of word `i / 64`, so the first 12 bytes of the big-endian words are the 91-bit message.

use std::sync::OnceLock;

use rr73_ft8::{crc, ldpc};
use serde::{Deserialize, Serialize};

const N: usize = ldpc::N;
const K: usize = ldpc::K;

type Bits = [u64; 3];

#[inline]
fn get(w: &Bits, i: usize) -> bool {
    (w[i >> 6] >> (63 - (i & 63))) & 1 == 1
}

#[inline]
fn set(w: &mut Bits, i: usize) {
    w[i >> 6] |= 1 << (63 - (i & 63));
}

#[inline]
fn xor(a: &mut Bits, b: &Bits) {
    a[0] ^= b[0];
    a[1] ^= b[1];
    a[2] ^= b[2];
}

#[inline]
fn popcount(w: &Bits) -> u32 {
    w[0].count_ones() + w[1].count_ones() + w[2].count_ones()
}

/// Calls `f` with the index of every set bit.
#[inline]
fn for_each_bit(w: &Bits, mut f: impl FnMut(usize)) {
    for (i, &word) in w.iter().enumerate() {
        let mut x = word;
        while x != 0 {
            let lead = x.leading_zeros() as usize;
            f(i * 64 + lead);
            x &= !(1u64 << (63 - lead));
        }
    }
}

/// The generator matrix of the (174,91) code: row `i` is the codeword of the message with
/// only bit `i` set, from `rr73_ft8::ldpc::encode`.
pub fn generator() -> &'static [Bits; K] {
    static G: OnceLock<[Bits; K]> = OnceLock::new();
    G.get_or_init(|| {
        let mut rows = [[0u64; 3]; K];
        for (i, row) in rows.iter_mut().enumerate() {
            let mut message = [0u8; 12];
            message[i / 8] |= 1 << (7 - i % 8);
            let codeword = ldpc::encode(&message);
            for (b, &bit) in codeword.iter().enumerate() {
                if bit & 1 == 1 {
                    set(row, b);
                }
            }
        }
        rows
    })
}

/// Which LLRs set the reliability order and the hard decisions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OsdSource {
    /// The demodulator's LLRs.
    Channel,
    /// The belief-propagation state with the fewest unsatisfied checks.
    Bp,
}

/// OSD parameters.
#[derive(Clone, Debug, PartialEq)]
pub struct OsdParams {
    /// Search order: 0, 1 or 2 flipped information positions.
    pub order: u8,
    /// Number of least reliable information positions that orders 1 and 2 flip (1 to 91).
    pub window: usize,
    /// LLRs that set the order and the hard decisions.
    pub source: OsdSource,
    /// Most code bits allowed to differ from the channel hard decisions.
    pub max_hard_errors: u32,
    /// Largest reliability-weighted distance allowed, as a fraction of the total reliability.
    pub max_distance: f32,
}

/// Buffers reused across OSD runs.
#[derive(Clone, Debug, Default)]
pub struct OsdScratch {
    rows: Vec<Bits>,
    pivots: Vec<usize>,
    order: Vec<usize>,
    reliability: Vec<f32>,
    deltas: Vec<f32>,
    found: Vec<(f32, u16, u16)>,
}

/// An accepted OSD codeword.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OsdResult {
    /// The codeword, packed.
    pub bits: [u64; 3],
    /// Reliability-weighted distance as a fraction of the total reliability.
    pub distance: f32,
    /// Code bits that differ from the channel hard decisions.
    pub hard_errors: u32,
}

impl OsdResult {
    /// Unpacks the codeword into one bit per byte.
    pub fn unpack(&self, codeword: &mut [u8]) {
        for (i, c) in codeword.iter_mut().enumerate().take(N) {
            *c = u8::from(get(&self.bits, i));
        }
    }
}

const NONE: u16 = u16::MAX;

/// Runs OSD. `source(i)` gives the LLR of bit `i` used for ordering (positive means 1);
/// `channel` holds the demodulator's LLRs (positive means 1), against which hard errors
/// are counted. Returns `None` when no candidate passes the CRC and the limits.
pub fn osd(
    params: &OsdParams,
    source: impl Fn(usize) -> f32,
    channel: &[f32],
    s: &mut OsdScratch,
) -> Option<OsdResult> {
    if channel.len() < N {
        return None;
    }
    s.reliability.clear();
    let mut hard: Bits = [0; 3];
    let mut channel_hard: Bits = [0; 3];
    let mut total = 0.0f32;
    for (i, &c) in channel.iter().enumerate().take(N) {
        let v = source(i);
        let v = if v.is_finite() { v } else { 0.0 };
        if v > 0.0 {
            set(&mut hard, i);
        }
        if c > 0.0 {
            set(&mut channel_hard, i);
        }
        s.reliability.push(v.abs());
        total += v.abs();
    }
    if total.is_nan() || total <= 0.0 {
        return None;
    }
    let rel = &s.reliability;
    s.order.clear();
    s.order.extend(0..N);
    s.order
        .sort_unstable_by(|&a, &b| rel[b].total_cmp(&rel[a]).then(a.cmp(&b)));

    // Gauss-Jordan elimination with pivots taken in reliability order.
    s.rows.clear();
    s.rows.extend_from_slice(generator());
    s.pivots.clear();
    for &col in &s.order {
        let p = s.pivots.len();
        if p == K {
            break;
        }
        let Some(r) = (p..K).find(|&r| get(&s.rows[r], col)) else {
            continue;
        };
        s.rows.swap(p, r);
        let pivot_row = s.rows[p];
        for (q, row) in s.rows.iter_mut().enumerate() {
            if q != p && get(row, col) {
                xor(row, &pivot_row);
            }
        }
        s.pivots.push(col);
    }
    if s.pivots.len() < K {
        return None;
    }

    // Order 0: re-encode the hard decisions of the information set.
    let mut base: Bits = [0; 3];
    for (p, &col) in s.pivots.iter().enumerate() {
        if get(&hard, col) {
            xor(&mut base, &s.rows[p]);
        }
    }
    let mut diff = base;
    xor(&mut diff, &hard);
    let mut base_metric = 0.0f32;
    for_each_bit(&diff, |i| base_metric += rel[i]);
    // Flipping bit i changes the metric by +rel (new disagreement) or -rel (fixed).
    let signed = |i: usize| if get(&diff, i) { -rel[i] } else { rel[i] };

    let limit = params.max_distance * total;
    s.found.clear();
    if base_metric <= limit {
        s.found.push((base_metric, NONE, NONE));
    }
    let window = params.window.clamp(1, K);
    let first = K - window;
    if params.order >= 1 {
        s.deltas.clear();
        for j in first..K {
            let mut d = 0.0;
            for_each_bit(&s.rows[j], |i| d += signed(i));
            s.deltas.push(d);
            let m = base_metric + d;
            if m <= limit {
                s.found.push((m, j as u16, NONE));
            }
        }
    }
    if params.order >= 2 {
        for j in first..K {
            for k in (j + 1)..K {
                let a = &s.rows[j];
                let b = &s.rows[k];
                let both = [a[0] & b[0], a[1] & b[1], a[2] & b[2]];
                let mut overlap = 0.0;
                for_each_bit(&both, |i| overlap += signed(i));
                let m = base_metric + s.deltas[j - first] + s.deltas[k - first] - 2.0 * overlap;
                if m <= limit {
                    s.found.push((m, j as u16, k as u16));
                }
            }
        }
    }
    s.found
        .sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));

    for &(metric, j, k) in &s.found {
        let mut c = base;
        if j != NONE {
            xor(&mut c, &s.rows[j as usize]);
        }
        if k != NONE {
            xor(&mut c, &s.rows[k as usize]);
        }
        if c == [0; 3] {
            continue;
        }
        let mut errors = c;
        xor(&mut errors, &channel_hard);
        let hard_errors = popcount(&errors);
        if hard_errors > params.max_hard_errors {
            continue;
        }
        let mut message = [0u8; 12];
        message[..8].copy_from_slice(&c[0].to_be_bytes());
        message[8..].copy_from_slice(&c[1].to_be_bytes()[..4]);
        if crc::check(&message).is_some() {
            return Some(OsdResult {
                bits: c,
                distance: metric / total,
                hard_errors,
            });
        }
    }
    None
}

/// Sum-product belief propagation, then OSD when it fails. OSD runs only on the (174,91)
/// graph of FT8 and FT4.
#[derive(Clone, Debug, PartialEq)]
pub struct BpOsd {
    /// The belief-propagation stage.
    pub bp: crate::ldpc::SumProduct,
    /// The OSD stage.
    pub osd: OsdParams,
}

impl crate::ldpc::LdpcDecoder for BpOsd {
    fn name(&self) -> &'static str {
        "bp-osd"
    }

    fn decode(
        &self,
        graph: &crate::ldpc::ParityGraph,
        llr: &[f32],
        scratch: &mut crate::ldpc::LdpcScratch,
        codeword: &mut [u8],
    ) -> crate::ldpc::LdpcOutcome {
        let outcome = self.bp.decode(graph, llr, scratch, codeword);
        if outcome.converged || graph.bits() != N || graph.checks() != ldpc::M || llr.len() < N {
            return outcome;
        }
        let found = match self.osd.source {
            OsdSource::Channel => osd(&self.osd, |i| llr[i], llr, &mut scratch.osd),
            OsdSource::Bp => {
                // The BP state is log(P(0) / P(1)); OSD takes positive for 1.
                let best = &scratch.best;
                osd(&self.osd, |i| -best[i], llr, &mut scratch.osd)
            }
        };
        match found {
            Some(r) => {
                r.unpack(codeword);
                crate::ldpc::LdpcOutcome {
                    converged: true,
                    iterations: outcome.iterations,
                    unsatisfied: 0,
                    hard_errors: r.hard_errors,
                    osd: true,
                    distance: r.distance,
                }
            }
            None => outcome,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rr73_ft8::Payload;

    fn codeword(seed: u8) -> [u8; N] {
        let mut payload = Payload([seed, 0x5a, seed ^ 0x33, 7, 9, 1, 2, 3, 4, 0]);
        payload.0[9] &= 0xf8;
        ldpc::encode(&crc::append(&payload))
    }

    fn params(order: u8) -> OsdParams {
        OsdParams {
            order,
            window: 40,
            source: OsdSource::Channel,
            max_hard_errors: N as u32,
            max_distance: 1.0,
        }
    }

    #[test]
    fn generator_rows_are_codewords_and_systematic() {
        let g = generator();
        for (i, row) in g.iter().enumerate() {
            let bits: Vec<u8> = (0..N).map(|b| u8::from(get(row, b))).collect();
            let arr: [u8; N] = bits.try_into().expect("174 bits");
            assert_eq!(ldpc::check(&arr), 0, "row {i}");
            for m in 0..K {
                assert_eq!(get(row, m), m == i, "row {i} bit {m}");
            }
        }
    }

    /// LLRs for `cw` with `flips` bits wrong at low confidence and the rest confident.
    fn llrs(cw: &[u8; N], flips: &[usize]) -> Vec<f32> {
        (0..N)
            .map(|i| {
                let sign = if cw[i] == 1 { 1.0 } else { -1.0 };
                let mag = 1.0 + (i * 37 % 11) as f32;
                if flips.contains(&i) {
                    -0.3 * sign
                } else {
                    sign * mag
                }
            })
            .collect()
    }

    #[test]
    fn order_zero_recovers_errors_outside_the_information_set() {
        let cw = codeword(1);
        // Weak errors become the least reliable bits, so they fall outside the information
        // set and order 0 corrects them.
        let llr = llrs(&cw, &[3, 50, 100, 150]);
        let r = osd(&params(0), |i| llr[i], &llr, &mut OsdScratch::default()).expect("decode");
        let mut out = [0u8; N];
        r.unpack(&mut out);
        assert_eq!(out, cw);
        assert_eq!(r.hard_errors, 4);
        assert!(r.distance < 0.01, "{}", r.distance);
    }

    #[test]
    fn order_two_finds_codewords_order_zero_misses() {
        let cw = codeword(2);
        // Two errors of moderate confidence rank near the weak end of the information set:
        // order 0 re-encodes them as they are, order 2 flips them back.
        let mut llr = llrs(&cw, &[]);
        let mut by_rel: Vec<usize> = (0..N).collect();
        by_rel.sort_by(|&a, &b| llr[b].abs().total_cmp(&llr[a].abs()).then(a.cmp(&b)));
        for &i in &by_rel[84..86] {
            llr[i] *= -0.95;
        }
        let mut s = OsdScratch::default();
        let mut out = [0u8; N];
        if let Some(zero) = osd(&params(0), |i| llr[i], &llr, &mut s) {
            zero.unpack(&mut out);
            assert_ne!(out, cw);
        }
        let two = osd(&params(2), |i| llr[i], &llr, &mut s).expect("order 2");
        two.unpack(&mut out);
        assert_eq!(out, cw);
        assert_eq!(two.hard_errors, 2);
    }

    #[test]
    fn limits_reject_far_candidates() {
        let cw = codeword(3);
        let llr = llrs(&cw, &[3, 50, 100, 150]);
        let mut s = OsdScratch::default();
        let mut p = params(1);
        p.max_hard_errors = 3;
        assert!(osd(&p, |i| llr[i], &llr, &mut s).is_none());
        let mut p = params(1);
        p.max_distance = 1e-4;
        assert!(osd(&p, |i| llr[i], &llr, &mut s).is_none());
    }

    #[test]
    fn degenerate_inputs_give_none() {
        let mut s = OsdScratch::default();
        let zeros = vec![0.0f32; N];
        assert!(osd(&params(2), |i| zeros[i], &zeros, &mut s).is_none());
        let nan = vec![f32::NAN; N];
        assert!(osd(&params(2), |i| nan[i], &nan, &mut s).is_none());
        assert!(osd(&params(2), |_| 1.0, &[1.0; 10], &mut s).is_none());
    }

    #[test]
    fn random_llrs_rarely_pass_the_crc_with_tight_limits() {
        // Pseudo-random LLRs: with no limits order 2 tries 821 codewords and some pass the
        // CRC by chance across many trials; tight limits stop them.
        let mut state = 99u64;
        let mut loose_hits = 0;
        let mut tight_hits = 0;
        let mut s = OsdScratch::default();
        for _ in 0..200 {
            let llr: Vec<f32> = (0..N)
                .map(|_| {
                    state = state
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    ((state >> 40) as f32 / (1u64 << 24) as f32 - 0.5) * 8.0
                })
                .collect();
            loose_hits += usize::from(osd(&params(2), |i| llr[i], &llr, &mut s).is_some());
            let mut tight = params(2);
            tight.max_distance = 0.1;
            tight_hits += usize::from(osd(&tight, |i| llr[i], &llr, &mut s).is_some());
        }
        assert!(loose_hits > 0, "expected chance CRC passes without limits");
        assert_eq!(tight_hits, 0);
    }
}
