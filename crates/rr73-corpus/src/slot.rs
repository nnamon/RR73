//! Slot files on disk: discovery, reading and writing WAV and sidecar pairs.

use std::fs;
use std::path::{Path, PathBuf};

use crate::sidecar::{FORMAT, SlotMeta};
use crate::{CorpusError, SAMPLE_RATE, wav};

/// The two files of one slot.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SlotFiles {
    /// Sidecar path (`<stem>.json`).
    pub json: PathBuf,
    /// Audio path (`<stem>.wav`).
    pub wav: PathBuf,
}

impl SlotFiles {
    /// The pair for a path to either file (or to the stem without an extension).
    pub fn from_path(path: &Path) -> Self {
        Self {
            json: path.with_extension("json"),
            wav: path.with_extension("wav"),
        }
    }

    /// The file stem, such as `260101_000000_s0042`.
    pub fn stem(&self) -> String {
        self.json
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    }
}

/// A slot read into memory.
#[derive(Clone, Debug)]
pub struct Slot {
    /// Where it was read from.
    pub files: SlotFiles,
    /// The sidecar.
    pub meta: SlotMeta,
    /// Audio at 12 kHz, scaled to [-1, 1).
    pub samples: Vec<f32>,
}

/// Reads and checks a sidecar: the format version must be [`FORMAT`] and the sample rate
/// 12000 Hz.
pub fn read_meta(path: &Path) -> Result<SlotMeta, CorpusError> {
    let text = fs::read_to_string(path).map_err(|source| CorpusError::Io {
        path: path.display().to_string(),
        source,
    })?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|source| CorpusError::Json {
        path: path.display().to_string(),
        source,
    })?;
    match value.get("format").and_then(|f| f.as_str()) {
        Some(FORMAT) => {}
        Some(other) => return Err(CorpusError::format(path, format!("unknown format {other:?}"))),
        None => return Err(CorpusError::format(path, "missing format field")),
    }
    let meta: SlotMeta = serde_json::from_value(value).map_err(|source| CorpusError::Json {
        path: path.display().to_string(),
        source,
    })?;
    if meta.sample_rate != SAMPLE_RATE {
        return Err(CorpusError::format(
            path,
            format!("sample_rate {} (expected {SAMPLE_RATE})", meta.sample_rate),
        ));
    }
    Ok(meta)
}

/// Reads a slot and checks it against the format: 12 kHz mono 16-bit audio holding exactly
/// one slot (180000 samples for FT8, 90000 for FT4).
pub fn read_slot(files: &SlotFiles) -> Result<Slot, CorpusError> {
    let meta = read_meta(&files.json)?;
    let (samples, rate) = wav::read(&files.wav)?;
    if rate != SAMPLE_RATE {
        return Err(CorpusError::format(
            &files.wav,
            format!("WAV rate {rate} Hz (expected {SAMPLE_RATE})"),
        ));
    }
    let want = meta.mode.slot_samples();
    if samples.len() != want {
        return Err(CorpusError::format(
            &files.wav,
            format!(
                "{} samples (expected {want} for {})",
                samples.len(),
                meta.mode.name()
            ),
        ));
    }
    Ok(Slot {
        files: files.clone(),
        meta,
        samples,
    })
}

/// Writes `<dir>/<stem>.wav` and `<dir>/<stem>.json`, creating `dir`. The audio must hold
/// exactly one slot for the sidecar's mode.
pub fn write_slot(
    dir: &Path,
    stem: &str,
    samples: &[f32],
    meta: &SlotMeta,
) -> Result<SlotFiles, CorpusError> {
    let files = SlotFiles::from_path(&dir.join(stem));
    let want = meta.mode.slot_samples();
    if samples.len() != want {
        return Err(CorpusError::format(
            &files.wav,
            format!(
                "{} samples (expected {want} for {})",
                samples.len(),
                meta.mode.name()
            ),
        ));
    }
    if meta.format != FORMAT || meta.sample_rate != SAMPLE_RATE {
        return Err(CorpusError::format(
            &files.json,
            "sidecar must be rr73-slot/1 at 12000 Hz",
        ));
    }
    fs::create_dir_all(dir).map_err(|source| CorpusError::Io {
        path: dir.display().to_string(),
        source,
    })?;
    wav::write(&files.wav, samples, SAMPLE_RATE)?;
    let mut text = serde_json::to_string_pretty(meta).map_err(|source| CorpusError::Json {
        path: files.json.display().to_string(),
        source,
    })?;
    text.push('\n');
    fs::write(&files.json, text).map_err(|source| CorpusError::Io {
        path: files.json.display().to_string(),
        source,
    })?;
    Ok(files)
}

/// Finds slots under `paths`. A path to a `.wav` or `.json` file names that slot; a
/// directory is searched recursively (hidden entries skipped) for `.json` sidecars with a
/// `.wav` beside them. The result is sorted and free of duplicates.
pub fn discover(paths: &[PathBuf]) -> Result<Vec<SlotFiles>, CorpusError> {
    let mut out = Vec::new();
    for path in paths {
        let meta = fs::metadata(path).map_err(|source| CorpusError::Io {
            path: path.display().to_string(),
            source,
        })?;
        if meta.is_dir() {
            walk(path, &mut out)?;
        } else {
            let files = SlotFiles::from_path(path);
            if !files.json.is_file() || !files.wav.is_file() {
                return Err(CorpusError::format(
                    path,
                    "slot needs both a .wav and a .json file",
                ));
            }
            out.push(files);
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

fn walk(dir: &Path, out: &mut Vec<SlotFiles>) -> Result<(), CorpusError> {
    let entries = fs::read_dir(dir).map_err(|source| CorpusError::Io {
        path: dir.display().to_string(),
        source,
    })?;
    for entry in entries {
        let entry = entry.map_err(|source| CorpusError::Io {
            path: dir.display().to_string(),
            source,
        })?;
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if path.is_dir() {
            walk(&path, out)?;
        } else if path.extension().is_some_and(|e| e == "json") {
            let files = SlotFiles::from_path(&path);
            if files.wav.is_file() {
                out.push(files);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::{Entry, SlotMode, Source, SourceKind, Timing, TimingReference};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rr73-corpus-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn synthetic_meta() -> SlotMeta {
        let mut meta = SlotMeta::new(SlotMode::Ft8, Source::new(SourceKind::Synthetic).with("seed", 42));
        meta.start_utc = Some("2026-01-01T00:00:00Z".into());
        meta.timing = Some(Timing {
            reference: TimingReference::Synthetic,
            offset_s: 0.0,
        });
        meta.truth = Some(vec![Entry {
            text: "CQ 9V1NE OJ11".into(),
            freq_hz: 1500.0,
            dt_s: 0.1,
            snr_db: -12.0,
        }]);
        meta
    }

    #[test]
    fn write_then_read_round_trips_within_quantisation() {
        let dir = temp_dir("roundtrip");
        let samples: Vec<f32> = (0..180_000).map(|i| 0.5 * (i as f32 * 0.01).sin()).collect();
        let meta = synthetic_meta();
        let files = write_slot(&dir, "260101_000000_s0001", &samples, &meta).expect("write");
        assert_eq!(files.stem(), "260101_000000_s0001");
        let slot = read_slot(&files).expect("read");
        assert_eq!(slot.meta, meta);
        let max_err = slot
            .samples
            .iter()
            .zip(&samples)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(max_err < 1.0 / 32_000.0, "{max_err}");
        let found = discover(std::slice::from_ref(&dir)).expect("discover");
        assert_eq!(found, vec![files.clone()]);
        let by_file = discover(&[files.wav.clone(), files.json.clone()]).expect("discover files");
        assert_eq!(by_file, vec![files]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wrong_length_rate_or_format_is_rejected() {
        let dir = temp_dir("reject");
        let meta = synthetic_meta();
        assert!(write_slot(&dir, "short", &[0.0; 100], &meta).is_err());

        let files = write_slot(&dir, "ok", &vec![0.0; 180_000], &meta).expect("write");
        let text = fs::read_to_string(&files.json).expect("read json");
        fs::write(&files.json, text.replace("rr73-slot/1", "rr73-slot/2")).expect("write json");
        let err = read_slot(&files).expect_err("format");
        assert!(err.to_string().contains("unknown format"), "{err}");

        fs::write(&files.json, text.replace("\"FT8\"", "\"FT4\"")).expect("write json");
        let err = read_slot(&files).expect_err("length");
        assert!(err.to_string().contains("expected 90000"), "{err}");

        wav::write(&files.wav, &vec![0.0; 180_000], 8000).expect("write wav");
        fs::write(&files.json, &text).expect("write json");
        let err = read_slot(&files).expect_err("rate");
        assert!(err.to_string().contains("8000"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discovery_skips_orphans_and_hidden_entries() {
        let dir = temp_dir("discover");
        let meta = synthetic_meta();
        let sub = dir.join("set");
        write_slot(&sub, "b", &vec![0.0; 180_000], &meta).expect("write b");
        write_slot(&sub, "a", &vec![0.0; 180_000], &meta).expect("write a");
        write_slot(&dir.join(".hidden"), "c", &vec![0.0; 180_000], &meta).expect("write c");
        fs::write(sub.join("results.json"), "{}").expect("orphan json");
        wav::write(&sub.join("lonely.wav"), &[0.0; 10], 12_000).expect("orphan wav");
        let found = discover(std::slice::from_ref(&dir)).expect("discover");
        let stems: Vec<String> = found.iter().map(SlotFiles::stem).collect();
        assert_eq!(stems, vec!["a", "b"]);
        assert!(discover(&[dir.join("missing")]).is_err());
        assert!(discover(&[sub.join("lonely.wav")]).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
