"""Offset of the host clock from an NTP server (SNTP, RFC 4330)."""

from __future__ import annotations

import socket
import struct
import time
from dataclasses import dataclass

NTP_TO_UNIX_S = 2_208_988_800
# A larger offset means a broken server or host clock; the measurement is discarded.
MAX_OFFSET_S = 60.0


@dataclass(frozen=True)
class ClockOffset:
    """offset_s: server time minus host time. rtt_s: round trip, which bounds the error at rtt_s / 2."""

    server: str
    offset_s: float
    rtt_s: float


def _ntp_time(data: bytes, at: int) -> float:
    seconds, fraction = struct.unpack_from("!II", data, at)
    return seconds - NTP_TO_UNIX_S + fraction / 2**32


def _usable(data: bytes, request: bytes) -> bool:
    """A server reply that answers this request from a synchronised clock (RFC 4330, section 5)."""
    if len(data) < 48:
        return False
    leap, mode, stratum = data[0] >> 6, data[0] & 0x07, data[1]
    if mode != 4 or leap == 3 or not 1 <= stratum <= 15:
        return False  # not a server reply, unsynchronised, or a kiss-o'-death (stratum 0)
    return data[24:32] == request[40:48]  # originate must echo our transmit time


def measure_offset(server: str, timeout_s: float = 2.0, tries: int = 3, port: int = 123) -> ClockOffset | None:
    """Best of a few SNTP queries (the one with the shortest round trip), or None when none succeed.

    Replies from unsynchronised servers, replies that do not echo the request, and offsets over
    MAX_OFFSET_S are discarded.
    """
    best: ClockOffset | None = None
    for _ in range(tries):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.settimeout(timeout_s)
                request = bytearray(48)
                request[0] = 0x23  # leap indicator 0, version 4, mode 3 (client)
                sent = time.time()
                transmit = sent + NTP_TO_UNIX_S
                struct.pack_into("!II", request, 40, int(transmit), int((transmit % 1) * 2**32))
                sock.sendto(request, (server, port))
                data, _ = sock.recvfrom(512)
                received = time.time()
        except OSError:
            continue
        if not _usable(data, bytes(request)):
            continue
        server_rx, server_tx = _ntp_time(data, 32), _ntp_time(data, 40)
        offset = ((server_rx - sent) + (server_tx - received)) / 2.0
        rtt = (received - sent) - (server_tx - server_rx)
        if abs(offset) > MAX_OFFSET_S or rtt < 0:
            continue
        if best is None or rtt < best.rtt_s:
            best = ClockOffset(server=server, offset_s=offset, rtt_s=rtt)
    return best
