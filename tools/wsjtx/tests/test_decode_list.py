"""Tests for decode_list.py, with a stand-in jt9 that prints captured jt9 2.7.0-rc3 output."""

from __future__ import annotations

import json
import wave
from pathlib import Path

import pytest

import decode_list
import reference

FIXTURES = Path(__file__).parent / "fixtures"


def make_slot(directory: Path, stem: str, mode: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    wav = directory / f"{stem}.wav"
    with wave.open(str(wav), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(12000)
        out.writeframes(b"\0\0" * 90000)
    sidecar = {"format": "rr73-slot/1", "mode": mode, "sample_rate": 12000, "truth": [], "noise_only": True}
    (directory / f"{stem}.json").write_text(json.dumps(sidecar), encoding="utf-8")
    return wav


def fake_jt9(tmp_path: Path, fixture: str) -> Path:
    """A jt9 stand-in that logs its arguments, writes a timer.out and prints a fixture."""
    script = tmp_path / "bin" / "jt9"
    script.parent.mkdir(exist_ok=True)
    log = tmp_path / "args.txt"
    script.write_text(
        "#!/bin/sh\n"
        f"echo \"$@\" >> '{log}'\n"
        'printf " Name  Time\\n jt9    0.250  1.00     0.008  0.03        1\\n" > timer.out\n'
        f"cat '{FIXTURES / fixture}'\n"
    )
    script.chmod(0o755)
    return script


@pytest.fixture(autouse=True)
def version_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "version"
    path.write_text("9.9.9\n")
    monkeypatch.setattr(reference, "VERSION_FILE", path)
    return path


@pytest.mark.parametrize(
    ("path", "name"),
    [
        ("corpus/synthetic/ft4-sweep/awgn/260101_000000_s0000.wav", "synthetic/ft4-sweep/awgn/260101_000000_s0000"),
        ("/work/corpus/public/ft8_lib/191111_110130.wav", "public/ft8_lib/191111_110130"),
        ("slots/261013_131415.wav", "slots/261013_131415"),
    ],
)
def test_slot_name_is_the_path_below_the_corpus(path: str, name: str) -> None:
    assert decode_list.slot_name(Path(path)) == name


def test_decode_lines_keep_jt9_layout_and_marks() -> None:
    output = (FIXTURES / "jt9-ft8-ap-annotation.txt").read_text()
    [line] = decode_list.decode_lines(output, "FT8")
    assert line.startswith("000005 -22 -0.0 1200 ~  CQ K1ABC FN42") and line.endswith("? a1")


def test_main_writes_sections_in_path_order_with_mode_flags_and_times(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus" / "synthetic" / "set"
    for stem in ("260101_000007_s0001", "260101_000000_s0000"):
        make_slot(corpus, stem, "FT4")
    jt9 = fake_jt9(tmp_path, "jt9-ft4-synth.txt")
    out, times = tmp_path / "list.txt", tmp_path / "times.jsonl"
    argv = ["--jt9", str(jt9), "--jobs", "2", "--out", str(out), "--times", str(times), str(tmp_path / "corpus")]
    assert decode_list.main(argv) == 0
    lines = out.read_text().splitlines()
    assert lines[0] == "== synthetic/set/260101_000000_s0000" and lines[4] == "== synthetic/set/260101_000007_s0001"
    assert lines[1].startswith("210007  -2  0.2 1500 +  K1ABC W9XYZ EN37") and len(lines) == 8
    assert all(args.split()[:3] == ["-5", "-d", "3"] for args in (tmp_path / "args.txt").read_text().splitlines())
    records = [json.loads(line) for line in times.read_text().splitlines()]
    assert [r["tool"] for r in records] == ["jt9 9.9.9 -5 -d 3"] * 2
    assert all(r["decodes"] == 3 and r["jt9_s"] == 0.25 and r["wall_s"] >= 0 for r in records)


def test_slot_without_a_sidecar_stops_before_decoding(tmp_path: Path) -> None:
    wav = make_slot(tmp_path / "corpus", "260101_000000_s0000", "FT8")
    wav.with_suffix(".json").unlink()
    jt9 = fake_jt9(tmp_path, "jt9-ft8-no-decodes.txt")
    assert decode_list.main(["--jt9", str(jt9), "--out", str(tmp_path / "list.txt"), str(wav)]) == 2
    assert not (tmp_path / "args.txt").exists()
