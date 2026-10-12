"""The SNTP check against a fake NTP server on 127.0.0.1."""

from __future__ import annotations

import socket
import struct
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

import pytest

from rr73_kiwi.ntp import NTP_TO_UNIX_S, measure_offset


def ntp_bytes(unix_s: float) -> bytes:
    value = unix_s + NTP_TO_UNIX_S
    return struct.pack("!II", int(value), int((value % 1) * 2**32))


@contextmanager
def ntp_server(
    offset_s: float = 0.5, stratum: int = 2, leap: int = 0, echo: bool = True, mode: int = 4
) -> Iterator[int]:
    """Answers SNTP requests with a clock offset_s ahead of this host."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    sock.settimeout(0.2)
    done = threading.Event()

    def serve() -> None:
        while not done.is_set():
            try:
                request, peer = sock.recvfrom(512)
            except OSError:
                continue
            now = time.time() + offset_s
            reply = bytearray(48)
            reply[0] = (leap << 6) | (4 << 3) | mode
            reply[1] = stratum
            reply[24:32] = request[40:48] if echo else ntp_bytes(12345.0)
            reply[32:40] = ntp_bytes(now)
            reply[40:48] = ntp_bytes(now)
            sock.sendto(bytes(reply), peer)

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        yield sock.getsockname()[1]
    finally:
        done.set()
        thread.join()
        sock.close()


def test_a_good_reply_gives_the_offset() -> None:
    with ntp_server(offset_s=0.5) as port:
        offset = measure_offset("127.0.0.1", timeout_s=0.5, port=port)
    assert offset is not None and offset.offset_s == pytest.approx(0.5, abs=0.05)


@pytest.mark.parametrize(
    "server",
    [
        {"stratum": 0},  # kiss-o'-death
        {"stratum": 16},  # unsynchronised
        {"leap": 3},  # clock not synchronised
        {"echo": False},  # not a reply to our request
        {"offset_s": 3600.0},  # implausible
    ],
)
def test_unusable_replies_are_rejected(server: dict) -> None:
    with ntp_server(**server) as port:
        assert measure_offset("127.0.0.1", timeout_s=0.3, port=port) is None
