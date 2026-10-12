"""The scheduler never reconnects in a tight loop: checked with a simulated clock and session runner."""

from __future__ import annotations

import fcntl
import json
import os
import subprocess
import sys
import threading
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from rr73_kiwi.config import BandWindow, Receiver
from rr73_kiwi.schedule import EXIT_DONE, EXIT_STOPPED, Request, run_schedule
from rr73_kiwi.session import BUSY, ENDED_BY_RECEIVER, ERROR, RECORDED, REFUSED, SessionResult
from rr73_kiwi.state import LOCK_NAME, LOG_NAME, STATE_NAME, LockBusy, ReceiverLock, ReceiverState, receiver_dir

T0 = datetime(2026, 10, 13, 21, 0, tzinfo=UTC).timestamp()
CLUB = Receiver(
    id="club-kiwi",
    name="Club",
    host="kiwi.example",
    port=80,
    access="club",
    antenna="loop",
    grid="OJ11",
    operator="club",
    software="test",
    channels=8,
    session_s=600.0,
    break_s=300.0,
    latency_s=0.0,
    plan=(BandWindow(0, 720, ("20m", "17m")), BandWindow(720, 0, ("40m", "30m"))),
)
PUBLIC = replace(CLUB, id="public-kiwi", access="public", break_s=2700.0)


class SimClock:
    def __init__(self) -> None:
        self.t = T0

    def now(self) -> float:
        return self.t

    def wait(self, seconds: float, stop: threading.Event) -> bool:
        self.t += max(0.0, seconds)
        return stop.is_set()


class Runner:
    """Records each attempt and returns scripted outcomes; a session lasts its full length."""

    def __init__(self, clock: SimClock, outcomes: list[str]) -> None:
        self.clock = clock
        self.outcomes = outcomes
        self.attempts: list[tuple[str, str, float]] = []

    def __call__(self, receiver, band, length_s, state) -> SessionResult:
        start = self.clock.now()
        self.attempts.append((receiver.id, band, start))
        outcome = self.outcomes[min(len(self.attempts) - 1, len(self.outcomes) - 1)]
        connected = length_s if outcome in (RECORDED, ENDED_BY_RECEIVER) else 0.0
        self.clock.t += connected + 2.0
        return SessionResult(outcome, "scripted", start, self.clock.now(), connected, 0, {"receiver": receiver.id})


def schedule(tmp_path: Path, receivers, outcomes, sessions=1, hours=None, bands=(), clock=None):
    clock = clock or SimClock()
    runner = Runner(clock, outcomes)
    request = Request(sessions=sessions, hours=hours, bands=tuple(bands), length_s=None)
    code = run_schedule(receivers, request, tmp_path, runner, clock, threading.Event())
    return code, runner, clock


def gaps(attempts: list[tuple[str, str, float]]) -> list[float]:
    times = [t for *_, t in attempts]
    return [b - a for a, b in zip(times, times[1:], strict=False)]


def test_failures_back_off_by_doubling(tmp_path: Path) -> None:
    code, runner, _ = schedule(tmp_path, [CLUB], [ERROR], sessions=1, hours=3)
    assert code == EXIT_STOPPED
    assert gaps(runner.attempts)[:6] == [122.0, 242.0, 482.0, 962.0, 1922.0, 3842.0]
    assert len(runner.attempts) == 7


def test_busy_receiver_is_retried_after_ten_minutes(tmp_path: Path) -> None:
    code, runner, _ = schedule(tmp_path, [CLUB], [BUSY, BUSY, RECORDED])
    assert code == EXIT_DONE
    assert gaps(runner.attempts) == [602.0, 602.0]


def test_sessions_are_separated_by_the_break(tmp_path: Path) -> None:
    code, runner, _ = schedule(tmp_path, [CLUB], [RECORDED], sessions=3)
    assert code == EXIT_DONE
    assert gaps(runner.attempts) == [600.0 + 2.0 + 300.0] * 2
    assert [band for _, band, _ in runner.attempts] == ["40m", "30m", "40m"]


def test_public_receivers_get_their_longer_waits(tmp_path: Path) -> None:
    _, runner, _ = schedule(tmp_path, [PUBLIC], [ERROR], hours=4)
    assert gaps(runner.attempts)[:3] == [602.0, 1202.0, 2402.0]
    _, runner, _ = schedule(tmp_path / "b", [PUBLIC], [BUSY, RECORDED])
    assert gaps(runner.attempts) == [1802.0]
    _, runner, _ = schedule(tmp_path / "c", [PUBLIC], [RECORDED], sessions=2)
    assert gaps(runner.attempts) == [600.0 + 2.0 + 2700.0]


def test_the_receiver_ending_a_session_counts_as_a_failure(tmp_path: Path) -> None:
    _, runner, _ = schedule(tmp_path, [CLUB], [ENDED_BY_RECEIVER, RECORDED])
    assert gaps(runner.attempts) == [600.0 + 2.0 + 300.0]


def test_waits_survive_a_restart(tmp_path: Path) -> None:
    clock = SimClock()
    schedule(tmp_path, [CLUB], [RECORDED], clock=clock)
    ended = clock.now()
    state = ReceiverState.load(receiver_dir(tmp_path, CLUB.id) / STATE_NAME)
    assert state.next_attempt_unix == ended + 300.0
    # A new process starting right away waits for the break before contacting the receiver.
    _, runner, _ = schedule(tmp_path, [CLUB], [RECORDED], clock=clock)
    assert runner.attempts[0][2] == ended + 300.0
    log = (receiver_dir(tmp_path, CLUB.id) / LOG_NAME).read_text().splitlines()
    assert len(log) == 2 and json.loads(log[0])["receiver"] == CLUB.id


def test_two_receivers_alternate_during_breaks(tmp_path: Path) -> None:
    other = replace(CLUB, id="club-kiwi-2")
    _, runner, _ = schedule(tmp_path, [CLUB, other], [RECORDED], sessions=3)
    assert [r for r, _, _ in runner.attempts] == ["club-kiwi", "club-kiwi-2", "club-kiwi"]


def hold_lock(path: Path) -> int:
    """Take the receiver lock as another live process would. Its heartbeat is an hour old."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    os.write(fd, json.dumps({"owner": "other:1", "heartbeat": T0 - 3600}).encode())
    return fd


def test_a_receiver_held_by_another_process_is_not_used(tmp_path: Path) -> None:
    fd = hold_lock(receiver_dir(tmp_path, CLUB.id) / LOCK_NAME)
    try:
        code, runner, _ = schedule(tmp_path, [CLUB], [RECORDED], hours=0.1)
    finally:
        os.close(fd)
    assert code == EXIT_STOPPED and runner.attempts == []


def test_two_holders_of_one_receiver_lock_are_impossible(tmp_path: Path) -> None:
    path = receiver_dir(tmp_path, CLUB.id) / LOCK_NAME
    first, second = ReceiverLock(path), ReceiverLock(path)
    first.acquire()
    with pytest.raises(LockBusy):
        second.acquire()
    first.release()
    second.acquire()
    second.release()


def test_a_lock_left_by_a_dead_process_is_free(tmp_path: Path) -> None:
    lock = receiver_dir(tmp_path, CLUB.id) / LOCK_NAME
    lock.parent.mkdir(parents=True)
    script = "import fcntl, os, sys; fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT); fcntl.flock(fd, fcntl.LOCK_EX)"
    subprocess.run([sys.executable, "-c", script, str(lock)], check=True)
    lock.write_text(json.dumps({"owner": "dead:1", "heartbeat": T0}))
    code, runner, _ = schedule(tmp_path, [CLUB], [RECORDED])
    assert code == EXIT_DONE and [t for *_, t in runner.attempts] == [T0]


def test_attempts_are_never_closer_than_the_minimum_gap(tmp_path: Path) -> None:
    outcomes = [ERROR, BUSY, ENDED_BY_RECEIVER, ERROR, RECORDED, BUSY, ERROR, RECORDED]
    _, runner, _ = schedule(tmp_path, [CLUB], outcomes, sessions=2)
    assert len(runner.attempts) >= 6
    assert min(gaps(runner.attempts)) >= 60.0


def test_a_crash_during_a_session_leaves_a_full_session_and_break_before_the_next(tmp_path: Path) -> None:
    clock = SimClock()

    def crash(*args: object) -> SessionResult:
        raise OSError("disk full")

    request = Request(sessions=1, hours=None, bands=(), length_s=None)
    try:
        run_schedule([CLUB], request, tmp_path, crash, clock, threading.Event())
    except OSError:
        pass
    else:
        raise AssertionError("the runner's exception should propagate")
    state = ReceiverState.load(receiver_dir(tmp_path, CLUB.id) / STATE_NAME)
    assert state.next_attempt_unix >= T0 + CLUB.session_s + CLUB.break_s
    lock = ReceiverLock(receiver_dir(tmp_path, CLUB.id) / LOCK_NAME)
    lock.acquire()  # released despite the crash
    lock.release()


@pytest.mark.parametrize("outcome", [ERROR, REFUSED, BUSY])
def test_any_session_that_held_a_channel_is_followed_by_the_break(tmp_path: Path, outcome: str) -> None:
    clock = SimClock()
    attempts: list[float] = []

    def runner(receiver, band, length_s, state) -> SessionResult:
        attempts.append(clock.now())
        start = clock.now()
        clock.t += 300.0  # held the channel for 5 minutes, then the network failed
        result = outcome if len(attempts) == 1 else RECORDED
        return SessionResult(result, "network error", start, clock.now(), 300.0, 10, {"receiver": receiver.id})

    request = Request(sessions=1, hours=None, bands=(), length_s=None)
    run_schedule([CLUB], request, tmp_path, runner, clock, threading.Event())
    assert attempts[1] - attempts[0] >= 300.0 + CLUB.break_s


class HookedClock(SimClock):
    """A simulated clock that runs a callback, standing in for another process, during waits."""

    def __init__(self, during_wait) -> None:
        super().__init__()
        self.during_wait = during_wait
        self.waits = 0

    def wait(self, seconds: float, stop: threading.Event) -> bool:
        self.waits += 1
        self.during_wait(self.waits, self.t)
        return super().wait(seconds, stop)


def write_state(tmp_path: Path, state: ReceiverState) -> None:
    state.save(receiver_dir(tmp_path, CLUB.id) / STATE_NAME)


def test_a_wait_set_by_another_process_is_honoured(tmp_path: Path) -> None:
    def other_process(n: int, now: float) -> None:
        if n == 1:  # during the first break, another process records and sets a long backoff
            write_state(tmp_path, ReceiverState(next_attempt_unix=T0 + 10_000, last_attempt_unix=now, failures=5))

    clock = HookedClock(other_process)
    _, runner, _ = schedule(tmp_path, [CLUB], [RECORDED], sessions=2, clock=clock)
    assert runner.attempts[1][2] >= T0 + 10_000


def test_finding_the_lock_held_never_overwrites_the_holder_state(tmp_path: Path) -> None:
    write_state(tmp_path, ReceiverState(next_attempt_unix=T0 + 100))
    lock_fd: list[int] = []
    theirs = ReceiverState(next_attempt_unix=T0 + 50, last_attempt_unix=T0 + 50, failures=3, rotation=7)
    theirs.sessions = [[T0 - 900.0, T0 - 200.0]]

    def other_process(n: int, now: float) -> None:
        if n == 1:  # another process takes the receiver and writes its own state
            lock_fd.append(hold_lock(receiver_dir(tmp_path, CLUB.id) / LOCK_NAME))
            write_state(tmp_path, theirs)

    clock = HookedClock(other_process)
    try:
        code, runner, _ = schedule(tmp_path, [CLUB], [RECORDED], hours=0.1, clock=clock)
    finally:
        os.close(lock_fd[0])
    assert code == EXIT_STOPPED and runner.attempts == []
    on_disk = ReceiverState.load(receiver_dir(tmp_path, CLUB.id) / STATE_NAME)
    assert on_disk == theirs


def test_state_is_read_again_after_taking_the_lock(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    acquire = ReceiverLock.acquire

    def acquire_after_another_session(self: ReceiverLock) -> None:
        # Another process finished a session between the ready check and the lock.
        write_state(tmp_path, ReceiverState(next_attempt_unix=T0 + 5000, last_attempt_unix=T0))
        monkeypatch.setattr(ReceiverLock, "acquire", acquire)
        acquire(self)

    monkeypatch.setattr(ReceiverLock, "acquire", acquire_after_another_session)
    _, runner, _ = schedule(tmp_path, [CLUB], [RECORDED])
    assert [t for *_, t in runner.attempts] == [T0 + 5000]
