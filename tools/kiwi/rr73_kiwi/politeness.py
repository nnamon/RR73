"""Politeness rules for shared KiwiSDR receivers.

The rules apply to every receiver and cannot be relaxed from the configuration; a receiver's
configuration may only make them stricter. "club" receivers belong to a club the RR73 owner
is a member of; "public" receivers belong to anyone else and get longer breaks and waits.
"""

from __future__ import annotations

from dataclasses import dataclass

from rr73_kiwi.status import KiwiStatus

# Channels that stay free after RR73 connects, by access class: skip when
# users >= users_max - free_channels. Club members agreed to the recorder's use, so club
# receivers keep 2 free for other members; strangers' receivers keep 3.
CLUB_FREE_CHANNELS = 2
PUBLIC_FREE_CHANNELS = 3
# End a session early when other listeners leave this many channels or fewer free.
CROWDED_FREE_CHANNELS = 1
# Session length limits, in seconds. One session holds one channel.
MAX_SESSION_S = 15 * 60
MIN_SESSION_S = 60
DEFAULT_SESSION_S = 12 * 60
# A session ends this long before any time limit the receiver announces.
LIMIT_MARGIN_S = 60.0
# A session needs at least this much of a receiver's daily allowance to be worth starting.
MIN_ALLOWANCE_S = 120.0
# How often the status page is read during a session to watch for crowding.
STATUS_POLL_S = 120.0
# Wait after a receiver ends a session on its own time limit.
TIME_LIMIT_WAIT_S = 6 * 3600.0
ACCESS_CLASSES = ("club", "public")


@dataclass(frozen=True)
class Rules:
    """Waits for one access class, in seconds."""

    access: str
    min_break_s: float
    default_break_s: float
    busy_wait_s: float
    backoff_base_s: float
    backoff_cap_s: float
    min_attempt_gap_s: float
    free_channels: int


_CLUB = Rules(
    access="club",
    min_break_s=5 * 60,
    default_break_s=5 * 60,
    busy_wait_s=10 * 60,
    backoff_base_s=2 * 60,
    backoff_cap_s=2 * 3600,
    min_attempt_gap_s=60,
    free_channels=CLUB_FREE_CHANNELS,
)
_PUBLIC = Rules(
    access="public",
    min_break_s=30 * 60,
    default_break_s=45 * 60,
    busy_wait_s=30 * 60,
    backoff_base_s=10 * 60,
    backoff_cap_s=6 * 3600,
    min_attempt_gap_s=5 * 60,
    free_channels=PUBLIC_FREE_CHANNELS,
)


def rules_for(access: str) -> Rules:
    """Rules for an access class: "club" or "public"."""
    if access == "club":
        return _CLUB
    if access == "public":
        return _PUBLIC
    raise ValueError(f"unknown access class {access!r}; expected club or public")


@dataclass(frozen=True)
class Admission:
    allowed: bool
    reason: str


def admission(status: KiwiStatus, rules: Rules) -> Admission:
    """Whether a new connection may be opened, given the receiver's /status before connecting."""
    if status.offline or status.status.lower() in ("offline", "down"):
        return Admission(False, f"receiver reports offline={status.fields.get('offline', '')} status={status.status}")
    if status.users >= status.users_max - rules.free_channels:
        return Admission(
            False,
            f"{status.users} of {status.users_max} channels in use; "
            f"connecting needs at most {status.users_max - rules.free_channels - 1}",
        )
    return Admission(True, f"{status.users} of {status.users_max} channels in use")


def crowded(status: KiwiStatus) -> bool:
    """True when a running session should end to leave channels for other listeners."""
    return status.users >= status.users_max - CROWDED_FREE_CHANNELS


def backoff_s(rules: Rules, failures: int) -> float:
    """Wait after the given number of consecutive failures: doubling from the base, capped."""
    if failures < 1:
        return 0.0
    return min(rules.backoff_cap_s, rules.backoff_base_s * 2.0 ** min(failures - 1, 30))


@dataclass(frozen=True)
class ServerLimits:
    """Time limits a receiver announces in its configuration, in seconds; None when unlimited."""

    inactivity_timeout_s: float | None = None
    ip_limit_s: float | None = None

    @classmethod
    def from_config(cls, config: dict[str, object]) -> ServerLimits:
        """Read inactivity_timeout_mins and ip_limit_mins from a Kiwi's load_cfg JSON. 0 means unlimited."""

        def minutes(key: str) -> float | None:
            value = config.get(key)
            if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
                return None
            return float(value) * 60.0

        return cls(minutes("inactivity_timeout_mins"), minutes("ip_limit_mins"))

    def to_json(self) -> dict[str, float | None]:
        return {"inactivity_timeout_s": self.inactivity_timeout_s, "ip_limit_s": self.ip_limit_s}

    @classmethod
    def from_json(cls, data: object) -> ServerLimits:
        if not isinstance(data, dict):
            return cls()
        values = [data.get(k) for k in ("inactivity_timeout_s", "ip_limit_s")]
        return cls(*(float(v) if isinstance(v, int | float) and v > 0 else None for v in values))


def allowed_session_s(requested_s: float, limits: ServerLimits, used_last_24h_s: float) -> float:
    """Session length that respects the 15-minute cap and the receiver's own limits.

    Returns 0 when the receiver's daily allowance for this address is too small for a session.
    """
    length = min(float(requested_s), float(MAX_SESSION_S))
    if limits.inactivity_timeout_s is not None:
        length = min(length, limits.inactivity_timeout_s - LIMIT_MARGIN_S)
    if limits.ip_limit_s is not None:
        remaining = limits.ip_limit_s - used_last_24h_s - LIMIT_MARGIN_S
        if remaining < MIN_ALLOWANCE_S:
            return 0.0
        length = min(length, remaining)
    return max(0.0, length)
