"""FT8 and WSPR dial frequencies, slot lengths and the receive passband."""

from collections.abc import Mapping
from types import MappingProxyType

FT8_DIAL_HZ: Mapping[str, int] = MappingProxyType(
    {
        "40m": 7_074_000,
        "30m": 10_136_000,
        "20m": 14_074_000,
        "17m": 18_100_000,
        "15m": 21_074_000,
        "10m": 28_074_000,
    }
)

# WSPR dial frequencies (USB); signals sit 1400 to 1600 Hz above them. Band names carry a
# -wspr suffix so a plan or --band can mix both modes.
WSPR_DIAL_HZ: Mapping[str, int] = MappingProxyType(
    {
        "40m-wspr": 7_038_600,
        "30m-wspr": 10_138_700,
        "20m-wspr": 14_095_600,
        "17m-wspr": 18_104_600,
        "15m-wspr": 21_094_600,
        "10m-wspr": 28_124_600,
    }
)

ALL_DIAL_HZ: Mapping[str, int] = MappingProxyType({**FT8_DIAL_HZ, **WSPR_DIAL_HZ})

# USB audio passband in Hz relative to the dial frequency.
PASSBAND_HZ = (100, 3000)


def dial_hz(band: str) -> int:
    """Dial frequency in Hz for a band name such as "20m" (FT8) or "20m-wspr"."""
    try:
        return ALL_DIAL_HZ[band]
    except KeyError:
        known = ", ".join(ALL_DIAL_HZ)
        raise ValueError(f"unknown band {band!r}; expected one of {known}") from None


def mode_of(band: str) -> str:
    """Corpus mode of a band name: "WSPR" for the -wspr bands, otherwise "FT8"."""
    return "WSPR" if band in WSPR_DIAL_HZ else "FT8"


def slot_seconds(mode: str) -> int:
    """Slot length in seconds: 120 for WSPR (even UTC minutes), 15 for FT8."""
    return 120 if mode == "WSPR" else 15
