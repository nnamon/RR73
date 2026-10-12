"""Per-receiver state that survives restarts: waits, failures, band rotation and session history.

The state lives next to the receiver's slots, in corpus/kiwi/<receiver>/.rr73-kiwi-state, so a
new rr73-kiwi process honours the break and backoff of the previous one. A lock file in the
same directory keeps two processes from recording the same receiver at once.
"""

from __future__ import annotations

import json
import os
import socket
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

from rr73_kiwi.politeness import ServerLimits

STATE_NAME = ".rr73-kiwi-state"
LOCK_NAME = ".rr73-kiwi-lock"
LOG_NAME = "sessions.jsonl"
DAY_S = 86400.0
LOCK_STALE_S = 180.0


def receiver_dir(corpus_root: Path, receiver_id: str) -> Path:
    return corpus_root / "kiwi" / receiver_id


@dataclass
class ReceiverState:
    """When the receiver may next be contacted, and what happened before."""

    next_attempt_unix: float = 0.0
    last_attempt_unix: float = 0.0
    failures: int = 0
    rotation: int = 0
    sessions: list[list[float]] = field(default_factory=list)  # [start, end] Unix times, last 24 h
    limits: dict[str, float | None] = field(default_factory=dict)

    def used_s(self, now: float) -> float:
        """Seconds connected during the 24 hours before now."""
        return sum(max(0.0, end - max(start, now - DAY_S)) for start, end in self.sessions if end > now - DAY_S)

    def record_session(self, start: float, end: float, now: float) -> None:
        self.sessions = [s for s in self.sessions if s[1] > now - DAY_S] + [[start, end]]

    @property
    def server_limits(self) -> ServerLimits:
        return ServerLimits.from_json(self.limits)

    @classmethod
    def load(cls, path: Path) -> ReceiverState:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return cls()
        except (OSError, json.JSONDecodeError):
            # A damaged state file must not let the recorder skip its waits: start with a long one.
            return cls(next_attempt_unix=path.stat().st_mtime + 3600.0 if path.exists() else 0.0)
        known = {k: data[k] for k in cls.__dataclass_fields__ if k in data}
        return cls(**known)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=path.parent)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(asdict(self), out, indent=2)
            out.write("\n")
        os.replace(tmp, path)


class LockBusy(Exception):
    """Another rr73-kiwi process holds the receiver."""


class ReceiverLock:
    """A lock file holding the owner's host name, process id and a heartbeat time.

    A lock whose heartbeat is older than LOCK_STALE_S is treated as left behind by a process
    that died, and is taken over.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._owner = f"{socket.gethostname()}:{os.getpid()}"
        self._held = False

    def acquire(self, now: float) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self._path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
            except FileExistsError:
                if not self._stale(now):
                    raise LockBusy(f"{self._path} is held by {self._read().get('owner', 'another process')}") from None
                self._path.unlink(missing_ok=True)
                continue
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                json.dump({"owner": self._owner, "heartbeat": now}, out)
            self._held = True
            return
        raise LockBusy(f"{self._path} could not be taken")

    def refresh(self, now: float) -> None:
        if self._held:
            tmp = self._path.with_name(self._path.name + ".tmp")
            tmp.write_text(json.dumps({"owner": self._owner, "heartbeat": now}), encoding="utf-8")
            os.replace(tmp, self._path)

    def release(self) -> None:
        if self._held:
            if self._read().get("owner") == self._owner:
                self._path.unlink(missing_ok=True)
            self._held = False

    def _read(self) -> dict:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _stale(self, now: float) -> bool:
        heartbeat = self._read().get("heartbeat")
        if not isinstance(heartbeat, int | float):
            try:
                heartbeat = self._path.stat().st_mtime
            except FileNotFoundError:
                return True
        return now - heartbeat > LOCK_STALE_S


def append_log(path: Path, record: dict) -> None:
    """Append one JSON line to the receiver's session log."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as out:
        out.write(json.dumps(record, sort_keys=True) + "\n")
