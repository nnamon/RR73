# 0007. Deeper FT8 and FT4 stages after the shipped preset

Status: accepted, 2026-10-14. Amended 2026-10-15: FT4 slots run the same stages (FT4, 2026-10-15). Amended 2026-10-16: every stage takes soft bits from blocks of symbols through the preset (experiment 0008). Amended again 2026-10-16: the preset searches DT to 4.5 s in FT8 and 1.5 s in FT4, and stage 3 keeps 2.5 s and 1.0 s (experiment 0010). Amended again 2026-10-16: the preset searches tones to 3200 Hz and stage 3 keeps 3000 Hz (experiment 0011).

## Context

The shipped preset, `subtract-3-osd2`, decodes an FT8 slot in about 70 ms of the 15 s (native, busiest public files). Experiment 0003 part 2 measured later stages that run on what it leaves, each returning only new decodes: finer search grids, more candidates, deeper OSD. The finer grid gave most of the gain. This record chooses the stages, says how the app runs them within a time budget, and gives the measurements.

## Decision

- FT8 slots, and FT4 slots from 2026-10-15, run three stages as one `DecoderSession` in the decoder worker:
  1. `subtract-3-osd2`, as shipped.
  2. `subtract-3-osd2` on a grid of 4 frames per symbol and 4 bins per tone spacing (`spectrogram.time_osr=4 spectrogram.freq_osr=4 spectrogram.window_symbols=2`).
  3. `subtract-3-osd2` on 8 frames per symbol and 4 bins per tone spacing, with 400 candidates from a 2 dB sync threshold and OSD over all 91 information bits (`spectrogram.time_osr=8 spectrogram.freq_osr=4 spectrogram.window_symbols=2 ldpc.osd_window=91 search.max_candidates=400 search.min_score_db=2`). From 2026-10-16 it searches DT only to 2.5 s in FT8 and 1.0 s in FT4, without the preset's partial-sync threshold (`search.ft8_dt_max_s=2.5 search.ft4_dt_max_s=1.0 search.partial_min_score_db=null`), as the preset searches late starts to 4.5 s and 1.5 s (experiment 0010). From 2026-10-16 it also keeps tones below 3000 Hz (`spectrogram.freq_max_hz=3000`), as the preset searches to 3200 Hz: past a receiver's passband edge its 400 places fill with noise candidates (experiment 0011). From 2026-10-23 it tries one more set of soft bits in FT8, 1 symbol scored normalised, after the preset's 3-symbol normalised set (`demod.ft8_extra_sets=[[3,"normalised"],[1,"normalised"]]`, experiment 0013).

  Stages 2 and 3 also leave frames that overlap digital silence out of the sync score (`search.skip_silent_frames=true`) and accept OSD decodes from -23 dB (`validate.osd_min_snr_db=-23`, 1 dB above the preset). In FT4 every stage keeps the preset's -19 dB floor (`validate.osd_ft4_min_snr_db`, experiment 0002). The plan is `DEEP` in `web/src/lib/decode/worker-client.ts`; CI gates it against `bench/subtract-3-osd2-deep.json`.
- Stage 1's decodes go to the list, the sequencer and the receive calibration at once, as before. The decodes of stages 2 and 3 are added to the slot in the list as each stage ends, and reach the sequencer as a later pass of the slot (`pass: 'late'`). The sequencer acts on a later pass as on the final one, on its new decodes only: a reply, the partner answering another station, a caller for the queue, a CQ for Hunt. The answer goes in the slot that follows when it can still start within the late-start limit (`LATE_S` in `web/src/lib/qso/sequencer.ts`: 4 s in FT8, 1.25 s in FT4), else a cycle later; a transmission already on air plays on. What a later pass lacks repeats nothing and counts no retry. The calibration keeps to stage 1 decodes, whose timing it needs.
- Budget: the worker steps stages 2 and 3 in slices of at most 40 ms and yields to its message loop between slices, so a request to pack or synthesise a transmission waits at most one slice and one step. The later stages stop when they finish, 2000 ms after the slot's decoding started, or when the next slot (FT8, FT4 or WSPR) reaches the worker. The next slot frees the session first, so the decoder context (callsign hashes) is back with the worker before it decodes.
- Slots RR73 transmitted in, and the early pass's partial slots (experiment 0006), decode with the preset alone. Until 2026-10-15 FT4 slots did too, as the stages had been measured on FT8 only.

## Measurements

FT8. Sets: the 60 ft8_lib public files (1298 WSJT-X decodes), the 350 SARTS slots from the KiwiSDR corpus in two sets (4210 `jt9 -8 -d 3` decodes), 5000 noise slots, `noise-ci`, `crowded`, `smoke` and the SNR sweep. Release build in the `rust` container on the Apple M4 (10 CPUs). Recall counts decodes matching the reference within 10 Hz and 0.5 s.

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
- A reply that only stage 2 or 3 finds often arrives after our next transmission has started (stage 3 ends at a WebKit p50 of 264 ms after decoding starts, the transmission at 0.5 s): that transmission plays out and the answer goes a cycle later, one period after it would have with stage 1. In FT4 stage 3 ends at a WebKit p50 of 181 ms. The sequencer tests cover this; it is not tested on air.
- The later stages raise the unmatched decodes on the recordings from 68 to 132; about 2 of the new 64 look false. The noise sets cannot show interference-shaped false decodes.
- The later stages take about 7 times the CPU time of stage 1 per FT8 slot (native mean 260 ms against 37 ms). Battery use is not measured.

## FT4, 2026-10-15

### Decision

FT4 slots run the same three stages as FT8 slots, with the same plan (`DEEP`) and the same 2000 ms budget. The early pass's partial slots and slots RR73 transmitted in decode with the preset alone, as in FT8. On the bench the stages lower FT4's SNR50 by 1.2 dB in AWGN and 1.4 dB with fading and add no false decode on 10000 noise slots. In Chromium and WebKit workers on the M4 all three end within 386 ms of the start of decoding, in a slot of 7.5 s.

### Measurements

Release build of `rr73-bench` 0.21.3 in the `rust` container on the Apple M4 (10 CPUs, 10 threads), the preset alone against the preset with the two `--then` stages of `DEEP`. `ft4-sweep` (experiment 0006): one FT4 message per slot at -24 to -6 dB in 1 dB steps, 40 slots per step in AWGN and with moderate Watterson fading, 20 crowded slots of 10 signals and 10000 FT4 noise slots. `late-start` (`docs/bench.md`): 40 slots per step in each of its 44 FT4 subsets (14080 slots) and 48 FT8 subsets (15360 slots).

| Set | Preset alone | Through stage 3 |
| --- | --- | --- |
| `ft4-sweep/awgn` (760 slots), matched, SNR50 | 350, -14.25 dB | 397, -15.42 dB |
| `ft4-sweep/fading` (760 slots), matched, SNR50 | 215, -10.83 dB | 268, -12.19 dB |
| `ft4-sweep/crowded` (200 signals), matched | 183 | 198 |
| `ft4-sweep/noise` (10000 slots), false | 0 | 0 |
| `ft4-sweep`, time per slot, p50, p90 | 11.0, 16.5 ms | 246.3, 270.3 ms |
| `late-start`, FT4 subsets, matched, false | 4977, 1 | 5704, 6 |
| `late-start`, FT8 subsets, matched, false | 6055, 0 | 6796, 4 |

`compare` against the preset alone: on `ft4-sweep`, 115 decodes gained, all matched, and 0 lost; on `late-start`, 1477 gained (1468 matched, 9 false) and 0 lost. The FT8 rows measure the stages FT8 slots already run, on a set the FT8 measurements above did not include.

Every false decode on `late-start` is an OSD codeword with 24 to 30 hard errors. The preset's one, in FT4, is `292RZQ S47NQS R RR91` (-16.4 dB, 24 hard errors). The stages add 5 in FT4 at 28 to 30 hard errors and -18.6 to -7.8 dB, such as `8M3VPW 9V4TKH R DE05` (-17.7 dB) and `6V7BAS/R KS8ZGV R KF30` (-9.3 dB), and 4 in FT8 at 28 or 29 hard errors and -21.0 to -13.5 dB, such as `805LAW 5A1AOA R PH83` (-13.5 dB).

Time per slot in browsers on 154 FT4 slots of `ft4-sweep` rendered with 3 slots per step (57 AWGN, 57 fading, 20 crowded, 20 noise), each slot's fastest of 3 runs: `tools/wasm-cost/ft8.mjs --mode FT4` in the `e2e` container, decoding in a dedicated module worker with the app's three-stage plan and 2000 ms budget, which no slot reached.

| p50, p95, max | Chromium 153 worker | WebKit 26.6 worker |
| --- | --- | --- |
| Preset alone | 10, 30, 34 ms | 9, 28, 33 ms |
| Through stage 2 | 40, 89, 93 ms | 34, 79, 87 ms |
| Through stage 3 | 201, 251, 386 ms | 181, 231, 365 ms |
| Longest step | 5.9 ms | 6.0 ms |

The browsers decode as many messages per stage as the native build on the same 154 slots: 228, 18 and 2, all matched.

### Alternatives rejected

- FT4 on the preset alone, as before: 1.2 dB of SNR50 in AWGN and 1.4 dB with fading forgone, and 727 matches on the FT4 `late-start` subsets.
- An OSD limit of 27 hard errors in FT4 (30 now): removes the 5 false decodes the stages add on `late-start` and loses 78 true OSD decodes, 66 on `late-start` and 12 on `ft4-sweep`.

### Open risks

- Not tested on a device: the stages' time on an iPhone in FT4. The budget bounds them to 2 s from the start of decoding, and FT4 slots come every 7.5 s, so a phone slower than the budget allows spends up to 2 s of each slot in them.
- False decodes on `late-start` in both modes: 5 in 14080 FT4 slots and 4 in 15360 FT8 slots from the stages, against 0 on 10000 FT4 and 5000 FT8 noise slots. All are OSD codewords at 28 to 30 hard errors, reported at -21.0 to -7.8 dB, above the SNR floors.
- No FT4 recordings in the corpus: the FT4 figures rest on synthetic signals, and interference-shaped false decodes are unmeasured.
- CI runs the stages on the smoke set's 6 FT4 slots only, with no FT4 noise slots.
- In FT4 the three stages take about 21 times the time of the preset alone per slot (native mean 252 ms against 12 ms on `ft4-sweep`, 10 threads), in slots half as long as FT8's. Battery use is not measured.
