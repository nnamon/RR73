"""Session scheduling across receivers, with every wait the politeness rules require.

After every attempt, whatever its outcome, the receiver's next allowed attempt moves into the
future: a break after a session, a busy wait when channels are short, and a doubling backoff
after failures. Attempts on one receiver are never closer than its minimum gap.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from rr73_kiwi.config import Receiver
from rr73_kiwi.politeness import TIME_LIMIT_WAIT_S, backoff_s, rules_for
from rr73_kiwi.session import (
    BUSY,
    ENDED_BY_RECEIVER,
    ERROR,
    NO_ALLOWANCE,
    RECORDED,
    REFUSED,
    STOPPED,
    SessionResult,
)
from rr73_kiwi.state import (
    LOCK_NAME,
    LOG_NAME,
    STATE_NAME,
    LockBusy,
    ReceiverLock,
    ReceiverState,
    append_log,
    receiver_dir,
)

log = logging.getLogger("rr73_kiwi")

NO_ALLOWANCE_WAIT_S = 3600.0
EXIT_DONE = 0
EXIT_STOPPED = 3


class Clock:
    """Wall clock with an interruptible wait. Tests substitute a simulated one."""

    def now(self) -> float:
        return time.time()

    def wait(self, seconds: float, stop: threading.Event) -> bool:
        """Wait up to seconds; True when stop was set."""
        return stop.wait(max(0.0, seconds))


SessionRunner = Callable[[Receiver, str, float, ReceiverState, Callable[[float], None]], SessionResult]


@dataclass(frozen=True)
class Request:
    sessions: int  # 0: until stopped
    hours: float | None
    bands: tuple[str, ...]  # empty: the receiver's plan
    length_s: float | None  # None: the receiver's session length


def ready_at(receiver: Receiver, state: ReceiverState) -> float:
    """Earliest Unix time the receiver may be contacted again."""
    return max(state.next_attempt_unix, state.last_attempt_unix + rules_for(receiver.access).min_attempt_gap_s)


def choose_band(receiver: Receiver, requested: Sequence[str], state: ReceiverState, now: float) -> str:
    bands = tuple(requested) or receiver.bands_at(datetime.fromtimestamp(now, tz=UTC))
    return bands[state.rotation % len(bands)]


def apply_outcome(receiver: Receiver, state: ReceiverState, result: SessionResult) -> None:
    """Set the next allowed attempt and the failure count from a session's outcome."""
    rules = rules_for(receiver.access)
    end = result.ended_unix
    if result.connected_s > 0:
        state.record_session(result.started_unix, end, end)
    if result.outcome in (RECORDED, STOPPED):
        state.failures = 0
        state.rotation += 1
        wait = receiver.break_s
    elif result.outcome == ENDED_BY_RECEIVER:
        state.failures += 1
        limit_words = ("limit", "timeout", "kick")
        wait = TIME_LIMIT_WAIT_S if any(w in result.detail.lower() for w in limit_words) else 0.0
        wait = max(wait, receiver.break_s, backoff_s(rules, state.failures))
    elif result.outcome == BUSY:
        wait = rules.busy_wait_s
    elif result.outcome == NO_ALLOWANCE:
        wait = NO_ALLOWANCE_WAIT_S
    elif result.outcome in (REFUSED, ERROR):
        state.failures += 1
        wait = backoff_s(rules, state.failures)
    else:
        raise ValueError(f"unknown session outcome {result.outcome!r}")
    state.next_attempt_unix = max(end + wait, state.last_attempt_unix + rules.min_attempt_gap_s)


def _utc_text(unix_s: float) -> str:
    return datetime.fromtimestamp(unix_s, tz=UTC).strftime("%H:%M:%S UTC")


def run_schedule(
    receivers: Sequence[Receiver],
    request: Request,
    corpus_root: Path,
    runner: SessionRunner,
    clock: Clock,
    stop: threading.Event,
) -> int:
    """Run sessions until request.sessions have recorded, the deadline passes or stop is set."""
    started = clock.now()
    deadline = started + request.hours * 3600.0 if request.hours is not None else None
    states = {r.id: ReceiverState.load(receiver_dir(corpus_root, r.id) / STATE_NAME) for r in receivers}
    recorded = 0
    while request.sessions == 0 or recorded < request.sessions:
        receiver = min(receivers, key=lambda r: ready_at(r, states[r.id]))
        state = states[receiver.id]
        state_path = receiver_dir(corpus_root, receiver.id) / STATE_NAME
        when = ready_at(receiver, state)
        if deadline is not None and when > deadline:
            log.info("Stopping: the next attempt (%s) is after the deadline", _utc_text(when))
            return EXIT_STOPPED
        if when > clock.now():
            log.info("%s: next attempt at %s", receiver.id, _utc_text(when))
            if clock.wait(when - clock.now(), stop):
                return EXIT_STOPPED
        if stop.is_set():
            return EXIT_STOPPED
        now = clock.now()
        band = choose_band(receiver, request.bands, state, now)
        length_s = request.length_s if request.length_s is not None else receiver.session_s
        lock = ReceiverLock(receiver_dir(corpus_root, receiver.id) / LOCK_NAME)
        try:
            lock.acquire(now)
        except LockBusy as exc:
            log.warning("%s: %s; trying again later", receiver.id, exc)
            state.last_attempt_unix = now
            state.next_attempt_unix = now + rules_for(receiver.access).busy_wait_s
            state.save(state_path)
            continue
        try:
            # Saved before connecting: if the process dies during the session, the next one still
            # waits for a full session and a break.
            state.last_attempt_unix = now
            state.next_attempt_unix = now + length_s + receiver.break_s
            state.save(state_path)
            log.info("%s %s: session of up to %.0f s", receiver.id, band, length_s)
            result = runner(receiver, band, length_s, state, lock.refresh)
        finally:
            lock.release()
        apply_outcome(receiver, state, result)
        state.save(state_path)
        record = dict(result.record)
        record.update(
            started_utc=datetime.fromtimestamp(result.started_unix, tz=UTC).isoformat(),
            ended_utc=datetime.fromtimestamp(result.ended_unix, tz=UTC).isoformat(),
            next_attempt_utc=datetime.fromtimestamp(state.next_attempt_unix, tz=UTC).isoformat(),
        )
        append_log(receiver_dir(corpus_root, receiver.id) / LOG_NAME, record)
        log.info("%s %s: %s, %s", receiver.id, band, result.outcome, result.detail)
        if result.outcome == RECORDED:
            recorded += 1
        if result.outcome == STOPPED or stop.is_set():
            return EXIT_STOPPED
    return EXIT_DONE
