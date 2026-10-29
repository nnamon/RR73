//! `rr73-bench loop-fixture`: the audio the end-to-end decode test plays as Chromium's fake
//! microphone, and the check that it decodes whatever sample playback starts at.
//!
//! Chromium loops the file from the moment capture starts, so the offset between the loop
//! and the UTC slots is arbitrary. The loop holds 4 messages, each sent [`COPIES`] times,
//! [`COPY_SPACING_S`] apart in time and [`COPY_STEP_HZ`] apart in frequency, rendered with
//! `rr73_chansim::render_loop` so a transmission that runs past the end of the file
//! continues at its start. Copies of a message start every 3.75 s, so whatever the offset,
//! one has a DT between -1.62 and 2.5 s: its 58 data symbols lie inside the slot (only the
//! first or last Costas array, 1.12 s, may be cut) and every preset searches that DT.
//!
//! The check decodes the file as a slot starting at every offset, `step` apart, and passes
//! when every offset gives each message from at least one copy, with frequency within
//! [`FREQ_LIMIT_HZ`] and SNR within [`SNR_LIMIT_DB`] of that copy (the end-to-end test's
//! limits), and no false decodes.

use std::path::Path;

use rayon::prelude::*;
use rr73_chansim::{Noise, Scene, SimSignal, render_loop};
use rr73_corpus::{
    Entry, SlotFiles, SlotMeta, SlotMode, Source, SourceKind, Timing, TimingReference, Tolerance,
    normalise_text, read_slot, write_slot,
};
use rr73_decode::{Decode, DecodeContext, DecoderConfig, SlotAudio, decode};
use rr73_ft8::{CallsignHashes, Mode};

/// The messages: text, base-tone frequency of the first copy (Hz), DT of the first copy (s)
/// and SNR (dB). The second is addressed to 9V1NE, the callsign the end-to-end test sets.
pub const MESSAGES: [(&str, f64, f64, f64); 4] = [
    ("CQ 9M2TRX OJ02", 1022.0, 0.1, -10.0),
    ("9V1NE JA1KXM PM95", 1418.0, 0.2, -12.0),
    ("CQ VK3QRP QF22", 1846.0, 0.0, -14.0),
    ("JH1RRT YB0AZK RR73", 2210.0, 0.1, -16.0),
];

/// Copies of each message in the loop.
pub const COPIES: usize = 4;

/// Time between the starts of consecutive copies of a message, in seconds: a quarter of the
/// 15 s loop.
pub const COPY_SPACING_S: f64 = 3.75;

/// Frequency step between consecutive copies of a message, in Hz. An FT8 signal is 50 Hz
/// wide, so neighbouring copies keep a 40 Hz gap.
pub const COPY_STEP_HZ: f64 = 90.0;

/// Seed of the noise.
pub const SEED: u64 = 2026;

/// Largest frequency error of a decode that counts as a copy, in Hz.
pub const FREQ_LIMIT_HZ: f64 = 3.0;

/// Largest SNR error of a decode that counts as a copy, in dB.
pub const SNR_LIMIT_DB: f64 = 4.0;

/// Length of the loop, in seconds: one FT8 slot.
pub const LOOP_S: f64 = 15.0;

/// The scene: each message's copies in turn, copy `k` delayed by `k` × [`COPY_SPACING_S`]
/// and raised by `k` × [`COPY_STEP_HZ`], in white noise.
pub fn scene() -> Scene {
    let signals = MESSAGES
        .iter()
        .flat_map(|&(text, freq_hz, dt_s, snr_db)| {
            (0..COPIES).map(move |k| {
                SimSignal::new(
                    text,
                    freq_hz + COPY_STEP_HZ * k as f64,
                    dt_s + COPY_SPACING_S * k as f64,
                    snr_db,
                )
            })
        })
        .collect();
    Scene {
        mode: Mode::Ft8,
        signals,
        noise: Noise::Awgn,
    }
}

/// Renders the loop and writes `<out>.wav` and `<out>.json`. The sidecar's truth lists
/// every copy, with DT measured from the nominal start of the file.
pub fn write(out: &Path) -> Result<SlotFiles, String> {
    let scene = scene();
    let (samples, truth) = render_loop(&scene, SEED).map_err(|e| e.to_string())?;
    let mut meta = SlotMeta::new(
        SlotMode::Ft8,
        Source::new(SourceKind::Synthetic)
            .with(
                "generator",
                format!("rr73-bench {} loop-fixture", env!("CARGO_PKG_VERSION")),
            )
            .with("loop", true)
            .with("copies", COPIES)
            .with("copy_spacing_s", COPY_SPACING_S)
            .with("copy_step_hz", COPY_STEP_HZ)
            .with("seed", SEED)
            .with("noise", "awgn")
            .with(
                "signals",
                serde_json::to_value(&scene.signals).map_err(|e| e.to_string())?,
            ),
    );
    meta.start_utc = Some("2026-01-01T00:00:00Z".into());
    meta.timing = Some(Timing {
        reference: TimingReference::Synthetic,
        offset_s: 0.0,
    });
    meta.truth = Some(
        truth
            .into_iter()
            .map(|t| Entry {
                text: t.text,
                freq_hz: t.freq_hz,
                dt_s: t.dt_s,
                snr_db: t.snr_db,
            })
            .collect(),
    );
    let dir = out.parent().unwrap_or(Path::new("."));
    let stem = out
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("{}: not a file path", out.display()))?;
    write_slot(dir, stem, &samples, &meta).map_err(|e| e.to_string())
}

/// What decoding the loop from one start offset gave.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct OffsetResult {
    /// Start offset into the loop, in seconds.
    pub offset_s: f64,
    /// For each truth entry, the decode that matched it within the limits, as
    /// (frequency error in Hz, SNR error in dB).
    pub copies: Vec<Option<(f64, f64)>>,
    /// Decodes that match a copy's text, frequency (10 Hz) and DT (0.5 s) but miss the
    /// frequency or SNR limit: (text, frequency error in Hz, SNR error in dB).
    pub outside_limits: Vec<(String, f64, f64)>,
    /// Decodes that match no copy: (text, frequency in Hz, DT in s).
    pub false_decodes: Vec<(String, f64, f64)>,
}

/// Distance between a decoded DT and a copy's DT, both in seconds, with the copy's DT taken
/// modulo the loop length.
pub fn loop_dt_error(copy_dt_s: f64, decoded_dt_s: f64) -> f64 {
    let d = (decoded_dt_s - copy_dt_s).rem_euclid(LOOP_S);
    d.min(LOOP_S - d)
}

/// Scores the decodes of the loop started `offset_s` into the file against its truth. A
/// copy at DT `d` in the file sits at DT `d - offset_s`, modulo the loop, in that slot.
pub fn score(offset_s: f64, decodes: &[Decode], truth: &[Entry]) -> OffsetResult {
    let tol = Tolerance::default();
    let mut result = OffsetResult {
        offset_s,
        copies: vec![None; truth.len()],
        ..OffsetResult::default()
    };
    for d in decodes {
        let text = normalise_text(&d.text);
        let freq = f64::from(d.freq_hz);
        let dt = f64::from(d.dt_s);
        let nearest = truth
            .iter()
            .enumerate()
            .filter(|(_, e)| normalise_text(&e.text) == text)
            .map(|(i, e)| (i, (freq - e.freq_hz).abs(), loop_dt_error(e.dt_s - offset_s, dt)))
            .filter(|&(_, df, ddt)| df <= tol.freq_hz && ddt <= tol.dt_s)
            .min_by(|a, b| a.1.total_cmp(&b.1));
        match nearest {
            None => result.false_decodes.push((d.text.clone(), freq, dt)),
            Some((i, df, _)) => {
                let dsnr = (f64::from(d.snr_db) - truth[i].snr_db).abs();
                if df <= FREQ_LIMIT_HZ && dsnr <= SNR_LIMIT_DB {
                    result.copies[i] = Some((df, dsnr));
                } else {
                    result.outside_limits.push((d.text.clone(), df, dsnr));
                }
            }
        }
    }
    result
}

/// Decodes the loop started at every multiple of `step` samples (12 kHz) with `config`.
pub fn decode_offsets(
    samples: &[f32],
    truth: &[Entry],
    config: &DecoderConfig,
    step: usize,
) -> Vec<OffsetResult> {
    let offsets: Vec<usize> = (0..samples.len()).step_by(step.max(1)).collect();
    offsets
        .par_iter()
        .map_init(DecodeContext::new, |ctx, &start| {
            let mut slot = Vec::with_capacity(samples.len());
            slot.extend_from_slice(&samples[start..]);
            slot.extend_from_slice(&samples[..start]);
            ctx.hashes = CallsignHashes::new();
            let report = decode(&SlotAudio::new(&slot, Mode::Ft8), config, ctx);
            score(start as f64 / 12_000.0, &report.decodes, truth)
        })
        .collect()
}

/// The check's summary for one preset.
#[derive(Clone, Debug, PartialEq)]
pub struct Summary {
    /// Offsets decoded.
    pub offsets: usize,
    /// Per distinct message text, in truth order: (text, offsets with at least one copy
    /// within the limits, offsets per copy index that copy was the one decoded).
    pub messages: Vec<(String, usize, Vec<usize>)>,
    /// Largest frequency error of a counted copy, in Hz.
    pub worst_freq_hz: f64,
    /// Largest SNR error of a counted copy, in dB.
    pub worst_snr_db: f64,
    /// Decodes of a copy outside the limits, over all offsets.
    pub outside_limits: usize,
    /// False decodes over all offsets.
    pub false_decodes: usize,
    /// Offsets, in seconds, where a message had no copy within the limits.
    pub missed_at_s: Vec<f64>,
}

impl Summary {
    /// `true` when every offset gave every message and nothing false.
    pub fn pass(&self) -> bool {
        self.offsets > 0
            && self.false_decodes == 0
            && self.missed_at_s.is_empty()
            && self.messages.iter().all(|(_, n, _)| *n == self.offsets)
    }
}

/// Summarises per-offset results against `truth`.
pub fn summarise(results: &[OffsetResult], truth: &[Entry]) -> Summary {
    let mut texts: Vec<String> = Vec::new();
    for e in truth {
        let t = normalise_text(&e.text);
        if !texts.contains(&t) {
            texts.push(t);
        }
    }
    let copies_of = |t: &str| -> Vec<usize> {
        truth
            .iter()
            .enumerate()
            .filter(|(_, e)| normalise_text(&e.text) == t)
            .map(|(i, _)| i)
            .collect()
    };
    let mut summary = Summary {
        offsets: results.len(),
        messages: Vec::new(),
        worst_freq_hz: 0.0,
        worst_snr_db: 0.0,
        outside_limits: results.iter().map(|r| r.outside_limits.len()).sum(),
        false_decodes: results.iter().map(|r| r.false_decodes.len()).sum(),
        missed_at_s: Vec::new(),
    };
    for t in &texts {
        let idx = copies_of(t);
        let mut found = 0;
        let mut per_copy = vec![0; idx.len()];
        for r in results {
            let mut any = false;
            for (k, &i) in idx.iter().enumerate() {
                if let Some((df, dsnr)) = r.copies[i] {
                    any = true;
                    per_copy[k] += 1;
                    summary.worst_freq_hz = summary.worst_freq_hz.max(df);
                    summary.worst_snr_db = summary.worst_snr_db.max(dsnr);
                }
            }
            if any {
                found += 1;
            } else if !summary.missed_at_s.contains(&r.offset_s) {
                summary.missed_at_s.push(r.offset_s);
            }
        }
        summary.messages.push((t.clone(), found, per_copy));
    }
    summary.missed_at_s.sort_by(f64::total_cmp);
    summary
}

/// Reads `<out>.wav` and `<out>.json`, decodes every start offset `step_s` apart with each
/// preset and returns the report text and whether every preset passed.
pub fn check(out: &Path, presets: &[String], step_s: f64) -> Result<(String, bool), String> {
    if !(step_s.is_finite() && step_s > 0.0) {
        return Err(format!("step {step_s} s must be positive"));
    }
    let slot = read_slot(&SlotFiles::from_path(out)).map_err(|e| e.to_string())?;
    let truth = slot
        .meta
        .truth
        .as_deref()
        .filter(|t| !t.is_empty())
        .ok_or_else(|| format!("{}: the sidecar has no truth", out.display()))?;
    let step = ((step_s * 12_000.0).round() as usize).max(1);
    let mut text = String::new();
    let mut pass = true;
    for preset in presets {
        let config = DecoderConfig::preset(preset).map_err(|e| e.to_string())?;
        let started = std::time::Instant::now();
        let results = decode_offsets(&slot.samples, truth, &config, step);
        let s = summarise(&results, truth);
        text.push_str(&format!(
            "{preset}: {} start offsets {:.3} s apart, decoded in {:.1} s\n",
            s.offsets,
            step as f64 / 12_000.0,
            started.elapsed().as_secs_f64()
        ));
        text.push_str(&format!(
            "  {:<22} {:>9}  {}\n",
            "message", "offsets", "offsets per copy"
        ));
        for (t, found, per_copy) in &s.messages {
            let copies: Vec<String> = per_copy.iter().map(|n| n.to_string()).collect();
            text.push_str(&format!(
                "  {:<22} {:>9}  {}\n",
                t,
                format!("{found}/{}", s.offsets),
                copies.join(" ")
            ));
        }
        text.push_str(&format!(
            "  worst frequency error {:.2} Hz, worst SNR error {:.2} dB, copies outside the limits {}, false decodes {}\n",
            s.worst_freq_hz, s.worst_snr_db, s.outside_limits, s.false_decodes
        ));
        if !s.missed_at_s.is_empty() {
            let at: Vec<String> = s.missed_at_s.iter().map(|o| format!("{o:.3}")).collect();
            text.push_str(&format!(
                "  a message was missed at offsets (s): {}\n",
                at.join(" ")
            ));
        }
        for r in results.iter().filter(|r| !r.false_decodes.is_empty()) {
            for (t, f, dt) in &r.false_decodes {
                text.push_str(&format!(
                    "  false decode at offset {:.3} s: {t} at {f:.1} Hz, DT {dt:.2} s\n",
                    r.offset_s
                ));
            }
        }
        text.push_str(if s.pass() { "  pass\n" } else { "  FAIL\n" });
        pass &= s.pass();
    }
    Ok((text, pass))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(text: &str, freq_hz: f64, dt_s: f64, snr_db: f64) -> Entry {
        Entry {
            text: text.into(),
            freq_hz,
            dt_s,
            snr_db,
        }
    }

    /// DT range, in seconds, in which an FT8 transmission keeps all 58 data symbols inside
    /// the slot and `config` searches for it: the first or last Costas array (7 symbols,
    /// 1.12 s) may be cut.
    fn decodable_dt(config: &DecoderConfig) -> (f64, f64) {
        let costas_s: f64 = 7.0 * 0.16;
        let whole_s = 79.0 * 0.16;
        let earliest = (-0.5 - costas_s).max(f64::from(config.search.ft8_dt_min_s));
        let latest = (LOOP_S - whole_s - 0.5 + costas_s).min(f64::from(config.search.ft8_dt_max_s));
        (earliest, latest)
    }

    fn decoded(text: &str, freq_hz: f32, dt_s: f32, snr_db: f32) -> Decode {
        Decode {
            text: text.into(),
            message: rr73_decode::DecodedMessage::Ft8(rr73_ft8::Message::parse(text).expect("message")),
            payload: rr73_ft8::Payload([0; 10]),
            freq_hz,
            dt_s,
            snr_db,
            pass: 1,
            ldpc_iterations: 0,
            hard_errors: 0,
            score: 0.0,
            osd: false,
            osd_distance: 0.0,
            ap: None,
            block: None,
        }
    }

    #[test]
    fn copies_never_share_spectrum_and_stay_in_the_passband() {
        let scene = scene();
        assert_eq!(scene.signals.len(), MESSAGES.len() * COPIES);
        let mut f: Vec<f64> = scene.signals.iter().map(|s| s.freq_hz).collect();
        f.sort_by(f64::total_cmp);
        // 8 tones 6.25 Hz apart: 50 Hz per signal, plus a 10 Hz guard.
        assert!(f.windows(2).all(|w| w[1] - w[0] >= 60.0), "{f:?}");
        assert!(f[0] >= 200.0 && f[f.len() - 1] + 50.0 <= 3000.0, "{f:?}");
    }

    #[test]
    fn every_offset_puts_a_copy_of_each_message_in_the_decodable_window() {
        let windows: Vec<(f64, f64)> = rr73_decode::PRESETS
            .iter()
            .map(|p| decodable_dt(&DecoderConfig::preset(p).expect("preset")))
            .collect();
        // A search past DT 2.5 s (the shipped preset) widens the window; the check below uses
        // the narrowest, the baseline's.
        for &(lo, hi) in &windows {
            assert!((lo - -1.62).abs() < 1e-6 && hi >= 2.5 - 1e-6, "{lo} {hi}");
        }
        let (lo, hi) = windows[0];
        let scene = scene();
        // Every 10 ms over the loop.
        for step in 0..1500 {
            let offset = step as f64 * 0.01;
            for (text, ..) in MESSAGES {
                let ok = scene.signals.iter().filter(|s| s.message == text).any(|s| {
                    let dt = (s.dt_s - offset - lo).rem_euclid(LOOP_S) + lo;
                    dt <= hi
                });
                assert!(ok, "{text} at offset {offset} s");
            }
        }
    }

    #[test]
    fn scoring_wraps_dt_and_separates_copies_misses_and_false_decodes() {
        let truth = [
            entry("CQ K1ABC FN42", 1000.0, 0.1, -10.0),
            entry("CQ K1ABC FN42", 1090.0, 3.85, -10.0),
            entry("CQ K1ABC FN42", 1180.0, 7.6, -10.0),
            entry("CQ K1ABC FN42", 1270.0, 11.35, -10.0),
        ];
        // Started 10 s in: the copy at 11.35 s sits at DT 1.35 s, the one at 0.1 s at
        // 5.1 s (outside the search), the one at 7.6 s at -2.4 s.
        let r = score(
            10.0,
            &[
                decoded("CQ K1ABC FN42", 1271.0, 1.3, -11.5),
                decoded("CQ K1ABC FN42", 1180.5, -2.4, -16.0),
                decoded("CQ K1ABC FN42", 1000.0, 0.1, -10.0),
                decoded("CQ W9XYZ EN37", 1500.0, 0.0, -10.0),
            ],
            &truth,
        );
        assert_eq!(r.copies[3], Some((1.0, 1.5)));
        assert_eq!(r.copies[2], None);
        assert_eq!(r.outside_limits, vec![("CQ K1ABC FN42".to_string(), 0.5, 6.0)]);
        // Right text and frequency at the wrong DT, and an unknown message.
        assert_eq!(r.false_decodes.len(), 2);
        assert!((loop_dt_error(14.9, -0.05) - 0.05).abs() < 1e-9);
        assert!((loop_dt_error(-0.2, 0.3) - 0.5).abs() < 1e-9);

        let s = summarise(&[r], &truth);
        assert_eq!(
            s.messages,
            vec![("CQ K1ABC FN42".to_string(), 1, vec![0, 0, 0, 1])]
        );
        assert_eq!((s.false_decodes, s.outside_limits), (2, 1));
        assert!(!s.pass());
        let clean = score(10.0, &[decoded("CQ K1ABC FN42", 1270.0, 1.35, -10.0)], &truth);
        assert!(summarise(&[clean], &truth).pass());
        let missed = score(10.0, &[], &truth);
        assert_eq!(summarise(&[missed], &truth).missed_at_s, vec![10.0]);
    }
}
