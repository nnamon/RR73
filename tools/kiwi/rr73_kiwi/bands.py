"""FT8 dial frequencies and the receive passband."""

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

# USB audio passband in Hz relative to the dial frequency.
PASSBAND_HZ = (100, 3000)


def dial_hz(band: str) -> int:
    """FT8 dial frequency in Hz for a band name such as "20m"."""
    try:
        return FT8_DIAL_HZ[band]
    except KeyError:
        known = ", ".join(FT8_DIAL_HZ)
        raise ValueError(f"unknown band {band!r}; expected one of {known}") from None
