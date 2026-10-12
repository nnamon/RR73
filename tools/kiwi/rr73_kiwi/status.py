"""Read a KiwiSDR's /status page: one key=value pair per line."""

from __future__ import annotations

import http.client
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

from rr73_kiwi import IDENT

USER_AGENT = f"rr73-kiwi ({IDENT})"
STATUS_TIMEOUT_S = 10.0
MAX_STATUS_BYTES = 65536


class StatusError(Exception):
    """The status page could not be read or does not carry the fields the rules need."""


@dataclass(frozen=True)
class KiwiStatus:
    """The fields of /status that the politeness rules use, plus all raw fields."""

    users: int
    users_max: int
    offline: bool
    status: str
    sw_version: str
    fields: Mapping[str, str]

    @property
    def free_channels(self) -> int:
        return self.users_max - self.users


def parse_status(text: str) -> KiwiStatus:
    """Parse /status text. Raises StatusError when users or users_max is missing or not a number."""
    fields: dict[str, str] = {}
    for line in text.splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip():
            fields[key.strip()] = value.strip()
    try:
        users = int(fields["users"])
        users_max = int(fields["users_max"])
    except KeyError as exc:
        raise StatusError(f"status page has no {exc.args[0]} field") from None
    except ValueError:
        raise StatusError("status page has a non-numeric users or users_max field") from None
    if users < 0 or users_max < 1:
        raise StatusError(f"status page reports users={users} users_max={users_max}")
    return KiwiStatus(
        users=users,
        users_max=users_max,
        offline=fields.get("offline", "no").lower() == "yes",
        status=fields.get("status", ""),
        sw_version=fields.get("sw_version", ""),
        fields=MappingProxyType(fields),
    )


def fetch_status(host: str, port: int, timeout_s: float = STATUS_TIMEOUT_S) -> KiwiStatus:
    """GET http://host:port/status and parse it."""
    request = urllib.request.Request(f"http://{host}:{port}/status", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            body = response.read(MAX_STATUS_BYTES + 1)
            # read(n) returns what arrived when the server closes early; length is what is missing.
            missing = response.length
    except urllib.error.HTTPError as exc:
        raise StatusError(f"{host}:{port}/status returned HTTP {exc.code}") from None
    except (urllib.error.URLError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise StatusError(f"{host}:{port}/status is unreachable: {reason}") from None
    except http.client.HTTPException as exc:
        raise StatusError(f"{host}:{port}/status sent a broken HTTP reply: {type(exc).__name__}") from None
    if len(body) > MAX_STATUS_BYTES:
        raise StatusError(f"{host}:{port}/status is larger than {MAX_STATUS_BYTES // 1024} KiB")
    if missing:
        raise StatusError(f"{host}:{port}/status was cut short: {missing} bytes missing")
    return parse_status(body.decode("utf-8", errors="replace"))
