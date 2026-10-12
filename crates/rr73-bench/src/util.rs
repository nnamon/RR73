//! Small helpers: commit id, UTC timestamps, environment, stable hashes.

use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::results::Environment;

/// The commit under test: `RR73_GIT_SHA` if set, else `git rev-parse --short=12 HEAD` with
/// `-dirty` appended when tracked files have changes, else `unknown` (inside the Docker
/// image a git worktree's metadata is outside the mount, so pass the variable there).
pub fn git_sha() -> String {
    if let Ok(v) = std::env::var("RR73_GIT_SHA")
        && !v.trim().is_empty()
    {
        return v.trim().to_string();
    }
    let run = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    match run(&["rev-parse", "--short=12", "HEAD"]) {
        Some(sha) if !sha.is_empty() => {
            let dirty =
                run(&["status", "--porcelain", "--untracked-files=no"]).is_some_and(|s| !s.is_empty());
            if dirty { format!("{sha}-dirty") } else { sha }
        }
        _ => "unknown".into(),
    }
}

/// Current time as ISO 8601 UTC with seconds (`2026-10-13T13:14:15Z`).
pub fn now_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    iso_utc(secs)
}

/// Formats seconds since the Unix epoch as ISO 8601 UTC.
pub fn iso_utc(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Proleptic Gregorian date from days since 1970-01-01 (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Machine and build description.
pub fn environment(threads: usize) -> Environment {
    Environment {
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        cpus: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        threads,
        profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
        .into(),
        bench_version: env!("CARGO_PKG_VERSION").into(),
    }
}

/// FNV-1a 64-bit hash: stable across runs and platforms, for naming files.
pub fn fnv1a(data: &[u8]) -> u64 {
    data.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, &b| {
        (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_dates_match_known_values() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(iso_utc(1_791_896_055), "2026-10-13T12:54:15Z");
        assert_eq!(iso_utc(-1), "1969-12-31T23:59:59Z");
    }

    #[test]
    fn fnv_is_stable() {
        assert_eq!(fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a(b"a"), 0xaf63_dc4c_8601_ec8c);
    }
}
