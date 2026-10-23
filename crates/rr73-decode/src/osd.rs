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
    /// Count every erased bit (channel LLR exactly 0: its symbol lies outside the audio) as a
    /// hard error, so a codeword resting on fewer received bits needs fewer disagreements.
    pub erasures_as_errors: bool,
}

/// Buffers reused across OSD runs.
#[derive(Clone, Debug, Default)]
pub struct OsdScratch {
    rows: Vec<Bits>,
    /// The rows during the elimination, word by word ([`eliminate`]).
    words: Vec<u64>,
    pivots: Vec<usize>,
    order: Vec<usize>,
    /// Sort keys of the reliability order.
    keys: Vec<u64>,
    reliability: Vec<f32>,
    /// Per code bit, the change in distance when a flip changes that bit: +reliability where
    /// the order-0 codeword agrees with the hard decision, -reliability where it does not.
    signed: Vec<f32>,
    /// The order-1 change of the distance of each window row, and whether it is summed yet.
    deltas: Vec<f32>,
    delta_known: Vec<bool>,
    /// The window rows' bits that count as hard errors: word 0 of every row, then word 1,
    /// then word 2.
    masked_rows: Vec<u64>,
    /// Hard errors of one window row paired with each later row.
    errors: Vec<u32>,
    /// Candidates that pass the integer checks and the distance limit, as [`found_key`]s.
    found: Vec<u64>,
    /// The reference OSDs' candidates and buffers, in tests.
    #[cfg(test)]
    found_ref: Vec<(f32, u16, u16)>,
    #[cfg(test)]
    member: Vec<f32>,
    #[cfg(test)]
    overlap: Vec<f32>,
}

/// A candidate of distance `metric` from window rows `j` and `k` ([`NONE`] for none) as one
/// integer: the distance's bits ordered as `f32::total_cmp` orders them, then `j`, then `k`.
/// Integer order is the order of (distance, `j`, `k`).
fn found_key(metric: f32, j: u16, k: u16) -> u64 {
    let b = metric.to_bits() as i32;
    let ordered = (b ^ ((((b >> 31) as u32) >> 1) as i32)) as u32 ^ 0x8000_0000;
    (u64::from(ordered) << 32) | (u64::from(j) << 16) | u64::from(k)
}

/// The distance and rows of a [`found_key`].
fn from_found_key(key: u64) -> (f32, u16, u16) {
    let t = (((key >> 32) as u32) ^ 0x8000_0000) as i32;
    let b = t ^ ((((t >> 31) as u32) >> 1) as i32);
    (f32::from_bits(b as u32), (key >> 16) as u16, key as u16)
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

/// Gauss-Jordan elimination of the generator matrix with pivots taken in the column order
/// `order`: writes to `rows` the 91 rows that are the identity on the pivot columns, and to
/// `pivots` those columns in pivot order. Returns `false` when `order` holds fewer than 91
/// independent columns. `words` holds the rows during the elimination, word by word: word 0
/// of every row, then word 1, then word 2, so clearing a column from every row runs as
/// whole-vector operations. The pivots and rows are those of a row-by-row elimination: each
/// column is a pivot when no combination of the earlier pivot columns gives it, and the rows
/// that are the identity on the pivots are unique.
fn eliminate(order: &[usize], words: &mut Vec<u64>, rows: &mut Vec<Bits>, pivots: &mut Vec<usize>) -> bool {
    words.clear();
    for w in 0..3 {
        words.extend(generator().iter().map(|row| row[w]));
    }
    let (w0, rest) = words.split_at_mut(K);
    let (w1, w2) = rest.split_at_mut(K);
    pivots.clear();
    for &col in order {
        let p = pivots.len();
        if p == K {
            break;
        }
        let (word, shift) = (col >> 6, 63 - (col & 63) as u32);
        let column = match word {
            0 => &*w0,
            1 => &*w1,
            _ => &*w2,
        };
        let Some(r) = (p..K).find(|&r| (column[r] >> shift) & 1 == 1) else {
            continue;
        };
        w0.swap(p, r);
        w1.swap(p, r);
        w2.swap(p, r);
        let pivot = [w0[p], w1[p], w2[p]];
        match word {
            0 => clear_column::<0>(w0, w1, w2, pivot, shift),
            1 => clear_column::<1>(w0, w1, w2, pivot, shift),
            _ => clear_column::<2>(w0, w1, w2, pivot, shift),
        }
        // The pivot row cleared itself.
        (w0[p], w1[p], w2[p]) = (pivot[0], pivot[1], pivot[2]);
        pivots.push(col);
    }
    rows.clear();
    rows.extend((0..K).map(|p| [w0[p], w1[p], w2[p]]));
    pivots.len() == K
}

/// Adds the pivot row's words `pivot` to every row that has bit `shift` of word `W` set, the
/// pivot row included; the rows' words lie word by word in `w0`, `w1` and `w2`.
fn clear_column<const W: usize>(w0: &mut [u64], w1: &mut [u64], w2: &mut [u64], pivot: Bits, shift: u32) {
    for ((a, b), c) in w0.iter_mut().zip(w1.iter_mut()).zip(w2.iter_mut()) {
        let mask = (([*a, *b, *c][W] >> shift) & 1).wrapping_neg();
        *a ^= pivot[0] & mask;
        *b ^= pivot[1] & mask;
        *c ^= pivot[2] & mask;
    }
}

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
    let mut erased: Bits = [0; 3];
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
        if c == 0.0 || !c.is_finite() {
            set(&mut erased, i);
        }
        s.reliability.push(v.abs());
        total += v.abs();
    }
    if total.is_nan() || total <= 0.0 {
        return None;
    }
    let rel = &s.reliability;
    // Reliability order, most reliable first, ties by position: the keys sort as the
    // reliabilities' bit patterns, which order non-negative floats as their values do.
    s.keys.clear();
    s.keys.extend(
        rel.iter()
            .enumerate()
            .map(|(i, r)| (u64::from(!r.to_bits()) << 32) | i as u64),
    );
    s.keys.sort_unstable();
    s.order.clear();
    s.order.extend(s.keys.iter().map(|&k| (k & 0xffff_ffff) as usize));

    if !eliminate(&s.order, &mut s.words, &mut s.rows, &mut s.pivots) {
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
    s.signed.clear();
    s.signed.extend(
        rel.iter()
            .enumerate()
            .map(|(i, &r)| if get(&diff, i) { -r } else { r }),
    );

    // The codeword returned is the one with the smallest key (distance, then rows) among the
    // candidates within the distance limit that are not all zero, keep their hard errors
    // within the limit and pass the CRC. The hard errors and the zero test are integer
    // functions of a candidate's rows alone, so they are checked first, and only candidates
    // that pass them get a distance. Each distance comes from the same operations in the same
    // order as when every candidate got one: the order-1 sums of each row's signed
    // reliabilities, and the order-2 overlap of two rows summed over the bits they share in
    // increasing order from +0.
    let limit = params.max_distance * total;
    let window = params.window.clamp(1, K);
    let first = K - window;
    let (keep, extra) = if params.erasures_as_errors {
        ([!erased[0], !erased[1], !erased[2]], popcount(&erased))
    } else {
        ([!0; 3], 0)
    };
    let masked = |w: &Bits| [w[0] & keep[0], w[1] & keep[1], w[2] & keep[2]];
    // Code bits of the order-0 codeword that differ from the channel decisions, counted ones.
    let mut errors0 = base;
    xor(&mut errors0, &channel_hard);
    let errors0 = masked(&errors0);
    let max_errors = params.max_hard_errors;
    let OsdScratch {
        rows,
        signed,
        deltas,
        delta_known,
        masked_rows,
        errors,
        found,
        ..
    } = s;
    found.clear();
    if base != [0; 3] && popcount(&errors0) + extra <= max_errors && base_metric <= limit {
        found.push(found_key(base_metric, NONE, NONE));
    }
    deltas.clear();
    deltas.resize(window, 0.0);
    delta_known.clear();
    delta_known.resize(window, false);
    // The order-1 change of the distance of window row `r`, summed once when first needed.
    let mut delta = |r: usize| -> f32 {
        if !delta_known[r] {
            let mut d = 0.0;
            for_each_bit(&rows[first + r], |i| d += signed[i]);
            deltas[r] = d;
            delta_known[r] = true;
        }
        deltas[r]
    };
    if params.order >= 1 {
        for r in 0..window {
            let row = &rows[first + r];
            let mut c = base;
            xor(&mut c, row);
            let mut e = errors0;
            xor(&mut e, &masked(row));
            if c != [0; 3] && popcount(&e) + extra <= max_errors {
                let m = base_metric + delta(r);
                if m <= limit {
                    found.push(found_key(m, (first + r) as u16, NONE));
                }
            }
        }
    }
    if params.order >= 2 {
        // The window rows' bits that count as errors, word by word across the rows, so the
        // hard errors of row r with every later row come from one loop over whole words.
        masked_rows.clear();
        for word in 0..3 {
            masked_rows.extend(rows[first..].iter().map(|row| row[word] & keep[word]));
        }
        for r in 0..window {
            let rj = rows[first + r];
            let mut ej = errors0;
            xor(&mut ej, &masked(&rj));
            let later = r + 1..window;
            errors.clear();
            errors.extend(
                masked_rows[later.clone()]
                    .iter()
                    .zip(&masked_rows[window + r + 1..2 * window])
                    .zip(&masked_rows[2 * window + r + 1..3 * window])
                    .map(|((&a, &b), &c)| {
                        (a ^ ej[0]).count_ones() + (b ^ ej[1]).count_ones() + (c ^ ej[2]).count_ones()
                    }),
            );
            for (q, &e) in later.zip(errors.iter()) {
                if e + extra > max_errors {
                    continue;
                }
                let rk = &rows[first + q];
                let mut c = base;
                xor(&mut c, &rj);
                xor(&mut c, rk);
                if c == [0; 3] {
                    continue;
                }
                let both = [rj[0] & rk[0], rj[1] & rk[1], rj[2] & rk[2]];
                let mut o = 0.0;
                for_each_bit(&both, |i| o += signed[i]);
                let m = base_metric + delta(r) + delta(q) - 2.0 * o;
                if m <= limit {
                    found.push(found_key(m, (first + r) as u16, (first + q) as u16));
                }
            }
        }
    }
    s.found.sort_unstable();

    for &key in &s.found {
        let (metric, j, k) = from_found_key(key);
        let mut c = base;
        if j != NONE {
            xor(&mut c, &s.rows[j as usize]);
        }
        if k != NONE {
            xor(&mut c, &s.rows[k as usize]);
        }
        let mut e = c;
        xor(&mut e, &channel_hard);
        let hard_errors = popcount(&masked(&e)) + extra;
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
            erasures_as_errors: false,
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
    fn erased_bits_count_as_hard_errors_when_asked() {
        let cw = codeword(4);
        // Two weak errors and six erased bits, as when the last symbols of a slot are cut.
        let mut llr = llrs(&cw, &[3, 50]);
        for v in &mut llr[160..166] {
            *v = 0.0;
        }
        let mut s = OsdScratch::default();
        let mut out = [0u8; N];
        let plain = osd(&params(0), |i| llr[i], &llr, &mut s).expect("plain");
        plain.unpack(&mut out);
        assert_eq!(out, cw);
        // Without the rule an erased bit counts only when the codeword has a 1 there.
        let ones = cw[160..166].iter().filter(|&&b| b == 1).count() as u32;
        assert_eq!(plain.hard_errors, 2 + ones);

        let mut p = params(0);
        p.erasures_as_errors = true;
        let counted = osd(&p, |i| llr[i], &llr, &mut s).expect("counted");
        assert_eq!(counted.hard_errors, 8);
        p.max_hard_errors = 7;
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

    /// The OSD of 0.21.8, before the speed work of experiment 0009. The faster search must
    /// give the same codewords, distances and candidate lists bit for bit.
    mod before {
        use super::super::*;

        pub(super) fn reference(
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
            let mut erased: Bits = [0; 3];
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
                if c == 0.0 || !c.is_finite() {
                    set(&mut erased, i);
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
            s.found_ref.clear();
            if base_metric <= limit {
                s.found_ref.push((base_metric, NONE, NONE));
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
                        s.found_ref.push((m, j as u16, NONE));
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
                            s.found_ref.push((m, j as u16, k as u16));
                        }
                    }
                }
            }
            s.found_ref
                .sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));

            for &(metric, j, k) in &s.found_ref {
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
                let hard_errors = if params.erasures_as_errors {
                    let received = [
                        errors[0] & !erased[0],
                        errors[1] & !erased[1],
                        errors[2] & !erased[2],
                    ];
                    popcount(&received) + popcount(&erased)
                } else {
                    popcount(&errors)
                };
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
    }

    /// The OSD of 0.24.2, after experiment 0009 and before 0014: a distance for every order-1
    /// and order-2 candidate from dense overlaps, then a sort of all of those within the
    /// limit and the checks in that order.
    mod at_0_24_2 {
        use super::super::*;

        pub(super) fn reference(
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
            let mut erased: Bits = [0; 3];
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
                if c == 0.0 || !c.is_finite() {
                    set(&mut erased, i);
                }
                s.reliability.push(v.abs());
                total += v.abs();
            }
            if total.is_nan() || total <= 0.0 {
                return None;
            }
            let rel = &s.reliability;
            // Reliability order, most reliable first, ties by position: the keys sort as the
            // reliabilities' bit patterns, which order non-negative floats as their values do.
            s.keys.clear();
            s.keys.extend(
                rel.iter()
                    .enumerate()
                    .map(|(i, r)| (u64::from(!r.to_bits()) << 32) | i as u64),
            );
            s.keys.sort_unstable();
            s.order.clear();
            s.order.extend(s.keys.iter().map(|&k| (k & 0xffff_ffff) as usize));

            // Gauss-Jordan elimination with pivots taken in reliability order. Rows are cleared of the
            // pivot column with a mask, so the inner loop has no branch on the data.
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
                let (word, shift) = (col >> 6, 63 - (col & 63));
                for (q, row) in s.rows.iter_mut().enumerate() {
                    let mask = ((row[word] >> shift) & u64::from(q != p)).wrapping_neg();
                    row[0] ^= pivot_row[0] & mask;
                    row[1] ^= pivot_row[1] & mask;
                    row[2] ^= pivot_row[2] & mask;
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
            s.signed.clear();
            s.signed.extend(
                rel.iter()
                    .enumerate()
                    .map(|(i, &r)| if get(&diff, i) { -r } else { r }),
            );

            let limit = params.max_distance * total;
            s.found.clear();
            if base_metric <= limit {
                s.found.push(found_key(base_metric, NONE, NONE));
            }
            let window = params.window.clamp(1, K);
            let first = K - window;
            let OsdScratch {
                rows,
                signed,
                deltas,
                member,
                overlap,
                found,
                ..
            } = s;
            if params.order >= 1 {
                deltas.clear();
                for (j, row) in rows.iter().enumerate().skip(first) {
                    let mut d = 0.0;
                    for_each_bit(row, |i| d += signed[i]);
                    deltas.push(d);
                    let m = base_metric + d;
                    if m <= limit {
                        found.push(found_key(m, j as u16, NONE));
                    }
                }
            }
            if params.order >= 2 {
                // The overlap of rows j and k sums the signed reliabilities of the bits both rows
                // have, in increasing bit order. For one j the sums for every k run side by side:
                // walking the bits of row j, each k adds the bit's value times 1 when it has the bit
                // and times 0 when not. A sum that starts at +0 never becomes -0, so adding a zero
                // leaves it unchanged, and every overlap equals the bit-by-bit sum exactly.
                member.clear();
                member.resize(N * window, 0.0);
                for r in 0..window {
                    for_each_bit(&rows[first + r], |i| member[i * window + r] = 1.0);
                }
                overlap.clear();
                overlap.resize(window, 0.0);
                for r in 0..window {
                    let ov = &mut overlap[r + 1..];
                    ov.fill(0.0);
                    for_each_bit(&rows[first + r], |i| {
                        let x = signed[i];
                        let has = &member[i * window + r + 1..(i + 1) * window];
                        for (o, &h) in ov.iter_mut().zip(has) {
                            *o += x * h;
                        }
                    });
                    let dj = deltas[r];
                    for (c, &o) in ov.iter().enumerate() {
                        let q = r + 1 + c;
                        let m = base_metric + dj + deltas[q] - 2.0 * o;
                        if m <= limit {
                            found.push(found_key(m, (first + r) as u16, (first + q) as u16));
                        }
                    }
                }
            }
            s.found.sort_unstable();

            for &key in &s.found {
                let (metric, j, k) = from_found_key(key);
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
                let hard_errors = if params.erasures_as_errors {
                    let received = [
                        errors[0] & !erased[0],
                        errors[1] & !erased[1],
                        errors[2] & !erased[2],
                    ];
                    popcount(&received) + popcount(&erased)
                } else {
                    popcount(&errors)
                };
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
    }

    /// A linear congruential generator and Box-Muller normal deviates.
    struct Lcg(u64);

    impl Lcg {
        fn uniform(&mut self) -> f32 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (self.0 >> 40) as f32 / (1u64 << 24) as f32
        }

        fn normal(&mut self) -> f32 {
            let u = self.uniform().max(1e-7);
            let v = self.uniform();
            (-2.0 * u.ln()).sqrt() * (std::f32::consts::TAU * v).cos()
        }
    }

    /// The elimination of 0.24.2: rows one by one, each cleared of the pivot column with a
    /// mask.
    fn eliminate_0_24_2(order: &[usize], rows: &mut Vec<Bits>, pivots: &mut Vec<usize>) -> bool {
        rows.clear();
        rows.extend_from_slice(generator());
        pivots.clear();
        for &col in order {
            let p = pivots.len();
            if p == K {
                break;
            }
            let Some(r) = (p..K).find(|&r| get(&rows[r], col)) else {
                continue;
            };
            rows.swap(p, r);
            let pivot_row = rows[p];
            let (word, shift) = (col >> 6, 63 - (col & 63));
            for (q, row) in rows.iter_mut().enumerate() {
                let mask = ((row[word] >> shift) & u64::from(q != p)).wrapping_neg();
                row[0] ^= pivot_row[0] & mask;
                row[1] ^= pivot_row[1] & mask;
                row[2] ^= pivot_row[2] & mask;
            }
            pivots.push(col);
        }
        pivots.len() == K
    }

    /// The word-by-word elimination gives the 0.24.2 elimination's pivots and rows bit for bit:
    /// random column orders, the systematic order, parity columns first, and orders with too
    /// few independent columns.
    #[test]
    fn elimination_matches_the_row_by_row_elimination() {
        let mut rng = Lcg(77);
        let (mut rows_a, mut pivots_a) = (Vec::new(), Vec::new());
        let (mut rows_b, mut pivots_b, mut words) = (Vec::new(), Vec::new(), Vec::new());
        let mut full = 0;
        for trial in 0..500usize {
            let mut order: Vec<usize> = (0..N).collect();
            match trial % 5 {
                0 => {}
                1 => order.reverse(),
                // The parity columns and only a few information columns: too few pivots.
                2 => order = (K - 5..N).collect(),
                _ => {
                    for i in (1..N).rev() {
                        let j = (rng.uniform() * (i + 1) as f32) as usize % (i + 1);
                        order.swap(i, j);
                    }
                }
            }
            let a = eliminate_0_24_2(&order, &mut rows_a, &mut pivots_a);
            let b = eliminate(&order, &mut words, &mut rows_b, &mut pivots_b);
            assert_eq!(a, b, "trial {trial}");
            if a {
                assert_eq!(pivots_a, pivots_b, "trial {trial}");
                assert_eq!(rows_a, rows_b, "trial {trial}");
                full += 1;
            }
        }
        assert_eq!(full, 400);
    }

    type Found = Vec<(u32, u16, u16)>;

    fn exact(r: Option<OsdResult>, found: &[(f32, u16, u16)]) -> (Option<([u64; 3], u32, u32)>, Found) {
        (
            r.map(|r| (r.bits, r.distance.to_bits(), r.hard_errors)),
            found.iter().map(|&(m, j, k)| (m.to_bits(), j, k)).collect(),
        )
    }

    #[test]
    fn found_keys_order_as_the_tuples_and_round_trip() {
        let metrics = [
            -f32::INFINITY,
            -3.5,
            -1e-30,
            -0.0,
            0.0,
            1e-38,
            0.25,
            0.25,
            7.0,
            1e30,
            f32::INFINITY,
            f32::NAN,
        ];
        let mut tuples = Vec::new();
        for (i, &m) in metrics.iter().enumerate() {
            for (j, k) in [(NONE, NONE), (3, NONE), (3, 90), (0, 1), (90, NONE)] {
                tuples.push((m, j, k + (i as u16 % 2) * u16::from(k != NONE)));
            }
        }
        let mut want = tuples.clone();
        want.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        let mut keys: Vec<u64> = tuples.iter().map(|&(m, j, k)| found_key(m, j, k)).collect();
        keys.sort_unstable();
        let got: Vec<(f32, u16, u16)> = keys.into_iter().map(from_found_key).collect();
        let bits = |v: &[(f32, u16, u16)]| v.iter().map(|&(m, j, k)| (m.to_bits(), j, k)).collect::<Vec<_>>();
        assert_eq!(bits(&want), bits(&got));
    }

    /// The search of experiment 0014, the 0.24.2 search it replaced and the 0.21.8 search give
    /// the same codeword, distance and hard errors bit for bit, at the preset's limits and
    /// looser and tighter ones; the 0.24.2 search also gives 0.21.8's candidate list.
    #[test]
    fn faster_search_matches_the_reference_bit_for_bit() {
        let mut rng = Lcg(2026);
        let (mut a, mut b, mut c) = (
            OsdScratch::default(),
            OsdScratch::default(),
            OsdScratch::default(),
        );
        let (mut cases, mut decoded) = (0, 0);
        for trial in 0..100usize {
            let cw = codeword(trial as u8);
            // Noise from clean to none of the codeword left.
            let sigma = [0.5f32, 0.8, 1.1, 1.5, 50.0][trial % 5];
            let noisy = |rng: &mut Lcg| -> Vec<f32> {
                (0..N)
                    .map(|i| 4.0 * (if cw[i] == 1 { 1.0 } else { -1.0 } + sigma * rng.normal()))
                    .collect()
            };
            let mut channel = noisy(&mut rng);
            if trial % 7 == 0 {
                // Erased bits, as at the end of a partial slot.
                channel[150..].fill(0.0);
            }
            if trial % 11 == 0 {
                // Ties in the reliability order.
                channel.iter_mut().for_each(|v| *v = v.round());
            }
            // The BP state orders some runs, so the order differs from the channel's.
            let source = if trial % 3 == 0 {
                noisy(&mut rng)
            } else {
                channel.clone()
            };
            for order in 0..=2u8 {
                for window in [1usize, 2, 17, 40, 91] {
                    for (max_distance, max_hard_errors) in
                        [(1.0f32, N as u32), (0.07, 30), (0.2, 45), (0.07, 24)]
                    {
                        let p = OsdParams {
                            order,
                            window,
                            source: OsdSource::Channel,
                            max_hard_errors,
                            max_distance,
                            erasures_as_errors: trial % 2 == 0,
                        };
                        let want = before::reference(&p, |i| source[i], &channel, &mut a);
                        let dense = at_0_24_2::reference(&p, |i| source[i], &channel, &mut b);
                        let found: Vec<(f32, u16, u16)> =
                            b.found.iter().map(|&k| from_found_key(k)).collect();
                        let what = format!(
                            "trial {trial}, order {order}, window {window}, limits {max_distance} {max_hard_errors}"
                        );
                        assert_eq!(exact(want, &a.found_ref), exact(dense, &found), "{what}");
                        let got = osd(&p, |i| source[i], &channel, &mut c);
                        assert_eq!(exact(want, &[]).0, exact(got, &[]).0, "{what}");
                        cases += 1;
                        decoded += usize::from(got.is_some());
                    }
                }
            }
        }
        assert_eq!(cases, 6000);
        assert!(decoded > 1000 && decoded < cases, "{decoded} of {cases} decoded");
    }
}
