"""Per-receiver state that survives restarts: waits, failures, band rotation and session history.

The state lives next to the receiver's slots, in corpus/kiwi/<receiver>/.rr73-kiwi-state, so a
new rr73-kiwi process honours the break and backoff of the previous one. An flock on a file in
the same directory keeps two processes from recording the same receiver at once.
"""

from __future__ import annotations

import fcntl
import json
import os
import socket
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from rr73_kiwi.politeness import ServerLimits

STATE_NAME = ".rr73-kiwi-state"
LOCK_NAME = ".rr73-kiwi-lock"
LOG_NAME = "sessions.jsonl"
DAY_S = 86400.0


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
        os.chmod(tmp, 0o644)  # mkstemp creates 0600
        os.replace(tmp, path)


class LockBusy(Exception):
    """Another rr73-kiwi process holds the receiver."""


class LockError(Exception):
    """The lock file cannot be locked, for example on a file system without flock."""


class ReceiverLock:
    """An exclusive flock on the receiver's lock file, held on one descriptor for the session.

    The kernel releases the lock when the holder exits, however it exits, so a lock is never
    left behind and never taken over while its holder lives. The file stays in place and names
    the last holder. Tested across containers on a Docker Desktop bind mount.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._fd: int | None = None

    def acquire(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self._path, os.O_RDWR | os.O_CREAT, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            raise LockBusy(f"{self._path} is held by {self._holder()}") from None
        except OSError as exc:
            os.close(fd)
            raise LockError(f"cannot lock {self._path}: {exc.strerror}. Keep the corpus on a local disk.") from None
        os.ftruncate(fd, 0)
        os.write(fd, json.dumps({"owner": f"{socket.gethostname()}:{os.getpid()}", "since": time.time()}).encode())
        self._fd = fd

    def release(self) -> None:
        if self._fd is not None:
            fcntl.flock(self._fd, fcntl.LOCK_UN)
            os.close(self._fd)
            self._fd = None

    def _holder(self) -> str:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return "another process"
        return str(data.get("owner", "another process")) if isinstance(data, dict) else "another process"


def append_log(path: Path, record: dict) -> None:
    """Append one JSON line to the receiver's session log."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as out:
        out.write(json.dumps(record, sort_keys=True) + "\n")
