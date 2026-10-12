"""One recording session: check the receiver, hold one channel, write slots, disconnect."""

from __future__ import annotations

import logging
import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from rr73_kiwi import IDENT
from rr73_kiwi.bands import dial_hz
from rr73_kiwi.config import Receiver
from rr73_kiwi.corpus import slot_stem, write_slot
from rr73_kiwi.kiwi import IqConnection, StreamEnded
from rr73_kiwi.ntp import measure_offset
from rr73_kiwi.politeness import STATUS_POLL_S, admission, allowed_session_s, crowded
from rr73_kiwi.slots import FT8_SLOT_S, Slot, SlotAssembler
from rr73_kiwi.state import ReceiverState
from rr73_kiwi.status import KiwiStatus, StatusError, fetch_status

log = logging.getLogger("rr73_kiwi")

# Extra wall time allowed after the last planned slot for its audio to arrive.
END_GRACE_S = 20.0

# Outcomes. "recorded" and "ended-by-receiver" held a channel; the others did not.
RECORDED = "recorded"
ENDED_BY_RECEIVER = "ended-by-receiver"
BUSY = "busy"
REFUSED = "refused"
ERROR = "error"
NO_ALLOWANCE = "no-allowance"
STOPPED = "stopped"


@dataclass
class SessionResult:
    outcome: str
    detail: str
    started_unix: float
    ended_unix: float
    connected_s: float = 0.0
    slots_written: int = 0
    record: dict = field(default_factory=dict)
    time_limited: bool = False  # the receiver announced or enforced a time limit or a kick


@dataclass(frozen=True)
class SessionContext:
    """What a session needs besides the receiver and band."""

    corpus_root: Path
    stop: threading.Event
    ntp_server: str | None
    status_reader: Callable[[str, int], KiwiStatus] = fetch_status
    now: Callable[[], float] = time.time
    status_poll_s: float = STATUS_POLL_S


class _CrowdWatch(threading.Thread):
    """Reads /status every STATUS_POLL_S during a session and flags when the receiver fills up."""

    def __init__(self, receiver: Receiver, read: Callable[[str, int], KiwiStatus], interval_s: float) -> None:
        super().__init__(name=f"crowd-watch-{receiver.id}", daemon=True)
        self._receiver = receiver
        self._read = read
        self._interval_s = interval_s
        self.done = threading.Event()
        self.crowded_by: str = ""

    def run(self) -> None:
        while not self.done.wait(self._interval_s):
            try:
                status = self._read(self._receiver.host, self._receiver.port)
            except StatusError:
                continue
            if crowded(status):
                self.crowded_by = f"{status.users} of {status.users_max} channels in use"
                return


def run_session(
    receiver: Receiver, band: str, length_s: float, state: ReceiverState, ctx: SessionContext
) -> SessionResult:
    """Record one session of at most length_s seconds. Never raises for receiver or network trouble."""
    started = ctx.now()
    record: dict = {"receiver": receiver.id, "band": band, "requested_s": length_s}

    def result(
        outcome: str, detail: str, connected_s: float = 0.0, slots_written: int = 0, time_limited: bool = False
    ) -> SessionResult:
        record.update(outcome=outcome, detail=detail, time_limited=time_limited)
        return SessionResult(outcome, detail, started, ctx.now(), connected_s, slots_written, record, time_limited)

    try:
        status = ctx.status_reader(receiver.host, receiver.port)
    except StatusError as exc:
        return result(ERROR, str(exc))
    record["status_before"] = {"users": status.users, "users_max": status.users_max}
    decision = admission(status)
    if not decision.allowed:
        return result(BUSY, decision.reason)
    length_s = allowed_session_s(length_s, state.server_limits, state.used_s(started))
    if length_s <= 0:
        return result(NO_ALLOWANCE, "the receiver's daily time limit for this address is used up")

    correction_s = -receiver.latency_s
    if ctx.ntp_server:
        offset = measure_offset(ctx.ntp_server)
        if offset is None:
            log.warning("NTP server %s did not answer; using the host clock as it is", ctx.ntp_server)
        else:
            correction_s += offset.offset_s
            record["ntp"] = {"server": offset.server, "offset_s": offset.offset_s, "rtt_s": offset.rtt_s}
    record["correction_s"] = correction_s

    dial = dial_hz(band)
    written: list[str] = []
    clipped = [0]

    def on_slot(slot: Slot) -> None:
        path = write_slot(ctx.corpus_root, receiver, dial, slot)
        if path is None:
            log.warning("%s: slot %s already exists; kept the existing files", receiver.id, slot_stem(slot.start_unix))
            return
        written.append(path.stem)
        clipped[0] += slot.clipped
        log.info("%s %s: wrote %s (%s timing)", receiver.id, band, path.stem, slot.clock.reference)

    holder: dict[str, SlotAssembler] = {}

    def on_rate(rate_hz: float) -> None:
        if "assembler" in holder:
            holder["assembler"].set_rate(rate_hz)
        else:
            holder["assembler"] = SlotAssembler(rate_hz, on_slot, correction_s=correction_s)

    def on_frame(seq: int, samples: np.ndarray, gps: dict[str, int] | None, arrival: float) -> None:
        if "assembler" in holder:
            holder["assembler"].add(seq, samples, gps, arrival)

    if ctx.stop.is_set():
        return result(STOPPED, "stopped before connecting")
    connection = IqConnection(receiver.host, receiver.port, dial, IDENT, on_frame, on_rate, ctx.now)
    watch = _CrowdWatch(receiver, ctx.status_reader, ctx.status_poll_s)
    outcome, detail = RECORDED, ""
    ended_by_limit = False
    connected_at = ctx.now()
    # Stop after the last slot that ends within the session length, and never after the length.
    end_slot = math.floor((connected_at + length_s - 2.0) / FT8_SLOT_S) * FT8_SLOT_S
    hard_end = connected_at + length_s
    limits_checked = False
    try:
        connection.open()
        watch.start()
        while True:
            if ctx.stop.is_set():
                outcome, detail = STOPPED, "stopped by signal"
                break
            if watch.crowded_by:
                detail = f"ended early to free a channel: {watch.crowded_by}"
                break
            assembler = holder.get("assembler")
            now = ctx.now()
            if assembler is not None and assembler.last_slot_end is not None and assembler.last_slot_end >= end_slot:
                break
            if now >= hard_end:
                detail = f"reached the session length of {hard_end - connected_at:.0f} s"
                break
            if now >= end_slot + END_GRACE_S:
                detail = "the last slot did not complete in time"
                break
            if not limits_checked and connection.info.limits is not None:
                limits_checked = True
                state.limits = connection.info.limits.to_json()
                allowed = allowed_session_s(length_s, connection.info.limits, state.used_s(started))
                if allowed <= 0:
                    outcome, detail = NO_ALLOWANCE, "the receiver's daily time limit for this address is used up"
                    break
                end_slot = min(end_slot, math.floor((connected_at + allowed - 2.0) / FT8_SLOT_S) * FT8_SLOT_S)
                hard_end = min(hard_end, connected_at + allowed)
            connection.poll()
    except StreamEnded as exc:
        kinds = {"busy": BUSY, "refused": REFUSED, "closed": ENDED_BY_RECEIVER, "limit": ENDED_BY_RECEIVER}
        outcome = kinds.get(exc.kind, ERROR)
        detail = str(exc)
        ended_by_limit = exc.kind == "limit"
    finally:
        connection.close()
        watch.done.set()
        assembler = holder.get("assembler")
        if assembler is not None:
            assembler.finish()
    ended = ctx.now()
    if outcome in (BUSY, REFUSED) and written:
        outcome = ENDED_BY_RECEIVER
    if not detail:
        detail = f"wrote {len(written)} slots"
    notices = connection.info.notices
    time_limited = ended_by_limit or bool(notices)
    if notices:
        detail = f"{detail}; the receiver sent {', '.join(notices)}"
    record["notices"] = notices
    connected_s = ended - connected_at
    record["connected_s"] = round(connected_s, 1)
    record["server"] = {
        "version": connection.info.version,
        "sample_rate_hz": connection.info.sample_rate_hz,
        "limits": connection.info.limits.to_json() if connection.info.limits else None,
        "messages": sorted(set(connection.info.messages)),
    }
    assembler = holder.get("assembler")
    if assembler is not None:
        stats = assembler.stats
        clock = stats.last_clock
        record["stream"] = {
            "frames": stats.frames,
            "segments": stats.segments,
            "gaps": stats.gaps,
            "slots_written": len(written),
            "slots_discarded": stats.discarded,
            "clipped_samples": clipped[0],
            "gps_rejected": stats.gps_rejected,
            "timing": None
            if clock is None
            else {
                "reference": clock.reference,
                "rate_hz": clock.rate_hz,
                "rate_source": clock.rate_source,
                "measured_rate_hz": clock.measured_rate_hz,
                "measured_rate_se_hz": clock.measured_rate_se_hz,
                "offset_s": clock.offset_s,
                "rms_s": clock.rms_s,
            },
        }
    record["slots"] = written
    return result(outcome, detail, connected_s=connected_s, slots_written=len(written), time_limited=time_limited)
