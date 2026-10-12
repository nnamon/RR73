#!/usr/bin/env python3
"""Run WSJT-X jt9 over corpus slots and store its decodes as the reference.

Each slot is a 12 kHz WAV with a JSON sidecar (docs/corpus.md). The decodes go into the
sidecar under reference["jt9-d3"]; every other field of the sidecar is kept as it was. jt9
writes working files (decoded.txt, jt9_wisdom.dat, timer.out) into its working directory, so
every run gets its own temporary directory. Runs are parallel across files.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import wave
from collections.abc import Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path

SIDECAR_FORMAT = "rr73-slot/1"
REFERENCE_KEY = "jt9-d3"
DEPTH = 3
MODE_FLAGS = {"FT8": "-8", "FT4": "-5"}
MODE_MARKERS = {"FT8": "~", "FT4": "+"}
VERSION_FILE = Path(os.environ.get("RR73_WSJTX_VERSION_FILE", "/usr/local/share/wsjtx/version"))
SAMPLE_RATE_HZ = 12000

# One decode line, for example "110130  -4  0.9 1291 ~  CQ R7IW LN35" followed by padding and,
# for a priori or low-confidence decodes, "? a1". FT8 lines carry "~", FT4 lines "+".
_DECODE_LINE = re.compile(
    r"^(?P<utc>\d{4}|\d{6})\s+(?P<snr>-?\d+)\s+(?P<dt>-?\d+\.\d+)\s+(?P<freq>\d+)\s+"
    r"(?P<marker>\S)\s+(?P<tail>\S.*?)\s*$"
)
# Annotation after the padded message field: "?" (low confidence) and/or "aN" (a priori type).
_ANNOTATION = re.compile(r"^(?P<text>\S.*?)(?:\s{2,}|\s(?=(?:\?\s+)?a\d+$))(?P<annotation>\?(?:\s+a\d+)?|a\d+)$")
_FINISHED = re.compile(r"^<DecodeFinished>\s+(?P<a>\d+)\s+(?P<count>\d+)\s+(?P<b>\d+)\s*$")


class Jt9Error(Exception):
    """jt9 failed or printed output that does not parse."""


class SlotError(Exception):
    """A slot or its sidecar cannot be used."""


@dataclass(frozen=True)
class Decode:
    """One jt9 decode: message text, audio frequency (Hz), DT (s) and SNR (dB in 2500 Hz)."""

    text: str
    freq_hz: int
    dt_s: float
    snr_db: int


def parse_jt9_output(stdout: str, mode: str) -> list[Decode]:
    """Parse jt9 standard output for one WAV file.

    Raises Jt9Error when a line looks like a decode but does not parse, when the marker does
    not match the mode, when the <DecodeFinished> line is missing, or when its decode count
    differs from the number of decode lines.
    """
    marker = MODE_MARKERS[mode]
    decodes: list[Decode] = []
    finished_count: int | None = None
    for raw in stdout.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        finished = _FINISHED.match(line.strip())
        if finished:
            if finished_count is not None:
                raise Jt9Error("jt9 printed <DecodeFinished> twice; run one file per process")
            finished_count = int(finished.group("count"))
            continue
        match = _DECODE_LINE.match(line.strip())
        if match is None:
            if re.match(r"^\s*\d{4,6}\s", line):
                raise Jt9Error(f"unparsed decode line: {line!r}")
            continue
        if finished_count is not None:
            raise Jt9Error(f"decode line after <DecodeFinished>: {line!r}")
        if match.group("marker") != marker:
            raise Jt9Error(f"mode marker {match.group('marker')!r} in {mode} output: {line!r}")
        decodes.append(
            Decode(
                text=_message_text(match.group("tail")),
                freq_hz=int(match.group("freq")),
                dt_s=float(match.group("dt")) + 0.0,  # + 0.0 turns -0.0 into 0.0
                snr_db=int(match.group("snr")),
            )
        )
    if finished_count is None:
        raise Jt9Error("jt9 output has no <DecodeFinished> line")
    if finished_count != len(decodes):
        raise Jt9Error(f"jt9 reported {finished_count} decodes, parsed {len(decodes)}")
    return decodes


def _message_text(tail: str) -> str:
    """Message text without padding and without jt9's "?" and "aN" annotations."""
    tail = tail.strip()
    annotated = _ANNOTATION.match(tail)
    return annotated.group("text").strip() if annotated else tail


def jt9_flags(mode: str, depth: int = DEPTH) -> list[str]:
    """Command-line flags for jt9 in the given mode."""
    if mode not in MODE_FLAGS:
        raise SlotError(f"unsupported mode {mode!r}; expected FT8 or FT4")
    return [MODE_FLAGS[mode], "-d", str(depth)]


def tool_string(version: str, mode: str) -> str:
    """Value of reference["jt9-d3"]["tool"], for example "jt9 2.7.0-rc3 -8 -d 3"."""
    return " ".join(["jt9", version, *jt9_flags(mode)])


def read_wsjtx_version(path: Path | None = None) -> str:
    """WSJT-X version recorded in the image at build time."""
    path = path or VERSION_FILE
    try:
        version = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise Jt9Error(f"cannot read the WSJT-X version from {path}: {exc.strerror}") from exc
    if not version:
        raise Jt9Error(f"{path} is empty")
    return version


def check_wav(path: Path) -> None:
    """Reject WAV files jt9 cannot read correctly: jt9 expects 12000 Hz, mono, 16-bit PCM."""
    try:
        with wave.open(str(path), "rb") as wav:
            rate, channels, width = wav.getframerate(), wav.getnchannels(), wav.getsampwidth()
    except (OSError, EOFError, wave.Error) as exc:
        raise SlotError(f"{path}: not a readable WAV file ({exc})") from exc
    if (rate, channels, width) != (SAMPLE_RATE_HZ, 1, 2):
        raise SlotError(f"{path}: {rate} Hz, {channels} channels, {8 * width}-bit; jt9 needs 12000 Hz mono 16-bit")


def run_jt9(wav: Path, mode: str, jt9: str = "jt9", timeout_s: float = 180.0) -> list[Decode]:
    """Decode one WAV file with jt9 in a private temporary working directory."""
    check_wav(wav)
    with tempfile.TemporaryDirectory(prefix="jt9-") as work:
        command = [jt9, *jt9_flags(mode), "-a", work, "-t", work, str(wav.resolve())]
        try:
            result = subprocess.run(command, cwd=work, capture_output=True, text=True, timeout=timeout_s, check=False)
        except subprocess.TimeoutExpired as exc:
            raise Jt9Error(f"jt9 took longer than {timeout_s:.0f} s on {wav}") from exc
        except OSError as exc:
            raise Jt9Error(f"cannot run {jt9}: {exc.strerror}") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()[-1:] or ["no output"]
        raise Jt9Error(f"jt9 exited with status {result.returncode} on {wav}: {detail[0]}")
    try:
        return parse_jt9_output(result.stdout, mode)
    except Jt9Error as exc:
        raise Jt9Error(f"{wav}: {exc}") from exc


def sidecar_path(wav: Path) -> Path:
    return wav.with_suffix(".json")


def load_sidecar(path: Path) -> dict:
    try:
        sidecar = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise SlotError(f"{path}: {exc.strerror}") from exc
    except json.JSONDecodeError as exc:
        raise SlotError(f"{path}: invalid JSON ({exc})") from exc
    if not isinstance(sidecar, dict) or sidecar.get("format") != SIDECAR_FORMAT:
        raise SlotError(f"{path}: format is not {SIDECAR_FORMAT}")
    if sidecar.get("mode") not in MODE_FLAGS:
        raise SlotError(f"{path}: mode {sidecar.get('mode')!r} is not FT8 or FT4")
    reference = sidecar.get("reference")
    if reference is not None and not isinstance(reference, dict):
        raise SlotError(f"{path}: reference is not an object; fix or remove it")
    if isinstance(reference, dict) and not isinstance(reference.get(REFERENCE_KEY, {}), dict):
        raise SlotError(f"{path}: reference.{REFERENCE_KEY} is not an object; fix or remove it")
    return sidecar


def with_reference(sidecar: dict, tool: str, decodes: Iterable[Decode]) -> dict:
    """A copy of the sidecar with reference["jt9-d3"] replaced and all other fields kept."""
    updated = dict(sidecar)
    reference = dict(updated.get("reference") or {})
    reference[REFERENCE_KEY] = {"tool": tool, "decodes": [asdict(d) for d in decodes]}
    updated["reference"] = reference
    return updated


def write_json_atomic(path: Path, data: dict) -> None:
    """Write JSON through a temporary file in the same directory, then rename it into place."""
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
    fd, tmp = tempfile.mkstemp(prefix=f".{path.stem}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(data, out, indent=2, ensure_ascii=False)
            out.write("\n")
        os.chmod(tmp, mode)  # mkstemp creates 0600; keep the sidecar's own mode
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def find_wavs(paths: Iterable[Path]) -> Iterator[Path]:
    """WAV files named on the command line and those below named directories, sorted."""
    for path in paths:
        if path.is_dir():
            yield from sorted(p for p in path.rglob("*.wav") if p.is_file())
        elif path.suffix.lower() == ".wav" and path.is_file():
            yield path
        else:
            raise SlotError(f"{path}: not a WAV file or directory")


@dataclass(frozen=True)
class Job:
    wav: Path
    mode: str
    sidecar: dict | None


def plan_jobs(
    wavs: Iterable[Path], version: str, force: bool, print_only: bool, default_mode: str
) -> tuple[list[Job], int, list[str]]:
    """Jobs to run, the number of slots already done, and errors for unusable slots."""
    jobs: list[Job] = []
    done = 0
    errors: list[str] = []
    for wav in wavs:
        side = sidecar_path(wav)
        if not side.exists():
            if print_only:
                jobs.append(Job(wav, default_mode, None))
            else:
                errors.append(f"{wav}: no sidecar {side.name}; use --print for WAV files without one")
            continue
        try:
            sidecar = load_sidecar(side)
        except SlotError as exc:
            errors.append(str(exc))
            continue
        current = (sidecar.get("reference") or {}).get(REFERENCE_KEY) or {}
        if not force and not print_only and current.get("tool") == tool_string(version, sidecar["mode"]):
            done += 1
            continue
        jobs.append(Job(wav, sidecar["mode"], sidecar))
    return jobs, done, errors


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="reference.py",
        description=(
            "Decode corpus slots with WSJT-X jt9 (-8 for FT8, -5 for FT4, depth 3) and store the "
            "decodes in each sidecar under reference.jt9-d3. Slots that already carry decodes from "
            "the same jt9 version and flags are skipped."
        ),
    )
    parser.add_argument("paths", nargs="+", type=Path, help="slot WAV files or directories searched recursively")
    parser.add_argument(
        "-j", "--jobs", type=int, default=os.cpu_count() or 1, help="parallel jt9 processes (default: CPU count)"
    )
    parser.add_argument(
        "--force", action="store_true", help="decode slots that already have reference.jt9-d3 from this jt9"
    )
    parser.add_argument(
        "--print",
        dest="print_only",
        action="store_true",
        help="print decodes as JSON lines and leave sidecars unchanged; WAV files need no sidecar",
    )
    parser.add_argument(
        "--mode", choices=sorted(MODE_FLAGS), default="FT8", help="mode for WAV files without a sidecar (default: FT8)"
    )
    parser.add_argument("--jt9", default="jt9", help="jt9 executable (default: jt9 on PATH)")
    parser.add_argument("--timeout", type=float, default=180.0, help="seconds allowed per jt9 run (default: 180)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.jobs < 1:
        print("reference.py: --jobs must be at least 1", file=sys.stderr)
        return 2
    try:
        version = read_wsjtx_version()
        wavs = list(find_wavs(args.paths))
    except (Jt9Error, SlotError) as exc:
        print(f"reference.py: {exc}", file=sys.stderr)
        return 2
    jobs, done, errors = plan_jobs(wavs, version, args.force, args.print_only, args.mode)
    decoded = 0
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(run_jt9, job.wav, job.mode, args.jt9, args.timeout): job for job in jobs}
        for future in as_completed(futures):
            job = futures[future]
            try:
                decodes = future.result()
            except (Jt9Error, SlotError) as exc:
                errors.append(str(exc))
                continue
            tool = tool_string(version, job.mode)
            if args.print_only or job.sidecar is None:
                record = {"file": str(job.wav), "tool": tool, "decodes": [asdict(d) for d in decodes]}
                print(json.dumps(record, ensure_ascii=False), flush=True)
            else:
                # Read the sidecar again: it may have changed while jt9 ran, and those changes stay.
                try:
                    current = load_sidecar(sidecar_path(job.wav))
                except SlotError as exc:
                    errors.append(str(exc))
                    continue
                if current["mode"] != job.mode:
                    errors.append(f"{sidecar_path(job.wav)}: mode changed to {current['mode']} during decoding")
                    continue
                write_json_atomic(sidecar_path(job.wav), with_reference(current, tool, decodes))
            decoded += 1
    for error in sorted(errors):
        print(f"reference.py: {error}", file=sys.stderr)
    print(
        f"reference.py: {decoded} slots decoded, {done} already had {REFERENCE_KEY}, {len(errors)} failed",
        file=sys.stderr,
    )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
