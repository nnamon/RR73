"""Receiver configuration from receivers.toml."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from rr73_kiwi.bands import FT8_DIAL_HZ
from rr73_kiwi.politeness import ACCESS_CLASSES, DEFAULT_SESSION_S, MAX_SESSION_S, MIN_SESSION_S, rules_for

MINUTES_PER_DAY = 24 * 60
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
_GRID = re.compile(r"^[A-R]{2}[0-9]{2}([a-x]{2})?$")
_HHMM = re.compile(r"^([01][0-9]|2[0-3]):([0-5][0-9])$")


class ConfigError(Exception):
    """receivers.toml is missing, unreadable or breaks a rule."""


@dataclass(frozen=True)
class BandWindow:
    """Bands recorded between two UTC times; the window may wrap past midnight."""

    start_min: int
    end_min: int
    bands: tuple[str, ...]

    def contains(self, minute_of_day: int) -> bool:
        if self.start_min < self.end_min:
            return self.start_min <= minute_of_day < self.end_min
        return minute_of_day >= self.start_min or minute_of_day < self.end_min


@dataclass(frozen=True)
class Receiver:
    """One KiwiSDR receiver and how rr73-kiwi may use it."""

    id: str
    name: str
    host: str
    port: int
    access: str
    antenna: str
    grid: str
    operator: str
    software: str
    channels: int | None
    session_s: float
    break_s: float
    latency_s: float
    plan: tuple[BandWindow, ...]

    def bands_at(self, when: datetime) -> tuple[str, ...]:
        """Bands planned for a UTC time."""
        minute = when.hour * 60 + when.minute
        for window in self.plan:
            if window.contains(minute):
                return window.bands
        return ()


def _parse_hhmm(value: object, where: str) -> int:
    if not isinstance(value, str) or not (match := _HHMM.match(value)):
        raise ConfigError(f'{where}: expected a UTC time as "HH:MM", got {value!r}')
    return int(match.group(1)) * 60 + int(match.group(2))


def _text(table: dict, key: str, where: str, default: str | None = None) -> str:
    value = table.get(key, default)
    if not isinstance(value, str) or not value:
        raise ConfigError(f"{where}: {key} must be a non-empty string")
    return value


def _number(table: dict, key: str, default: float, where: str) -> float:
    value = table.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ConfigError(f"{where}: {key} must be a number")
    return float(value)


def _plan(entries: object, where: str) -> tuple[BandWindow, ...]:
    if not isinstance(entries, list) or not entries:
        raise ConfigError(f"{where}: needs at least one [[receiver.plan]] entry")
    windows = []
    for i, entry in enumerate(entries):
        here = f"{where} plan {i + 1}"
        if not isinstance(entry, dict):
            raise ConfigError(f"{here}: expected a table")
        bands = entry.get("bands")
        if not isinstance(bands, list) or not bands or not all(isinstance(b, str) for b in bands):
            raise ConfigError(f"{here}: bands must be a non-empty list of band names")
        unknown = [b for b in bands if b not in FT8_DIAL_HZ]
        if unknown:
            raise ConfigError(f"{here}: unknown bands {unknown}; known bands are {list(FT8_DIAL_HZ)}")
        start, end = _parse_hhmm(entry.get("from"), here), _parse_hhmm(entry.get("to"), here)
        if start == end:
            raise ConfigError(f"{here}: from and to are equal")
        windows.append(BandWindow(start, end, tuple(bands)))
    covered = [any(w.contains(m) for w in windows) for m in range(MINUTES_PER_DAY)]
    if not all(covered):
        gap = covered.index(False)
        raise ConfigError(f"{where}: the plan has no band at {gap // 60:02d}:{gap % 60:02d} UTC; cover all 24 hours")
    return tuple(windows)


def _receiver(table: object, index: int) -> Receiver:
    where = f"receiver {index + 1}"
    if not isinstance(table, dict):
        raise ConfigError(f"{where}: expected a table")
    rid = _text(table, "id", where)
    if not _ID.match(rid):
        raise ConfigError(f"{where}: id {rid!r} must be lower-case letters, digits and hyphens")
    where = f"receiver {rid}"
    access = _text(table, "access", where)
    if access not in ACCESS_CLASSES:
        raise ConfigError(f"{where}: access must be one of {ACCESS_CLASSES}")
    rules = rules_for(access)
    port = table.get("port", 80)
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ConfigError(f"{where}: port must be an integer from 1 to 65535")
    grid = _text(table, "grid", where)
    if not _GRID.match(grid):
        raise ConfigError(f"{where}: grid {grid!r} is not a Maidenhead locator")
    channels = table.get("channels")
    if channels is not None and (isinstance(channels, bool) or not isinstance(channels, int) or channels < 1):
        raise ConfigError(f"{where}: channels must be a positive integer")
    session_s = _number(table, "session_minutes", DEFAULT_SESSION_S / 60, where) * 60
    if not MIN_SESSION_S <= session_s <= MAX_SESSION_S:
        raise ConfigError(f"{where}: session_minutes must be from {MIN_SESSION_S // 60} to {MAX_SESSION_S // 60}")
    break_s = _number(table, "break_minutes", rules.default_break_s / 60, where) * 60
    if break_s < rules.min_break_s:
        raise ConfigError(f"{where}: break_minutes must be at least {rules.min_break_s / 60:g} for {access} receivers")
    latency_s = _number(table, "latency_s", 0.0, where)
    if not 0.0 <= latency_s <= 10.0:
        raise ConfigError(f"{where}: latency_s must be from 0 to 10")
    return Receiver(
        id=rid,
        name=_text(table, "name", where, rid),
        host=_text(table, "host", where),
        port=port,
        access=access,
        antenna=_text(table, "antenna", where),
        grid=grid,
        operator=_text(table, "operator", where, "unknown"),
        software=_text(table, "software", where, "unknown"),
        channels=channels,
        session_s=session_s,
        break_s=break_s,
        latency_s=latency_s,
        plan=_plan(table.get("plan"), where),
    )


def load_receivers(path: Path) -> tuple[Receiver, ...]:
    """Read and check receivers.toml."""
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ConfigError(f"cannot read {path}: {exc.strerror}") from None
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"{path}: {exc}") from None
    tables = data.get("receiver")
    if not isinstance(tables, list) or not tables:
        raise ConfigError(f"{path}: needs at least one [[receiver]] table")
    receivers = tuple(_receiver(t, i) for i, t in enumerate(tables))
    ids = [r.id for r in receivers]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise ConfigError(f"{path}: duplicate receiver ids {duplicates}")
    return receivers
