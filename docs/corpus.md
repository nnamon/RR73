# Corpus format

The corpus is a directory tree of slots. Containers mount it at `/work/corpus` from `RR73_CORPUS` (set in `.env`), so every worktree shares one copy. Each slot is a WAV file and a JSON sidecar with the same stem. The corpus lives in `corpus/`, which git ignores. CI uses synthetic slots and public files fetched at a pinned commit.

## Layout

```
corpus/
  public/ft8_lib/<stem>.wav|json          ft8_lib test files with WSJT-X decode lists
  synthetic/<set>/<stem>.wav|json         rr73-bench synth output, exact truth
  kiwi/<receiver>/<YYYYMMDD>/<stem>.wav|json
  kx2/<YYYYMMDD>/<stem>.wav|json          recorded in the app
```

Stems follow WSJT-X naming, `YYMMDD_HHMMSS`, with the slot start time in UTC. Synthetic stems may add a suffix: `260101_000000_s0042`.

## Audio

- WAV, PCM 16-bit, mono, 12000 Hz.
- Exactly one slot: 180000 samples for FT8 (15 s), 90000 for FT4 (7.5 s).
- Sample 0 is the slot start in UTC. Recordings whose source clock is off are corrected before writing, and the correction is recorded in `timing`.

## Sidecar

```json
{
  "format": "rr73-slot/1",
  "mode": "FT8",
  "start_utc": "2026-10-13T13:14:15Z",
  "sample_rate": 12000,
  "dial_hz": 14074000,
  "source": {
    "kind": "kiwisdr",
    "receiver": "sarts-web888",
    "host": "167.172.88.10",
    "antenna": "Wellbrook loop",
    "grid": "OJ11"
  },
  "timing": { "reference": "gps", "offset_s": 0.0 },
  "noise_only": false,
  "truth": null,
  "reference": {
    "jt9-d3": {
      "tool": "jt9 2.6.1 -8 -d 3",
      "decodes": [
        { "text": "CQ 9M2TRX OJ02", "freq_hz": 1022, "dt_s": 0.1, "snr_db": -7 }
      ]
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `format` | Schema version. Readers reject versions they don't know. |
| `mode` | `FT8` or `FT4`. |
| `start_utc` | Slot start, ISO 8601 UTC. |
| `dial_hz` | Radio dial frequency, USB. Audio frequency plus dial gives RF. |
| `source.kind` | `kiwisdr`, `kx2`, `synthetic` or `public`. |
| `timing.reference` | `gps`, `ntp`, `phone` or `synthetic`. `offset_s` is the correction applied. |
| `noise_only` | `true` for slots used to count false decodes. |
| `truth` | Synthetic slots only: the exact signals, `{ text, freq_hz, dt_s, snr_db }`. |
| `reference` | Decodes from reference tools, keyed by tool and depth. |

## Scoring

A decode matches a reference or truth entry when the message text is equal, the frequency is within 10 Hz and DT is within 0.5 s. Each entry matches at most once.

- **Recall**: matched entries over reference or truth entries.
- **Unique**: decodes that match nothing. On synthetic slots and noise-only slots these are false decodes. On real slots they are candidates for review, kept as true only if the callsign prefix is valid and the station appears in a neighbouring slot.
- **SNR50**: on synthetic sets, the SNR at which half of the signals decode, fitted per scene type.
