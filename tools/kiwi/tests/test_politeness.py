"""Politeness checks against a fake /status endpoint, and the rule arithmetic."""

from __future__ import annotations

import http.server
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

import pytest

from rr73_kiwi.politeness import (
    MAX_SESSION_S,
    ServerLimits,
    admission,
    allowed_session_s,
    backoff_s,
    crowded,
    rules_for,
)
from rr73_kiwi.status import StatusError, fetch_status, parse_status

SARTS_STATUS = """status=private
offline=no
name=0-30 MHz SDR | Singapore
users=9
users_max=13
gps_good=23
sw_version=Web888_v2026.205
antenna=Wellbrook Loop
"""


@contextmanager
def status_server(body: str, code: int = 200, delay_s: float = 0.0) -> Iterator[tuple[int, list[dict[str, str]]]]:
    """Serve body at /status on 127.0.0.1; yields the port and the request headers seen."""
    seen: list[dict[str, str]] = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 (http.server API)
            seen.append(dict(self.headers))
            time.sleep(delay_s)
            data = body.encode()
            self.send_response(code)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args: object) -> None:
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1], seen
    finally:
        server.shutdown()
        server.server_close()


def status_with(users: int, users_max: int, **extra: str) -> str:
    lines = {"status": "active", "offline": "no", "users": str(users), "users_max": str(users_max), **extra}
    return "".join(f"{k}={v}\n" for k, v in lines.items())


def test_sarts_status_page_allows_a_connection_and_identifies_us() -> None:
    with status_server(SARTS_STATUS) as (port, seen):
        status = fetch_status("127.0.0.1", port)
    assert (status.users, status.users_max, status.free_channels) == (9, 13, 4)
    assert admission(status, rules_for("public")).allowed
    assert seen[0]["User-Agent"] == "rr73-kiwi (RR73 corpus 9V1NE)"


@pytest.mark.parametrize(
    ("access", "users", "users_max", "allowed"),
    [
        ("public", 0, 4, True),
        ("public", 0, 3, False),
        ("public", 9, 13, True),
        ("public", 10, 13, False),
        ("public", 12, 13, False),
        ("public", 13, 13, False),
        ("public", 4, 8, True),
        ("public", 5, 8, False),
        ("club", 10, 13, True),
        ("club", 11, 13, False),
        ("club", 13, 13, False),
        ("club", 0, 2, False),
        ("club", 0, 3, True),
    ],
)
def test_connect_only_when_enough_channels_stay_free(access: str, users: int, users_max: int, allowed: bool) -> None:
    with status_server(status_with(users, users_max)) as (port, _):
        assert admission(fetch_status("127.0.0.1", port), rules_for(access)).allowed is allowed


@pytest.mark.parametrize("extra", [{"offline": "yes"}, {"status": "offline"}, {"status": "down"}])
def test_offline_receivers_are_skipped(extra: dict[str, str]) -> None:
    decision = admission(parse_status(status_with(1, 13, **extra)), rules_for("public"))
    assert not decision.allowed and "offline" in decision.reason


@pytest.mark.parametrize(
    "body", ["status=active\nusers=3\n", "users=three\nusers_max=8\n", "<html>Not a Kiwi</html>", ""]
)
def test_status_without_usable_counts_is_an_error(body: str) -> None:
    with status_server(body) as (port, _), pytest.raises(StatusError):
        fetch_status("127.0.0.1", port)


def test_http_errors_unreachable_and_slow_receivers_are_errors() -> None:
    with status_server(SARTS_STATUS, code=503) as (port, _), pytest.raises(StatusError, match="HTTP 503"):
        fetch_status("127.0.0.1", port)
    with status_server(SARTS_STATUS) as (port, _):
        pass
    with pytest.raises(StatusError, match="unreachable"):
        fetch_status("127.0.0.1", port)
    with status_server(SARTS_STATUS, delay_s=2.0) as (port, _):
        started = time.monotonic()
        with pytest.raises(StatusError):
            fetch_status("127.0.0.1", port, timeout_s=0.5)
        assert time.monotonic() - started < 1.9


def test_crowding_threshold_during_a_session() -> None:
    assert not crowded(parse_status(status_with(10, 13)))  # our channel included: 3 free
    assert not crowded(parse_status(status_with(11, 13)))
    assert crowded(parse_status(status_with(12, 13)))
    assert crowded(parse_status(status_with(13, 13)))


def test_backoff_doubles_and_is_capped() -> None:
    club = rules_for("club")
    assert [backoff_s(club, n) for n in range(0, 5)] == [0, 120, 240, 480, 960]
    assert backoff_s(club, 50) == club.backoff_cap_s == 7200
    public = rules_for("public")
    assert backoff_s(public, 1) == 600 and backoff_s(public, 20) == public.backoff_cap_s


def test_public_receivers_wait_longer_than_club_receivers() -> None:
    club, public = rules_for("club"), rules_for("public")
    for name in ("min_break_s", "busy_wait_s", "backoff_base_s", "backoff_cap_s", "min_attempt_gap_s"):
        assert getattr(public, name) > getattr(club, name), name
    assert club.min_break_s == 300 and public.min_break_s == 1800
    with pytest.raises(ValueError):
        rules_for("friends")


def test_receiver_time_limits_shorten_or_prevent_sessions() -> None:
    none = ServerLimits()
    assert allowed_session_s(20 * 60, none, 0) == MAX_SESSION_S
    assert allowed_session_s(12 * 60, none, 0) == 12 * 60
    inactivity = ServerLimits(inactivity_timeout_s=10 * 60)
    assert allowed_session_s(12 * 60, inactivity, 0) == 9 * 60
    daily = ServerLimits(ip_limit_s=60 * 60)
    assert allowed_session_s(12 * 60, daily, 50 * 60) == 9 * 60
    assert allowed_session_s(12 * 60, daily, 57 * 60) == 2 * 60
    assert allowed_session_s(12 * 60, daily, 58 * 60) == 0


def test_limits_from_the_receiver_configuration() -> None:
    # The SARTS Web-888 sends inactivity_timeout_mins=90 and ip_limit_mins=0 in load_cfg.
    limits = ServerLimits.from_config({"inactivity_timeout_mins": 90, "ip_limit_mins": 0, "rx_name": "x"})
    assert limits == ServerLimits(inactivity_timeout_s=5400.0, ip_limit_s=None)
    assert ServerLimits.from_json(limits.to_json()) == limits
    assert ServerLimits.from_config({"inactivity_timeout_mins": True}) == ServerLimits()


@contextmanager
def raw_server(reply: bytes) -> Iterator[int]:
    """A TCP server on 127.0.0.1 that sends reply to every connection and closes it."""
    import socket

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    done = threading.Event()

    def serve() -> None:
        listener.settimeout(0.2)
        while not done.is_set():
            try:
                conn, _ = listener.accept()
            except OSError:
                continue
            with conn:
                conn.recv(4096)
                conn.sendall(reply)

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        yield listener.getsockname()[1]
    finally:
        done.set()
        thread.join()
        listener.close()


@pytest.mark.parametrize(
    "reply",
    [
        b"HELLO WORLD\r\n\r\n",  # not HTTP: BadStatusLine
        b"HTTP/1.1 200 OK\r\nContent-Length: 500\r\n\r\nusers=1\nusers_max=8\n",  # cut short: IncompleteRead
        b"",  # closed without a reply: RemoteDisconnected
    ],
)
def test_broken_http_replies_are_status_errors(reply: bytes) -> None:
    with raw_server(reply) as port, pytest.raises(StatusError):
        fetch_status("127.0.0.1", port)
