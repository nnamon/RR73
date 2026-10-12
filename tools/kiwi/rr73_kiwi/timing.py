"""Map the samples of a Kiwi IQ stream to UTC.

There are two sources of time.

GPS: in IQ mode every frame carries the GPS time of its first sample (seconds of the GPS week
and nanoseconds) and last_gps_solution, the number of frames since the receiver's last GPS fix
(254 or 255 when it has none). Frames with a fresh fix (0) are anchors. A least-squares line
through the anchors gives the true sample rate and the time of every sample. The timestamps
are used only when the anchors agree with each other to within one sample and with the host
clock to within 10 s. Some receivers send placeholder values: the SARTS Web-888 steps the
seconds once per second with a constant nanosecond field, about 2078 s from GPS time.

NTP: the host clock at frame arrival. A frame arrives after its last sample was produced, so
the lower envelope of (arrival time - sample time of the frame's end) over many frames bounds
the true mapping. It is late by the smallest network and receiver latency, which the
configured latency_s corrects. The measured offset of the host clock from NTP is also applied.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

GPS_EPOCH_UNIX = 315_964_800  # 1980-01-06T00:00:00Z
SECONDS_PER_WEEK = 604_800
# GPS time minus UTC since 2017-01-01. Unverified after 2026: check IERS Bulletin C.
GPS_UTC_LEAP_S = 18
NO_FIX = 254
# Accepted GPS fit quality and agreement with the host clock.
MIN_ANCHORS = 10
MIN_ANCHOR_SPAN_S = 2.0
MAX_RATE_ERROR = 500e-6
GPS_LATENCY_RANGE_S = (-0.05, 10.0)
# Arrival-time rate measurement: bin width and the span needed before the measured rate is used.
ARRIVAL_BIN_S = 10.0
MIN_RATE_SPAN_S = 120.0
MAX_ARRIVAL_RATE_ERROR = 300e-6


@dataclass(frozen=True)
class SampleClock:
    """UTC of sample n of a stream segment: t(n) = t0 + n / rate_hz (Unix seconds)."""

    t0: float
    rate_hz: float
    reference: str
    offset_s: float
    rms_s: float
    anchors: int

    def time_at(self, index: float | np.ndarray) -> float | np.ndarray:
        return self.t0 + np.asarray(index, dtype=np.float64) / self.rate_hz

    def index_at(self, unix_s: float | np.ndarray) -> float | np.ndarray:
        return (np.asarray(unix_s, dtype=np.float64) - self.t0) * self.rate_hz


def gps_tow_to_unix(tow_s: float | np.ndarray, near_unix: float | np.ndarray, leap_s: float) -> np.ndarray:
    """Unix time for a GPS time of week, taking the week nearest to near_unix.

    leap_s is GPS time minus UTC: 18 when the receiver sends GPS time, 0 when it sends UTC.
    """
    tow = np.asarray(tow_s, dtype=np.float64)
    gps_now = np.asarray(near_unix, dtype=np.float64) + leap_s - GPS_EPOCH_UNIX
    week = np.round((gps_now - tow) / SECONDS_PER_WEEK)
    return GPS_EPOCH_UNIX + week * SECONDS_PER_WEEK + tow - leap_s


@dataclass(frozen=True)
class FrameLog:
    """Timing data of the frames of one stream segment, oldest first."""

    index: np.ndarray  # sample index of each frame's first sample in the segment
    count: np.ndarray  # samples per frame
    arrival: np.ndarray  # host Unix time at arrival, s
    gps_tow: np.ndarray  # GPS time of week of the first sample, s; NaN without a fix
    fresh: np.ndarray  # True when the frame carries a fresh GPS fix


def fit_gps(frames: FrameLog, nominal_rate_hz: float) -> SampleClock | str:
    """A GPS-referenced clock, or the reason the timestamps cannot be used."""
    usable = frames.fresh & np.isfinite(frames.gps_tow)
    if np.count_nonzero(usable) < MIN_ANCHORS:
        return f"fewer than {MIN_ANCHORS} frames carry a fresh GPS timestamp"
    index = frames.index[usable].astype(np.float64)
    arrival = frames.arrival[usable]
    end_offset = frames.count[usable] / nominal_rate_hz
    chosen = None
    latency = 0.0
    for leap in (GPS_UTC_LEAP_S, 0):
        stamps = gps_tow_to_unix(frames.gps_tow[usable], arrival, leap)
        latency = float(np.median(arrival - (stamps + end_offset)))
        if GPS_LATENCY_RANGE_S[0] <= latency <= GPS_LATENCY_RANGE_S[1]:
            chosen = stamps
            break
    if chosen is None:
        return f"GPS timestamps differ from the host clock by {latency:.1f} s"
    ref_n, ref_t = index[0], chosen[0]
    x, y = index - ref_n, chosen - ref_t
    keep = np.ones(len(x), dtype=bool)
    slope = intercept = 0.0
    for _ in range(2):
        slope, intercept = np.polyfit(x[keep], y[keep], 1)
        residual = y - (intercept + slope * x)
        keep = np.abs(residual) <= 2.0 / nominal_rate_hz
        if np.count_nonzero(keep) < 2:
            break
    kept = int(np.count_nonzero(keep))
    if kept < max(MIN_ANCHORS, int(0.8 * len(x))):
        return f"GPS timestamps disagree with each other: {len(x) - kept} of {len(x)} anchors off by over 2 samples"
    span = (x[keep].max() - x[keep].min()) / nominal_rate_hz
    if span < MIN_ANCHOR_SPAN_S:
        return f"GPS anchors span {span:.1f} s; {MIN_ANCHOR_SPAN_S:.0f} s needed"
    rate = 1.0 / slope if slope > 0 else 0.0
    if abs(rate / nominal_rate_hz - 1.0) > MAX_RATE_ERROR:
        return f"GPS timestamps give {rate:.3f} Hz against {nominal_rate_hz:.3f} Hz reported"
    residual = y[keep] - (intercept + slope * x[keep])
    rms = float(np.sqrt(np.mean(residual**2)))
    if rms > 1.0 / nominal_rate_hz:
        return f"GPS anchors scatter by {rms * 1e6:.0f} us rms"
    t0 = ref_t + intercept - ref_n * slope
    return SampleClock(t0=t0, rate_hz=rate, reference="gps", offset_s=0.0, rms_s=rms, anchors=kept)


def fit_arrival(frames: FrameLog, nominal_rate_hz: float, correction_s: float) -> SampleClock:
    """An NTP-referenced clock from arrival times, with correction_s added to every sample time.

    The sample rate is measured from the lower envelope of arrival times once the frames span
    MIN_RATE_SPAN_S; before that, or when the measurement is implausible, the reported rate is used.
    """
    end = (frames.index + frames.count).astype(np.float64)
    rate = nominal_rate_hz
    rms = 0.0
    span_s = (end[-1] - frames.index[0]) / nominal_rate_hz
    if span_s >= MIN_RATE_SPAN_S:
        bins = np.floor(end / (ARRIVAL_BIN_S * nominal_rate_hz)).astype(np.int64)
        lag = frames.arrival - end / nominal_rate_hz
        # Minimum lag per bin: the frames that waited least in buffers.
        order = np.lexsort((lag, bins))
        first = np.ones(len(order), dtype=bool)
        first[1:] = bins[order][1:] != bins[order][:-1]
        pick = order[first]
        if len(pick) >= 6:
            base = lag[pick].min()
            slope, intercept = np.polyfit(end[pick] - end[pick][0], lag[pick] - base, 1)
            measured = nominal_rate_hz / (1.0 + slope * nominal_rate_hz)
            if abs(measured / nominal_rate_hz - 1.0) <= MAX_ARRIVAL_RATE_ERROR:
                rate = measured
                fitted = base + intercept + slope * (end[pick] - end[pick][0])
                rms = float(np.sqrt(np.mean((lag[pick] - fitted) ** 2)))
    t0 = float(np.min(frames.arrival - end / rate)) + correction_s
    return SampleClock(t0=t0, rate_hz=rate, reference="ntp", offset_s=correction_s, rms_s=rms, anchors=len(end))
