//! LDPC decoding by belief propagation on the parity-check graph.
//!
//! The decoders take LLRs in the crate's convention (positive means 1) and write hard bits.
//! Internally they work with `log(P(0) / P(1))`. Both use the flooding schedule: all
//! variable-to-check messages, then all check-to-variable messages, then a hard decision
//! and a syndrome check. The channel hard decision is checked before the first iteration.
//! An all-zero hard decision satisfies every check but is never a valid FT8 or FT4
//! codeword (its CRC is zero), so it counts as a failure, as in ft8_lib.
//!
//! [`SumProduct`] follows ft8_lib's `bp_decode` (`ft8/ldpc.c`) and uses its rational
//! approximations of tanh and atanh, Copyright (c) 2018 Kārlis Goba, MIT licence. Changes:
//! edge-indexed message arrays built from the codec's parity tables, leave-one-out products
//! without division, and a final check after the last iteration.

use std::sync::OnceLock;

/// Largest check-node degree supported (FT8 and FT4 use 6 and 7).
pub const MAX_CHECK_DEGREE: usize = 32;

/// A parity-check graph in compressed form: edges grouped by check, and for each bit the
/// list of its edges.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParityGraph {
    bits: usize,
    check_start: Vec<usize>,
    edge_bit: Vec<usize>,
    bit_start: Vec<usize>,
    bit_edges: Vec<usize>,
    /// Checks grouped by degree, for the sum-product schedule ([`SumProduct`]). Its edges are
    /// numbered by slot: within a group, edge `i` of the group's check `x` is slot
    /// `start + i * lanes + x`, so one step of every check of the group runs on a contiguous
    /// run of slots. `lanes` rounds the group's check count up to a multiple of [`LANES`];
    /// the slots of the padding checks hold values nothing reads.
    groups: Vec<CheckGroup>,
    /// Bit of each slot (0 for padding).
    slot_bit: Vec<usize>,
    /// For each bit, its slots, in the order of `bit_edges` (from `bit_start`).
    bit_slots: Vec<usize>,
    /// The most lanes of a group.
    widest: usize,
    /// For each check, its bits as a mask over words of 64 bits: bit `b` is bit `b % 64` of
    /// word `b / 64`, `words` words per check.
    check_masks: Vec<u64>,
    words: usize,
}

/// Checks per vector step of the sum-product schedule.
const LANES: usize = 8;

/// Checks of one degree in the slot numbering of [`ParityGraph`].
#[derive(Clone, Debug, PartialEq, Eq)]
struct CheckGroup {
    degree: usize,
    lanes: usize,
    start: usize,
}

impl ParityGraph {
    /// Builds a graph over `bits` code bits from, for each check, the bit indices it
    /// covers. Rejects out-of-range or repeated indices and checks above
    /// [`MAX_CHECK_DEGREE`].
    pub fn new<C: AsRef<[u16]>>(bits: usize, checks: &[C]) -> Result<Self, String> {
        let mut check_start = Vec::with_capacity(checks.len() + 1);
        let mut edge_bit = Vec::new();
        check_start.push(0);
        for (m, row) in checks.iter().enumerate() {
            let row = row.as_ref();
            if row.is_empty() || row.len() > MAX_CHECK_DEGREE {
                return Err(format!("check {m} has {} bits", row.len()));
            }
            for (i, &b) in row.iter().enumerate() {
                let b = b as usize;
                if b >= bits || row[..i].iter().any(|&o| o as usize == b) {
                    return Err(format!("check {m} lists bit {b} out of range or twice"));
                }
                edge_bit.push(b);
            }
            check_start.push(edge_bit.len());
        }
        let mut degree = vec![0usize; bits];
        for &b in &edge_bit {
            degree[b] += 1;
        }
        let mut bit_start = Vec::with_capacity(bits + 1);
        bit_start.push(0);
        for d in &degree {
            let last = bit_start.last().copied().unwrap_or(0);
            bit_start.push(last + d);
        }
        let mut fill = bit_start.clone();
        let mut bit_edges = vec![0usize; edge_bit.len()];
        for (e, &b) in edge_bit.iter().enumerate() {
            bit_edges[fill[b]] = e;
            fill[b] += 1;
        }
        let checks = check_start.len() - 1;
        let degree_of = |m: usize| check_start[m + 1] - check_start[m];
        let mut degrees: Vec<usize> = (0..checks).map(degree_of).collect();
        degrees.sort_unstable();
        degrees.dedup();
        let mut groups = Vec::with_capacity(degrees.len());
        let mut slot_of_edge = vec![0usize; edge_bit.len()];
        let mut slot_bit = Vec::new();
        let mut widest = 0;
        for degree in degrees {
            let members: Vec<usize> = (0..checks).filter(|&m| degree_of(m) == degree).collect();
            let lanes = members.len().next_multiple_of(LANES);
            let start = slot_bit.len();
            slot_bit.resize(start + degree * lanes, 0);
            for (x, &m) in members.iter().enumerate() {
                for i in 0..degree {
                    let slot = start + i * lanes + x;
                    slot_of_edge[check_start[m] + i] = slot;
                    slot_bit[slot] = edge_bit[check_start[m] + i];
                }
            }
            groups.push(CheckGroup { degree, lanes, start });
            widest = widest.max(lanes);
        }
        let bit_slots = bit_edges.iter().map(|&e| slot_of_edge[e]).collect();
        let words = bits.div_ceil(64);
        let mut check_masks = vec![0u64; checks * words];
        for (m, w) in check_start.windows(2).enumerate() {
            for &b in &edge_bit[w[0]..w[1]] {
                check_masks[m * words + b / 64] |= 1 << (b % 64);
            }
        }
        Ok(Self {
            bits,
            check_start,
            edge_bit,
            bit_start,
            bit_edges,
            groups,
            slot_bit,
            bit_slots,
            widest,
            check_masks,
            words,
        })
    }

    /// The (174,91) graph shared by FT8 and FT4, from `rr73_ft8::ldpc::check_to_bits`.
    pub fn ft8() -> &'static ParityGraph {
        static GRAPH: OnceLock<ParityGraph> = OnceLock::new();
        GRAPH.get_or_init(|| {
            ParityGraph::new(rr73_ft8::ldpc::N, rr73_ft8::ldpc::check_to_bits())
                .unwrap_or_else(|e| panic!("rr73-ft8 parity table is malformed: {e}"))
        })
    }

    /// Number of code bits.
    pub fn bits(&self) -> usize {
        self.bits
    }

    /// Number of parity checks.
    pub fn checks(&self) -> usize {
        self.check_start.len().saturating_sub(1)
    }

    /// Number of edges (ones in the parity-check matrix).
    pub fn edges(&self) -> usize {
        self.edge_bit.len()
    }

    /// Number of unsatisfied checks for hard bits packed by [`ParityGraph::pack`]: the same
    /// count as [`ParityGraph::unsatisfied`].
    fn unsatisfied_packed(&self, packed: &[u64]) -> usize {
        self.check_masks
            .chunks_exact(self.words)
            .filter(|mask| {
                mask.iter()
                    .zip(packed)
                    .map(|(m, p)| (m & p).count_ones())
                    .sum::<u32>()
                    & 1
                    == 1
            })
            .count()
    }

    /// Packs hard bits (0 or 1 per bit; missing bits read as 0) into `packed`, 64 per word.
    fn pack(&self, hard: &[u8], packed: &mut Vec<u64>) {
        packed.clear();
        packed.resize(self.words, 0);
        for (b, &h) in hard.iter().take(self.bits).enumerate() {
            packed[b / 64] |= u64::from(h & 1) << (b % 64);
        }
    }

    /// Number of unsatisfied checks for hard bits `hard` (0 or 1 per bit).
    pub fn unsatisfied(&self, hard: &[u8]) -> usize {
        self.check_start
            .windows(2)
            .filter(|w| {
                self.edge_bit[w[0]..w[1]]
                    .iter()
                    .fold(0u8, |acc, &b| acc ^ (hard.get(b).copied().unwrap_or(0) & 1))
                    != 0
            })
            .count()
    }
}

/// Result of one LDPC decode.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LdpcOutcome {
    /// `true` when the hard decision satisfies every check and is not all zero.
    pub converged: bool,
    /// Message-passing iterations run (0 when the channel hard decision was a codeword).
    pub iterations: u32,
    /// Unsatisfied checks of the final hard decision.
    pub unsatisfied: u32,
    /// Code bits where the final hard decision differs from the channel hard decision.
    pub hard_errors: u32,
    /// `true` when ordered-statistics decoding produced the codeword after BP failed.
    pub osd: bool,
    /// For OSD codewords: the reliability-weighted distance to the received LLRs, as a
    /// fraction of the total reliability (0 for BP codewords).
    pub distance: f32,
}

/// Reusable message storage, sized on first use for a graph.
#[derive(Clone, Debug, Default)]
pub struct LdpcScratch {
    l0: Vec<f32>,
    total: Vec<f32>,
    v2c: Vec<f32>,
    c2v: Vec<f32>,
    /// Sum-product, by slot: tanh of half of each variable-to-check message, and the product of
    /// the tanh values of the slots before it in its check.
    tanh: Vec<f32>,
    prefix: Vec<f32>,
    /// Sum-product, by check of one group: the product of the tanh values after a slot.
    suffix: Vec<f32>,
    /// The hard decision packed for the parity checks.
    packed: Vec<u64>,
    /// Totals (`log(P(0) / P(1))`) of the iteration with the fewest unsatisfied checks.
    pub(crate) best: Vec<f32>,
    /// Buffers for ordered-statistics decoding.
    pub(crate) osd: crate::osd::OsdScratch,
}

impl LdpcScratch {
    fn ensure(&mut self, graph: &ParityGraph) {
        self.l0.resize(graph.bits, 0.0);
        self.total.resize(graph.bits, 0.0);
        self.best.resize(graph.bits, 0.0);
        let slots = graph.slot_bit.len();
        self.v2c.resize(graph.edges(), 0.0);
        // By edge for min-sum, by slot for sum-product.
        self.c2v.resize(graph.edges().max(slots), 0.0);
        self.tanh.resize(slots, 0.0);
        self.prefix.resize(slots, 0.0);
        self.suffix.resize(graph.widest, 0.0);
    }
}

/// Recovers a codeword from LLRs.
pub trait LdpcDecoder {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Decodes `llr` (positive means 1, one per code bit) into `codeword` (0 or 1 per bit).
    /// Extra or missing entries in either slice are ignored or read as zero.
    fn decode(
        &self,
        graph: &ParityGraph,
        llr: &[f32],
        scratch: &mut LdpcScratch,
        codeword: &mut [u8],
    ) -> LdpcOutcome;
}

/// Sum-product belief propagation (ft8_lib `bp_decode`).
#[derive(Clone, Debug, PartialEq)]
pub struct SumProduct {
    /// Most iterations.
    pub max_iterations: u32,
}

/// Normalised min-sum: check messages are the smallest other input magnitude times
/// `scale`, with the product of the other signs.
#[derive(Clone, Debug, PartialEq)]
pub struct MinSum {
    /// Most iterations.
    pub max_iterations: u32,
    /// Scale applied to check messages, in (0, 1].
    pub scale: f32,
}

impl LdpcDecoder for SumProduct {
    fn name(&self) -> &'static str {
        "sum-product"
    }

    fn decode(
        &self,
        graph: &ParityGraph,
        llr: &[f32],
        scratch: &mut LdpcScratch,
        codeword: &mut [u8],
    ) -> LdpcOutcome {
        run(
            graph,
            llr,
            self.max_iterations,
            scratch,
            codeword,
            sum_product_iteration,
        )
    }
}

impl LdpcDecoder for MinSum {
    fn name(&self) -> &'static str {
        "min-sum"
    }

    fn decode(
        &self,
        graph: &ParityGraph,
        llr: &[f32],
        scratch: &mut LdpcScratch,
        codeword: &mut [u8],
    ) -> LdpcOutcome {
        let scale = self.scale;
        let update = move |v2c: &[f32], c2v: &mut [f32]| {
            let mut negative = false;
            let (mut min1, mut min2, mut at) = (f32::INFINITY, f32::INFINITY, usize::MAX);
            for (i, &q) in v2c.iter().enumerate() {
                negative ^= q < 0.0;
                let a = q.abs();
                if a < min1 {
                    min2 = min1;
                    min1 = a;
                    at = i;
                } else if a < min2 {
                    min2 = a;
                }
            }
            for (i, (&q, out)) in v2c.iter().zip(c2v.iter_mut()).enumerate() {
                let mag = if i == at { min2 } else { min1 };
                let sign_negative = negative ^ (q < 0.0);
                let m = scale * if mag.is_finite() { mag } else { 0.0 };
                *out = if sign_negative { -m } else { m };
            }
        };
        run(
            graph,
            llr,
            self.max_iterations,
            scratch,
            codeword,
            by_check(update),
        )
    }
}

/// The flooding-schedule driver shared by both decoders. `iterate` runs one iteration: it
/// updates the check messages from the totals, then the totals from the check messages.
fn run(
    graph: &ParityGraph,
    llr: &[f32],
    max_iterations: u32,
    s: &mut LdpcScratch,
    codeword: &mut [u8],
    iterate: impl Fn(&ParityGraph, &mut LdpcScratch),
) -> LdpcOutcome {
    s.ensure(graph);
    let n = graph.bits;
    for (b, l0) in s.l0.iter_mut().enumerate() {
        let v = llr.get(b).copied().unwrap_or(0.0);
        *l0 = if v.is_finite() { -v } else { 0.0 };
    }
    s.c2v.fill(0.0);
    s.total.copy_from_slice(&s.l0);

    let mut outcome = LdpcOutcome::default();
    let mut iteration = 0u32;
    let mut fewest = usize::MAX;
    loop {
        hard_decision(&s.total, codeword);
        graph.pack(codeword, &mut s.packed);
        let unsatisfied = graph.unsatisfied_packed(&s.packed);
        if unsatisfied < fewest {
            fewest = unsatisfied;
            s.best.copy_from_slice(&s.total);
        }
        outcome.unsatisfied = unsatisfied as u32;
        outcome.iterations = iteration;
        if unsatisfied == 0 {
            outcome.converged = codeword.iter().take(n).any(|&b| b != 0);
            break;
        }
        if iteration >= max_iterations {
            break;
        }
        iteration += 1;
        iterate(graph, s);
    }
    outcome.hard_errors = codeword
        .iter()
        .zip(&s.l0)
        .filter(|&(&c, &l0)| c != u8::from(l0 < 0.0))
        .count() as u32;
    outcome
}

/// One iteration in check order, with messages kept by edge: `update` maps one check's
/// incoming variable messages to its outgoing check messages.
fn by_check(update: impl Fn(&[f32], &mut [f32])) -> impl Fn(&ParityGraph, &mut LdpcScratch) {
    move |graph, s| {
        for (e, v) in s.v2c.iter_mut().enumerate() {
            *v = s.total[graph.edge_bit[e]] - s.c2v[e];
        }
        for w in graph.check_start.windows(2) {
            update(&s.v2c[w[0]..w[1]], &mut s.c2v[w[0]..w[1]]);
        }
        for b in 0..graph.bits {
            let edges = &graph.bit_edges[graph.bit_start[b]..graph.bit_start[b + 1]];
            s.total[b] = s.l0[b] + edges.iter().map(|&e| s.c2v[e]).sum::<f32>();
        }
    }
}

/// One sum-product iteration (ft8_lib's `bp_decode`) with check messages kept by slot (see
/// [`ParityGraph`]). Every message comes from the same operations in the same order as in a
/// loop over checks: tanh of half of each incoming message, leave-one-out products from
/// prefix products and a suffix product, then twice the atanh. Each step runs across all
/// checks of one degree at once, over contiguous slots, so it vectorises.
fn sum_product_iteration(graph: &ParityGraph, s: &mut LdpcScratch) {
    let LdpcScratch {
        l0,
        total,
        c2v,
        tanh,
        prefix,
        suffix,
        ..
    } = s;
    for ((t, &bit), &c) in tanh.iter_mut().zip(&graph.slot_bit).zip(c2v.iter()) {
        *t = total[bit] - c;
    }
    for t in tanh.iter_mut() {
        *t = fast_tanh(0.5 * *t);
    }
    for g in &graph.groups {
        let (d, n, o) = (g.degree, g.lanes, g.start);
        prefix[o..o + n].fill(1.0);
        for i in 1..d {
            let (before, here) = prefix[o + (i - 1) * n..o + (i + 1) * n].split_at_mut(n);
            let t = &tanh[o + (i - 1) * n..o + i * n];
            // Whole vectors of LANES checks, so no loop runs one value at a time.
            let (here, before, t) = (
                here.as_chunks_mut::<LANES>().0,
                before.as_chunks::<LANES>().0,
                t.as_chunks::<LANES>().0,
            );
            for ((h, b), t) in here.iter_mut().zip(before).zip(t) {
                for ((h, &b), &t) in h.iter_mut().zip(b).zip(t) {
                    *h = b * t;
                }
            }
        }
        let suffix = &mut suffix[..n];
        suffix.fill(1.0);
        for i in (0..d).rev() {
            let r = o + i * n..o + (i + 1) * n;
            let lanes = c2v[r.clone()]
                .as_chunks_mut::<LANES>()
                .0
                .iter_mut()
                .zip(prefix[r.clone()].as_chunks::<LANES>().0)
                .zip(tanh[r].as_chunks::<LANES>().0)
                .zip(suffix.as_chunks_mut::<LANES>().0.iter_mut());
            for (((c, p), t), u) in lanes {
                for (((c, &p), &t), u) in c.iter_mut().zip(p).zip(t).zip(u.iter_mut()) {
                    *c = 2.0 * fast_atanh(p * *u);
                    *u *= t;
                }
            }
        }
    }
    for b in 0..graph.bits {
        let slots = &graph.bit_slots[graph.bit_start[b]..graph.bit_start[b + 1]];
        total[b] = l0[b] + slots.iter().map(|&e| c2v[e]).sum::<f32>();
    }
}

/// Bit is 1 when `log(P(0) / P(1)) < 0`.
fn hard_decision(total: &[f32], codeword: &mut [u8]) {
    for (c, &t) in codeword.iter_mut().zip(total) {
        *c = u8::from(t < 0.0);
    }
}

/// ft8_lib's rational approximation of tanh, saturating beyond |x| = 4.97.
fn fast_tanh(x: f32) -> f32 {
    // The rational value is computed in every case and the saturation chosen after it, which
    // compiles to selects, so loops over many values vectorise.
    let x2 = x * x;
    let a = x * (945.0 + x2 * (105.0 + x2));
    let b = 945.0 + x2 * (420.0 + x2 * 15.0);
    let r = a / b;
    if x < -4.97 {
        -1.0
    } else if x > 4.97 {
        1.0
    } else {
        r
    }
}

/// ft8_lib's rational approximation of atanh. It stays finite at |x| = 1 (2.28), which
/// bounds check messages.
fn fast_atanh(x: f32) -> f32 {
    let x2 = x * x;
    let a = x * (945.0 + x2 * (-735.0 + x2 * 64.0));
    let b = 945.0 + x2 * (-1050.0 + x2 * 225.0);
    a / b
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hamming (7,4): data bits 0-3, parity bits 4-6.
    fn hamming() -> ParityGraph {
        ParityGraph::new(7, &[vec![0u16, 1, 2, 4], vec![0, 1, 3, 5], vec![0, 2, 3, 6]]).expect("graph")
    }

    const CODEWORD: [u8; 7] = [1, 0, 1, 1, 0, 0, 1];

    fn llr_for(bits: &[u8], mag: f32) -> Vec<f32> {
        bits.iter().map(|&b| if b == 1 { mag } else { -mag }).collect()
    }

    fn decoders() -> Vec<Box<dyn LdpcDecoder>> {
        vec![
            Box::new(SumProduct { max_iterations: 20 }),
            Box::new(MinSum {
                max_iterations: 20,
                scale: 0.75,
            }),
        ]
    }

    #[test]
    fn graph_structure_is_consistent() {
        let g = hamming();
        assert_eq!((g.bits(), g.checks(), g.edges()), (7, 3, 12));
        assert_eq!(g.unsatisfied(&CODEWORD), 0);
        let mut bad = CODEWORD;
        bad[0] ^= 1;
        assert_eq!(g.unsatisfied(&bad), 3);
        assert!(ParityGraph::new(7, &[vec![0u16, 7]]).is_err());
        assert!(ParityGraph::new(7, &[vec![1u16, 1]]).is_err());
        assert!(ParityGraph::new(7, &[Vec::<u16>::new()]).is_err());
    }

    #[test]
    fn clean_codeword_converges_without_iterating() {
        for d in decoders() {
            let mut out = [0u8; 7];
            let r = d.decode(
                &hamming(),
                &llr_for(&CODEWORD, 4.0),
                &mut LdpcScratch::default(),
                &mut out,
            );
            assert!(r.converged, "{}", d.name());
            assert_eq!((r.iterations, r.hard_errors, r.unsatisfied), (0, 0, 0));
            assert_eq!(out, CODEWORD);
        }
    }

    #[test]
    fn one_weak_wrong_bit_is_corrected() {
        for d in decoders() {
            for flip in 0..7 {
                let mut llr = llr_for(&CODEWORD, 4.0);
                llr[flip] *= -0.5;
                let mut out = [0u8; 7];
                let r = d.decode(&hamming(), &llr, &mut LdpcScratch::default(), &mut out);
                assert!(r.converged, "{} flip {flip}", d.name());
                assert_eq!(out, CODEWORD, "{} flip {flip}", d.name());
                assert_eq!(r.hard_errors, 1);
                assert!(r.iterations >= 1);
            }
        }
    }

    #[test]
    fn all_zero_and_degenerate_inputs_fail_cleanly() {
        for d in decoders() {
            let mut out = [9u8; 7];
            let mut scratch = LdpcScratch::default();
            let r = d.decode(&hamming(), &[0.0; 7], &mut scratch, &mut out);
            assert!(!r.converged, "{} all-zero", d.name());
            let r = d.decode(&hamming(), &[f32::NAN; 7], &mut scratch, &mut out);
            assert!(!r.converged);
            assert!(out.iter().all(|&b| b <= 1));
            let r = d.decode(&hamming(), &[f32::INFINITY, -1.0], &mut scratch, &mut out);
            assert!(!r.converged);
            let r = d.decode(&hamming(), &llr_for(&CODEWORD, 1e30), &mut scratch, &mut out);
            assert!(r.converged);
        }
    }

    #[test]
    fn zero_iterations_only_checks_the_channel_decision() {
        let mut llr = llr_for(&CODEWORD, 4.0);
        llr[2] = -1.0;
        let mut out = [0u8; 7];
        let r =
            SumProduct { max_iterations: 0 }.decode(&hamming(), &llr, &mut LdpcScratch::default(), &mut out);
        assert!(!r.converged);
        assert_eq!(r.iterations, 0);
        assert!(r.unsatisfied > 0);
    }

    #[test]
    fn rational_approximations_track_the_real_functions() {
        for i in -40..=40 {
            let x = i as f32 * 0.1;
            assert!((fast_tanh(x) - x.tanh()).abs() < 1e-2, "tanh {x}");
        }
        for i in -9..=9 {
            let x = i as f32 * 0.1;
            assert!((fast_atanh(x) - x.atanh()).abs() < 2e-2, "atanh {x}");
        }
        assert!((fast_atanh(1.0) - 274.0 / 120.0).abs() < 1e-4);
    }

    /// Sum-product as it ran before experiment 0009: one check at a time, messages by edge.
    fn sum_product_by_check(
        graph: &ParityGraph,
        llr: &[f32],
        max_iterations: u32,
        s: &mut LdpcScratch,
        codeword: &mut [u8],
    ) -> LdpcOutcome {
        let update = |v2c: &[f32], c2v: &mut [f32]| {
            let d = v2c.len();
            let mut t = [0.0f32; MAX_CHECK_DEGREE];
            for (ti, &q) in t.iter_mut().zip(v2c) {
                *ti = fast_tanh(0.5 * q);
            }
            let mut prefix = [1.0f32; MAX_CHECK_DEGREE + 1];
            for i in 0..d {
                prefix[i + 1] = prefix[i] * t[i];
            }
            let mut suffix = 1.0f32;
            for i in (0..d).rev() {
                c2v[i] = 2.0 * fast_atanh(prefix[i] * suffix);
                suffix *= t[i];
            }
        };
        run(graph, llr, max_iterations, s, codeword, by_check(update))
    }

    /// ft8_lib's tanh approximation as it was written, with early returns.
    fn fast_tanh_branching(x: f32) -> f32 {
        if x < -4.97 {
            return -1.0;
        }
        if x > 4.97 {
            return 1.0;
        }
        let x2 = x * x;
        let a = x * (945.0 + x2 * (105.0 + x2));
        let b = 945.0 + x2 * (420.0 + x2 * 15.0);
        a / b
    }

    #[test]
    fn branch_free_tanh_gives_the_same_values() {
        let mut x = -12.0f32;
        while x <= 12.0 {
            assert_eq!(fast_tanh(x).to_bits(), fast_tanh_branching(x).to_bits(), "{x}");
            x += 0.000_37;
        }
        for x in [-4.97f32, 4.97, 0.0, -0.0, 1e30, -1e30, f32::MAX, f32::MIN] {
            assert_eq!(fast_tanh(x).to_bits(), fast_tanh_branching(x).to_bits(), "{x}");
        }
        assert!(fast_tanh(f32::NAN).is_nan() && fast_tanh_branching(f32::NAN).is_nan());
    }

    /// A random graph of `checks` checks of 2 to 9 bits over `bits` bits.
    fn random_graph(bits: usize, checks: usize, state: &mut u64) -> ParityGraph {
        let mut next = |m: u64| {
            *state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (*state >> 33) % m
        };
        let rows: Vec<Vec<u16>> = (0..checks)
            .map(|_| {
                let d = 2 + next(8) as usize;
                let mut row: Vec<u16> = Vec::new();
                while row.len() < d {
                    let b = next(bits as u64) as u16;
                    if !row.contains(&b) {
                        row.push(b);
                    }
                }
                row
            })
            .collect();
        ParityGraph::new(bits, &rows).expect("graph")
    }

    #[test]
    fn slot_order_matches_the_check_loop_bit_for_bit() {
        let ft8 = ParityGraph::ft8();
        let mut state = 7u64;
        let toys: Vec<ParityGraph> = (0..4).map(|_| random_graph(60, 30, &mut state)).collect();
        let hamming = hamming();
        let mut graphs: Vec<&ParityGraph> = vec![ft8, &hamming];
        graphs.extend(toys.iter());
        let (mut a, mut b) = (LdpcScratch::default(), LdpcScratch::default());
        let mut converged = 0;
        for (g, graph) in graphs.iter().enumerate() {
            let n = graph.bits();
            for trial in 0..60u64 {
                let llr: Vec<f32> = (0..n)
                    .map(|i| {
                        state = state
                            .wrapping_mul(6364136223846793005)
                            .wrapping_add(1442695040888963407);
                        let u = (state >> 40) as f32 / (1u64 << 24) as f32;
                        // A codeword-free mix: a bias by position and noise of several sizes.
                        let scale = [0.5f32, 2.0, 6.0, 20.0][(trial % 4) as usize];
                        scale * (u - 0.5)
                            + if (i * 7 + trial as usize).is_multiple_of(5) {
                                0.0
                            } else {
                                0.8
                            }
                    })
                    .collect();
                for iterations in [0u32, 1, 25, 60] {
                    let (mut ca, mut cb) = (vec![0u8; n], vec![0u8; n]);
                    let want = sum_product_by_check(graph, &llr, iterations, &mut a, &mut ca);
                    let got = SumProduct {
                        max_iterations: iterations,
                    }
                    .decode(graph, &llr, &mut b, &mut cb);
                    let bits = |v: &[f32]| v.iter().map(|x| x.to_bits()).collect::<Vec<_>>();
                    assert_eq!(want, got, "graph {g} trial {trial} iterations {iterations}");
                    assert_eq!(ca, cb);
                    assert_eq!(bits(&a.total), bits(&b.total));
                    assert_eq!(bits(&a.best), bits(&b.best));
                    converged += usize::from(got.converged);
                }
            }
        }
        assert!(converged > 0);
    }

    #[test]
    fn ft8_codewords_with_noise_decode_alike_in_both_orders() {
        // Real codewords at low SNR, where belief propagation iterates and often fails.
        let graph = ParityGraph::ft8();
        let (mut a, mut b) = (LdpcScratch::default(), LdpcScratch::default());
        let mut state = 11u64;
        let mut converged = 0;
        for trial in 0..300u32 {
            let mut payload = rr73_ft8::Payload([trial as u8, 0x5a, 3, 7, 9, 1, 2, 3, 4, 0]);
            payload.0[9] &= 0xf8;
            let cw = rr73_ft8::ldpc::encode(&rr73_ft8::crc::append(&payload));
            let sigma = 0.6 + 0.3 * (trial % 5) as f32;
            let llr: Vec<f32> = cw
                .iter()
                .map(|&c| {
                    state = state
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    let u = ((state >> 40) as f32 + 0.5) / (1u64 << 24) as f32;
                    state = state
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    let v = (state >> 40) as f32 / (1u64 << 24) as f32;
                    let g = (-2.0 * u.ln()).sqrt() * (std::f32::consts::TAU * v).cos();
                    4.0 * (if c == 1 { 1.0 } else { -1.0 } + sigma * g)
                })
                .collect();
            let (mut ca, mut cb) = ([0u8; 174], [0u8; 174]);
            let want = sum_product_by_check(graph, &llr, 25, &mut a, &mut ca);
            let got = SumProduct { max_iterations: 25 }.decode(graph, &llr, &mut b, &mut cb);
            assert_eq!(want, got, "trial {trial}");
            assert_eq!(ca, cb);
            let bits = |v: &[f32]| v.iter().map(|x| x.to_bits()).collect::<Vec<_>>();
            assert_eq!(bits(&a.best), bits(&b.best));
            converged += usize::from(got.converged);
        }
        assert!(converged > 30 && converged < 300, "{converged}");
    }

    #[test]
    fn packed_parity_counts_the_same_unsatisfied_checks() {
        let mut state = 5u64;
        let toys: Vec<ParityGraph> = (0..3).map(|_| random_graph(150, 70, &mut state)).collect();
        let mut graphs: Vec<&ParityGraph> = vec![ParityGraph::ft8()];
        graphs.extend(toys.iter());
        let mut packed = Vec::new();
        for graph in graphs {
            for trial in 0..200usize {
                // Bytes other than 0 and 1 count by their lowest bit; short inputs read as 0.
                let len = graph.bits() - (trial % 3) * 7;
                let hard: Vec<u8> = (0..len)
                    .map(|i| {
                        state = state
                            .wrapping_mul(6364136223846793005)
                            .wrapping_add(1442695040888963407);
                        ((state >> 40) as u8) & if i % 2 == 0 { 1 } else { 3 }
                    })
                    .collect();
                graph.pack(&hard, &mut packed);
                assert_eq!(graph.unsatisfied_packed(&packed), graph.unsatisfied(&hard));
            }
        }
    }
}
