from datetime import UTC, datetime

import numpy as np
import pytest
from helpers import FRAME, Stream

from rr73_kiwi.timing import (
    GPS_EPOCH_UNIX,
    SECONDS_PER_WEEK,
    FrameLog,
    SampleClock,
    fit_arrival,
    fit_gps,
    gps_tow_to_unix,
)

START = datetime(2026, 10, 13, 13, 14, 22, 300000, tzinfo=UTC).timestamp()


def frame_log(stream: Stream, gps: str, jitter_s: float = 0.0, seed: int = 1) -> FrameLog:
    rows = list(stream.frames(gps))
    rng = np.random.default_rng(seed)
    index = np.array([k * FRAME for k, *_ in rows])
    arrival = np.array([a for *_, a in rows])
    if jitter_s:
        arrival = arrival + rng.exponential(jitter_s, len(rows))
    tow = np.array([np.nan if g is None else g["gpssec"] + 1e-9 * g["gpsnsec"] for _, _, g, _ in rows])
    fresh = np.array([g is not None and g["last_gps_solution"] == 0 for _, _, g, _ in rows])
    return FrameLog(index=index, count=np.full(len(rows), FRAME), arrival=arrival, gps_tow=tow, fresh=fresh)


def test_gps_time_of_week_round_trip() -> None:
    unix = datetime(2026, 10, 13, 13, 14, 15, tzinfo=UTC).timestamp()
    tow = (unix + 18 - GPS_EPOCH_UNIX) % SECONDS_PER_WEEK
    assert gps_tow_to_unix(tow, unix + 3.0, 18) == pytest.approx(unix, abs=1e-6)


def test_gps_week_is_taken_nearest_to_the_host_clock() -> None:
    # 5 s into a GPS week, while the host clock still reads the end of the previous week.
    week_start = GPS_EPOCH_UNIX + 2440 * SECONDS_PER_WEEK - 18
    assert gps_tow_to_unix(5.0, week_start - 2.0, 18) == pytest.approx(week_start + 5.0, abs=1e-6)
    assert gps_tow_to_unix(SECONDS_PER_WEEK - 2.0, week_start + 1.0, 18) == pytest.approx(week_start - 2.0, abs=1e-6)


@pytest.mark.parametrize("kind", ["fresh", "utc"])
def test_gps_fit_recovers_rate_and_time(kind: str) -> None:
    stream = Stream(start_unix=START, rate_hz=12001.135, duration_s=40.0)
    clock = fit_gps(frame_log(stream, kind, jitter_s=0.05), 12001.0)
    assert isinstance(clock, SampleClock)
    assert clock.reference == "gps" and clock.offset_s == 0.0
    assert clock.rate_hz == pytest.approx(12001.135, abs=1e-6)
    assert float(clock.time_at(0)) == pytest.approx(START, abs=1e-6)


def test_web888_placeholder_timestamps_are_rejected() -> None:
    stream = Stream(start_unix=START, duration_s=40.0)
    reason = fit_gps(frame_log(stream, "web888"), 12000.0)
    assert isinstance(reason, str) and "differ from the host clock" in reason


def test_timestamps_stepping_once_per_second_are_rejected() -> None:
    stream = Stream(start_unix=START, duration_s=40.0)
    log = frame_log(stream, "fresh")
    stepped = np.floor(log.gps_tow) + 0.405  # right second, constant fraction
    reason = fit_gps(FrameLog(log.index, log.count, log.arrival, stepped, np.ones_like(log.fresh)), 12001.135)
    assert isinstance(reason, str) and "disagree" in reason


def test_no_gps_is_reported() -> None:
    stream = Stream(start_unix=START, duration_s=10.0)
    assert "fresh GPS timestamp" in fit_gps(frame_log(stream, "none"), 12001.135)  # type: ignore[operator]


def test_arrival_clock_is_late_by_the_smallest_latency_and_corrected() -> None:
    stream = Stream(start_unix=START, rate_hz=12001.135, duration_s=60.0, latency_s=0.3)
    log = frame_log(stream, "none", jitter_s=0.08)
    clock = fit_arrival(log, 12001.135, correction_s=0.0)
    assert clock.reference == "ntp"
    assert float(clock.time_at(0)) - START == pytest.approx(0.3, abs=0.002)
    corrected = fit_arrival(log, 12001.135, correction_s=-0.3)
    assert float(corrected.time_at(0)) == pytest.approx(START, abs=0.002)
    assert corrected.offset_s == -0.3


def test_arrival_clock_measures_the_rate_over_long_spans() -> None:
    stream = Stream(start_unix=START, rate_hz=12001.135, duration_s=300.0, latency_s=0.3)
    log = frame_log(stream, "none", jitter_s=0.05)
    clock = fit_arrival(log, 12000.0, correction_s=0.0)
    assert clock.rate_hz == pytest.approx(12001.135, abs=0.05)
    short = Stream(start_unix=START, rate_hz=12001.135, duration_s=60.0)
    assert fit_arrival(frame_log(short, "none", jitter_s=0.05), 12000.0, 0.0).rate_hz == 12000.0
