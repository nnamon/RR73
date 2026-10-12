"""A fake KiwiSDR on 127.0.0.1: the /status page and the SND WebSocket in IQ mode.

It speaks enough of the protocol for kiwiclient: the HTTP upgrade, MSG parameters, and SND
frames carrying GPS fields and big-endian IQ samples. It streams a helpers.Stream faster than
real time and keeps a simulated clock (sim_now) that follows the stream, for the session's clock.
"""

from __future__ import annotations

import base64
import hashlib
import json
import socket
import socketserver
import struct
import threading
import time
import urllib.parse
from dataclasses import dataclass, field

import numpy as np
from helpers import Stream

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


@dataclass
class Behaviour:
    status: dict[str, str] = field(
        default_factory=lambda: {"status": "active", "offline": "no", "users": "2", "users_max": "8"}
    )
    config: dict[str, object] = field(
        default_factory=lambda: {"inactivity_timeout_mins": 90, "ip_limit_mins": 0, "rx_gps": "(1.411547, 103.948270)"}
    )
    too_busy: bool = False
    close_after_frames: int | None = None
    crowd_after_frames: int | None = None  # status reports users_max - 1 users after this many frames
    gps: str = "fresh"
    frame_pause_s: float = 0.002
    upgrade_reply: str | None = None  # an HTTP status such as "307 Temporary Redirect" instead of 101
    limit_after_frames: int | None = None  # send limit_message after this many frames, then close
    limit_message: str = "MSG inactivity_timeout=1"
    status_raw: bytes | None = None  # sent verbatim in place of a /status response


class FakeKiwi:
    def __init__(self, stream: Stream, behaviour: Behaviour | None = None) -> None:
        self.stream = stream
        self.behaviour = behaviour or Behaviour()
        self.sim_now = stream.start_unix
        self.status_requests: list[dict[str, str]] = []
        self.ws_connections = 0
        self.received: list[str] = []
        self.close_codes: list[int] = []
        self.frames_sent = 0
        self.events: list[str] = []
        self.upgrade_attempts = 0
        self.rejected_closed: list[bool] = []  # per rejected upgrade: did the client close its socket
        self._lock = threading.Lock()
        fake = self

        class Handler(socketserver.BaseRequestHandler):
            def handle(self) -> None:
                fake._handle(self.request)

        socketserver.ThreadingTCPServer.allow_reuse_address = True
        self._server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self.port = self._server.server_address[1]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    def __enter__(self) -> FakeKiwi:
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._server.shutdown()
        self._server.server_close()

    def now(self) -> float:
        return self.sim_now

    # HTTP

    def _handle(self, sock: socket.socket) -> None:
        request = b""
        while b"\r\n\r\n" not in request:
            chunk = sock.recv(4096)
            if not chunk:
                return
            request += chunk
        head = request.split(b"\r\n\r\n")[0].decode("latin-1")
        lines = head.split("\r\n")
        path = lines[0].split()[1]
        headers = {k.strip().lower(): v.strip() for k, _, v in (line.partition(":") for line in lines[1:])}
        if path == "/status" and self.behaviour.status_raw is not None:
            sock.sendall(self.behaviour.status_raw)
            return
        if path == "/status":
            with self._lock:
                self.status_requests.append(headers)
                self.events.append("status")
                status = dict(self.behaviour.status)
            body = "".join(f"{k}={v}\n" for k, v in status.items()).encode()
            sock.sendall(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: %d\r\n\r\n" % len(body) + body
            )
            return
        if headers.get("upgrade", "").lower() == "websocket" and path.endswith("/SND"):
            if self.behaviour.upgrade_reply is not None:
                self._reject_upgrade(sock)
                return
            self._websocket(sock, headers["sec-websocket-key"])
            return
        sock.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")

    def _reject_upgrade(self, sock: socket.socket) -> None:
        with self._lock:
            self.upgrade_attempts += 1
            self.events.append("upgrade-rejected")
        reply = f"HTTP/1.1 {self.behaviour.upgrade_reply}\r\n"
        if self.behaviour.upgrade_reply.startswith("3"):
            reply += f"Location: http://127.0.0.1:{self.port}/\r\n"
        sock.sendall((reply + "Content-Length: 0\r\n\r\n").encode())
        sock.settimeout(3.0)
        try:
            closed = sock.recv(1) == b""
        except ConnectionResetError:
            closed = True  # a close with unread data in the client's buffer sends a reset
        except OSError:
            closed = False
        with self._lock:
            self.rejected_closed.append(closed)

    # WebSocket

    def _websocket(self, sock: socket.socket, key: str) -> None:
        # A small send buffer makes the stream wait for the client, so sim_now stays within a few
        # seconds of the frames the client is reading, as arrival times do on a real network.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 8192)
        with self._lock:
            self.ws_connections += 1
            self.events.append("ws")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        sock.sendall(
            (
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode()
        )
        streaming = threading.Event()
        closed = threading.Event()
        reader = threading.Thread(target=self._read_client, args=(sock, streaming, closed), daemon=True)
        reader.start()
        if not streaming.wait(10):
            return
        if self.behaviour.too_busy:
            reader.join(5)
            return
        try:
            for seq, samples, gps, arrival in self.stream.frames(self.behaviour.gps):
                if closed.is_set():
                    break
                if self.behaviour.close_after_frames is not None and seq >= self.behaviour.close_after_frames:
                    sock.shutdown(socket.SHUT_RDWR)
                    break
                if self.behaviour.limit_after_frames is not None and seq >= self.behaviour.limit_after_frames:
                    self._send(sock, self.behaviour.limit_message.encode())
                    sock.shutdown(socket.SHUT_RDWR)
                    break
                if self.behaviour.crowd_after_frames is not None and seq == self.behaviour.crowd_after_frames:
                    with self._lock:
                        users_max = int(self.behaviour.status["users_max"])
                        self.behaviour.status["users"] = str(users_max - 1)
                self._send(sock, self._snd(seq, samples, gps))
                self.sim_now = arrival
                self.frames_sent += 1
                time.sleep(self.behaviour.frame_pause_s)
        except OSError:
            pass
        closed.wait(5)

    def _read_client(self, sock: socket.socket, streaming: threading.Event, closed: threading.Event) -> None:
        try:
            while True:
                opcode, payload = self._read_frame(sock)
                if opcode == 8:
                    self.close_codes.append(struct.unpack("!H", payload[:2])[0] if len(payload) >= 2 else 0)
                    break
                text = payload.decode("utf-8", errors="replace")
                self.received.append(text)
                if text.startswith("SET auth"):
                    if self.behaviour.too_busy:
                        self._send(sock, b"MSG too_busy=13")
                        streaming.set()
                        continue
                    config = urllib.parse.quote(json.dumps(self.behaviour.config))
                    for message in (
                        "MSG version_maj=2026 version_min=205",
                        f"MSG load_cfg={config}",
                        "MSG audio_rate=12000",
                        f"MSG sample_rate={self.stream.rate_hz:.6f}",
                    ):
                        self._send(sock, message.encode())
                if text.startswith("SET mod=iq"):
                    streaming.set()
        except (OSError, ConnectionError):
            pass
        finally:
            closed.set()

    @staticmethod
    def _read_exact(sock: socket.socket, n: int) -> bytes:
        data = b""
        while len(data) < n:
            chunk = sock.recv(n - len(data))
            if not chunk:
                raise ConnectionError("client went away")
            data += chunk
        return data

    def _read_frame(self, sock: socket.socket) -> tuple[int, bytes]:
        b0, b1 = self._read_exact(sock, 2)
        length = b1 & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._read_exact(sock, 2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._read_exact(sock, 8))[0]
        mask = self._read_exact(sock, 4) if b1 & 0x80 else b"\0\0\0\0"
        payload = bytes(c ^ mask[i % 4] for i, c in enumerate(self._read_exact(sock, length)))
        return b0 & 0x0F, payload

    @staticmethod
    def _send(sock: socket.socket, payload: bytes) -> None:
        n = len(payload)
        if n < 126:
            header = struct.pack("!BB", 0x82, n)
        elif n < 65536:
            header = struct.pack("!BBH", 0x82, 126, n)
        else:
            header = struct.pack("!BBQ", 0x82, 127, n)
        sock.sendall(header + payload)

    @staticmethod
    def _snd(seq: int, samples: np.ndarray, gps: dict[str, int] | None) -> bytes:
        fields = gps or {"last_gps_solution": 255, "dummy": 0, "gpssec": 0, "gpsnsec": 0}
        iq = np.empty(2 * len(samples), dtype=">i2")
        iq[0::2] = np.clip(np.rint(samples.real), -32768, 32767)
        iq[1::2] = np.clip(np.rint(samples.imag), -32768, 32767)
        return (
            b"SND"
            + struct.pack("<BI", 0x08, seq)
            + struct.pack(">H", 1000)
            + struct.pack("<BBII", fields["last_gps_solution"], 0, fields["gpssec"], fields["gpsnsec"])
            + iq.tobytes()
        )
