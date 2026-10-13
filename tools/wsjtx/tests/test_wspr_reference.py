"""Tests for wspr_reference.py's wsprd output parsing."""

from pathlib import Path

import pytest

import wspr_reference

# wsprd 2.7.0-rc3 output for two synthetic slots (rr73-bench synth --set wspr-smoke, slots
# 12 and 15), decoded with -f 14.0956.
# wsprd ends each decode line with a space.
OUTPUT = "0012 -20  1.3  14.097013  0  PJ4/K1ABC 33 \n0015 -20  1.3  14.097171 -3  0N3MVW DQ74 17 \n<DecodeFinished>\n"


def test_parses_decodes_with_audio_frequency() -> None:
    decodes = wspr_reference.parse_wsprd_output(OUTPUT, 14_095_600)
    assert [d.text for d in decodes] == ["PJ4/K1ABC 33", "0N3MVW DQ74 17"]
    assert decodes[0].freq_hz == 1413.0
    assert decodes[1].drift == -3
    assert decodes[1].dt_s == 1.3
    assert decodes[0].snr_db == -20


def test_rejects_incomplete_or_odd_output() -> None:
    with pytest.raises(wspr_reference.WsprdError):
        wspr_reference.parse_wsprd_output("0012 -20  1.3  14.097013  0  PJ4/K1ABC 33\n", 14_095_600)
    with pytest.raises(wspr_reference.WsprdError):
        wspr_reference.parse_wsprd_output("0012 -20 junk\n<DecodeFinished>\n", 14_095_600)
    assert wspr_reference.parse_wsprd_output("<DecodeFinished>\n", 14_095_600) == []


def test_import_lines_name_the_slot_below_the_corpus() -> None:
    wav = Path("/work/corpus/synthetic/wspr-smoke/260101_002400_s0012.wav")
    decodes = wspr_reference.parse_wsprd_output(OUTPUT, 14_095_600)
    lines = wspr_reference.import_lines(wav, decodes[:1])
    assert lines[0] == "== synthetic/wspr-smoke/260101_002400_s0012"
    assert lines[1].split("~")[1].strip() == "PJ4/K1ABC 33"
