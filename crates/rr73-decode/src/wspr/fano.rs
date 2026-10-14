//! Sequential decoding of the K = 32, rate 1/2 convolutional code with the Fano algorithm.
//!
//! The decoder walks the code tree one input bit at a time. Each branch adds the Fano metric
//! of its two code bits: `log2(P(bit | received) / 0.5) - bias` per bit, from the bit's
//! log-likelihood ratio. A running threshold `T` moves in steps of `delta`: the decoder moves
//! forward while the path metric stays at or above `T`, tightens `T` on first visits, backs up
//! to try the other branch when it cannot, and lowers `T` when it cannot back up. The last 31
//! input bits are the known zero tail, so only one branch is open there. Written from the
//! textbook description (Lin and Costello, "Error Control Coding", chapter 13).

use rr73_wspr::code::{CODE_BITS, INPUT_BITS, MESSAGE_BITS, branch_bits};

/// Result of one decoding attempt.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FanoOutcome {
    /// `true` when a path reached the end of the tree within the step limit.
    pub decoded: bool,
    /// Steps taken.
    pub cycles: u32,
    /// Path metric of the decoded path, in bits.
    pub metric: f32,
}

/// Decodes the 81 input bits from code-bit metrics.
pub trait SequentialDecoder {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Decodes from `llr` (log-likelihood ratio of bit 1 for each of the 162 code bits, in
    /// code order) into `bits` (81 input bits, message then tail).
    fn decode(&self, llr: &[f32; CODE_BITS], bits: &mut [u8; INPUT_BITS]) -> FanoOutcome;
}

/// The Fano algorithm.
#[derive(Clone, Debug, PartialEq)]
pub struct Fano {
    /// Most steps per input bit.
    pub max_cycles_per_bit: u32,
    /// Threshold step, in bits.
    pub delta: f32,
    /// Metric bias per code bit, in bits.
    pub bias: f32,
}

#[derive(Clone, Copy, Default)]
struct Node {
    /// Encoder register after the bits up to this node.
    register: u32,
    /// Path metric at this node.
    metric: f32,
    /// Branch metrics, better first.
    branch: [f32; 2],
    /// Input bit of each branch.
    bit: [u8; 2],
    /// Branches open: 2 in the message, 1 in the tail.
    open: u8,
    /// Branch being tried: 0 (better) or 1.
    tried: u8,
}

/// `log2(2 P(bit = 1))` and `log2(2 P(bit = 0))` for log-likelihood ratio `l`.
fn bit_metrics(l: f32) -> [f32; 2] {
    // log2(2 / (1 + e^-l)) = 1 - softplus(-l) / ln 2
    let softplus = |x: f32| if x > 30.0 { x } else { x.exp().ln_1p() };
    let one = 1.0 - softplus(-l) / std::f32::consts::LN_2;
    let zero = 1.0 - softplus(l) / std::f32::consts::LN_2;
    [zero, one]
}

impl Fano {
    fn expand(node: &mut Node, depth: usize, table: &[[f32; 4]; INPUT_BITS]) {
        let m = |bit: u8| {
            let (a, b) = branch_bits((node.register << 1) | u32::from(bit));
            table[depth][usize::from(a) * 2 + usize::from(b)]
        };
        let m0 = m(0);
        if depth >= MESSAGE_BITS {
            node.branch = [m0, f32::NEG_INFINITY];
            node.bit = [0, 1];
            node.open = 1;
        } else {
            let m1 = m(1);
            if m1 > m0 {
                node.branch = [m1, m0];
                node.bit = [1, 0];
            } else {
                node.branch = [m0, m1];
                node.bit = [0, 1];
            }
            node.open = 2;
        }
        node.tried = 0;
    }
}

impl SequentialDecoder for Fano {
    fn name(&self) -> &'static str {
        "fano"
    }

    fn decode(&self, llr: &[f32; CODE_BITS], bits: &mut [u8; INPUT_BITS]) -> FanoOutcome {
        // table[j][2 a + b]: metric of a branch at depth j whose code bits are a and b.
        let mut table = [[0.0f32; 4]; INPUT_BITS];
        for (j, row) in table.iter_mut().enumerate() {
            let a = bit_metrics(llr[2 * j]);
            let b = bit_metrics(llr[2 * j + 1]);
            for x in 0..2 {
                for y in 0..2 {
                    row[x * 2 + y] = a[x] + b[y] - 2.0 * self.bias;
                }
            }
        }
        let max_cycles = u64::from(self.max_cycles_per_bit) * INPUT_BITS as u64;
        let delta = self.delta;
        let mut nodes = [Node::default(); INPUT_BITS + 1];
        Self::expand(&mut nodes[0], 0, &table);
        let mut k = 0usize;
        let mut threshold = 0.0f32;
        let mut cycles = 0u64;
        loop {
            cycles += 1;
            if cycles > max_cycles {
                return FanoOutcome {
                    decoded: false,
                    cycles: cycles.min(u64::from(u32::MAX)) as u32,
                    metric: 0.0,
                };
            }
            let node = nodes[k];
            let next = node.metric + node.branch[usize::from(node.tried)];
            if next >= threshold {
                // Move forward.
                let mut child = Node {
                    register: (node.register << 1) | u32::from(node.bit[usize::from(node.tried)]),
                    metric: next,
                    ..Node::default()
                };
                k += 1;
                if k == INPUT_BITS {
                    nodes[k] = child;
                    break;
                }
                Self::expand(&mut child, k, &table);
                nodes[k] = child;
                // First visit to this node under the current threshold: tighten it.
                if node.metric < threshold + delta {
                    while next >= threshold + delta {
                        threshold += delta;
                    }
                }
                continue;
            }
            // Look back.
            loop {
                if k == 0 || nodes[k - 1].metric < threshold {
                    threshold -= delta;
                    nodes[k].tried = 0;
                    break;
                }
                k -= 1;
                if nodes[k].tried == 0 && nodes[k].open == 2 {
                    nodes[k].tried = 1;
                    break;
                }
            }
        }
        for (j, b) in bits.iter_mut().enumerate() {
            *b = (nodes[j + 1].register & 1) as u8;
        }
        FanoOutcome {
            decoded: true,
            cycles: cycles as u32,
            metric: nodes[INPUT_BITS].metric,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rr73_wspr::code::convolve;

    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> f64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((self.0 >> 11) as f64 + 0.5) / (1u64 << 53) as f64
        }
        fn gauss(&mut self) -> f64 {
            let (u, v) = (self.next(), self.next());
            (-2.0 * u.ln()).sqrt() * (std::f64::consts::TAU * v).cos()
        }
    }

    fn message(seed: u64) -> [u8; INPUT_BITS] {
        let mut r = Lcg(seed);
        let mut m = [0u8; INPUT_BITS];
        for b in m.iter_mut().take(MESSAGE_BITS) {
            *b = u8::from(r.next() < 0.5);
        }
        m
    }

    /// BPSK-like LLRs at Es/N0 `esn0` (linear) per code bit.
    fn channel(code: &[u8; CODE_BITS], esn0: f64, seed: u64) -> [f32; CODE_BITS] {
        let mut r = Lcg(seed);
        let sigma = (1.0 / (2.0 * esn0)).sqrt();
        std::array::from_fn(|i| {
            let x = if code[i] == 1 { 1.0 } else { -1.0 } + sigma * r.gauss();
            (2.0 * x / (sigma * sigma)) as f32
        })
    }

    fn fano() -> Fano {
        Fano {
            max_cycles_per_bit: 10_000,
            delta: 1.0,
            bias: 0.5,
        }
    }

    #[test]
    fn noiseless_codewords_decode_in_one_pass() {
        for seed in 0..20 {
            let m = message(seed);
            let code = convolve(&m);
            let llr: [f32; CODE_BITS] = std::array::from_fn(|i| if code[i] == 1 { 8.0 } else { -8.0 });
            let mut bits = [0u8; INPUT_BITS];
            let out = fano().decode(&llr, &mut bits);
            assert!(out.decoded);
            assert_eq!(bits, m);
            assert_eq!(out.cycles as usize, INPUT_BITS);
        }
    }

    #[test]
    fn noisy_codewords_decode_and_noise_mostly_fails() {
        // Eb/N0 of 5 dB over the 50 message bits (Es/N0 -0.1 dB per code bit): the cutoff
        // rate of the channel is above the code rate, so sequential decoding nearly always
        // succeeds.
        let esn0 = 10f64.powf(5.0 / 10.0) * 50.0 / 162.0;
        let mut ok = 0;
        for seed in 0..50 {
            let m = message(seed + 100);
            let llr = channel(&convolve(&m), esn0, seed);
            let mut bits = [0u8; INPUT_BITS];
            if fano().decode(&llr, &mut bits).decoded && bits == m {
                ok += 1;
            }
        }
        assert!(ok >= 45, "{ok} of 50");
        // Pure noise: a decoded path is possible but rare with these settings.
        let mut decoded = 0;
        for seed in 0..20 {
            let mut r = Lcg(seed + 999);
            let llr: [f32; CODE_BITS] = std::array::from_fn(|_| (r.gauss() * 1.0) as f32);
            let mut bits = [0u8; INPUT_BITS];
            decoded += u32::from(
                Fano {
                    max_cycles_per_bit: 1000,
                    ..fano()
                }
                .decode(&llr, &mut bits)
                .decoded,
            );
        }
        assert!(decoded <= 2, "{decoded}");
    }
}
