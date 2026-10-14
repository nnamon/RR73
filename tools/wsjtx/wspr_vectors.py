#!/usr/bin/env python3
"""Run WSJT-X wsprsim and wsprcode over a list of WSPR messages and write JSON test vectors.

For each message wsprsim prints the packed message with its zero tail (11 bytes) and the 162
channel symbols, and wsprcode prints the text WSJT-X decodes from it. Every run gets its own
temporary working directory.

    docker compose run --rm wsjtx python3 tools/wsjtx/wspr_vectors.py \\
        tools/wsjtx/wspr_cases.txt fixtures/wspr/wsjtx.json

The case file holds one message per line as an operator types it; blank lines and lines
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

_DATA = re.compile(r"^Data is\s*:\s*(?P<hex>(?:[0-9A-F]{2}\s+){10}[0-9A-F]{2})\s*$")
_SYMBOLS = re.compile(r"^[0-3](?: [0-3]){161}$")
_DECODED = re.compile(r"^Decoded message:\s*(?P<text>.*?)\s+ntype:\s*(?P<ntype>-?\d+)\s*$")


class ToolError(Exception):
    """wsprsim or wsprcode failed or printed output that does not parse."""


def read_cases(path: Path) -> list[str]:
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def parse_wsprsim(message: str, output: str) -> tuple[str, str]:
    """The 11 data bytes (hex, space-separated) and the 162 channel symbols (digits)."""
    data = None
    symbols = None
    lines = [line.strip() for line in output.splitlines()]
    for i, line in enumerate(lines):
        if data is None and (m := _DATA.match(line)):
            data = m.group("hex")
        if line == "Channel symbols:" and i + 1 < len(lines) and _SYMBOLS.match(lines[i + 1]):
            symbols = lines[i + 1].replace(" ", "")
    if data is None or symbols is None:
        raise ToolError(f"wsprsim output for {message!r} does not parse: {output!r}")
    return data, symbols


def parse_wsprcode(message: str, output: str) -> tuple[str, int]:
    """The text wsprcode decodes and its ntype field."""
    for line in output.splitlines():
        if m := _DECODED.match(line.strip()):
            return m.group("text").strip(), int(m.group("ntype"))
    raise ToolError(f"wsprcode output for {message!r} has no decoded message: {output!r}")


def run_tool(command: list[str], ok_status: set[int]) -> str:
    with tempfile.TemporaryDirectory(prefix="wspr-") as work:
        result = subprocess.run(command, cwd=work, capture_output=True, text=True, timeout=60, check=False)
    if result.returncode not in ok_status:
        raise ToolError(f"{command[0]} exited with status {result.returncode}: {result.stderr.strip()}")
    return result.stdout


def vector(message: str) -> dict:
    # wsprsim exits with status 1 after printing when no output file is requested.
    data, symbols = parse_wsprsim(message, run_tool(["wsprsim", "-cd", message], {0, 1}))
    decoded, ntype = parse_wsprcode(message, run_tool(["wsprcode", message], {0}))
    return {"message": message, "decoded": decoded, "ntype": ntype, "data": data, "symbols": symbols}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("cases", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args(argv)
    cases = read_cases(args.cases)
    try:
        with ThreadPoolExecutor(max_workers=os.cpu_count() or 1) as pool:
            vectors = list(pool.map(vector, cases))
    except ToolError as exc:
        print(f"wspr_vectors.py: {exc}", file=sys.stderr)
        return 1
    version = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else "unknown"
    doc = {
        "generator": f"tools/wsjtx/wspr_vectors.py with wsprsim and wsprcode from WSJT-X {version}",
        "vectors": vectors,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(f"wspr_vectors.py: {len(vectors)} vectors written to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
