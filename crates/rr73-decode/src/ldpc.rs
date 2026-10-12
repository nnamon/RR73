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
        Ok(Self {
            bits,
            check_start,
            edge_bit,
            bit_start,
            bit_edges,
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
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LdpcOutcome {
    /// `true` when the hard decision satisfies every check and is not all zero.
    pub converged: bool,
    /// Message-passing iterations run (0 when the channel hard decision was a codeword).
    pub iterations: u32,
    /// Unsatisfied checks of the final hard decision.
    pub unsatisfied: u32,
    /// Code bits where the final hard decision differs from the channel hard decision.
    pub hard_errors: u32,
}

/// Reusable message storage, sized on first use for a graph.
#[derive(Clone, Debug, Default)]
pub struct LdpcScratch {
    l0: Vec<f32>,
    total: Vec<f32>,
    v2c: Vec<f32>,
    c2v: Vec<f32>,
}

impl LdpcScratch {
    fn ensure(&mut self, graph: &ParityGraph) {
        self.l0.resize(graph.bits, 0.0);
        self.total.resize(graph.bits, 0.0);
        self.v2c.resize(graph.edges(), 0.0);
        self.c2v.resize(graph.edges(), 0.0);
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
        run(graph, llr, self.max_iterations, scratch, codeword, |v2c, c2v| {
            let d = v2c.len();
            let mut t = [0.0f32; MAX_CHECK_DEGREE];
            for (ti, &q) in t.iter_mut().zip(v2c) {
                *ti = fast_tanh(0.5 * q);
            }
            // Leave-one-out products from prefix and suffix products.
            let mut prefix = [1.0f32; MAX_CHECK_DEGREE + 1];
            for i in 0..d {
                prefix[i + 1] = prefix[i] * t[i];
            }
            let mut suffix = 1.0f32;
            for i in (0..d).rev() {
                c2v[i] = 2.0 * fast_atanh(prefix[i] * suffix);
                suffix *= t[i];
            }
        })
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
        run(graph, llr, self.max_iterations, scratch, codeword, |v2c, c2v| {
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
        })
    }
}

/// The flooding-schedule driver shared by both decoders. `update` maps one check's
/// incoming variable messages to its outgoing check messages.
fn run(
    graph: &ParityGraph,
    llr: &[f32],
    max_iterations: u32,
    s: &mut LdpcScratch,
    codeword: &mut [u8],
    update: impl Fn(&[f32], &mut [f32]),
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
    loop {
        hard_decision(&s.total, codeword);
        let unsatisfied = graph.unsatisfied(codeword);
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
        for (e, v) in s.v2c.iter_mut().enumerate() {
            *v = s.total[graph.edge_bit[e]] - s.c2v[e];
        }
        for w in graph.check_start.windows(2) {
            update(&s.v2c[w[0]..w[1]], &mut s.c2v[w[0]..w[1]]);
        }
        for b in 0..n {
            let edges = &graph.bit_edges[graph.bit_start[b]..graph.bit_start[b + 1]];
            s.total[b] = s.l0[b] + edges.iter().map(|&e| s.c2v[e]).sum::<f32>();
        }
    }
    outcome.hard_errors = codeword
        .iter()
        .zip(&s.l0)
        .filter(|&(&c, &l0)| c != u8::from(l0 < 0.0))
        .count() as u32;
    outcome
}

/// Bit is 1 when `log(P(0) / P(1)) < 0`.
fn hard_decision(total: &[f32], codeword: &mut [u8]) {
    for (c, &t) in codeword.iter_mut().zip(total) {
        *c = u8::from(t < 0.0);
    }
}

/// ft8_lib's rational approximation of tanh, saturating beyond |x| = 4.97.
fn fast_tanh(x: f32) -> f32 {
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
}
