import numpy as np
import pytest

from rr73_kiwi.resample import KERNEL_HALF_WIDTH, interpolate, to_int16, usb_audio


def level_db(x: np.ndarray, reference: float) -> float:
    return 20 * np.log10(np.sqrt(np.mean(x**2)) / reference + 1e-300)


@pytest.mark.parametrize("rate_hz", [12001.135, 11998.7, 12000.0, 20250.0])
@pytest.mark.parametrize("tone_hz", [200.0, 1500.0, 2900.0])
def test_resampled_tone_matches_the_exact_tone(rate_hz: float, tone_hz: float) -> None:
    rng = np.random.default_rng(int(rate_hz + tone_hz))
    phase = rng.uniform(0, 2 * np.pi)
    n_in = int(3.0 * rate_hz)
    x = np.cos(2 * np.pi * tone_hz * np.arange(n_in) / rate_hz + phase)
    offset_s = 0.1234567  # output sample 0 falls between input samples
    t_out = offset_s + np.arange(int(2.5 * 12000)) / 12000
    y = interpolate(x, t_out * rate_hz, rate_hz)
    exact = np.cos(2 * np.pi * tone_hz * t_out + phase)
    assert len(y) == 30000
    assert level_db(y - exact, np.sqrt(0.5)) < -90


def test_usb_audio_keeps_the_upper_sideband_passband() -> None:
    rate = 12001.135
    n = int(4 * rate)
    t = np.arange(n) / rate
    wanted = 1000.0 * np.exp(2j * np.pi * 1500 * t)
    unwanted = sum(1000.0 * np.exp(2j * np.pi * f * t) for f in (-1500.0, -300.0, 30.0, 3500.0, 5000.0))
    audio = usb_audio(wanted + unwanted, rate)
    middle = slice(int(0.5 * rate), int(3.5 * rate))
    expected = 1000.0 * np.cos(2 * np.pi * 1500 * t)
    assert level_db(audio[middle] - expected[middle], 1000.0 / np.sqrt(2)) < -60


def test_interpolate_needs_kernel_support_at_both_ends() -> None:
    x = np.zeros(1000)
    with pytest.raises(ValueError):
        interpolate(x, np.array([KERNEL_HALF_WIDTH - 2.0]), 12000.0)
    with pytest.raises(ValueError):
        interpolate(x, np.array([1000.0 - KERNEL_HALF_WIDTH]), 12000.0)
    assert len(interpolate(x, np.array([100.5, 500.25]), 12000.0)) == 2


def test_to_int16_rounds_and_counts_clipping() -> None:
    samples, clipped = to_int16(np.array([0.4, -0.6, 32767.4, 40000.0, -40000.0, -32768.0]))
    assert samples.dtype == np.int16
    assert samples.tolist() == [0, -1, 32767, 32767, -32768, -32768]
    assert clipped == 2
