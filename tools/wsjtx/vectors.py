#!/usr/bin/env python3
"""Run WSJT-X ft8sim over a list of messages and write the results as JSON test vectors.

For each message ft8sim prints the text WSJT-X displays after packing and unpacking it, the
message type i3.n3, the 77 message bits and the 79 FT8 channel symbols. ft8sim also writes a
WAV file into its working directory, so every run gets its own temporary directory.

    docker compose run --rm wsjtx python3 tools/wsjtx/vectors.py \\
        tools/wsjtx/cases.txt fixtures/ft8/wsjtx.json

The case file holds one message per line as an operator would type it; blank lines and lines
starting with # are skipped.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

VERSION_FILE = Path(os.environ.get("RR73_WSJTX_VERSION_FILE", "/usr/local/share/wsjtx/version"))
# ft8sim "message" f0 DT fdop del nfiles snr: one clean file at 1500 Hz.
FT8SIM_ARGS = ["1500", "0", "0", "0", "1", "-10"]

# n3 is printed as "*" where it is not a field (type 4).
_DECODED = re.compile(r"Decoded message:\s(?P<text>.*?)\s+i3\.n3:\s*(?P<i3>\d)\.(?P<n3>[\d*])\s*$")
_BITS = re.compile(r"^[01 ]+$")
_SYMBOLS = re.compile(r"^[0-7]{79}$")


class Ft8simError(Exception):
    """ft8sim failed or printed output that does not parse."""


def read_cases(path: Path) -> list[str]:
    cases = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            cases.append(line.strip())
    return cases


def parse_output(message: str, output: str) -> dict:
    """Extracts display text, i3.n3, message bits and channel symbols from ft8sim output."""
    lines = output.splitlines()
    decoded = None
    bits = None
    symbols = None
    for i, line in enumerate(lines):
        if decoded is None and (m := _DECODED.search(line)):
            decoded = m
        elif bits is None and _BITS.match(line.strip()) and len(line.replace(" ", "").strip()) == 77:
            # The bits follow "Message bits:", or for type 1 a row of field names, and type 1
            # prints them in groups separated by spaces.
            bits = line.replace(" ", "").strip()
        elif line.strip() == "Channel symbols:" and i + 1 < len(lines) and _SYMBOLS.match(lines[i + 1].strip()):
            symbols = lines[i + 1].strip()
    if decoded is None or bits is None or symbols is None or len(bits) != 77:
        raise Ft8simError(f"cannot parse ft8sim output for {message!r}:\n{output}")
    return {
        "input": message,
        "text": decoded.group("text").strip(),
        "i3": int(decoded.group("i3")),
        "n3": None if decoded.group("n3") == "*" else int(decoded.group("n3")),
        "bits": bits,
        "symbols": symbols,
    }


def run_ft8sim(message: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="ft8sim-") as work:
        result = subprocess.run(
            ["ft8sim", message, *FT8SIM_ARGS], cwd=work, capture_output=True, text=True, check=False
        )
    if result.returncode != 0:
        raise Ft8simError(f"ft8sim exited {result.returncode} for {message!r}: {result.stderr}")
    return parse_output(message, result.stdout)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("cases", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 1)
    args = parser.parse_args(argv)

    cases = read_cases(args.cases)
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        vectors = list(pool.map(run_ft8sim, cases))
    version = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else "unknown"
    generator = f"tools/wsjtx/vectors.py with WSJT-X {version} ft8sim"
    # One vector per line keeps diffs readable.
    lines = ["{", f' "generator": {json.dumps(generator)},', ' "vectors": [']
    lines += [" " + json.dumps(v) + ("," if i + 1 < len(vectors) else "") for i, v in enumerate(vectors)]
    lines += [" ]", "}"]
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(vectors)} cases written to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
