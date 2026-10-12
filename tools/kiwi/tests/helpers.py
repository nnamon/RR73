"""Synthetic Kiwi IQ streams with known timing, for the slot, timing and session tests."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

import numpy as np

from rr73_kiwi.timing import GPS_EPOCH_UNIX, GPS_UTC_LEAP_S, SECONDS_PER_WEEK

FRAME = 512
PULSE_HZ = 1500.0
PULSE_SIGMA_S = 0.002


@dataclass
class Stream:
    """A stream whose first sample is at start_unix (true UTC) and whose true rate is rate_hz."""

    start_unix: float
    rate_hz: float = 12001.135
    duration_s: float = 70.0
    tone_hz: float = 700.0
    markers: list[float] = field(default_factory=list)  # true UTC times of short pulses at +1500 Hz
    latency_s: float = 0.3

    @property
    def count(self) -> int:
        n = int(self.duration_s * self.rate_hz)
        return n - n % FRAME

    def samples(self) -> np.ndarray:
        t = self.start_unix + np.arange(self.count) / self.rate_hz
        rel = t - self.start_unix
        iq = 1500.0 * np.exp(2j * np.pi * self.tone_hz * rel)
        for marker in self.markers:
            d = t - marker
            near = np.abs(d) < 10 * PULSE_SIGMA_S
            iq[near] += 8000.0 * np.exp(-0.5 * (d[near] / PULSE_SIGMA_S) ** 2) * np.exp(2j * np.pi * PULSE_HZ * d[near])
        return iq.astype(np.complex64)

    def frames(self, gps: str = "fresh", drop: frozenset[int] = frozenset()) -> Iterator[tuple]:
        """(seq, samples, gps fields or None, arrival) per frame; frames in drop are left out."""
        iq = self.samples()
        for k in range(self.count // FRAME):
            if k in drop:
                continue
            first = self.start_unix + k * FRAME / self.rate_hz
            arrival = first + FRAME / self.rate_hz + self.latency_s
            yield k, iq[k * FRAME : (k + 1) * FRAME], gps_fields(gps, first, k), arrival


def gps_fields(kind: str, first_unix: float, k: int) -> dict[str, int] | None:
    """GPS fields as kiwiclient passes them: a real fix, none, or Web-888 placeholders."""
    if kind == "none":
        return None
    gps_s = first_unix + GPS_UTC_LEAP_S - GPS_EPOCH_UNIX
    tow = gps_s % SECONDS_PER_WEEK
    if kind == "fresh":
        sec = int(tow)
        return {"last_gps_solution": k % 6, "dummy": 0, "gpssec": sec, "gpsnsec": int(round((tow - sec) * 1e9))}
    if kind == "utc":
        tow = (first_unix - GPS_EPOCH_UNIX) % SECONDS_PER_WEEK
        sec = int(tow)
        return {"last_gps_solution": k % 6, "dummy": 0, "gpssec": sec, "gpsnsec": int(round((tow - sec) * 1e9))}
    if kind == "web888":
        return {"last_gps_solution": 0, "dummy": 0, "gpssec": int(tow + 2078.0), "gpsnsec": 405140266}
    raise ValueError(kind)


def pulse_position(audio: np.ndarray) -> float:
    """Sample index of the strongest pulse in real audio, from the analytic envelope, to a fraction of a sample."""
    spectrum = np.fft.fft(audio.astype(np.float64))
    n = len(audio)
    spectrum[n // 2 + 1 :] = 0
    spectrum[1 : n // 2] *= 2
    freqs = np.fft.fftfreq(n, 1 / 12000)
    spectrum[np.abs(freqs - PULSE_HZ) > 400] = 0  # keep the pulse, drop the steady tone
    envelope = np.abs(np.fft.ifft(spectrum))
    i = int(np.argmax(envelope))
    a, b, c = envelope[i - 1], envelope[i], envelope[i + 1]
    return i + 0.5 * (a - c) / (a - 2 * b + c)
