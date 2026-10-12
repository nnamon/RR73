"""Whole sessions against a fake KiwiSDR: the status check, the protocol, slots on disk, clean close."""

from __future__ import annotations

import json
import threading
import wave
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fake_kiwi import Behaviour, FakeKiwi
from helpers import Stream

from rr73_kiwi.config import BandWindow, Receiver
from rr73_kiwi.session import BUSY, ENDED_BY_RECEIVER, RECORDED, SessionContext, run_session
from rr73_kiwi.state import ReceiverState

START = datetime(2026, 10, 13, 13, 14, 22, 300000, tzinfo=UTC).timestamp()


def receiver(port: int) -> Receiver:
    return Receiver(
        id="fake-kiwi",
        name="Fake Kiwi",
        host="127.0.0.1",
        port=port,
        access="club",
        antenna="Wellbrook loop",
        grid="OJ11",
        operator="test",
        software="test",
        channels=8,
        session_s=60.0,
        break_s=300.0,
        latency_s=0.0,
        plan=(BandWindow(0, 0 + 24 * 60 - 1, ("20m",)), BandWindow(24 * 60 - 1, 0, ("20m",))),
    )


def session(fake: FakeKiwi, tmp_path: Path, length_s: float = 60.0, poll_s: float = 120.0):
    ctx = SessionContext(
        corpus_root=tmp_path / "corpus",
        stop=threading.Event(),
        ntp_server=None,
        now=fake.now,
        status_poll_s=poll_s,
    )
    return run_session(receiver(fake.port), "20m", length_s, ReceiverState(), ctx)


def test_session_records_aligned_slots_and_disconnects_cleanly(tmp_path: Path) -> None:
    with FakeKiwi(Stream(start_unix=START, duration_s=70.0)) as fake:
        result = session(fake, tmp_path)
    assert result.outcome == RECORDED
    assert fake.events[0] == "status" and fake.events.count("ws") == 1
    assert fake.close_codes == [1001]  # going away
    sent = fake.received
    assert "SET auth t=kiwi p=" in sent
    assert "SET ident_user=RR73%20corpus%209V1NE" in sent
    assert "SET mod=iq low_cut=100 high_cut=3000 freq=14074.000" in sent
    assert "SET compression=0" in sent
    assert any(s.startswith("SET agc=1 ") for s in sent)
    assert sent.count("SET keepalive") >= 1
    # Connected at 13:14:22.3 for up to 60 s: slots 13:14:30, 13:14:45 and 13:15:00 end by 13:15:15.
    day = tmp_path / "corpus" / "kiwi" / "fake-kiwi" / "20261013"
    stems = sorted(p.stem for p in day.glob("*.wav"))
    assert stems == ["261013_131430", "261013_131445", "261013_131500"]
    assert result.slots_written == 3
    for stem in stems:
        with wave.open(str(day / f"{stem}.wav")) as w:
            assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 12000, 180000)
        sidecar = json.loads((day / f"{stem}.json").read_text())
        assert sidecar["timing"] == {"reference": "gps", "offset_s": 0.0}
        assert sidecar["dial_hz"] == 14074000
    assert result.record["server"]["limits"] == {"inactivity_timeout_s": 5400.0, "ip_limit_s": None}
    assert result.record["server"]["version"] == "2026.205"
    assert result.record["stream"]["gaps"] == 0


def test_busy_receiver_is_not_contacted(tmp_path: Path) -> None:
    behaviour = Behaviour(status={"status": "active", "offline": "no", "users": "10", "users_max": "13"})
    with FakeKiwi(Stream(start_unix=START), behaviour) as fake:
        result = session(fake, tmp_path)
    assert result.outcome == BUSY and "10 of 13" in result.detail
    assert fake.ws_connections == 0
    assert "RR73 corpus 9V1NE" in fake.status_requests[0]["user-agent"]


@pytest.mark.parametrize(
    "status", [{"users": "3", "users_max": "8", "offline": "yes"}, {"users": "x", "users_max": "8"}]
)
def test_offline_or_unreadable_status_prevents_connecting(tmp_path: Path, status: dict[str, str]) -> None:
    with FakeKiwi(Stream(start_unix=START), Behaviour(status=status)) as fake:
        result = session(fake, tmp_path)
    assert result.outcome in ("busy", "error")
    assert fake.ws_connections == 0


def test_too_busy_reply_ends_the_attempt(tmp_path: Path) -> None:
    with FakeKiwi(Stream(start_unix=START), Behaviour(too_busy=True)) as fake:
        result = session(fake, tmp_path)
    assert result.outcome == BUSY and "channels are in use" in result.detail
    assert result.slots_written == 0


def test_receiver_closing_keeps_the_slots_written_so_far(tmp_path: Path) -> None:
    # About 30 s of audio (700 frames): the slot 13:14:30 completes, 13:14:45 does not.
    with FakeKiwi(Stream(start_unix=START, duration_s=70.0), Behaviour(close_after_frames=700)) as fake:
        result = session(fake, tmp_path)
    assert result.outcome == ENDED_BY_RECEIVER
    assert result.slots_written == 1
    assert result.record["stream"]["slots_discarded"] == 1


def test_session_ends_early_when_the_receiver_fills_up(tmp_path: Path) -> None:
    behaviour = Behaviour(crowd_after_frames=500, frame_pause_s=0.004)
    with FakeKiwi(Stream(start_unix=START, duration_s=70.0), behaviour) as fake:
        result = session(fake, tmp_path, poll_s=0.05)
    assert result.outcome == RECORDED
    assert "free a channel" in result.detail
    assert fake.frames_sent < 1500
    assert fake.close_codes == [1001]


def test_a_failure_to_write_slots_stops_the_session_and_propagates(tmp_path: Path) -> None:
    blocker = tmp_path / "corpus"
    blocker.write_text("a file where the corpus directory should be")
    with FakeKiwi(Stream(start_unix=START, duration_s=70.0)) as fake, pytest.raises(OSError):
        session(fake, tmp_path)
    assert fake.close_codes == [1001]


@pytest.mark.parametrize("message", ["MSG inactivity_timeout=1", "MSG ip_limit=60,10.8.0.1", "MSG kicked"])
def test_a_receiver_time_limit_is_recognised(tmp_path: Path, message: str) -> None:
    behaviour = Behaviour(limit_after_frames=700, limit_message=message)
    with FakeKiwi(Stream(start_unix=START, duration_s=70.0), behaviour) as fake:
        result = session(fake, tmp_path)
    assert result.outcome == ENDED_BY_RECEIVER
    assert result.time_limited
    assert message.removeprefix("MSG ").split("=")[0] in result.detail
    assert result.slots_written == 1
