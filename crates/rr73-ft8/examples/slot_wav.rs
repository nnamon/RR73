//! Writes slot WAV files carrying FT8 or FT4 signals built by rr73-ft8, for decoding with
//! WSJT-X's jt9 (see `tools/wsjtx/decodes.sh`).
//!
//! ```text
//! slot_wav ft8|ft4 OUT_DIR < cases.txt > manifest.json
//! ```
//!
//! Each input line is `text <message>` (packed with `Message::parse` and `pack`) or
//! `hex <20 hex digits>` (a raw payload), optionally followed by `  # note`. Blank lines and
//! lines starting with `#` are skipped. Up to 12 signals share one slot, 180 Hz apart from
//! 500 Hz, starting 0.5 s after the slot boundary, at 12 kHz, mono, 16 bits. The manifest
//! lists every signal with its file, frequency, payload and the text rr73-ft8 shows for it
//! with an empty hash table.

use rr73_ft8::message::{Message, pack, unpack};
use rr73_ft8::{CallsignHashes, Mode, Payload, synth, tones};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

const SAMPLE_RATE_HZ: u32 = 12_000;
const SIGNALS_PER_SLOT: usize = 12;
const FIRST_FREQ_HZ: f32 = 500.0;
const SPACING_HZ: f32 = 180.0;
/// Peak amplitude of each signal; 12 signals stay below full scale.
const AMPLITUDE: f32 = 0.06;

struct Case {
    payload: Payload,
    source: String,
    note: String,
}

fn parse_hex(text: &str) -> Result<Payload, String> {
    if text.len() != 20 || !text.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("expected 20 hex digits: {text}"));
    }
    let mut bytes = [0u8; 10];
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = u8::from_str_radix(&text[2 * i..2 * i + 2], 16).map_err(|e| e.to_string())?;
    }
    Ok(Payload(bytes))
}

fn read_cases(input: impl BufRead) -> Result<Vec<Case>, String> {
    let mut cases = Vec::new();
    for line in input.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (body, note) = match line.split_once("  # ") {
            Some((body, note)) => (body.trim(), note.trim().to_string()),
            None => (line, String::new()),
        };
        let payload = if let Some(text) = body.strip_prefix("text ") {
            let message = Message::parse(text).map_err(|e| format!("{text}: {e}"))?;
            pack(&message, &mut CallsignHashes::new()).map_err(|e| format!("{text}: {e}"))?
        } else if let Some(hex) = body.strip_prefix("hex ") {
            parse_hex(hex.trim())?
        } else {
            return Err(format!("expected `text ...` or `hex ...`: {line}"));
        };
        cases.push(Case {
            payload,
            source: body.to_string(),
            note,
        });
    }
    Ok(cases)
}

fn write_wav(path: &Path, samples: &[f32]) -> std::io::Result<()> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&SAMPLE_RATE_HZ.to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE_HZ * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for &s in samples {
        out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32_767.0).round() as i16).to_le_bytes());
    }
    std::fs::write(path, out)
}

fn hex(payload: &Payload) -> String {
    payload.0.iter().map(|b| format!("{b:02x}")).collect()
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let (mode, name) = match args.get(1).map(String::as_str) {
        Some("ft8") => (Mode::Ft8, "ft8"),
        Some("ft4") => (Mode::Ft4, "ft4"),
        _ => return Err("usage: slot_wav ft8|ft4 OUT_DIR < cases.txt > manifest.json".into()),
    };
    let out_dir = PathBuf::from(args.get(2).ok_or("missing OUT_DIR")?);
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let cases = read_cases(std::io::stdin().lock())?;
    let params = mode.params();
    let slot_samples = (params.slot_s * SAMPLE_RATE_HZ as f32) as usize;
    let start = (params.start_offset_s * SAMPLE_RATE_HZ as f32) as usize;
    let empty = CallsignHashes::new();

    let mut manifest = Vec::new();
    for (slot, group) in cases.chunks(SIGNALS_PER_SLOT).enumerate() {
        let file = format!("{name}-{slot:02}.wav");
        let mut samples = vec![0.0f32; slot_samples];
        for (k, case) in group.iter().enumerate() {
            let freq_hz = FIRST_FREQ_HZ + SPACING_HZ * k as f32;
            let wave = synth::gfsk(
                mode,
                &tones::from_payload(mode, &case.payload),
                freq_hz,
                SAMPLE_RATE_HZ,
                AMPLITUDE,
            );
            for (dst, s) in samples[start..].iter_mut().zip(wave) {
                *dst += s;
            }
            let rr73_text = match unpack(&case.payload, &empty) {
                Ok(m) => serde_json::Value::String(m.to_string()),
                Err(e) => serde_json::Value::String(format!("error: {e}")),
            };
            manifest.push(serde_json::json!({
                "wav": file,
                "mode": name,
                "freq_hz": freq_hz,
                "source": case.source,
                "note": case.note,
                "payload": hex(&case.payload),
                "rr73_text": rr73_text,
            }));
        }
        write_wav(&out_dir.join(&file), &samples).map_err(|e| format!("{file}: {e}"))?;
    }
    let text = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    writeln!(std::io::stdout(), "{text}").map_err(|e| e.to_string())
}

fn main() {
    if let Err(e) = run() {
        eprintln!("slot_wav: {e}");
        std::process::exit(1);
    }
}
