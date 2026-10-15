#!/usr/bin/env python3
"""Decode corpus slots with WSJT-X jt9 and write the decode list that `rr73-bench import` reads.

For each slot, in path order: a line `== <name>`, where the name is the WAV path below the corpus
directory without extension, then jt9's decode lines as printed (a priori and low-confidence marks
included). The mode comes from the slot's sidecar; depth 3. Each slot runs in its own jt9
process. Each worker thread keeps one jt9 working directory for its slots, so jt9 reuses its FFTW
wisdom as WSJT-X does; `--fresh` gives every slot a new directory. `--my-call`, `--his-call` and
`--qso-progress` pass a QSO context to jt9 (`-c`, `-x`, `-Q`), which sets the a priori hypotheses
it tries. `--times` writes one JSON line per slot with its wall time, CPU time and the time jt9's
own timer reports.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import reference

# The first row of jt9's timer.out: " jt9   0.594  1.00 ...", seconds spent in jt9's main routine.
_TIMER_TOTAL = re.compile(r"^\s*jt9\s+(?P<s>\d+\.\d+)\s")


@dataclass(frozen=True)
class SlotRun:
    """One slot's jt9 decode lines and times (s)."""

    name: str
    mode: str
    lines: list[str]
    wall_s: float
    cpu_s: float
    jt9_s: float | None


def slot_name(wav: Path) -> str:
    """The WAV path below its last `corpus` directory, without extension, or the path as given."""
    parts = wav.with_suffix("").parts
    below = [i for i, part in enumerate(parts[:-1]) if part == "corpus"]
    return "/".join(parts[below[-1] + 1 :] if below else parts)


def decode_lines(stdout: str, mode: str) -> list[str]:
    """jt9's decode lines, unchanged, after checking that the output parses."""
    count = len(reference.parse_jt9_output(stdout, mode))
    lines = [line.rstrip() for line in stdout.splitlines() if reference._DECODE_LINE.match(line.strip())]
    if len(lines) != count:
        raise reference.Jt9Error(f"jt9 printed {len(lines)} decode lines, parsed {count}")
    return lines


def timer_total_s(path: Path) -> float | None:
    """The jt9 row of timer.out, or None when the file is missing or has no such row."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in text.splitlines():
        match = _TIMER_TOTAL.match(line)
        if match:
            return float(match.group("s"))
    return None


def context_flags(my_call: str | None, his_call: str | None, qso_progress: int | None) -> list[str]:
    """jt9's QSO context options: own callsign, the other station's callsign, QSO progress."""
    flags = ["-c", my_call] if my_call else []
    flags += ["-x", his_call] if his_call else []
    return flags + (["-Q", str(qso_progress)] if qso_progress is not None else [])


def run_slot(wav: Path, mode: str, work: Path, jt9: str, context: list[str] | None = None) -> SlotRun:
    """Decode one slot with jt9 in the working directory `work`, with QSO context options `context`."""
    reference.check_wav(wav)
    (work / "timer.out").unlink(missing_ok=True)
    flags = [*reference.jt9_flags(mode), *(context or [])]
    command = [jt9, *flags, "-a", str(work), "-t", str(work), str(wav.resolve())]
    start = time.perf_counter()
    with open(work / "stderr.txt", "w", encoding="utf-8") as err:
        proc = subprocess.Popen(command, cwd=work, stdout=subprocess.PIPE, stderr=err, text=True)
        stdout = proc.stdout.read() if proc.stdout else ""
        _, status, usage = os.wait4(proc.pid, 0)
        proc.returncode = os.waitstatus_to_exitcode(status)
    wall_s = time.perf_counter() - start
    if proc.returncode != 0:
        detail = (work / "stderr.txt").read_text(errors="replace").strip().splitlines()[-1:] or ["no output"]
        raise reference.Jt9Error(f"jt9 exited with status {proc.returncode} on {wav}: {detail[0]}")
    try:
        lines = decode_lines(stdout, mode)
    except reference.Jt9Error as exc:
        raise reference.Jt9Error(f"{wav}: {exc}") from exc
    return SlotRun(
        name=slot_name(wav),
        mode=mode,
        lines=lines,
        wall_s=wall_s,
        cpu_s=usage.ru_utime + usage.ru_stime,
        jt9_s=timer_total_s(work / "timer.out"),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="decode_list.py",
        description="Decode corpus slots with jt9 (depth 3, mode from the sidecar) into a list for rr73-bench import.",
    )
    parser.add_argument("paths", nargs="+", type=Path, help="slot WAV files or directories searched recursively")
    parser.add_argument("--out", type=Path, required=True, help="decode list to write")
    parser.add_argument("--times", type=Path, help="JSON lines with each slot's wall, CPU and jt9 timer seconds")
    parser.add_argument("-j", "--jobs", type=int, default=os.cpu_count() or 1, help="parallel jt9 processes")
    parser.add_argument("--fresh", action="store_true", help="a new jt9 working directory for every slot")
    parser.add_argument("--my-call", help="own callsign for jt9's a priori hypotheses (jt9 -c)")
    parser.add_argument("--his-call", help="the other station's callsign (jt9 -x)")
    parser.add_argument("--qso-progress", type=int, choices=range(6), help="QSO progress, 0 to 5 (jt9 -Q)")
    parser.add_argument("--jt9", default="jt9", help="jt9 executable (default: jt9 on PATH)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.jobs < 1:
        print("decode_list.py: --jobs must be at least 1", file=sys.stderr)
        return 2
    context = context_flags(args.my_call, args.his_call, args.qso_progress)
    try:
        version = reference.read_wsjtx_version()
        wavs = list(reference.find_wavs(args.paths))
        modes = [reference.load_sidecar(reference.sidecar_path(wav))["mode"] for wav in wavs]
    except (reference.Jt9Error, reference.SlotError) as exc:
        print(f"decode_list.py: {exc}", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="jt9-list-") as root:
        local = threading.local()

        def decode(wav: Path, mode: str) -> SlotRun:
            if args.fresh or not hasattr(local, "work"):
                local.work = Path(tempfile.mkdtemp(dir=root))
            return run_slot(wav, mode, local.work, args.jt9, context)

        errors: list[str] = []
        runs: list[SlotRun] = []
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = [pool.submit(decode, wav, mode) for wav, mode in zip(wavs, modes, strict=True)]
            for future in futures:
                try:
                    runs.append(future.result())
                except (reference.Jt9Error, reference.SlotError) as exc:
                    errors.append(str(exc))
    with open(args.out, "w", encoding="utf-8") as out:
        for run in runs:
            out.write(f"== {run.name}\n")
            out.writelines(f"{line}\n" for line in run.lines)
    if args.times:
        with open(args.times, "w", encoding="utf-8") as out:
            for run in runs:
                tool = " ".join([reference.tool_string(version, run.mode), *context])
                record = {"name": run.name, "tool": tool, "decodes": len(run.lines), "wall_s": round(run.wall_s, 4)}
                record |= {"cpu_s": round(run.cpu_s, 4), "jt9_s": run.jt9_s}
                out.write(json.dumps(record) + "\n")
    for error in errors:
        print(f"decode_list.py: {error}", file=sys.stderr)
    print(f"decode_list.py: {len(runs)} slots decoded, {len(errors)} failed", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
