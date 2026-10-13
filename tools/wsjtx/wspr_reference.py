#!/usr/bin/env python3
"""Run WSJT-X wsprd over WSPR slots and store or print its decodes.

Each slot is a 12 kHz WAV of 120 s with a JSON sidecar whose mode is WSPR (docs/corpus.md).
By default the decodes go into the sidecar under reference["wsprd"], with every other field
kept. --import writes them instead as a text file for `rr73-bench import`, for scoring wsprd
on synthetic slots against their truth. wsprd runs in a private temporary directory, so its
files and its callsign hash table never carry over between slots.

wsprd prints the RF frequency in MHz for the dial given with -f. The audio frequency stored
here is that minus the dial: the signal's centre, midway between tones 1 and 2.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path

from reference import SlotError, check_wav, find_wavs, read_wsjtx_version, sidecar_path, write_json_atomic

REFERENCE_KEY = "wsprd"
SIDECAR_FORMAT = "rr73-slot/1"
DEFAULT_DIAL_HZ = 14_095_600

# "0012 -20  1.3  14.097013  0  PJ4/K1ABC 33": time, SNR, DT, frequency (MHz), drift, message.
_LINE = re.compile(
    r"^(?P<utc>\d{4,6})\s+(?P<snr>-?\d+)\s+(?P<dt>-?\d+\.\d+)\s+(?P<freq>\d+\.\d+)\s+(?P<drift>-?\d+)\s+(?P<text>\S.*?)\s*$"
)


class WsprdError(Exception):
    """wsprd failed or printed output that does not parse."""


@dataclass(frozen=True)
class Decode:
    """One wsprd decode: text, audio frequency of the signal centre (Hz), DT (s), SNR (dB in
    2500 Hz) and drift as wsprd prints it (Hz over the transmission, rounded)."""

    text: str
    freq_hz: float
    dt_s: float
    snr_db: int
    drift: int


def parse_wsprd_output(stdout: str, dial_hz: int) -> list[Decode]:
    """Parse wsprd standard output for one file. Raises WsprdError without <DecodeFinished>
    or for a line that starts like a decode and does not parse."""
    decodes: list[Decode] = []
    finished = False
    for raw in stdout.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("<DecodeFinished>"):
            finished = True
            continue
        match = _LINE.match(line)
        if match is None:
            if re.match(r"^\d{4,6}\s", line):
                raise WsprdError(f"unparsed decode line: {line!r}")
            continue
        freq_hz = round(float(match.group("freq")) * 1e6 - dial_hz, 1)
        decodes.append(
            Decode(
                text=" ".join(match.group("text").split()),
                freq_hz=freq_hz,
                dt_s=float(match.group("dt")) + 0.0,
                snr_db=int(match.group("snr")),
                drift=int(match.group("drift")),
            )
        )
    if not finished:
        raise WsprdError("wsprd output has no <DecodeFinished> line")
    return decodes


def run_wsprd(
    wav: Path, dial_hz: int, flags: list[str], wsprd: str = "wsprd", timeout_s: float = 600.0
) -> list[Decode]:
    check_wav(wav)
    with tempfile.TemporaryDirectory(prefix="wsprd-") as work:
        command = [wsprd, "-a", work, "-f", f"{dial_hz / 1e6:.6f}", *flags, str(wav.resolve())]
        try:
            result = subprocess.run(command, cwd=work, capture_output=True, text=True, timeout=timeout_s, check=False)
        except subprocess.TimeoutExpired as exc:
            raise WsprdError(f"wsprd took longer than {timeout_s:.0f} s on {wav}") from exc
    if result.returncode != 0:
        raise WsprdError(f"wsprd exited with status {result.returncode} on {wav}: {result.stderr.strip()}")
    try:
        return parse_wsprd_output(result.stdout, dial_hz)
    except WsprdError as exc:
        raise WsprdError(f"{wav}: {exc}") from exc


def load_wspr_sidecar(path: Path) -> dict:
    try:
        sidecar = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SlotError(f"{path}: {exc}") from exc
    if not isinstance(sidecar, dict) or sidecar.get("format") != SIDECAR_FORMAT:
        raise SlotError(f"{path}: format is not {SIDECAR_FORMAT}")
    if sidecar.get("mode") != "WSPR":
        raise SlotError(f"{path}: mode {sidecar.get('mode')!r} is not WSPR")
    return sidecar


def import_name(wav: Path) -> str:
    """The slot's path below corpus/ without extension, as rr73-bench import expects."""
    parts = wav.with_suffix("").parts
    return "/".join(parts[parts.index("corpus") + 1 :]) if "corpus" in parts else wav.stem


def import_lines(wav: Path, decodes: list[Decode]) -> list[str]:
    lines = [f"== {import_name(wav)}"]
    lines += [f"000000 {d.snr_db:3d} {d.dt_s:4.1f} {d.freq_hz:7.1f} ~  {d.text}" for d in decodes]
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("paths", nargs="+", type=Path, help="slot WAV files or directories searched recursively")
    parser.add_argument("-j", "--jobs", type=int, default=os.cpu_count() or 1, help="parallel wsprd processes")
    parser.add_argument("--import", dest="import_out", type=Path, help="write rr73-bench import text here instead")
    parser.add_argument("--deep", action="store_true", help="run wsprd with -d (deeper search)")
    args = parser.parse_args(argv)
    flags = ["-d"] if args.deep else []
    try:
        version = read_wsjtx_version()
        wavs = list(find_wavs(args.paths))
    except (SlotError, OSError) as exc:
        print(f"wspr_reference.py: {exc}", file=sys.stderr)
        return 2
    jobs = []
    errors: list[str] = []
    for wav in wavs:
        try:
            sidecar = load_wspr_sidecar(sidecar_path(wav))
        except SlotError as exc:
            errors.append(str(exc))
            continue
        jobs.append((wav, int(sidecar.get("dial_hz") or DEFAULT_DIAL_HZ)))
    results: dict[Path, list[Decode]] = {}
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        futures = {pool.submit(run_wsprd, wav, dial, flags): (wav, dial) for wav, dial in jobs}
        for future in as_completed(futures):
            wav, dial = futures[future]
            try:
                results[wav] = future.result()
            except (WsprdError, SlotError) as exc:
                errors.append(str(exc))
                continue
            if args.import_out is None:
                tool = " ".join(["wsprd", version, "-f", f"{dial / 1e6:.6f}", *flags])
                current = load_wspr_sidecar(sidecar_path(wav))
                reference = dict(current.get("reference") or {})
                reference[REFERENCE_KEY] = {"tool": tool, "decodes": [asdict(d) for d in results[wav]]}
                write_json_atomic(sidecar_path(wav), {**current, "reference": reference})
    if args.import_out is not None:
        lines: list[str] = []
        for wav in sorted(results):
            lines += import_lines(wav, results[wav])
        args.import_out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for error in sorted(errors):
        print(f"wspr_reference.py: {error}", file=sys.stderr)
    total = sum(len(d) for d in results.values())
    print(f"wspr_reference.py: {len(results)} slots decoded, {total} decodes, {len(errors)} failed", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
