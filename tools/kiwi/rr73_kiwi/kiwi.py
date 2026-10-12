"""One IQ connection to a KiwiSDR channel, through the official kiwiclient.

kiwiclient (github.com/jks-prv/kiwiclient) is fetched into the image at a pinned commit. Its
KiwiSDRStream class speaks the Kiwi WebSocket protocol; this module drives it for one channel
in IQ mode, which is the only mode whose frames carry GPS timestamps.
"""

from __future__ import annotations

import json
import socket
import time
import types
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

from rr73_kiwi.bands import PASSBAND_HZ
from rr73_kiwi.kiwiclient import client as kc
from rr73_kiwi.politeness import ServerLimits

SOCKET_TIMEOUT_S = 10.0
MAX_MESSAGES = 200

FrameHandler = Callable[[int, np.ndarray, "dict[str, int] | None", float], None]


class _CallbackFailed(Exception):
    """Carries an exception from rr73-kiwi's own frame or rate handler through kiwiclient."""

    def __init__(self, error: Exception) -> None:
        super().__init__(str(error))
        self.error = error


class StreamEnded(Exception):
    """The receiver refused or ended the connection, or the network failed.

    kind is "busy" (no channel for us), "refused" (the receiver turned us away), "closed"
    (the receiver closed a running connection) or "error" (network or protocol failure).
    """

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


@dataclass
class ServerInfo:
    """What the receiver told us after connecting."""

    sample_rate_hz: float | None = None
    version: str = ""
    limits: ServerLimits | None = None
    messages: list[str] = field(default_factory=list)


def _kiwiclient_options(host: str) -> types.SimpleNamespace:
    """The option attributes KiwiSDRStream reads, set for one plain IQ channel."""
    return types.SimpleNamespace(
        server_host=host,
        ws_timestamp=int(time.time()),
        socket_timeout=SOCKET_TIMEOUT_S,
        wideband=False,
        freq_pbc=False,
        idx=0,
        S_meter=-1,
        sdt=0,
        sound=True,
        tstamp=False,
        stats=False,
        ADC_OV=False,
        netcat=False,
        resample=0,
        camp_allow_1ch=False,
        nolocal=False,
        admin=False,
        password="",
        tlimit_password="",
        tlimit=None,
        wf_cal=None,
        user="none",
        bad_cmd=False,
    )


class _Client(kc.KiwiSDRStream):
    def __init__(self, connection: IqConnection) -> None:
        super().__init__()
        self._options = _kiwiclient_options(connection.host)
        self._type = "SND"
        self._start_time = None
        self._connection = connection

    def _setup_rx_params(self) -> None:
        # Sent once the receiver has reported its sample rate.
        self.set_name(urllib.parse.quote(self._connection.ident))
        self.set_mod("iq", PASSBAND_HZ[0], PASSBAND_HZ[1], self._connection.dial_hz / 1000.0)
        self.set_agc(on=True)
        self._set_snd_comp(False)

    def _on_sample_rate_change(self) -> None:
        try:
            self._connection.on_rate(float(self._sample_rate))
        except Exception as exc:
            raise _CallbackFailed(exc) from exc

    def _process_msg_param(self, name: str, value: str | None) -> None:
        self._connection.message(name, value)
        super()._process_msg_param(name, value)

    def _process_iq_samples(
        self, seq: int, samples: np.ndarray, rssi: float, gps: dict[str, int] | None, fmt: str | None
    ) -> None:
        try:
            self._connection.on_frame(int(seq), np.asarray(samples, dtype=np.complex64), gps, self._connection.now())
        except Exception as exc:
            raise _CallbackFailed(exc) from exc


class IqConnection:
    """One channel on one receiver, tuned to a dial frequency in IQ mode with a USB passband."""

    def __init__(
        self,
        host: str,
        port: int,
        dial_hz: int,
        ident: str,
        on_frame: FrameHandler,
        on_rate: Callable[[float], None],
        now: Callable[[], float] = time.time,
    ) -> None:
        self.host = host
        self.port = port
        self.dial_hz = dial_hz
        self.ident = ident
        self.on_frame = on_frame
        self._on_rate = on_rate
        self.now = now
        self.info = ServerInfo()
        self._client = _Client(self)
        self._open = False

    def on_rate(self, rate_hz: float) -> None:
        self.info.sample_rate_hz = rate_hz
        self._on_rate(rate_hz)

    def message(self, name: str, value: str | None) -> None:
        if len(self.info.messages) < MAX_MESSAGES:
            self.info.messages.append(name)
        if name == "load_cfg" and value:
            try:
                config = json.loads(urllib.parse.unquote(value))
            except json.JSONDecodeError:
                config = None
            if isinstance(config, dict):
                self.info.limits = ServerLimits.from_config(config)
        elif name == "version_maj" and value:
            self.info.version = value
        elif name == "version_min" and value:
            self.info.version = f"{self.info.version}.{value}"

    def open(self) -> None:
        """Connect and authenticate. Tuning follows when the receiver reports its sample rate."""
        try:
            self._client.connect(self.host, self.port)
            self._open = True
            self._client.open()
        except _CallbackFailed as exc:
            raise exc.error from None
        except Exception as exc:
            raise _ended(exc) from exc

    def poll(self) -> None:
        """Process one message from the receiver. Raises StreamEnded when the connection ends."""
        try:
            self._client.run()
        except _CallbackFailed as exc:
            raise exc.error from None
        except Exception as exc:
            raise _ended(exc) from exc

    def close(self) -> None:
        """Send a WebSocket close and shut the socket."""
        if self._open:
            self._open = False
            self._client.close()


def _ended(exc: Exception) -> StreamEnded:
    if isinstance(exc, StreamEnded):
        return exc
    if isinstance(exc, kc.KiwiTooBusyError):
        return StreamEnded("busy", f"all channels are in use: {exc}")
    if isinstance(exc, kc.KiwiRedirectError):
        return StreamEnded("busy", "the receiver is full and redirects to another receiver")
    if isinstance(exc, kc.KiwiBadPasswordError):
        return StreamEnded("busy" if "busy" in str(exc) else "refused", str(exc))
    if isinstance(exc, kc.KiwiDownError | kc.KiwiConnectionError):
        return StreamEnded("refused", str(exc))
    if isinstance(exc, kc.KiwiServerTerminatedConnection):
        return StreamEnded("closed", f"the receiver closed the connection: {exc}")
    if isinstance(exc, TimeoutError | socket.timeout):
        return StreamEnded("error", f"no data from the receiver for {SOCKET_TIMEOUT_S:.0f} s")
    if isinstance(exc, OSError):
        return StreamEnded("error", f"network error: {exc}")
    if isinstance(exc, kc.KiwiError):
        return StreamEnded("error", str(exc))
    return StreamEnded("error", f"{type(exc).__name__}: {exc}")
