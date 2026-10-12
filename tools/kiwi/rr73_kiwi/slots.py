"""Cut a Kiwi IQ stream into UTC-aligned FT8 slots of exactly 180000 samples at 12000 Hz."""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np

from rr73_kiwi.resample import KERNEL_HALF_WIDTH, interpolate, to_int16, usb_audio
from rr73_kiwi.timing import NO_FIX, FrameLog, SampleClock, fit_arrival, fit_gps

OUT_RATE_HZ = 12000
FT8_SLOT_S = 15
SETTLE_S = 1.0  # discard the first second of a segment: AGC settling and the channel's old buffer
MARGIN_S = 0.25  # input kept on each side of a slot for the passband filter and the resampler
HISTORY_S = 300.0  # frames used for timing fits
KEEP_S = 1.0  # extra input held before the next slot, so a refitted clock never finds it trimmed
PAD = KERNEL_HALF_WIDTH + 2  # input samples beyond the margin needed by the resampler


@dataclass(frozen=True)
class Slot:
    """One slot ready to write: 16-bit samples at 12000 Hz, sample 0 at start_unix (UTC)."""

    start_unix: int
    samples: np.ndarray
    clock: SampleClock
    clipped: int


@dataclass
class AssemblerStats:
    frames: int = 0
    segments: int = 0
    gaps: int = 0
    written: int = 0
    discarded: int = 0
    gps_rejected: str = ""
    last_clock: SampleClock | None = None
    reported_rates: set[float] = field(default_factory=set)


class SlotAssembler:
    """Collects IQ frames and emits every slot the stream covers completely.

    A segment is a run of frames with consecutive sequence numbers. A gap ends the segment,
    and any slot that overlaps a gap, the segment's first second or the end of the stream is
    discarded.
    """

    def __init__(
        self,
        rate_hz: float,
        on_slot: Callable[[Slot], None],
        correction_s: float = 0.0,
        slot_s: int = FT8_SLOT_S,
    ) -> None:
        self._rate_hz = rate_hz
        self._on_slot = on_slot
        self._correction_s = correction_s
        self._slot_s = slot_s
        self._out_count = slot_s * OUT_RATE_HZ
        self.stats = AssemblerStats(reported_rates={rate_hz})
        self.last_slot_end: int | None = None
        self._reset()

    @property
    def rate_hz(self) -> float:
        return self._rate_hz

    def set_rate(self, rate_hz: float) -> None:
        """The receiver reported a new sample rate: start a new segment."""
        if rate_hz != self._rate_hz:
            self._discard_segment()
            self._rate_hz = rate_hz
            self.stats.reported_rates.add(rate_hz)

    def _reset(self) -> None:
        self._seq: int | None = None
        self._chunks: deque[np.ndarray] = deque()
        self._buffer_start = 0  # segment index of the first sample held in _chunks
        self._total = 0  # samples received in this segment
        self._frames: deque[tuple[int, int, float, float, bool]] = deque()
        self._next_slot: int | None = None
        self._clock: SampleClock | None = None

    def _discard_segment(self) -> None:
        """End the segment. A slot the stream had reached is partial and counts as discarded."""
        if self._next_slot is not None and self._clock is not None:
            if self._total > float(self._clock.index_at(self._next_slot)):
                self.stats.discarded += 1
        self._reset()

    @property
    def _settle_samples(self) -> int:
        return int(SETTLE_S * self._rate_hz)

    def add(self, seq: int, samples: np.ndarray, gps: dict[str, int] | None, arrival_unix: float) -> None:
        """Add one frame: its sequence number, complex samples, GPS fields and host arrival time."""
        if self._seq is not None and seq != (self._seq + 1) & 0xFFFFFFFF:
            self.stats.gaps += 1
            self._discard_segment()
        if self._seq is None:
            self.stats.segments += 1
        self._seq = seq
        self.stats.frames += 1
        tow, fresh = math.nan, False
        if gps is not None and gps.get("last_gps_solution", 255) < NO_FIX:
            tow = gps.get("gpssec", 0) + 1e-9 * gps.get("gpsnsec", 0)
            fresh = gps.get("last_gps_solution") == 0
        self._frames.append((self._total, len(samples), arrival_unix, tow, fresh))
        horizon = self._total - HISTORY_S * self._rate_hz
        while self._frames and self._frames[0][0] < horizon:
            self._frames.popleft()
        self._chunks.append(np.asarray(samples, dtype=np.complex64))
        self._total += len(samples)
        self._emit_ready()

    def finish(self) -> None:
        """End of stream: the slot in progress is partial and is discarded."""
        self._discard_segment()

    def clock(self) -> SampleClock | None:
        """The current sample clock: GPS when the timestamps pass the checks, NTP otherwise."""
        if not self._frames:
            return None
        index, count, arrival, tow, fresh = (np.array(c) for c in zip(*self._frames, strict=True))
        log = FrameLog(index=index, count=count, arrival=arrival, gps_tow=tow, fresh=fresh.astype(bool))
        gps = fit_gps(log, self._rate_hz)
        if isinstance(gps, SampleClock):
            self.stats.gps_rejected = ""
            return gps
        self.stats.gps_rejected = gps  # the latest reason
        return fit_arrival(log, self._rate_hz, self._correction_s)

    def _emit_ready(self) -> None:
        if self._total < self._settle_samples + 2 * MARGIN_S * self._rate_hz:
            return
        if self._next_slot is not None and self._clock is not None:
            # Refit the clock only when the next slot may be complete.
            needed = float(self._clock.index_at(self._next_slot + self._slot_s + MARGIN_S)) + PAD
            if self._total < needed - 0.1 * self._rate_hz:
                return
        clock = self.clock()
        if clock is None:
            return
        self._clock = clock
        pad = PAD
        if self._next_slot is None:
            earliest = float(clock.time_at(self._settle_samples)) + MARGIN_S + pad / clock.rate_hz
            self._next_slot = math.ceil(earliest / self._slot_s) * self._slot_s
        while True:
            start = self._next_slot
            lo = math.floor(float(clock.index_at(start - MARGIN_S))) - pad
            hi = math.ceil(float(clock.index_at(start + self._slot_s + MARGIN_S))) + pad
            if lo < max(self._buffer_start, self._settle_samples):
                self.stats.discarded += 1
                self._next_slot = start + self._slot_s
                continue
            if hi > self._total:
                return
            self._emit(start, clock, lo, hi)
            self._next_slot = start + self._slot_s
            self._trim(math.floor(float(clock.index_at(self._next_slot - MARGIN_S - KEEP_S))))

    def _emit(self, start: int, clock: SampleClock, lo: int, hi: int) -> None:
        held = np.concatenate(list(self._chunks)) if len(self._chunks) > 1 else self._chunks[0]
        self._chunks = deque([held])
        block = held[lo - self._buffer_start : hi - self._buffer_start]
        audio = usb_audio(block, clock.rate_hz)
        # Offsets from the slot start stay small, so the positions carry no float rounding jitter.
        first = (start - clock.t0) * clock.rate_hz - lo
        positions = first + np.arange(self._out_count) * (clock.rate_hz / OUT_RATE_HZ)
        samples, clipped = to_int16(interpolate(audio, positions, clock.rate_hz))
        self.stats.written += 1
        self.stats.last_clock = clock
        self.last_slot_end = start + self._slot_s
        self._on_slot(Slot(start_unix=start, samples=samples, clock=clock, clipped=clipped))

    def _trim(self, keep_from: int) -> None:
        """Drop held samples before segment index keep_from."""
        if keep_from <= self._buffer_start:
            return
        held = np.concatenate(list(self._chunks)) if len(self._chunks) > 1 else self._chunks[0]
        drop = min(keep_from - self._buffer_start, len(held))
        self._chunks = deque([held[drop:]])
        self._buffer_start += drop
