# Experiment 0001: signal subtraction and multiple passes

Status: accepted 2026-10-13. Hypothesis recorded before implementation (commit 245ec0d); results measured on the tree of commit 20faba3.

## Question

Does subtracting each decoded signal from the slot audio and decoding the residual again find signals that the `baseline` preset misses in busy bands, without new false decodes and within the time budget?

## Rationale

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

Measured with `rr73-bench run` and `compare` in the `rust` container on an Apple M4 (Docker Desktop, 10 CPUs), release build. Sets as in `docs/bench.md`: 60 public ft8_lib files against their WSJT-X lists, 26 SARTS KiwiSDR slots on 40 m against `jt9 2.7.0-rc3 -8 -d 3` (the shared corpus held 26 at the time), and the synthetic sets at their default sizes.

### Recall and false decodes

| Set | Slots | `baseline` | `subtract-3` | `subtract-3`, no refinement |
| --- | --- | --- | --- | --- |
| `kiwi/sarts-web888` recall (matched of 1070) | 26 | 0.459 (491) | 0.587 (628) | 0.521 (557) |
| `public/ft8_lib` recall (matched of 1298) | 60 | 0.719 (933) | 0.876 (1137) | 0.780 (1012) |
| Unmatched decodes on recordings (kiwi, public) | 86 | 0, 28 | 2, 52 | 1, 35 |
| `crowded/n10` recall | 20 | 0.990 | 0.990 | 0.990 |
| `crowded/n20` recall | 20 | 0.995 | 0.995 | 0.995 |
| `crowded/n40` recall | 20 | 0.994 | 0.996 | 0.996 |
| `crowded/n20-overlap` recall | 20 | 0.762 | 0.927 | 0.863 |
| SNR50, `snr-sweep/awgn` | 840 | -18.85 dB | -18.85 dB | -18.85 dB |
| SNR50, `snr-sweep/fading` | 840 | -15.17 dB | -15.17 dB | -15.17 dB |
| False decodes, `noise` | 1000 | 0 | 0 | 0 |
| False decodes, all synthetic sets | 2990 | 0 | 0 | 0 |

`compare baseline subtract-3` over all 3076 slots: 435 decodes gained (409 matched, 26 unmatched), none lost. Of the 54 unmatched decodes `subtract-3` makes on the two recorded sets, 30 have the same text as a reference decode in another slot of the corpus and 51 carry a callsign that appears in some reference list, so most are real stations the reference lists do not hold for that slot. Pass 2 found 207 decodes on the public files and 128 on the SARTS slots; pass 3 found 21 and 11.

Both recorded sets beat the expected range: SARTS recall 0.587 (expected 0.52 to 0.56) and public 0.876 (expected 0.75 to 0.78). Overlapping crowded slots reached 0.927 (expected 0.85 or more). SNR50 and false decodes are unchanged, as expected: a single signal decodes in pass 1 exactly as in `baseline`.

### Refinement, smoothing and passes

Refining start and frequency from the decoded tones before subtracting is worth most of the gain on recordings (SARTS 557 to 628 matched, public 1012 to 1137). Its tests show why: with the decoder's grid position (start off by up to 40 ms, frequency by up to 1.6 Hz) subtraction removes less than with the refined position, which matches the truth to within 4 ms and 0.1 Hz at -5 dB.

The refinement lives in the subtractor because it needs the decoded tones. A `SyncRefine` stage for candidates before demodulation was not built in this experiment.

Matched decodes for `subtract.smooth_s` and `passes` (refinement on):

| Variant | SARTS (of 1070) | Public (of 1298) | `n20-overlap` (of 400) |
| --- | --- | --- | --- |
| smooth 0.08 s | 587 | 1115 | 348 |
| smooth 0.12 s | 619 | 1139 | 363 |
| smooth 0.16 s (preset) | 628 | 1137 | 371 |
| smooth 0.24 s | 629 | 1127 | 374 |
| smooth 0.32 s | 608 | 1116 | 377 |
| 2 passes | 617 | 1121 | 367 |
| 4 passes | 629 | 1138 | 371 |

The smoothing length was chosen on the same recordings that report the result. The optimum is flat from 0.12 to 0.24 s (within 12 decodes on either set), so the choice adds little bias. A fourth pass adds 1 decode per set and is left out.

### Time per slot

Single-threaded native, median of 5 runs over the 86 recorded slots (host load average 4 to 5 from other workloads):

| | `baseline` | `subtract-3` |
| --- | --- | --- |
| `public/ft8_lib` p50 | 9.0 ms (runs 8.9 to 9.4) | 47.9 ms (47.8 to 53.0) |
| `public/ft8_lib` slowest slot | 10.2 ms | 58.3 ms |
| SARTS p50 | 9.9 ms (9.6 to 10.3) | 55.7 ms (55.5 to 62.2) |
| SARTS slowest slot | 11.0 ms | 70.8 ms |
| Slowest slot in the whole corpus (one run) | | 69 ms (SARTS); 63 ms on `crowded/n40` |

Stage means for `subtract-3` on the SARTS slots: spectrogram 4.9 ms and search 7.8 ms (over up to 3 passes), LDPC 16.4 ms, subtraction 26.4 ms (about 0.9 ms per subtracted signal, plus 0.1 ms for its refinement). Noise-only slots stop after pass 1 and take 4.8 ms.

WebAssembly: the same crate built with `wasm-pack --target nodejs` and run in Node 24 on the same machine decodes the 86 recorded slots with identical results in p50 73 ms and at most 103 ms per slot for `subtract-3` (14.4 ms and 35 ms for `baseline`), 1.4 to 1.5 times native. Estimate for a phone: single-core speed of A-series iPhone chips runs from about 45 % of an M4 core (A13, the oldest iOS 26 device) to about 90 % (A18 Pro), going by published single-core benchmark scores, so the slowest slot would take about 115 to 250 ms in WebAssembly on a phone. That is under the 2 s target with a factor of 8 to spare. Not tested on a device.

## Decision

Keep `subtract-3`. Recall rises on both recorded sets (+0.128 and +0.157), false decodes stay at 0, SNR50 is unchanged, and the slowest slot takes 69 ms native, under the 300 ms budget.

`baseline` is unchanged, so `bench/baseline.json` and the CI gate stay as they are; the gate passes for both presets. The app does not decode yet (`web/src/lib/decode` holds a placeholder client), so no default changes and `CHANGELOG.md` gets no line. When the decoder is wired into the app, use `subtract-3`.

## Open risks

- 26 SARTS slots recorded between 21:49 and 22:01 UTC on 2026-10-12 are a small sample of real bands.
- The ft8_lib lists come from an older WSJT-X; some of the unmatched decodes may be real stations the lists miss, so recall on that set understates both presets equally.
- FT4 runs through the same code and passes the smoke set and unit tests; no FT4 recordings were measured.
