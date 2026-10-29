//! Operator text to an LQ8 message.
//!
//! Ported from `parse_message()` and `parse_hash_string()` in `src/message.cpp` of lq_lib by
//! Luis Quesada HB9IPH (MIT licence, commit 00f3bcf); the licence is in `LICENSE-lq_lib` next
//! to this crate's manifest. The rules run in the reference's order, and text that matches
//! none is free text.

use super::fields::{
    hash16, hash20, hash24, parse_report, split_any, split_standard, valid_locator, valid_nonstd, with_suffix,
};
use super::{Kind, Message, Target};

/// A bracketed token: `<...>` (hash 0), hexadecimal (`<01a4f2>`) or a callsign
/// (`<AB4SS>`, hashed in 24 bits). Returns the hash and the callsign, empty for the first two.
fn hash_token(token: &str) -> Option<(u32, String)> {
    let inner = token.strip_prefix('<')?.strip_suffix('>')?;
    if token.len() < 3 {
        return None;
    }
    if inner == "..." {
        return Some((0, String::new()));
    }
    let hex = inner
        .strip_prefix("0x")
        .or_else(|| inner.strip_prefix("0X"))
        .unwrap_or(inner);
    if !hex.is_empty() && hex.len() <= 8 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return u32::from_str_radix(hex, 16).ok().map(|v| (v, String::new()));
    }
    Some((hash24(inner), inner.to_string()))
}

/// A target token as a call field and a 24-bit hash.
fn target(token: &str) -> (String, u32) {
    match hash_token(token) {
        Some((h, call)) => (call, h & 0xFF_FFFF),
        None => (token.to_string(), hash24(token)),
    }
}

/// A multi-station target: `(call, 24-bit hash)` from a bracketed or plain token.
fn multi_target(token: &str, report: i32) -> Target {
    let (call, hash) = target(token);
    Target { call, hash, report }
}

/// The 16-bit sender hash of a multi-station message.
fn dx(m: &mut Message, token: &str) {
    match hash_token(token) {
        Some((h, call)) if call.is_empty() => m.hash1 = h & 0xFFFF,
        Some((_, call)) => {
            m.hash1 = hash16(&call);
            m.call1 = call;
        }
        None => {
            m.call1 = token.to_string();
            m.hash1 = hash16(token);
        }
    }
}

/// The 20-bit target of type 7: a callsign hashes in 20 bits, a hexadecimal value keeps its
/// top 20 bits when wider.
fn target20(m: &mut Message, token: &str) {
    match hash_token(token) {
        Some((h, call)) if call.is_empty() => {
            m.hash1 = if h > 0xF_FFFF { (h >> 4) & 0xF_FFFF } else { h };
        }
        Some((_, call)) => {
            m.hash1 = hash20(&call);
            m.call1 = call;
        }
        None => {
            m.call1 = token.to_string();
            m.hash1 = hash20(token);
        }
    }
}

fn is_73(word: &str) -> bool {
    matches!(word, "73" | "RR73" | "RRR")
}

/// 73 to `t` from `c`: type 9, 10 or 12 by the callsigns.
fn seventy3(t: &str, c: &str) -> Message {
    let th = hash_token(t);
    if th.is_none()
        && let (Some((bt, st)), Some((bc, sc))) = (split_standard(t), split_standard(c))
    {
        let mut m = Message::new(Kind::Seventy3Std);
        m.call1 = with_suffix(&bt, st);
        m.portable1 = st;
        m.call2 = with_suffix(&bc, sc);
        m.portable2 = sc;
        return m;
    }
    if let Some((base, suf)) = split_any(c).filter(|(b, _)| b.len() <= 9) {
        let mut m = Message::new(Kind::Seventy3Nonstd);
        (m.call1, m.hash1) = target(t);
        m.call2 = with_suffix(&base, suf);
        m.portable2 = suf;
        return m;
    }
    let mut m = Message::new(Kind::Multi73);
    m.call1 = c.to_string();
    m.hash1 = hash16(c);
    m.targets.push(multi_target(t, 0));
    m
}

/// REPORT+73 to `t` from `c`: type 8 between standard callsigns, else type 11 to one target.
fn report73(t: &str, c: &str, report: i32) -> Message {
    if hash_token(t).is_none()
        && let (Some((bt, st)), Some((bc, sc))) = (split_standard(t), split_standard(c))
    {
        let mut m = Message::new(Kind::Report73);
        m.call1 = with_suffix(&bt, st);
        m.portable1 = st;
        m.call2 = with_suffix(&bc, sc);
        m.portable2 = sc;
        m.report = report;
        return m;
    }
    let mut m = Message::new(Kind::MultiReport73);
    m.call1 = c.to_string();
    m.hash1 = hash16(c);
    m.targets.push(multi_target(t, report));
    m
}

/// A call from `c` to `t` with an optional locator: type 5, 6 or 7 by the callsigns.
fn call(t: &str, c: &str, loc: &str, report: i32) -> Message {
    let th = hash_token(t);
    let clean_c = match hash_token(c) {
        Some((_, call)) if !call.is_empty() => call,
        _ => c.to_string(),
    };
    let target_std = split_standard(t);
    if let Some((bc, sc)) = split_standard(&clean_c) {
        if let Some((bt, false)) = target_std.filter(|_| th.is_none())
            && !sc
            && !loc.is_empty()
        {
            let mut m = Message::new(Kind::CallStd);
            m.call1 = bt;
            m.call2 = bc;
            m.locator = loc.to_string();
            m.report = report;
            return m;
        }
        let mut m = Message::new(Kind::CallStdSuf);
        (m.call1, m.hash1) = target(t);
        m.call2 = with_suffix(&bc, sc);
        m.portable2 = sc;
        m.locator = loc.to_string();
        m.report = report;
        return m;
    }
    let mut m = Message::new(Kind::CallNonstd);
    target20(&mut m, t);
    match split_any(&clean_c) {
        Some((base, suf)) => {
            m.call2 = with_suffix(&base, suf);
            m.portable2 = suf;
        }
        None => m.call2 = clean_c,
    }
    m.report = report;
    m
}

/// The CQ forms; `None` when the words fit none of them.
fn cq(t: &[&str]) -> Option<Message> {
    let std_cq = |modifier: &str, c: &str, loc: &str| -> Option<Message> {
        let (base, suf) = split_standard(c)?;
        let mut m = Message::new(Kind::CqStd);
        m.call1 = with_suffix(&base, suf);
        m.portable1 = suf;
        m.modifier = modifier.to_string();
        m.locator = loc.to_string();
        Some(m)
    };
    let other = |kind: Kind, c: &str, modifier: &str, loc: &str| -> Option<Message> {
        let (base, suf) = split_any(c)?;
        let (kind, max) = if base.len() <= 9 {
            (kind, 9)
        } else {
            (Kind::CqNonstd3, 13)
        };
        if base.len() > max {
            return None;
        }
        let mut m = Message::new(kind);
        m.call1 = with_suffix(&base, suf);
        m.portable1 = suf;
        if kind == Kind::CqNonstd1 {
            m.locator = loc.to_string();
        }
        if kind == Kind::CqNonstd2 {
            m.modifier = modifier.to_string();
        }
        Some(m)
    };
    match t.len() {
        2 => std_cq("", t[1], "").or_else(|| {
            let (base, suf) = split_any(t[1])?;
            let mut m = Message::new(Kind::CqNonstd3);
            m.call1 = with_suffix(&base, suf);
            m.portable1 = suf;
            Some(m)
        }),
        3 if valid_locator(t[2]) => std_cq("", t[1], t[2]).or_else(|| other(Kind::CqNonstd1, t[1], "", t[2])),
        3 => std_cq(t[1], t[2], "").or_else(|| other(Kind::CqNonstd2, t[2], t[1], "")),
        4 => std_cq(t[1], t[2], t[3]).or_else(|| {
            let (base, suf) = split_any(t[2]).filter(|(b, _)| b.len() <= 9)?;
            let mut m = Message::new(Kind::CqNonstd1);
            m.call1 = with_suffix(&base, suf);
            m.portable1 = suf;
            m.locator = t[3].to_string();
            Some(m)
        }),
        _ => None,
    }
}

/// Reads operator text. `None` only for empty text.
pub(crate) fn parse(text: &str) -> Option<Message> {
    let t: Vec<&str> = text.split_whitespace().collect();
    if t.is_empty() {
        return None;
    }

    // "73 TARGET CALLER" and "73 DX TARGET1 TARGET2"; "73 DE ..." is free text.
    if is_73(t[0]) && (3..=4).contains(&t.len()) && t[1] != "DE" && t[1] != "de" {
        if t.len() == 3 {
            return Some(seventy3(t[1], t[2]));
        }
        let mut m = Message::new(Kind::Multi73);
        dx(&mut m, t[1]);
        m.targets = t[2..4].iter().map(|w| multi_target(w, 0)).collect();
        return Some(m);
    }

    if matches!(
        t[0],
        "MULTI-73" | "MULTI_73" | "M73" | "73M" | "MULTI-RR73" | "MULTI_RR73" | "MRR73" | "RR73M"
    ) && (3..=4).contains(&t.len())
    {
        let mut m = Message::new(Kind::Multi73);
        match hash_token(t[1]) {
            Some((h, call)) => {
                m.hash1 = h & 0xFFFF;
                m.call1 = call;
            }
            None => {
                m.call1 = t[1].to_string();
                m.hash1 = hash16(t[1]);
            }
        }
        m.targets = t[2..].iter().take(2).map(|w| multi_target(w, 0)).collect();
        return Some(m);
    }

    if t[0] == "CQ"
        && let Some(m) = cq(&t)
    {
        return Some(m);
    }

    if t[0] == "CALL" && t.len() >= 3 {
        let (loc, rst) = match t.len() {
            4 if parse_report(t[3]).is_some() => ("", t[3]),
            4 if valid_locator(t[3]) => (t[3], ""),
            4 => ("", ""),
            3 => ("", ""),
            _ => (t[3], t[4]),
        };
        return Some(call(t[1], t[2], loc, parse_report(rst).unwrap_or(0)));
    }

    if matches!(
        t[0],
        "REPORT+73" | "REPORT73" | "RPT73" | "REPORT" | "REPLY73" | "REPLY"
    ) && (t.len() == 3 || t.len() == 4)
    {
        let caller = if t.len() == 4 { t[2] } else { "" };
        let rst = parse_report(t[t.len() - 1]).unwrap_or(0);
        return Some(report73(t[1], caller, rst));
    }

    let multi_word = matches!(
        t[0],
        "MULTI-REPORT+73"
            | "MULTI_REPORT73"
            | "MRPT73"
            | "RPT73M"
            | "MULTI-REPORT"
            | "MULTI-REPLY73"
            | "MULTI-REPLY"
            | "MULTI_REPLY73"
            | "MREPLY73"
    ) || (matches!(t[0], "RPT73" | "REPORT+73") && t.len() >= 6);
    if multi_word && (4..=6).contains(&t.len()) && t.len().is_multiple_of(2) {
        let mut m = Message::new(Kind::MultiReport73);
        dx(&mut m, t[1]);
        let mut ok = true;
        for pair in t[2..].chunks(2).take(2) {
            let Some(rst) = parse_report(pair[1]) else {
                ok = false;
                break;
            };
            m.targets.push(multi_target(pair[0], rst));
        }
        if ok && !m.targets.is_empty() {
            return Some(m);
        }
    }

    // "<TARGET1> R+05 <TARGET2> R-03 <DX>"
    if t.len() == 5
        && let (Some(r1), Some(r2)) = (parse_report(t[1]), parse_report(t[3]))
    {
        let mut m = Message::new(Kind::MultiReport73);
        m.targets = vec![multi_target(t[0], r1), multi_target(t[2], r2)];
        dx(&mut m, t[4]);
        return Some(m);
    }

    // "<TARGET1> <TARGET2> <DX> 73"
    if t.len() == 4 && is_73(t[3]) {
        let mut m = Message::new(Kind::Multi73);
        m.targets = vec![multi_target(t[0], 0), multi_target(t[1], 0)];
        dx(&mut m, t[2]);
        return Some(m);
    }

    // "AB4SS 9V1NE OJ11 -03": a call.
    if t.len() == 4
        && valid_locator(t[2])
        && let Some(rst) = parse_report(t[3])
    {
        return Some(call(t[0], t[1], t[2], rst));
    }

    if t.len() == 3 {
        // "<TARGET1> R+05 <DX>": a multi-station report to one target.
        if t[1].starts_with(['R', 'r'])
            && let Some(rst) = parse_report(t[1])
        {
            let mut m = Message::new(Kind::MultiReport73);
            m.targets.push(multi_target(t[0], rst));
            dx(&mut m, t[2]);
            return Some(m);
        }
        let (tg, c, w) = (t[0], t[1], t[2]);
        let th = hash_token(tg);
        let target_valid = split_standard(tg).is_some() || valid_nonstd(tg, 13) || th.is_some();
        let caller_valid = split_standard(c).is_some() || valid_nonstd(c, 13);
        if target_valid && caller_valid {
            if is_73(w) {
                return Some(seventy3(tg, c));
            }
            if valid_locator(w) {
                return Some(call(tg, c, w, 0));
            }
            if let Some(rst) = parse_report(w) {
                // A report without R from a non-standard caller is a call (type 7).
                if split_standard(c).is_none() && !w.starts_with(['R', 'r']) {
                    return Some(call(tg, c, "", rst));
                }
                return Some(report73(tg, c, rst));
            }
        }
    }

    let mut m = Message::new(Kind::FreeText);
    m.text = text.to_string();
    Some(m)
}
