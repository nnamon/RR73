"""The WebSocket connection to a receiver, against the fake KiwiSDR."""

from __future__ import annotations

import threading
import time
from datetime import UTC, datetime

import pytest
from fake_kiwi import Behaviour, FakeKiwi
from helpers import Stream

from rr73_kiwi.kiwi import IqConnection, StreamEnded

START = datetime(2026, 10, 13, 13, 14, 22, 300000, tzinfo=UTC).timestamp()


def open_in_thread(connection: IqConnection, timeout_s: float = 3.0) -> tuple[bool, BaseException | None]:
    """Run connection.open() with a time limit. Returns (finished, exception raised)."""
    outcome: list[BaseException | None] = []

    def target() -> None:
        try:
            connection.open()
            outcome.append(None)
        except BaseException as exc:  # noqa: BLE001 (handed to the test)
            outcome.append(exc)

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(timeout_s)
    return (not thread.is_alive(), outcome[0] if outcome else None)


def rejected_closed(fake: FakeKiwi) -> list[bool]:
    """The fake records whether the client closed a rejected socket, within 3 s."""
    deadline = time.monotonic() + 4.0
    while len(fake.rejected_closed) < fake.upgrade_attempts and time.monotonic() < deadline:
        time.sleep(0.05)
    return fake.rejected_closed


def connection(fake: FakeKiwi) -> IqConnection:
    return IqConnection("127.0.0.1", fake.port, 14_074_000, "RR73 corpus 9V1NE", lambda *a: None, lambda r: None)


@pytest.mark.parametrize("reply", ["307 Temporary Redirect", "301 Moved Permanently", "308 Permanent Redirect"])
def test_a_redirect_ends_the_attempt_after_one_connection(reply: str) -> None:
    with FakeKiwi(Stream(start_unix=START), Behaviour(upgrade_reply=reply)) as fake:
        conn = connection(fake)
        finished, error = open_in_thread(conn)
        assert finished, "open() kept reconnecting"
        assert isinstance(error, StreamEnded) and error.kind == "busy"
        assert fake.upgrade_attempts == 1
        assert rejected_closed(fake) == [True]


def test_a_refused_upgrade_closes_the_socket() -> None:
    with FakeKiwi(Stream(start_unix=START), Behaviour(upgrade_reply="403 Forbidden")) as fake:
        conn = connection(fake)
        finished, error = open_in_thread(conn)
        assert finished
        assert isinstance(error, StreamEnded) and error.kind == "refused"
        # The connection object is still referenced here, so only an explicit close ends the socket.
        assert rejected_closed(fake) == [True]
