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
from dataclasses import dataclass, replace
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


SessionRunner = Callable[[Receiver, str, float, ReceiverState], SessionResult]


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
        wait = max(receiver.break_s, backoff_s(rules, state.failures))
    elif result.outcome == BUSY:
        wait = rules.busy_wait_s
    elif result.outcome == NO_ALLOWANCE:
        wait = NO_ALLOWANCE_WAIT_S
    elif result.outcome in (REFUSED, ERROR):
        state.failures += 1
        wait = backoff_s(rules, state.failures)
    else:
        raise ValueError(f"unknown session outcome {result.outcome!r}")
    if result.connected_s > 0:
        # A session that held a channel is followed by the break, however it ended.
        wait = max(wait, receiver.break_s)
    if result.time_limited:
        wait = max(wait, TIME_LIMIT_WAIT_S)
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
    """Run sessions until request.sessions have recorded, the deadline passes or stop is set.

    The state file is shared with any other rr73-kiwi process. It is read afresh before every
    decision and again after taking the receiver's lock, and written only while holding the lock.
    """
    started = clock.now()
    deadline = started + request.hours * 3600.0 if request.hours is not None else None
    # Waits of this process alone, such as after finding the lock held. Never written to the state.
    holdoff: dict[str, float] = {}
    recorded = 0

    def state_path(receiver: Receiver) -> Path:
        return receiver_dir(corpus_root, receiver.id) / STATE_NAME

    while request.sessions == 0 or recorded < request.sessions:
        ready = {r.id: max(ready_at(r, ReceiverState.load(state_path(r))), holdoff.get(r.id, 0.0)) for r in receivers}
        receiver = min(receivers, key=lambda r: ready[r.id])
        when = ready[receiver.id]
        if deadline is not None and when > deadline:
            log.info("Stopping: the next attempt (%s) is after the deadline", _utc_text(when))
            return EXIT_STOPPED
        if when > clock.now():
            log.info("%s: next attempt at %s", receiver.id, _utc_text(when))
            if clock.wait(when - clock.now(), stop):
                return EXIT_STOPPED
            continue  # read the state again: another process may have changed it
        if stop.is_set():
            return EXIT_STOPPED
        now = clock.now()
        lock = ReceiverLock(receiver_dir(corpus_root, receiver.id) / LOCK_NAME)
        try:
            lock.acquire()
        except LockBusy as exc:
            log.warning("%s: %s; trying again later", receiver.id, exc)
            holdoff[receiver.id] = now + rules_for(receiver.access).busy_wait_s
            continue
        try:
            state = ReceiverState.load(state_path(receiver))
            if ready_at(receiver, state) > now:
                continue  # another process recorded between the check and the lock
            band = choose_band(receiver, request.bands, state, now)
            length_s = request.length_s if request.length_s is not None else receiver.session_s
            # Saved before connecting: if the process dies during the session, the next one still
            # waits for a full session and a break, and the whole planned length counts towards
            # the receiver's daily limit. The session itself sees the state without that entry.
            state.last_attempt_unix = now
            state.next_attempt_unix = now + length_s + receiver.break_s
            planned = replace(state, sessions=[*state.sessions, [now, now + length_s]])
            planned.save(state_path(receiver))
            log.info("%s %s: session of up to %.0f s", receiver.id, band, length_s)
            result = runner(receiver, band, length_s, state)
            apply_outcome(receiver, state, result)
            state.save(state_path(receiver))
            record = dict(result.record)
            record.update(
                started_utc=datetime.fromtimestamp(result.started_unix, tz=UTC).isoformat(),
                ended_utc=datetime.fromtimestamp(result.ended_unix, tz=UTC).isoformat(),
                next_attempt_utc=datetime.fromtimestamp(state.next_attempt_unix, tz=UTC).isoformat(),
            )
            append_log(receiver_dir(corpus_root, receiver.id) / LOG_NAME, record)
        finally:
            lock.release()
        log.info("%s %s: %s, %s", receiver.id, band, result.outcome, result.detail)
        if result.outcome == RECORDED:
            recorded += 1
        if result.outcome == STOPPED or stop.is_set():
            return EXIT_STOPPED
    return EXIT_DONE
