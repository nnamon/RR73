#!/usr/bin/env python3
"""Decode rr73-ft8 slot WAVs with jt9 and pair each signal with the text WSJT-X shows for it.

Reads the manifests written by `cargo run --example slot_wav` (one JSON array per mode), runs
jt9 on every WAV they name, and writes a fixture with one entry per signal: the payload, the
case it came from, and jt9's text, or null when jt9 printed nothing for that frequency.
Run through tools/wsjtx/decodes.sh.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reference import Jt9Error, _message_text, jt9_flags, read_wsjtx_version  # noqa: E402

# jt9 reports the audio frequency in whole hertz; signals are 180 Hz apart.
FREQ_TOLERANCE_HZ = 8
# A decode line. Unlike reference.py, the message may be empty: jt9 prints an empty message
# for some payloads it unpacks to nothing (telemetry 0, for example).
_DECODE_LINE = re.compile(r"^\d{4,6}\s+-?\d+\s+-?\d+\.\d+\s+(?P<freq>\d+)\s+[~+](?:\s+(?P<tail>.*?))?\s*$")


def decode_wav(wav: Path, mode: str) -> list[tuple[int, str]]:
    """Runs jt9 on one WAV in a private working directory; returns (frequency, text) pairs."""
    with tempfile.TemporaryDirectory(prefix="jt9-") as work:
        command = ["jt9", *jt9_flags(mode), "-a", work, "-t", work, str(wav.resolve())]
        result = subprocess.run(command, cwd=work, capture_output=True, text=True, timeout=180, check=False)
    if result.returncode != 0 or "<DecodeFinished>" not in result.stdout:
        raise Jt9Error(f"jt9 failed on {wav}: {result.stderr.strip() or result.stdout.strip()}")
    decodes = []
    for line in result.stdout.splitlines():
        m = _DECODE_LINE.match(line.strip())
        if m:
            decodes.append((int(m.group("freq")), _message_text(m.group("tail") or "")))
    return decodes


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("output", type=Path)
    parser.add_argument("manifests", type=Path, nargs="+")
    args = parser.parse_args(argv)

    entries = []
    for manifest_path in args.manifests:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        decodes_by_wav: dict[str, list] = {}
        for signal in manifest:
            wav = signal["wav"]
            if wav not in decodes_by_wav:
                decodes_by_wav[wav] = decode_wav(manifest_path.parent / wav, signal["mode"].upper())
            matches = [text for freq, text in decodes_by_wav[wav] if abs(freq - signal["freq_hz"]) <= FREQ_TOLERANCE_HZ]
            if len(matches) > 1:
                raise SystemExit(f"{wav}: {len(matches)} decodes near {signal['freq_hz']} Hz")
            entries.append(
                {
                    "mode": signal["mode"],
                    "source": signal["source"],
                    "note": signal["note"],
                    "payload": signal["payload"],
                    "wsjtx_text": matches[0] if matches else None,
                }
            )
    generator = f"tools/wsjtx/decodes.sh with WSJT-X {read_wsjtx_version()} jt9"
    # One signal per line keeps diffs readable.
    lines = ["{", f' "generator": {json.dumps(generator)},', ' "signals": [']
    lines += [" " + json.dumps(e) + ("," if i + 1 < len(entries) else "") for i, e in enumerate(entries)]
    lines += [" ]", "}"]
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    decoded = sum(1 for e in entries if e["wsjtx_text"] is not None)
    print(f"{len(entries)} signals, {decoded} decoded by jt9, written to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
