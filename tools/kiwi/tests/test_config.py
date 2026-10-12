from datetime import UTC, datetime
from pathlib import Path

import pytest

from rr73_kiwi.config import ConfigError, load_receivers

RECEIVERS_TOML = Path(__file__).resolve().parents[1] / "receivers.toml"

BASE = """
[[receiver]]
id = "test-kiwi"
host = "kiwi.example"
access = "{access}"
antenna = "dipole"
grid = "OJ11"
{extra}

[[receiver.plan]]
from = "00:00"
to = "{to}"
bands = ["20m"]
"""


def load(tmp_path: Path, access: str = "club", extra: str = "", to: str = "00:00") -> None:
    path = tmp_path / "receivers.toml"
    path.write_text(BASE.format(access=access, extra=extra, to=to.replace("00:00", "23:59")) + _wrap(to))
    load_receivers(path)


def _wrap(to: str) -> str:
    # A second window closes the day when the first ends at 23:59.
    return '\n[[receiver.plan]]\nfrom = "23:59"\nto = "00:00"\nbands = ["20m"]\n' if to == "00:00" else ""


def test_repository_configuration_has_the_sarts_receiver() -> None:
    [sarts] = load_receivers(RECEIVERS_TOML)
    assert (sarts.id, sarts.host, sarts.port, sarts.access) == ("sarts-web888", "167.172.88.10", 80, "club")
    assert (sarts.antenna, sarts.grid, sarts.channels) == ("Wellbrook loop", "OJ11", 13)
    assert sarts.session_s <= 15 * 60 and sarts.break_s >= 5 * 60
    assert sarts.bands_at(datetime(2026, 10, 13, 3, 0, tzinfo=UTC))[0] == "20m"
    assert "40m" in sarts.bands_at(datetime(2026, 10, 13, 21, 0, tzinfo=UTC))


def test_minimal_receiver_loads(tmp_path: Path) -> None:
    load(tmp_path)


@pytest.mark.parametrize(
    ("access", "extra", "message"),
    [
        ("club", "break_minutes = 4", "break_minutes must be at least 5"),
        ("public", "break_minutes = 20", "break_minutes must be at least 30"),
        ("club", "session_minutes = 16", "session_minutes must be from 1 to 15"),
        ("friends", "", "access must be one of"),
        ("club", 'port = "80"', "port must be an integer"),
        ("club", "latency_s = -1", "latency_s must be from 0 to 10"),
    ],
)
def test_rules_cannot_be_relaxed(tmp_path: Path, access: str, extra: str, message: str) -> None:
    with pytest.raises(ConfigError, match=message):
        load(tmp_path, access=access, extra=extra)


def test_plan_must_cover_the_whole_day(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="no band at 12:00 UTC"):
        load(tmp_path, to="12:00")


def test_unknown_band_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "receivers.toml"
    text = BASE.format(access="club", extra="", to="23:59") + _wrap("00:00")
    path.write_text(text.replace('bands = ["20m"]', 'bands = ["60m"]', 1))
    with pytest.raises(ConfigError, match="unknown bands"):
        load_receivers(path)


def test_one_receiver_cannot_appear_twice_under_two_ids(tmp_path: Path) -> None:
    # Two entries for one address would let the recorder hold two of its channels.
    one = BASE.format(access="club", extra="", to="23:59") + _wrap("00:00")
    two = one.replace('id = "test-kiwi"', 'id = "test-kiwi-2"').replace(
        'host = "kiwi.example"', 'host = "KIWI.example"'
    )
    path = tmp_path / "receivers.toml"
    path.write_text(one + two)
    with pytest.raises(ConfigError, match="same receiver"):
        load_receivers(path)
