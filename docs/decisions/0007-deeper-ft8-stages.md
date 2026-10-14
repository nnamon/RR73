# 0007. Deeper FT8 stages after the shipped preset

Status: accepted, 2026-10-14

## Context

The shipped preset, `subtract-3-osd2`, decodes an FT8 slot in about 70 ms of the 15 s (native, busiest public files). Experiment 0003 part 2 measured later stages that run on what it leaves, each returning only new decodes: finer search grids, more candidates, deeper OSD. The finer grid gave most of the gain. This record chooses the stages, says how the app runs them within a time budget, and gives the measurements.

## Decision

- FT8 slots run three stages as one `DecoderSession` in the decoder worker:
  1. `subtract-3-osd2`, as shipped.
  2. `subtract-3-osd2` on a grid of 4 frames per symbol and 4 bins per tone spacing (`spectrogram.time_osr=4 spectrogram.freq_osr=4 spectrogram.window_symbols=2`).
  3. `subtract-3-osd2` on 8 frames per symbol and 4 bins per tone spacing, with 400 candidates from a 2 dB sync threshold and OSD over all 91 information bits (`spectrogram.time_osr=8 spectrogram.freq_osr=4 spectrogram.window_symbols=2 ldpc.osd_window=91 search.max_candidates=400 search.min_score_db=2`).

  Stages 2 and 3 also leave frames that overlap digital silence out of the sync score (`search.skip_silent_frames=true`) and accept OSD decodes from -23 dB (`validate.osd_min_snr_db=-23`, 1 dB above the preset). The plan is `DEEP` in `web/src/lib/decode/worker-client.ts`; CI gates it against `bench/subtract-3-osd2-deep.json`.
- Stage 1's decodes go to the list, the sequencer and the receive calibration at once, as before. The decodes of stages 2 and 3 are added to the slot in the list as each stage ends; the sequencer and the calibration do not see them.
- Budget: the worker steps stages 2 and 3 in slices of at most 40 ms and yields to its message loop between slices, so a request to pack or synthesise a transmission waits at most one slice and one step. The later stages stop when they finish, 2000 ms after the slot's decoding started, or when the next slot (FT8, FT4 or WSPR) reaches the worker. The next slot frees the session first, so the decoder context (callsign hashes) is back with the worker before it decodes.
- FT4 slots, and slots RR73 transmitted in, decode with the preset alone. The stages were measured on FT8 only.

## Measurements

Sets: the 60 ft8_lib public files (1298 WSJT-X decodes), the 350 SARTS slots from the KiwiSDR corpus in two sets (4210 `jt9 -8 -d 3` decodes), 5000 noise slots, `noise-ci`, `crowded`, `smoke` and the SNR sweep. Release build in the `rust` container on the Apple M4 (10 CPUs). Recall counts decodes matching the reference within 10 Hz and 0.5 s.

| Set | Preset alone | Through stage 2 | Through stage 3 |
| --- | --- | --- | --- |
| `public/ft8_lib`, recall | 0.894 (1160) | 0.935 (1214) | 0.945 (1227) |
| SARTS 12 October (146 slots), recall | 0.717 (1638) | 0.791 (1806) | 0.821 (1876) |
| SARTS 13 October (204 slots), recall | 0.766 (1475) | 0.834 (1606) | 0.860 (1657) |
| SARTS, both | 0.739 (3113) | 0.810 (3412) | 0.839 (3533) |
| `crowded` (80 slots), recall | 0.982 | 0.991 | 0.993 |
| Unmatched on the recordings (public, SARTS) | 61, 7 | 88, 14 | 103, 29 |
| False decodes: 5000 noise slots, `noise-ci`, `crowded`, `smoke`, sweep | 0 | 0 | 0 |
| SNR50, AWGN sweep | -19.02 dB | -19.63 dB | -19.88 dB |
| SNR50, fading sweep | -15.67 dB | -16.85 dB | -17.25 dB |

`compare` against the preset alone: 669 decodes gained (605 matched, 64 unmatched), 0 lost. A later stage cannot lose an earlier decode.

Stress: stage 2 and stage 3, each run after the preset with its sync threshold at 0 dB, on the 5000 noise slots and `crowded`: 0 false decodes (stage 3 tried up to 400 candidates in each noise slot).

Partly silent slots (`--silent-s`), the chain against the preset alone, same sets less the 5000 noise slots:

| Silent span | Public matched | SARTS matched | Synthetic matched | False |
| --- | --- | --- | --- | --- |
| 0 to 2 s | 1137 to 1214 | 2935 to 3473 | 2478 to 2631 | 0 |
| 6 to 6.5 s | 1123 to 1198 | 2914 to 3345 | 2536 to 2655 | 0 |
| 12.5 to 15 s | 1084 to 1189 | 2912 to 3465 | 2537 to 2674 | 0 |

The 5000 noise slots with 0 to 4 s, 3 to 3.5 s, 6 to 6.5 s, 9 to 9.5 s and 13 to 15 s silent: 0 false decodes. Two choices come from these runs. Without the silence option in stages 2 and 3, the 12.5 to 15 s run gave a false decode in `crowded/n40` (`RB9KHM TY7INW R MR69`, OSD, -23.8 dB) and 75 fewer matches. With the option and the preset's -24 dB OSD floor, the 6 to 6.5 s run gave one in the noise slots (`630WLM/R SY4GGE/R R RP95`, OSD, -23.8 dB). Across the 21 runs of these stages, the weakest later-stage OSD decode that matched a reference or truth read -21.4 dB, so the -23 dB floor costs none.

Unmatched decodes on the recordings: of the 64 the later stages add, 52 carry only callsigns that a reference list or a stage 1 decode holds somewhere in the corpus. Of the other 12, 2 look false: `V95NAD IE4OIQ/R R AL92` (neither prefix is allocated) and `NL9ALU JC0FMD +15` (OSD with 30 hard errors at -0.5 dB). The rest are plausible stations, such as `EY8MM YB1BML 73` and `CQ SM5MNB JO89`.

Time per slot on the 410 recorded slots (60 public, 350 SARTS), each slot's fastest of 3 runs, with the host's 1-minute load at 2.2 to 2.6. Native: `rr73-bench run --threads 1` in the `rust` container. Browsers: `tools/wasm-cost/ft8.mjs` in the `e2e` container, decoding in a dedicated module worker with the app's 2000 ms budget, which no slot reached.

| p50, p95, max | Native, 1 thread | Chromium 153 worker | WebKit 26.6 worker |
| --- | --- | --- | --- |
| Preset alone | 21.5, 78.9, 96.0 ms | 30, 101, 121 ms | 24, 89, 110 ms |
| Through stage 2 | 71.6, 185.5, 207.8 ms | 108, 250, 282 ms | 81, 207, 237 ms |
| Through stage 3 | 242.1, 560.0, 691.5 ms | 321, 711, 888 ms | 264, 613, 753 ms |
| Longest step | 5.5 ms | 6.4 ms | 8.0 ms |

The WebKit worker stays well inside the limits set for this work (median under 2 s, 95th percentile under 3 s). With the budget set to 150 ms for a check, every public slot stopped between 151 and 155 ms. The decodes in the browsers equal the native ones: 4341, 387 and 164 by stage.

## Alternatives rejected

- Stage 3 alone after the preset: the same recall and SNR50 as stages 2 and 3, and no earlier result when the budget cuts it short. Stage 2 finds 72 % of the gain in about a quarter of the later stages' time (native p50: 50 ms of 220 ms).
- Stage 3 with 600 candidates from a 1 dB threshold: 7 more matches on SARTS (0.841) for 35 % more stage time.
- Running all stages inside `decode_slot` and posting once: stage 1 decodes would wait for the later stages (WebKit on the M4: p50 264 ms, p95 613 ms, against 24 and 89 ms) and longer on a phone, and the sequencer decides the next transmission from them within the 1.5 s late-start window.
- The silence option in the preset itself, and erasing silent symbols in the demodulator: see experiment 0003.

## Open risks

- Not tested on a device. The budget bounds the later stages to 2 s from the start of decoding whatever the phone's speed; on a phone slower than the budget allows, stage 3 ends early with its best candidates tried.
- The sequencer acts on stage 1 decodes only: a reply that only stage 2 or 3 finds shows in the list, and the operator answers it by hand.
- The later stages raise the unmatched decodes on the recordings from 68 to 132; about 2 of the new 64 look false. The noise sets cannot show interference-shaped false decodes.
- The later stages take about 7 times the CPU time of stage 1 per FT8 slot (native mean 260 ms against 37 ms). Battery use is not measured.
