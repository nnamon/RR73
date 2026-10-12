"""Write slots and sidecars in the corpus format of docs/corpus.md."""

from __future__ import annotations

import json
import os
import tempfile
import wave
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from rr73_kiwi.config import Receiver
from rr73_kiwi.slots import OUT_RATE_HZ, Slot

SIDECAR_FORMAT = "rr73-slot/1"
FILE_MODE = 0o644


def utc(unix_s: float) -> datetime:
    return datetime.fromtimestamp(unix_s, tz=UTC)


def slot_stem(start_unix: int) -> str:
    """WSJT-X style stem YYMMDD_HHMMSS for the slot start in UTC."""
    return utc(start_unix).strftime("%y%m%d_%H%M%S")


def slot_dir(corpus_root: Path, receiver_id: str, start_unix: int) -> Path:
    return corpus_root / "kiwi" / receiver_id / utc(start_unix).strftime("%Y%m%d")


def sidecar(receiver: Receiver, dial_hz: int, slot: Slot) -> dict:
    """Sidecar contents for a recorded slot. reference stays empty until reference.py runs."""
    return {
        "format": SIDECAR_FORMAT,
        "mode": "FT8",
        "start_utc": utc(slot.start_unix).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sample_rate": OUT_RATE_HZ,
        "dial_hz": dial_hz,
        "source": {
            "kind": "kiwisdr",
            "receiver": receiver.id,
            "host": receiver.host,
            "antenna": receiver.antenna,
            "grid": receiver.grid,
        },
        "timing": {"reference": slot.clock.reference, "offset_s": round(slot.clock.offset_s, 4)},
        "noise_only": False,
        "truth": None,
        "reference": {},
    }


def _atomic_write(path: Path, write: Callable[[Path], None]) -> None:
    """Write through a temporary file in the same directory, then rename it into place."""
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    os.close(fd)
    try:
        write(Path(tmp))
        os.chmod(tmp, FILE_MODE)  # mkstemp creates 0600
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def write_slot(corpus_root: Path, receiver: Receiver, dial_hz: int, slot: Slot) -> Path | None:
    """Write the WAV, then the sidecar. Returns the WAV path, or None when the slot already exists."""
    if len(slot.samples) != 15 * OUT_RATE_HZ:
        raise ValueError(f"slot has {len(slot.samples)} samples; FT8 slots have {15 * OUT_RATE_HZ}")
    directory = slot_dir(corpus_root, receiver.id, slot.start_unix)
    directory.mkdir(parents=True, exist_ok=True)
    stem = slot_stem(slot.start_unix)
    wav_path, json_path = directory / f"{stem}.wav", directory / f"{stem}.json"
    if wav_path.exists() or json_path.exists():
        return None

    def write_wav(path: Path) -> None:
        with wave.open(str(path), "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(OUT_RATE_HZ)
            out.writeframes(slot.samples.astype("<i2").tobytes())

    def write_json(path: Path) -> None:
        path.write_text(json.dumps(sidecar(receiver, dial_hz, slot), indent=2) + "\n", encoding="utf-8")

    _atomic_write(wav_path, write_wav)
    _atomic_write(json_path, write_json)
    return wav_path
