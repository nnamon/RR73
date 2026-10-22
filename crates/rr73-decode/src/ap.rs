//! A priori (AP) decoding: candidates that fail to decode are tried again with the bits a QSO
//! under way lets the decoder expect.
//!
//! The context names the operator's callsign and, during a QSO, the other station's callsign
//! and audio frequency. The hypotheses come from template messages, so the bit layout of each
//! message type stays in the message codec:
//!
//! - `my`: the first callsign field is the operator's (`9V1NE K1ABC FN42`, any second station).
//! - `my_dx`: both callsigns, any report or grid (`9V1NE K1ABC R-12`).
//! - `rrr`, `rr73`, `73`: the whole message (`9V1NE K1ABC RR73`).
//!
//! A partial hypothesis (`my`, `my_dx`) sets the log-likelihood ratios of its known bits to a
//! large value of the right sign and runs the LDPC decoder again; the codeword must still pass
//! the CRC. A whole message fixes all 174 code bits, so it is tested without the LDPC decoder:
//! the channel's hard decisions must agree with its codeword on all but a few bits. Both kinds
//! are accepted only when the channel's hard decisions disagree with the codeword on at most
//! a configured number of bits (`ap.*_max_hard_errors`), which bounds false decodes on noise.
//! `my` is tried on every candidate in the band, so its limit is the tightest.
//! The QSO hypotheses apply to candidates near the other station's frequency only.

use rr73_ft8::message::{self, Message};
use rr73_ft8::{Callsign, CallsignHashes, Mode, tones};

use crate::config::ApParams;
use crate::layout::CODEWORD_BITS;
use crate::ldpc::{LdpcDecoder, LdpcOutcome, LdpcScratch, ParityGraph, SumProduct};
use crate::validate::{Validated, Validator};

/// What a QSO under way lets the decoder expect.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ApContext {
    /// The operator's callsign, as sent: 9V1NE.
    pub my_call: String,
    /// The other station in the QSO under way, if any: K1ABC.
    pub dx_call: Option<String>,
    /// The other station's audio frequency (tone 0), in Hz, if known.
    pub dx_hz: Option<f32>,
}

/// The kind of knowledge an AP decode used, for reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApKind {
    /// The operator's callsign first.
    My,
    /// Both callsigns.
    MyDx,
    /// `MY DX RRR`.
    Rrr,
    /// `MY DX RR73`.
    Rr73,
    /// `MY DX 73`.
    SeventyThree,
    /// `CQ` as the first word, without a QSO context.
    Cq,
}

/// One hypothesis: the code bits it fixes, and whether it needs the station's frequency.
#[derive(Clone, Debug)]
pub struct Hypothesis {
    /// What the hypothesis knows.
    pub kind: ApKind,
    /// Code bits known, with their value: (index, 0 or 1).
    pub bits: Vec<(usize, u8)>,
    /// `true` for the whole message: every code bit is known and no LDPC decode is needed.
    pub whole: bool,
    /// `true` for the QSO hypotheses, tried only near the other station's frequency.
    pub near_dx: bool,
}

/// The codeword of a template message, or `None` when it does not pack.
fn codeword(mode: Mode, text: &str) -> Option<[u8; CODEWORD_BITS]> {
    let msg = Message::parse(text).ok()?;
    let payload = message::pack(&msg, &mut CallsignHashes::new()).ok()?;
    Some(tones::codeword(mode, &payload))
}

fn standard(call: &str) -> bool {
    Callsign::new(call).is_ok_and(|c| c.is_standard())
}

/// Bits `indices` of `cw`, with their values.
fn bits_of(cw: &[u8; CODEWORD_BITS], indices: impl Iterator<Item = usize>) -> Vec<(usize, u8)> {
    indices.map(|i| (i, cw[i])).collect()
}

/// The hypotheses for `ctx` in `mode`: none when the operator's callsign is not a standard
/// one, and only `my` without a standard callsign for the other station.
pub fn hypotheses(mode: Mode, ctx: &ApContext) -> Vec<Hypothesis> {
    let my = ctx.my_call.trim().to_uppercase();
    if !standard(&my) {
        return Vec::new();
    }
    let mut out = Vec::new();
    // Message type 1 (or 2 with a /P call): the first callsign and its flag are bits 0 to 28,
    // the second and its flag 29 to 57, the message type 74 to 76.
    if let Some(cw) = codeword(mode, &format!("{my} K1ABC FN42")) {
        out.push(Hypothesis {
            kind: ApKind::My,
            bits: bits_of(&cw, 0..29),
            whole: false,
            near_dx: false,
        });
    }
    let Some(dx) = ctx
        .dx_call
        .as_deref()
        .map(|d| d.trim().to_uppercase())
        .filter(|d| standard(d))
    else {
        return out;
    };
    if let Some(cw) = codeword(mode, &format!("{my} {dx} FN42")) {
        out.push(Hypothesis {
            kind: ApKind::MyDx,
            bits: bits_of(&cw, (0..58).chain(74..77)),
            whole: false,
            near_dx: true,
        });
    }
    for (kind, end) in [
        (ApKind::Rrr, "RRR"),
        (ApKind::Rr73, "RR73"),
        (ApKind::SeventyThree, "73"),
    ] {
        if let Some(cw) = codeword(mode, &format!("{my} {dx} {end}")) {
            out.push(Hypothesis {
                kind,
                bits: bits_of(&cw, 0..CODEWORD_BITS),
                whole: true,
                near_dx: true,
            });
        }
    }
    out
}

/// `CQ` as the first word of a message of type 1: the first callsign field and its flag (bits
/// 0 to 28) and the message type (74 to 76), as `jt9` tries without a QSO context.
pub fn cq_hypothesis(mode: Mode) -> Option<Hypothesis> {
    let cw = codeword(mode, "CQ K1ABC FN42")?;
    Some(Hypothesis {
        kind: ApKind::Cq,
        bits: bits_of(&cw, (0..29).chain(74..77)),
        whole: false,
        near_dx: false,
    })
}

/// Code bits where the channel's hard decision (`llr` > 0 reads as 1) differs from `codeword`.
pub fn hard_errors(llr: &[f32; CODEWORD_BITS], codeword: &[u8; CODEWORD_BITS]) -> u32 {
    llr.iter()
        .zip(codeword.iter())
        .filter(|&(&l, &c)| u8::from(l > 0.0) != (c & 1))
        .count() as u32
}

/// Copies `llr` into `out` with the hypothesis' known bits set to `strength` of the right sign.
pub fn apply(h: &Hypothesis, llr: &[f32; CODEWORD_BITS], strength: f32, out: &mut [f32; CODEWORD_BITS]) {
    *out = *llr;
    for &(i, b) in &h.bits {
        out[i] = if b == 1 { strength } else { -strength };
    }
}

/// Tries `hyps` on a candidate whose channel LLRs are `llr`, whole messages first, then both
/// callsigns, then the operator's callsign. `near` is `true` when the candidate lies within
/// `params.width_hz` of the other station. Returns the first decode the limits accept, with
/// its LDPC outcome (hard errors counted against the channel) and the hypothesis' kind.
#[allow(clippy::too_many_arguments)]
pub(crate) fn try_hypotheses(
    hyps: &[Hypothesis],
    params: &ApParams,
    near: bool,
    llr: &[f32; CODEWORD_BITS],
    ap_llr: &mut [f32; CODEWORD_BITS],
    codeword: &mut [u8; CODEWORD_BITS],
    graph: &ParityGraph,
    ldpc: &dyn LdpcDecoder,
    bp_iterations: u32,
    scratch: &mut LdpcScratch,
    validator: &dyn Validator,
    mode: Mode,
    hashes: &mut CallsignHashes,
    attempts: &mut u32,
) -> Option<(Validated, LdpcOutcome, ApKind)> {
    let applies = |h: &Hypothesis| {
        if h.kind == ApKind::Cq {
            params.cq
        } else if h.near_dx {
            near
        } else {
            near || params.my_anywhere
        }
    };
    // The whole messages differ in a few bits only (RRR, RR73, 73): the one the channel
    // agrees with most wins, if it is within the limit.
    let mut best: Option<(u32, &Hypothesis)> = None;
    for h in hyps.iter().filter(|h| h.whole && applies(h)) {
        for &(i, b) in &h.bits {
            codeword[i] = b;
        }
        let errors = hard_errors(llr, codeword);
        if errors <= params.whole_max_hard_errors && best.is_none_or(|(e, _)| errors < e) {
            best = Some((errors, h));
        }
    }
    if let Some((errors, h)) = best {
        for &(i, b) in &h.bits {
            codeword[i] = b;
        }
        let outcome = LdpcOutcome {
            converged: true,
            iterations: 0,
            unsatisfied: 0,
            hard_errors: errors,
            osd: false,
            distance: 0.0,
        };
        if let Ok(v) = validator.validate(mode, codeword, &outcome, hashes) {
            return Some((v, outcome, h.kind));
        }
    }
    for h in hyps.iter().rev().filter(|h| !h.whole && applies(h)) {
        apply(h, llr, params.strength, ap_llr);
        *attempts += 1;
        let bp_only = (h.kind == ApKind::My && !near && params.my_anywhere_bp_only)
            || (h.kind == ApKind::Cq && params.cq_bp_only);
        let mut outcome = if bp_only {
            SumProduct {
                max_iterations: bp_iterations,
            }
            .decode(graph, ap_llr, scratch, codeword)
        } else {
            ldpc.decode(graph, ap_llr, scratch, codeword)
        };
        if !outcome.converged || h.bits.iter().any(|&(i, b)| codeword[i] != b) {
            continue;
        }
        let errors = hard_errors(llr, codeword);
        let limit = match h.kind {
            ApKind::My => params.my_max_hard_errors,
            ApKind::Cq => params.cq_max_hard_errors,
            _ => params.my_dx_max_hard_errors,
        };
        if errors > limit {
            continue;
        }
        outcome.hard_errors = errors;
        // A CQ decode knows no callsign, so its message is held to the OSD rule.
        let checked = LdpcOutcome {
            osd: outcome.osd || h.kind == ApKind::Cq,
            ..outcome
        };
        if let Ok(v) = validator.validate(mode, codeword, &checked, hashes) {
            return Some((v, outcome, h.kind));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(my: &str, dx: Option<&str>) -> ApContext {
        ApContext {
            my_call: my.into(),
            dx_call: dx.map(Into::into),
            dx_hz: Some(1500.0),
        }
    }

    #[test]
    fn builds_the_hypotheses_a_qso_allows() {
        let kinds = |c: &ApContext| {
            hypotheses(Mode::Ft8, c)
                .iter()
                .map(|h| h.kind)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            kinds(&ctx("9V1NE", Some("K1ABC"))),
            vec![
                ApKind::My,
                ApKind::MyDx,
                ApKind::Rrr,
                ApKind::Rr73,
                ApKind::SeventyThree
            ]
        );
        assert_eq!(kinds(&ctx("9v1ne", None)), vec![ApKind::My]);
        // A compound callsign travels hashed in other message types: no hypotheses.
        assert!(kinds(&ctx("VK3/9V1NE", Some("K1ABC"))).is_empty());
        assert_eq!(kinds(&ctx("9V1NE", Some("VK3/K1ABC"))), vec![ApKind::My]);
    }

    #[test]
    fn fixes_the_bits_each_message_carries() {
        let hs = hypotheses(Mode::Ft8, &ctx("9V1NE", Some("K1ABC")));
        let sent = codeword(Mode::Ft8, "9V1NE K1ABC R-12").expect("packs");
        // The partial hypotheses agree with any message between the two stations.
        for h in &hs[..2] {
            assert!(h.bits.iter().all(|&(i, b)| sent[i] == b), "{:?}", h.kind);
        }
        assert_eq!(hs[0].bits.len(), 29);
        assert_eq!(hs[1].bits.len(), 61);
        // The whole RR73 message is its codeword.
        let rr73 = codeword(Mode::Ft8, "9V1NE K1ABC RR73").expect("packs");
        assert!(hs[3].bits.iter().all(|&(i, b)| rr73[i] == b) && hs[3].bits.len() == CODEWORD_BITS);
        // Another station's message to someone else disagrees with `my`.
        let other = codeword(Mode::Ft8, "JA1KXM K1ABC R-12").expect("packs");
        assert!(hs[0].bits.iter().any(|&(i, b)| other[i] != b));
    }

    #[test]
    fn counts_hard_errors_and_sets_known_bits() {
        let cw = codeword(Mode::Ft4, "9V1NE K1ABC RRR").expect("packs");
        let mut llr = [0.0f32; CODEWORD_BITS];
        for (l, &c) in llr.iter_mut().zip(cw.iter()) {
            *l = if c == 1 { 1.0 } else { -1.0 };
        }
        assert_eq!(hard_errors(&llr, &cw), 0);
        llr[3] = -llr[3];
        llr[100] = -llr[100];
        assert_eq!(hard_errors(&llr, &cw), 2);
        let h = &hypotheses(Mode::Ft4, &ctx("9V1NE", Some("K1ABC")))[0];
        let mut out = [0.0f32; CODEWORD_BITS];
        apply(h, &llr, 30.0, &mut out);
        assert_eq!(out[3].abs(), 30.0);
        assert_eq!(out[3] > 0.0, cw[3] == 1);
        assert_eq!(out[100], llr[100]);
    }
}
