from datetime import UTC, datetime

import numpy as np
import pytest
from helpers import Stream, pulse_position

from rr73_kiwi.slots import OUT_RATE_HZ, Slot, SlotAssembler

# The stream starts 7.3 s into a slot, so the first slot (13:14:15) is partial and never started.
START = datetime(2026, 10, 13, 13, 14, 22, 300000, tzinfo=UTC).timestamp()
FIRST_SLOT = int(datetime(2026, 10, 13, 13, 14, 30, tzinfo=UTC).timestamp())


def run(
    stream: Stream, gps: str, correction_s: float = 0.0, drop: frozenset[int] = frozenset()
) -> tuple[list[Slot], SlotAssembler]:
    slots: list[Slot] = []
    assembler = SlotAssembler(stream.rate_hz if gps != "none" else round(stream.rate_hz), slots.append, correction_s)
    for seq, samples, fields, arrival in stream.frames(gps, drop):
        assembler.add(seq, samples, fields, arrival)
    assembler.finish()
    return slots, assembler


def marker_stream(**kwargs: float) -> Stream:
    # One pulse 1.0 s after the start of every slot from 13:14:30 to 13:15:15.
    markers = [FIRST_SLOT + 15 * i + 1.0 for i in range(4)]
    return Stream(start_unix=START, duration_s=70.0, markers=markers, **kwargs)


def test_slots_are_aligned_complete_and_exactly_180000_samples() -> None:
    slots, assembler = run(marker_stream(), "fresh")
    # 13:14:22.3 to 13:15:32.3: complete slots 13:14:30, :45, 13:15:00 and :15; 13:15:30 is partial.
    assert [s.start_unix for s in slots] == [FIRST_SLOT + 15 * i for i in range(4)]
    for slot in slots:
        assert slot.samples.dtype == np.int16 and len(slot.samples) == 15 * OUT_RATE_HZ == 180000
        assert slot.clock.reference == "gps"
        assert pulse_position(slot.samples) == pytest.approx(1.0 * OUT_RATE_HZ, abs=0.3)
    assert assembler.stats.discarded == 1
    assert assembler.stats.written == 4


def test_gps_clock_measures_the_true_rate() -> None:
    slots, _ = run(marker_stream(rate_hz=11998.7), "fresh")
    assert slots[-1].clock.rate_hz == pytest.approx(11998.7, abs=1e-4)
    assert all(abs(pulse_position(s.samples) - OUT_RATE_HZ) < 0.3 for s in slots)


def test_without_gps_slots_are_late_by_the_latency_until_corrected() -> None:
    late, _ = run(marker_stream(latency_s=0.3), "none")
    assert all(s.clock.reference == "ntp" for s in late)
    # The receiver reports 12001 Hz; the true rate is 12001.135 Hz. Over 70 s that is 0.8 ms.
    assert pulse_position(late[0].samples) == pytest.approx(1.3 * OUT_RATE_HZ, abs=12)
    corrected, _ = run(marker_stream(latency_s=0.3), "none", correction_s=-0.3)
    assert all(s.clock.offset_s == -0.3 for s in corrected)
    assert [round(pulse_position(s.samples)) for s in corrected] == pytest.approx([12000] * 4, abs=12)


def test_placeholder_gps_falls_back_to_ntp() -> None:
    slots, assembler = run(marker_stream(latency_s=0.3), "web888", correction_s=-0.3)
    assert slots and all(s.clock.reference == "ntp" for s in slots)
    assert "differ from the host clock" in assembler.stats.gps_rejected
    assert all(abs(pulse_position(s.samples) - OUT_RATE_HZ) < 12 for s in slots)


def test_a_gap_discards_only_the_slots_it_touches() -> None:
    stream = marker_stream()
    # Frames 900 to 902 (about 13:15:00.7) are lost: the 13:15:00 slot is cut short and dropped.
    slots, assembler = run(stream, "fresh", drop=frozenset({900, 901, 902}))
    starts = [s.start_unix for s in slots]
    assert FIRST_SLOT + 30 not in starts
    assert starts[:2] == [FIRST_SLOT, FIRST_SLOT + 15]
    assert assembler.stats.gaps == 1 and assembler.stats.segments == 2
    # After the gap the new segment settles for 1 s, then the next whole slot, 13:15:15, is written.
    assert starts[2:] == [FIRST_SLOT + 45]
    assert all(len(s.samples) == 180000 for s in slots)


def test_stream_shorter_than_a_slot_writes_nothing() -> None:
    slots, assembler = run(Stream(start_unix=START, duration_s=12.0), "fresh")
    assert slots == [] and assembler.stats.written == 0


def test_first_second_is_not_used() -> None:
    # Starting 0.5 s before a boundary leaves too little time to settle: that slot is skipped.
    start = FIRST_SLOT - 0.5
    slots, _ = run(Stream(start_unix=start, duration_s=33.0), "fresh")
    assert [s.start_unix for s in slots] == [FIRST_SLOT + 15]
