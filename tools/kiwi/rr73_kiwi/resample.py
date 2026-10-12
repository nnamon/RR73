"""USB audio from IQ samples, and band-limited resampling to exactly 12000 Hz."""

from __future__ import annotations

import numpy as np

from rr73_kiwi.bands import PASSBAND_HZ

KERNEL_HALF_WIDTH = 32  # input samples on each side of an output sample
KERNEL_CUTOFF_HZ = 4500.0  # above the 3000 Hz passband, below 6000 Hz Nyquist at 12 kHz
KAISER_BETA = 8.6
_TABLE_STEPS = 1024  # kernel table points per input sample
_CHUNK = 16384


def usb_audio(
    iq: np.ndarray, rate_hz: float, passband_hz: tuple[float, float] = PASSBAND_HZ, edge_hz: float = 50.0
) -> np.ndarray:
    """Real USB audio from complex baseband centred on the dial frequency.

    Keeps positive frequencies within the passband, with raised-cosine edges edge_hz wide
    outside it, and returns the real part. The first and last 0.1 s carry FFT edge effects;
    callers pass a margin and discard it.
    """
    n = len(iq)
    nfft = 1 << max(1, (n - 1).bit_length())
    spectrum = np.fft.fft(np.asarray(iq, dtype=np.complex128), nfft)
    freqs = np.fft.fftfreq(nfft, 1.0 / rate_hz)
    lo, hi = passband_hz
    mask = np.zeros(nfft)
    mask[(freqs >= lo) & (freqs <= hi)] = 1.0
    lower = (freqs > lo - edge_hz) & (freqs < lo)
    mask[lower] = 0.5 - 0.5 * np.cos(np.pi * (freqs[lower] - (lo - edge_hz)) / edge_hz)
    upper = (freqs > hi) & (freqs < hi + edge_hz)
    mask[upper] = 0.5 + 0.5 * np.cos(np.pi * (freqs[upper] - hi) / edge_hz)
    return np.fft.ifft(spectrum * mask)[:n].real


def _kernel_table(cutoff: float) -> np.ndarray:
    """Kaiser-windowed sinc sampled every 1/_TABLE_STEPS input samples over [-W, W]."""
    distance = np.arange(-KERNEL_HALF_WIDTH * _TABLE_STEPS, KERNEL_HALF_WIDTH * _TABLE_STEPS + 1) / _TABLE_STEPS
    window = np.i0(KAISER_BETA * np.sqrt(np.clip(1.0 - (distance / KERNEL_HALF_WIDTH) ** 2, 0.0, None))) / np.i0(
        KAISER_BETA
    )
    return 2.0 * cutoff * np.sinc(2.0 * cutoff * distance) * window


def interpolate(x: np.ndarray, positions: np.ndarray, rate_hz: float) -> np.ndarray:
    """Values of the band-limited signal x (sampled at rate_hz) at fractional sample positions.

    Every position needs KERNEL_HALF_WIDTH samples of x on each side. Raises ValueError otherwise.
    """
    positions = np.asarray(positions, dtype=np.float64)
    if len(positions) == 0:
        return np.zeros(0)
    if positions.min() < KERNEL_HALF_WIDTH - 1 or positions.max() > len(x) - KERNEL_HALF_WIDTH - 1:
        raise ValueError("interpolation positions too close to the ends of the input")
    table = _kernel_table(KERNEL_CUTOFF_HZ / rate_hz)
    taps = np.arange(-KERNEL_HALF_WIDTH + 1, KERNEL_HALF_WIDTH + 1)
    out = np.empty(len(positions))
    for start in range(0, len(positions), _CHUNK):
        pos = positions[start : start + _CHUNK]
        base = np.floor(pos).astype(np.int64)
        frac = pos - base
        # Distance from each output position to each contributing input sample, in table steps.
        steps = (frac[:, None] - taps[None, :] + KERNEL_HALF_WIDTH) * _TABLE_STEPS
        lower = np.floor(steps).astype(np.int64)
        weight = steps - lower
        upper = np.minimum(lower + 1, len(table) - 1)
        kernel = table[lower] * (1.0 - weight) + table[upper] * weight
        out[start : start + _CHUNK] = np.sum(x[base[:, None] + taps[None, :]] * kernel, axis=1)
    return out


def to_int16(samples: np.ndarray) -> tuple[np.ndarray, int]:
    """Round to 16-bit PCM, clipping at full scale. Returns the samples and the number clipped."""
    rounded = np.rint(samples)
    clipped = int(np.count_nonzero((rounded > 32767) | (rounded < -32768)))
    return np.clip(rounded, -32768, 32767).astype(np.int16), clipped
