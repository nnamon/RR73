//! Character framing: finds start bits and reads the 5 data bits and the stop bit.
//!
//! Two framers share the per-sample evidence from the demodulator:
//!
//! - [`Viterbi`] segments the stream into characters and idle mark by dynamic programming. A
//!   character is a start bit, 5 data bits and at least `min_stop_bits` of mark; any idle mark
//!   may follow it. Each candidate character scores the evidence at its bit ends (start bit
//!   space, stop bit mark, data bits either way) and idle scores mark evidence per sample, so
//!   the best path places every start bit using the whole neighbourhood. Characters come out
//!   after a fixed lag of a few characters, once the paths have merged.
//! - [`Uart`] hunts for a mark-to-space edge after at least half a bit of mark, checks the
//!   start bit at its end, samples the data bits and checks the stop bit, as a hardware UART
//!   does. It has the shortest delay.

use std::f64::consts::LN_2;

use crate::demod::Soft;

/// One framed character.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Frame {
    /// Start-bit edge, in decimated samples (the edge lies after this sample position).
    pub start: f64,
    /// The 5-bit code, first data bit in bit 0.
    pub code: u8,
    /// The start bit read as mark or the stop bit as space.
    pub framing_error: bool,
    /// Confidence from 0 to 1: 1 minus twice the mean bit error probability.
    pub quality: f32,
}

#[derive(Clone, Debug)]
struct Ring<T> {
    buf: Vec<T>,
    mask: usize,
}

impl<T: Copy + Default> Ring<T> {
    fn new(min_len: usize) -> Self {
        let len = min_len.next_power_of_two();
        Self {
            buf: vec![T::default(); len],
            mask: len - 1,
        }
    }

    #[inline]
    fn get(&self, i: u64) -> T {
        self.buf[(i as usize) & self.mask]
    }

    #[inline]
    fn set(&mut self, i: u64, v: T) {
        self.buf[(i as usize) & self.mask] = v;
    }
}

/// Probability that a bit with log-likelihood ratio `llr` is read wrongly.
fn bit_error(llr: f64) -> f64 {
    1.0 / (1.0 + llr.abs().min(50.0).exp())
}

/// log(e^a + e^b).
fn log_add(a: f64, b: f64) -> f64 {
    a.max(b) + (-(a - b).abs()).exp().ln_1p()
}

/// Reads the code and confidence from the 7 bit-end evidences (start, 5 data, stop).
fn read_bits(bits: &[(f64, f64); 7]) -> (u8, bool, f32) {
    let mut code = 0u8;
    for (k, &(m, s)) in bits[1..6].iter().enumerate() {
        if m > s {
            code |= 1 << k;
        }
    }
    let error = bits[0].0 > bits[0].1 || bits[6].1 > bits[6].0;
    let mean_err = bits.iter().map(|&(m, s)| bit_error(m - s)).sum::<f64>() / 7.0;
    (code, error, (1.0 - 2.0 * mean_err) as f32)
}

#[derive(Clone, Copy, Debug, Default)]
struct Info {
    code: u8,
    error: bool,
    quality: f32,
}

/// Dynamic-programming framer with fixed-lag output.
#[derive(Clone, Debug)]
pub(crate) struct Viterbi {
    sps: f64,
    len: u64,
    extra_stop: f64,
    lag: u64,
    step: u64,
    mark: Ring<f32>,
    space: Ring<f32>,
    best: Ring<f64>,
    framed: Ring<bool>,
    info: Ring<Info>,
    n: u64,
    committed: u64,
    since: u64,
    path: Vec<(u64, u64)>,
}

impl Viterbi {
    /// `sps` is decimated samples per bit; `latency_chars` the output lag in characters.
    pub fn new(sps: f64, min_stop_bits: f64, latency_chars: f64) -> Self {
        let bits = 6.0 + min_stop_bits;
        let len = ((bits * sps).floor() as u64).max(8);
        let lag = (latency_chars * bits * sps).round() as u64;
        let step = (len / 4).max(1);
        let cap = (lag + 3 * len + step + 64) as usize;
        Self {
            sps,
            len,
            extra_stop: min_stop_bits - 1.0,
            lag,
            step,
            mark: Ring::new(cap),
            space: Ring::new(cap),
            best: Ring::new(cap),
            framed: Ring::new(cap),
            info: Ring::new(cap),
            n: 0,
            committed: 0,
            since: 0,
            path: Vec::new(),
        }
    }

    /// Evidence at fractional position `p`, interpolated; positions past `newest` use it.
    fn at(&self, p: f64, newest: u64) -> (f64, f64) {
        let p = p.max(0.0);
        let i = p.floor();
        let f = p - i;
        let i = (i as u64).min(newest);
        let j = (i + 1).min(newest);
        let m = f64::from(self.mark.get(i)) * (1.0 - f) + f64::from(self.mark.get(j)) * f;
        let s = f64::from(self.space.get(i)) * (1.0 - f) + f64::from(self.space.get(j)) * f;
        (m, s)
    }

    fn score(&self, t: u64, newest: u64) -> (f64, Info) {
        let t0 = t as f64;
        let mut bits = [(0.0, 0.0); 7];
        for (k, b) in bits.iter_mut().enumerate() {
            *b = self.at(t0 + (k + 1) as f64 * self.sps, newest);
        }
        let mut score = bits[0].1 + bits[6].0;
        for &(m, s) in &bits[1..6] {
            score += log_add(m, s) - LN_2;
        }
        if self.extra_stop > 0.0 {
            let (m, _) = self.at(t0 + (7.0 + self.extra_stop) * self.sps, newest);
            score += self.extra_stop * m;
        }
        let (code, error, quality) = read_bits(&bits);
        (score, Info { code, error, quality })
    }

    pub fn push(&mut self, s: Soft, out: &mut Vec<Frame>) {
        let n = self.n;
        self.mark.set(n, s.mark);
        self.space.set(n, s.space);
        let prev = if n == 0 { 0.0 } else { self.best.get(n - 1) };
        let mut best = prev + f64::from(s.mark) / self.sps;
        let mut framed = false;
        if n >= self.len {
            let t = n - self.len;
            let (score, info) = self.score(t, n);
            let total = self.best.get(t) + score;
            if total > best {
                best = total;
                framed = true;
                self.info.set(n, info);
            }
        }
        self.best.set(n, best);
        self.framed.set(n, framed);
        self.n = n + 1;
        self.since += 1;
        if self.since >= self.step {
            self.traceback(false, out);
        }
    }

    /// Commits the characters on the best path that end at least `lag` samples ago, or all of
    /// them when `flush` is set.
    fn traceback(&mut self, flush: bool, out: &mut Vec<Frame>) {
        self.since = 0;
        if self.n == 0 {
            return;
        }
        let last = self.n - 1;
        self.path.clear();
        let mut m = self.trace_start(last);
        while m > self.committed {
            if self.framed.get(m) {
                let t = m - self.len;
                self.path.push((t, m));
                m = t;
            } else {
                m -= 1;
            }
        }
        let horizon = if flush {
            last
        } else {
            last.saturating_sub(self.lag)
        };
        for &(t, m) in self.path.iter().rev() {
            if m > horizon {
                break;
            }
            if t >= self.committed {
                let info = self.info.get(m);
                out.push(Frame {
                    start: t as f64,
                    code: info.code,
                    framing_error: info.error,
                    quality: info.quality,
                });
                self.committed = m;
            }
        }
        self.committed = self.committed.max(horizon.saturating_sub(self.len));
    }

    /// Where the traceback starts. The best path that ends exactly at `last` must explain a
    /// character still arriving as idle mark, which can pull the recent past onto a wrong
    /// path. A character in progress competes instead: the best path to its start plus the
    /// evidence of its bits so far.
    fn trace_start(&self, last: u64) -> u64 {
        let mut start = last;
        let mut top = self.best.get(last);
        for t in last.saturating_sub(self.len)..last {
            let mut score = self.best.get(t);
            let mut complete = 0;
            for k in 0..6 {
                let p = t as f64 + (k + 1) as f64 * self.sps;
                if p > last as f64 {
                    break;
                }
                let (m, s) = self.at(p, last);
                score += if k == 0 { s } else { log_add(m, s) - LN_2 };
                complete += 1;
            }
            if complete > 0 && score > top {
                top = score;
                start = t;
            }
        }
        start
    }

    pub fn flush(&mut self, out: &mut Vec<Frame>) {
        self.traceback(true, out);
    }
}

/// Edge-hunting framer.
#[derive(Clone, Debug)]
pub(crate) struct Uart {
    sps: f64,
    llr: Ring<f32>,
    n: u64,
    mark_run: f64,
    prev: f32,
    edge: Option<f64>,
    start_checked: bool,
}

impl Uart {
    pub fn new(sps: f64) -> Self {
        Self {
            sps,
            llr: Ring::new((9.0 * sps) as usize + 64),
            n: 0,
            mark_run: 0.0,
            prev: 0.0,
            edge: None,
            start_checked: false,
        }
    }

    fn at(&self, p: f64) -> f64 {
        let newest = self.n.saturating_sub(1);
        let p = p.max(0.0);
        let i = p.floor();
        let f = p - i;
        let i = (i as u64).min(newest);
        let j = (i + 1).min(newest);
        f64::from(self.llr.get(i)) * (1.0 - f) + f64::from(self.llr.get(j)) * f
    }

    pub fn push(&mut self, s: Soft, out: &mut Vec<Frame>) {
        let d = s.llr();
        let n = self.n;
        self.llr.set(n, d);
        self.n = n + 1;
        let now = n as f64;
        match self.edge {
            None => {
                if d > 0.0 {
                    self.mark_run += 1.0;
                } else {
                    if self.prev > 0.0 && self.mark_run >= 0.5 * self.sps {
                        // The filter output crosses zero when its window is half over the
                        // start bit, half a bit after the edge.
                        let cross = now - 1.0 + f64::from(self.prev) / f64::from(self.prev - d);
                        self.edge = Some(cross - 0.5 * self.sps);
                        self.start_checked = false;
                    }
                    self.mark_run = 0.0;
                }
            }
            Some(edge) => {
                if !self.start_checked && now >= edge + self.sps + 1.0 {
                    self.start_checked = true;
                    if self.at(edge + self.sps) > 0.0 {
                        self.edge = None;
                        self.mark_run = 0.0;
                    }
                } else if now >= edge + 7.0 * self.sps + 1.0 {
                    let mut bits = [(0.0, 0.0); 7];
                    for (k, b) in bits.iter_mut().enumerate() {
                        let l = self.at(edge + (k + 1) as f64 * self.sps);
                        *b = (0.5 * l, -0.5 * l);
                    }
                    let (code, error, quality) = read_bits(&bits);
                    out.push(Frame {
                        start: edge,
                        code,
                        framing_error: error,
                        quality,
                    });
                    self.edge = None;
                    self.mark_run = if error { 0.0 } else { 0.5 * self.sps };
                }
            }
        }
        self.prev = d;
    }
}

/// The configured framer.
#[derive(Clone, Debug)]
pub(crate) enum AnyFramer {
    Viterbi(Box<Viterbi>),
    Uart(Uart),
}

impl AnyFramer {
    pub fn push(&mut self, s: Soft, out: &mut Vec<Frame>) {
        match self {
            AnyFramer::Viterbi(v) => v.push(s, out),
            AnyFramer::Uart(u) => u.push(s, out),
        }
    }

    pub fn flush(&mut self, out: &mut Vec<Frame>) {
        if let AnyFramer::Viterbi(v) = self {
            v.flush(out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ideal evidence for a sequence of half bits (`sps` samples each): +10 for the present
    /// tone, -10 for the absent one, with a one-bit matched filter's triangular transitions.
    fn soft_stream(levels: &[bool], sps: f64) -> Vec<Soft> {
        let total = (levels.len() as f64 * sps) as usize;
        let mut raw = vec![0.0f64; total];
        for (i, r) in raw.iter_mut().enumerate() {
            let bit = ((i as f64) / sps) as usize;
            *r = if levels[bit.min(levels.len() - 1)] {
                1.0
            } else {
                -1.0
            };
        }
        let l = (2.0 * sps).round() as usize;
        (0..total)
            .map(|i| {
                let lo = (i + 1).saturating_sub(l);
                let mean = raw[lo..=i].iter().sum::<f64>() / l as f64;
                let v = (10.0 * mean) as f32;
                Soft {
                    mark: v,
                    space: -v,
                    power: 1.0,
                }
            })
            .collect()
    }

    fn frame_bits(codes: &[u8], stop: f64, gap_bits: usize, out: &mut Vec<bool>) {
        for &c in codes {
            out.extend([false, false]);
            for k in 0..5 {
                let b = (c >> k) & 1 == 1;
                out.extend([b, b]);
            }
            // Stop bits on a half-bit grid: 1.5 stop bits become 3 half bits.
            for _ in 0..((stop * 2.0) as usize) {
                out.push(true);
            }
            out.extend(std::iter::repeat_n(true, gap_bits * 2));
        }
    }

    fn run(framer: &mut AnyFramer, levels: &[bool], sps: f64) -> Vec<u8> {
        let mut frames = Vec::new();
        for s in soft_stream(levels, sps) {
            framer.push(s, &mut frames);
        }
        framer.flush(&mut frames);
        frames
            .iter()
            .filter(|f| !f.framing_error)
            .map(|f| f.code)
            .collect()
    }

    #[test]
    fn both_framers_read_back_to_back_and_spaced_characters() {
        let codes = [0x1F, 0x0A, 0x15, 0x0A, 0x15, 0x00, 0x04, 0x1B, 0x10, 0x01];
        let sps = 8.25; // half-bit grid at 16.5 samples per bit
        for stop in [1.0, 1.5, 2.0] {
            for gap in [0, 3] {
                let mut half = vec![true; 8];
                frame_bits(&codes, stop, gap, &mut half);
                half.extend(std::iter::repeat_n(true, 40));
                let mut v = AnyFramer::Viterbi(Box::new(Viterbi::new(2.0 * sps, 1.0, 2.0)));
                assert_eq!(run(&mut v, &half, sps), codes, "viterbi stop {stop} gap {gap}");
                let mut u = AnyFramer::Uart(Uart::new(2.0 * sps));
                assert_eq!(run(&mut u, &half, sps), codes, "uart stop {stop} gap {gap}");
            }
        }
    }
}
