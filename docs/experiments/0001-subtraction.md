# Experiment 0001: signal subtraction and multiple passes

Status: hypothesis recorded 2026-10-13, before implementation.

## Question

Does subtracting each decoded signal from the slot audio and decoding the residual again find signals that the `baseline` preset misses in busy bands, without new false decodes and within the time budget?

## Why it should help

The `baseline` preset (the ft8_lib method) decodes once. Two effects hide weaker signals in a busy slot:

- Overlap: a strong signal covers the tone bins of a weaker one in the same frequency range, so the weaker one's LLRs are wrong.
- Candidate crowding: every strong signal scores high at several neighbouring time and frequency positions, so the 140 candidates fill with copies of signals that are already decoded.

Removing decoded signals clears both. The SARTS 40 m slots hold 41 jt9 decodes each on average against 19 for `baseline`, and `crowded/n20-overlap` loses a quarter of its signals, so there is room to gain.

## Method

- Rebuild each new decode from its tones with a complex GFSK model matched to `rr73_ft8::synth::gfsk`.
- Estimate its complex amplitude over time by mixing the residual with the model and low-pass filtering, so fading and small frequency errors are followed; subtract the rebuilt signal.
- Decode the residual again; stop after 3 passes or when a pass finds nothing new. Duplicates across passes are dropped by payload.
- Option, measured separately: refine each decode's DT and frequency with its known tones before subtracting, since a DT error of up to 40 ms (half a spectrogram step) leaves energy at every symbol edge.
- New presets beside `baseline`, which stays unchanged.

## Expected effect

| Set | `baseline` | Expected with subtraction |
| --- | --- | --- |
| `kiwi/sarts-web888` recall (jt9 -d 3) | 0.459 | 0.52 to 0.56 (60 to 110 more of 1070) |
| `public/ft8_lib` recall (WSJT-X lists) | 0.719 | 0.75 to 0.78 |
| `crowded/n20-overlap` recall | 0.762 | 0.85 or more |
| `crowded/n10`, `n20`, `n40` recall | 0.990 to 0.995 | unchanged or up to 1.0 |
| SNR50, AWGN and fading | -18.85 dB, -15.17 dB | unchanged within 0.1 dB: a single signal decodes in pass 1 as before, and the residual holds only noise |
| False decodes (1000 noise slots, synthetic sets) | 0 | 0; noise slots stop after pass 1 |
| Time per slot, `public/ft8_lib`, 1 thread | 9.9 ms | 25 to 50 ms; busiest slots under 150 ms |

Refinement should add recall on the real sets mainly through strong signals, whose residual matters most.

## Acceptance

Keep a preset only if recall rises on the real sets, false decodes do not rise, and the slowest slot stays under 300 ms single-threaded native. Otherwise record it below as a negative result.

## Results

Pending.
