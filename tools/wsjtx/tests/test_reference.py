"""Tests for reference.py. Fixtures are jt9 2.7.0-rc3 standard output captured from real runs:
ft8_lib test WAVs at commit 9fec6ca, ft8sim output, and an FT4 slot synthesised from ft4code
channel symbols."""

from __future__ import annotations

import json
import shutil
import stat
import subprocess
import wave
from pathlib import Path

import pytest

import reference
from reference import Decode, Jt9Error, SlotError, parse_jt9_output

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("name", "mode", "count"),
    [
        ("jt9-ft8-191111_110130.txt", "FT8", 5),
        ("jt9-ft8-191111_110615.txt", "FT8", 22),
        ("jt9-ft8-191111_110645.txt", "FT8", 19),
        ("jt9-ft8-websdr_test11.txt", "FT8", 25),
        ("jt9-ft8-ap-annotation.txt", "FT8", 1),
        ("jt9-ft8-no-decodes.txt", "FT8", 0),
        ("jt9-ft4-synth.txt", "FT4", 3),
    ],
)
def test_fixture_decode_counts_match_decode_finished(name: str, mode: str, count: int) -> None:
    assert len(parse_jt9_output(fixture(name), mode)) == count


def test_fields_of_first_decode() -> None:
    decodes = parse_jt9_output(fixture("jt9-ft8-191111_110130.txt"), "FT8")
    assert decodes[0] == Decode(text="CQ R7IW LN35", freq_hz=1291, dt_s=0.9, snr_db=-4)
    assert decodes[-1] == Decode(text="TK4LS YC1MRF 73", freq_hz=2479, dt_s=1.2, snr_db=-16)


def test_hashed_portable_and_nonstandard_callsigns_keep_their_text() -> None:
    texts = {d.text for d in parse_jt9_output(fixture("jt9-ft8-191111_110615.txt"), "FT8")}
    assert {"<...> ON7EE JO10", "OT4B <...> -19", "ET3RFG/R IN3ADG -23", "CQ JA OH1LWZ KP11"} <= texts
    texts = {d.text for d in parse_jt9_output(fixture("jt9-ft8-191111_110645.txt"), "FT8")}
    assert {"CQ OR18TRA", "<...> DA0FONTANE", "PA3EPP SP8NFO R+01"} <= texts


def test_negative_dt_and_negative_zero() -> None:
    decodes = {d.text: d for d in parse_jt9_output(fixture("jt9-ft8-websdr_test11.txt"), "FT8")}
    assert decodes["K4VBM HA8EK RR73"].dt_s == -2.3
    zero = decodes["CQ PD1ECA JO32"].dt_s
    assert zero == 0.0 and json.dumps(zero) == "0.0"


def test_a_priori_annotation_is_removed_from_text() -> None:
    assert parse_jt9_output(fixture("jt9-ft8-ap-annotation.txt"), "FT8") == [
        Decode(text="CQ K1ABC FN42", freq_hz=1200, dt_s=0.0, snr_db=-22)
    ]


def test_ft4_output() -> None:
    decodes = parse_jt9_output(fixture("jt9-ft4-synth.txt"), "FT4")
    assert Decode(text="9V1NE 9M2TRX OJ02", freq_hz=2000, dt_s=-0.1, snr_db=-4) in decodes


def test_ft4_output_read_as_ft8_is_rejected() -> None:
    with pytest.raises(Jt9Error, match="marker"):
        parse_jt9_output(fixture("jt9-ft4-synth.txt"), "FT8")


@pytest.mark.parametrize(
    ("tail", "text"),
    [
        ("CQ K1ABC FN42                           ", "CQ K1ABC FN42"),
        ("CQ K1ABC FN42                       ? a1", "CQ K1ABC FN42"),
        ("CQ K1ABC FN42                         a2", "CQ K1ABC FN42"),
        ("K1ABC W9XYZ RR73                     ?", "K1ABC W9XYZ RR73"),
        ("<PJ4/K1ABC> <W9XYZ/P> R RR73 EXTRA1 a3", "<PJ4/K1ABC> <W9XYZ/P> R RR73 EXTRA1"),
        ("QRZ ?", "QRZ ?"),
        ("TNX 73 GL", "TNX 73 GL"),
    ],
)
def test_message_text(tail: str, text: str) -> None:
    line = f"120000 -10  0.1 1500 ~  {tail}\n<DecodeFinished>   0   1        0\n"
    assert parse_jt9_output(line, "FT8")[0].text == text


@pytest.mark.parametrize(
    ("output", "error"),
    [
        ("110130  -4  0.9 1291 ~  CQ R7IW LN35\n", "no <DecodeFinished>"),
        ("110130  -4  0.9 1291 ~  CQ R7IW LN35\n<DecodeFinished>   0   2        0\n", "reported 2"),
        ("110130  -4  zero 1291 ~  CQ R7IW LN35\n<DecodeFinished>   0   1        0\n", "unparsed"),
        ("<DecodeFinished>   0   0        0\n110130  -4  0.9 1291 ~  CQ R7IW LN35\n", "after"),
        ("<DecodeFinished>   0   0        0\n<DecodeFinished>   0   0        0\n", "twice"),
    ],
)
def test_malformed_output_is_rejected(output: str, error: str) -> None:
    with pytest.raises(Jt9Error, match=error):
        parse_jt9_output(output, "FT8")


def test_other_lines_are_ignored() -> None:
    output = (
        "Fortran runtime note: denormal\n\n110130  -4  0.9 1291 ~  CQ R7IW LN35\n<DecodeFinished>   0   1        0\n"
    )
    assert len(parse_jt9_output(output, "FT8")) == 1


def test_tool_string_names_version_and_flags() -> None:
    assert reference.tool_string("2.7.0-rc3", "FT8") == "jt9 2.7.0-rc3 -8 -d 3"
    assert reference.tool_string("2.7.0-rc3", "FT4") == "jt9 2.7.0-rc3 -5 -d 3"
    with pytest.raises(SlotError):
        reference.tool_string("2.7.0-rc3", "WSPR")


# Sidecar handling and the command line, with a stand-in jt9 that prints a fixture.

SIDECAR = {
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
        "grid": "OJ11",
    },
    "timing": {"reference": "gps", "offset_s": 0.0},
    "noise_only": False,
    "truth": None,
    "reference": {"other-tool": {"tool": "x", "decodes": []}},
}


def write_silent_wav(path: Path, rate: int = 12000, samples: int = 180000) -> None:
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"\0\0" * samples)


def make_slot(directory: Path, stem: str, sidecar: dict | None = SIDECAR) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    wav = directory / f"{stem}.wav"
    write_silent_wav(wav)
    if sidecar is not None:
        (directory / f"{stem}.json").write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
    return wav


@pytest.fixture
def fake_jt9(tmp_path: Path) -> Path:
    """A jt9 stand-in that leaves working files in its working directory and prints a fixture."""
    script = tmp_path / "bin" / "jt9"
    script.parent.mkdir()
    source = FIXTURES / "jt9-ft8-191111_110130.txt"
    script.write_text(
        f"#!/bin/sh\necho junk > decoded.txt\necho junk > timer.out\necho \"$@\" > args.txt\ncat '{source}'\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return script


@pytest.fixture
def version_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "version"
    path.write_text("9.9.9\n")
    monkeypatch.setattr(reference, "VERSION_FILE", path)
    return path


def test_main_writes_reference_and_keeps_other_fields(tmp_path: Path, fake_jt9: Path, version_file: Path) -> None:
    day = tmp_path / "corpus" / "kiwi" / "sarts-web888" / "20261013"
    for stem in ("261013_131415", "261013_131430", "261013_131445"):
        make_slot(day, stem)
    assert reference.main(["--jt9", str(fake_jt9), "--jobs", "3", str(tmp_path / "corpus")]) == 0
    sidecar = json.loads((day / "261013_131430.json").read_text())
    assert sidecar["reference"]["jt9-d3"]["tool"] == "jt9 9.9.9 -8 -d 3"
    assert sidecar["reference"]["jt9-d3"]["decodes"][0] == {
        "text": "CQ R7IW LN35",
        "freq_hz": 1291,
        "dt_s": 0.9,
        "snr_db": -4,
    }
    assert sidecar["reference"]["other-tool"] == SIDECAR["reference"]["other-tool"]
    assert {k: v for k, v in sidecar.items() if k != "reference"} == {
        k: v for k, v in SIDECAR.items() if k != "reference"
    }
    assert list(sidecar) == list(SIDECAR)
    assert sorted(p.name for p in day.iterdir()) == sorted(
        f"{s}.{e}" for s in ("261013_131415", "261013_131430", "261013_131445") for e in ("json", "wav")
    )


def test_main_skips_slots_done_by_the_same_tool_unless_forced(
    tmp_path: Path, fake_jt9: Path, version_file: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    make_slot(tmp_path, "261013_131415")
    assert reference.main(["--jt9", str(fake_jt9), str(tmp_path)]) == 0
    capsys.readouterr()
    assert reference.main(["--jt9", str(fake_jt9), str(tmp_path)]) == 0
    assert "0 slots decoded, 1 already had" in capsys.readouterr().err
    assert reference.main(["--jt9", str(fake_jt9), "--force", str(tmp_path)]) == 0
    assert "1 slots decoded, 0 already had" in capsys.readouterr().err
    version_file.write_text("9.9.10\n")
    assert reference.main(["--jt9", str(fake_jt9), str(tmp_path)]) == 0
    assert "1 slots decoded" in capsys.readouterr().err


def test_main_runs_jt9_with_mode_flags_from_the_sidecar(tmp_path: Path, version_file: Path) -> None:
    ft4 = dict(SIDECAR, mode="FT4")
    wav = make_slot(tmp_path / "slots", "261013_131415", ft4)
    script = tmp_path / "jt9"
    log = tmp_path / "args.txt"
    script.write_text(f"#!/bin/sh\necho \"$@\" > '{log}'\ncat '{FIXTURES / 'jt9-ft4-synth.txt'}'\n")
    script.chmod(0o755)
    assert reference.main(["--jt9", str(script), str(wav)]) == 0
    args = log.read_text().split()
    assert args[:3] == ["-5", "-d", "3"] and args[-1] == str(wav.resolve())
    sidecar = json.loads(wav.with_suffix(".json").read_text())
    assert sidecar["reference"]["jt9-d3"]["tool"] == "jt9 9.9.9 -5 -d 3"
    assert len(sidecar["reference"]["jt9-d3"]["decodes"]) == 3


def test_print_mode_needs_no_sidecar_and_writes_nothing(
    tmp_path: Path, fake_jt9: Path, version_file: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    wav = make_slot(tmp_path / "public", "191111_110130", sidecar=None)
    assert reference.main(["--jt9", str(fake_jt9), "--print", str(wav)]) == 0
    record = json.loads(capsys.readouterr().out)
    assert record["tool"] == "jt9 9.9.9 -8 -d 3" and len(record["decodes"]) == 5
    assert [p.name for p in wav.parent.iterdir()] == ["191111_110130.wav"]


def test_missing_and_unknown_sidecars_fail(
    tmp_path: Path, fake_jt9: Path, version_file: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    make_slot(tmp_path, "261013_131415", sidecar=None)
    make_slot(tmp_path, "261013_131430", dict(SIDECAR, format="rr73-slot/2"))
    make_slot(tmp_path, "261013_131445")
    assert reference.main(["--jt9", str(fake_jt9), str(tmp_path)]) == 1
    err = capsys.readouterr().err
    assert "no sidecar" in err and "format is not rr73-slot/1" in err and "1 slots decoded" in err
    unknown = json.loads((tmp_path / "261013_131430.json").read_text())
    assert "jt9-d3" not in unknown["reference"]


def test_jt9_failure_is_reported_and_sidecar_unchanged(
    tmp_path: Path, version_file: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    wav = make_slot(tmp_path, "261013_131415")
    script = tmp_path / "jt9"
    script.write_text("#!/bin/sh\necho 'Fortran runtime error: Cannot open file' >&2\nexit 2\n")
    script.chmod(0o755)
    before = wav.with_suffix(".json").read_text()
    assert reference.main(["--jt9", str(script), str(wav)]) == 1
    assert "exited with status 2" in capsys.readouterr().err
    assert wav.with_suffix(".json").read_text() == before


def test_wav_format_is_checked(tmp_path: Path) -> None:
    wav = tmp_path / "261013_131415.wav"
    write_silent_wav(wav, rate=48000)
    with pytest.raises(SlotError, match="48000 Hz"):
        reference.check_wav(wav)


@pytest.mark.skipif(shutil.which("jt9") is None or shutil.which("ft8sim") is None, reason="needs jt9 and ft8sim")
def test_real_jt9_decodes_a_simulated_slot(tmp_path: Path) -> None:
    subprocess.run(
        ["ft8sim", "CQ 9V1NE OJ11", "1500", "0.0", "0.0", "0.0", "1", "-12"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    wav = tmp_path / "261013_131415.wav"
    (tmp_path / "000000_000001.wav").rename(wav)
    (tmp_path / "261013_131415.json").write_text(json.dumps(SIDECAR))
    assert reference.main([str(wav)]) == 0
    result = json.loads(wav.with_suffix(".json").read_text())["reference"]["jt9-d3"]
    assert result["tool"].startswith("jt9 ") and result["tool"].endswith(" -8 -d 3")
    [decode] = result["decodes"]
    assert decode["text"] == "CQ 9V1NE OJ11" and abs(decode["freq_hz"] - 1500) <= 1 and abs(decode["dt_s"]) <= 0.1
