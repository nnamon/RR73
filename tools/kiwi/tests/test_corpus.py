import json
import wave
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from rr73_kiwi.config import BandWindow, Receiver
from rr73_kiwi.corpus import slot_stem, write_slot
from rr73_kiwi.slots import Slot
from rr73_kiwi.timing import SampleClock

SARTS = Receiver(
    id="sarts-web888",
    name="SARTS Web-888, Singapore",
    host="167.172.88.10",
    port=80,
    access="club",
    antenna="Wellbrook loop",
    grid="OJ11",
    operator="9V1YC for SARTS",
    software="KiwiSDR v2026.205",
    channels=13,
    session_s=720.0,
    break_s=300.0,
    latency_s=0.0,
    plan=(BandWindow(0, 720, ("20m",)), BandWindow(720, 0, ("40m",))),
)
START = int(datetime(2026, 10, 13, 13, 14, 15, tzinfo=UTC).timestamp())


def slot(reference: str = "ntp", offset_s: float = -0.0123, samples: np.ndarray | None = None) -> Slot:
    clock = SampleClock(t0=0.0, rate_hz=12000.0, reference=reference, offset_s=offset_s, rms_s=0.0, anchors=0)
    data = np.arange(180000, dtype=np.int64).astype(np.int16) if samples is None else samples
    return Slot(start_unix=START, samples=data, clock=clock, clipped=0)


def test_slot_path_wav_format_and_sidecar(tmp_path: Path) -> None:
    written = write_slot(tmp_path / "corpus", SARTS, 14_074_000, slot())
    assert written == tmp_path / "corpus/kiwi/sarts-web888/20261013/261013_131415.wav"
    with wave.open(str(written)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 12000, 180000)
        data = np.frombuffer(w.readframes(180000), dtype="<i2")
    assert np.array_equal(data, slot().samples)
    sidecar = json.loads(written.with_suffix(".json").read_text())
    assert sidecar == {
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
        "timing": {"reference": "ntp", "offset_s": -0.0123},
        "noise_only": False,
        "truth": None,
        "reference": {},
    }
    assert sorted(p.name for p in written.parent.iterdir()) == ["261013_131415.json", "261013_131415.wav"]


def test_gps_timing_is_recorded(tmp_path: Path) -> None:
    written = write_slot(tmp_path, SARTS, 7_074_000, slot(reference="gps", offset_s=0.0))
    assert json.loads(written.with_suffix(".json").read_text())["timing"] == {"reference": "gps", "offset_s": 0.0}


def test_existing_slots_are_never_overwritten(tmp_path: Path) -> None:
    first = write_slot(tmp_path, SARTS, 14_074_000, slot())
    before = first.read_bytes()
    assert write_slot(tmp_path, SARTS, 14_074_000, slot(samples=np.zeros(180000, dtype=np.int16))) is None
    assert first.read_bytes() == before


def test_wrong_sample_count_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="180000"):
        write_slot(tmp_path, SARTS, 14_074_000, slot(samples=np.zeros(179999, dtype=np.int16)))
    assert not any(tmp_path.rglob("*.wav"))


def test_stems_follow_wsjtx_naming() -> None:
    assert slot_stem(START) == "261013_131415"
    assert slot_stem(int(datetime(2027, 1, 2, 3, 4, 45, tzinfo=UTC).timestamp())) == "270102_030445"


def test_slot_files_are_readable_by_everyone(tmp_path: Path) -> None:
    written = write_slot(tmp_path, SARTS, 14_074_000, slot())
    assert written.stat().st_mode & 0o777 == 0o644
    assert written.with_suffix(".json").stat().st_mode & 0o777 == 0o644
