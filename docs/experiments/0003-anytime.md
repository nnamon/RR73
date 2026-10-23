# Experiment 0003: anytime decoding

Status: hypothesis recorded 2026-10-13, before implementation. Part 1 measured; the app runs an early pass at 13.5 s in FT8 and 6 s in FT4 since 2026-10-15 (experiment 0006). Part 2 measured 2026-10-14; the chosen stages ship (decision 0007).

## Question

Two separate questions about when decoding happens:

1. Early decoding: how many of the shipped preset's full-slot decodes does it already find in a partial slot (the first 11.8 s or 13.5 s of audio), at what cost in false decodes and time? The app could show them before the slot ends and the sequencer could prepare its reply earlier.
2. Deeper passes after the deadline: once the shipped preset has run at slot end, do further stages that spend more compute on the residual and on more candidates find more true decodes, without false ones, within the time left before the next slot's early pass?

## Rationale

An FT8 transmission at DT 0 runs from 0.5 s to 13.14 s. At 11.8 s it lacks its last 9 symbols: 2 data symbols (6 of 174 code bits) and the third Costas array. Missing symbols become zero LLRs (erasures), which the LDPC code fills in when the rest is clean, and the first two Costas arrays still give the sync score. Late starters lose more: at 11.8 s a signal at DT +0.5 s lacks its last 12 symbols, 5 of them data symbols (15 code bits). WSJT-X reports about 85 % of its decodes at its 11.8 s pass.

The shipped preset spends about 100 ms of a 15 s slot. It stops after 3 passes, keeps the 140 best candidates scoring at least 5 dB, searches a grid of 2 frames per symbol and 2 bins per tone spacing, and runs OSD of order 2 over 40 positions. Each limit leaves signals behind: weak signals sitting between grid points lose up to 1.4 dB to scalloping and timing offset, candidates beyond the 140th are never tried, and OSD stops at 40 positions. The time before the next slot's early pass (about 10 s on a phone) can pay for lifting these limits on the residual.

## Method

- Part 1: `rr73-bench run --audio-s 11.8` and `--audio-s 13.5` decode only the first seconds of every slot. Two ways to treat the rest are measured: absent (the spectrogram stops where the audio stops, so cut symbols are erasures) and zero-filled. The early decodes are compared with the full-slot decodes of the same preset: the share of full-slot decodes already found, early decodes that the full slot does not have, false decodes on 5000 noise slots, and time.
- Part 2: a staged decoder. Stage 1 is the shipped preset at slot end. Each later stage starts from the residual left by all earlier decodes and returns only new decodes. Candidate stages, each measured alone on top of stage 1: more passes; more candidates and a lower sync threshold; a finer search grid (4 frames per symbol, 4 bins per tone spacing); deeper OSD with the same acceptance checks. Stages that add true decodes without false ones are then chained, cheapest first.
- API: `decode_partial` for part 1, and a `DecodeSession` that runs stage by stage and step by step in bounded work units (a spectrogram and search, a batch of candidates, a batch of subtractions), so a caller can stop between units and a new slot always wins. `rr73-wasm` exposes both. The web app was not changed in this experiment; experiment 0006 adds the early pass to it.

## Expected effect

| Measure | Expected |
| --- | --- |
| Share of full-slot decodes found at 11.8 s (SARTS 350, public 60) | 75 to 85 % |
| Share found at 13.5 s | 93 to 98 % |
| False decodes in partial slots, 5000 noise slots | 0 |
| Time of an early pass | about the same as a full-slot decode (fewer frames, more failing candidates) |
| Recall added by the chained later stages, SARTS 350 | +0.02 to +0.05 over 0.739 |
| SNR50 gain from the later stages, AWGN | 0.3 to 0.8 dB |
| False decodes of the later stages, 5000 noise slots and the stress harness | 0 |
| Time of all later stages, single-threaded native, busiest slot | under 3 s (about 6 s on a phone at 2 times slower) |

The finer grid and the larger candidate list should give most of the stage gain; extra passes the least.

## Acceptance

Keep a stage only if it adds true decodes on the recorded sets or lowers SNR50, adds no false decode on 5000 noise slots and in the stress harness, and fits the budget with work units small enough to stop within about 50 ms on a phone. Early decoding is useful if it finds most full-slot decodes with no false decodes; its decodes that the full slot does not confirm are reported. Negative results are recorded here.

## Results

Measured with `rr73-bench run`, `compare` and Python over the results files in the `rust` container on the Apple M4 (Docker Desktop, 10 CPUs), release build, with other workloads on the host. Sets: the 60 ft8_lib public files; the 350 SARTS slots (4210 `jt9 -8 -d 3` decodes, list in `results/sarts-all.txt`); 5000 noise slots; `crowded`, `smoke` and `noise-ci`.

### Part 1: early decoding

`--audio-s` keeps the first 11.8 s or 13.5 s of each slot. "Share" counts how many of the shipped preset's full-slot decodes (1221 on the public files, 3120 on SARTS) the early pass already finds (same text within 10 Hz). Recall is against the reference lists.

| `subtract-3-osd2` | Share, public | Share, SARTS | Recall, public | Recall, SARTS | False, 5000 noise slots |
| --- | --- | --- | --- | --- | --- |
| Full slot | 1.000 | 1.000 | 0.894 | 0.739 | 0 |
| 11.8 s, audio absent, erased bits counted as OSD errors (shipped) | 0.898 | 0.884 | 0.821 | 0.658 | 0 |
| 11.8 s, audio absent, OSD rule as for full slots | 0.932 | 0.920 | 0.848 | 0.687 | 1 |
| 11.8 s, zeros after 11.8 s | 0.898 | 0.868 | 0.820 | 0.647 | 1 |
| 13.5 s, audio absent, erased bits counted (shipped) | 0.986 | 0.998 | 0.891 | 0.739 | 0 |
| 13.5 s, audio absent, OSD rule as for full slots | 0.988 | 0.998 | 0.892 | 0.739 | 0 |
| 13.5 s, zeros after 13.5 s | 0.974 | 0.997 | 0.881 | 0.738 | 1 |
| `subtract-3` (no OSD) at 11.8 s, share of the `subtract-3-osd2` full slot | 0.888 | 0.862 | 0.812 | 0.641 | 0 |
| `subtract-3` at 13.5 s | 0.956 | 0.948 | 0.867 | 0.702 | 0 |

With the audio absent, the spectrogram stops at the last frame that lies wholly inside the audio and the missing symbols become zero LLRs. Zero-filling the rest of the slot instead makes the cut symbols look like weak ones: it finds fewer decodes, breaks the SNR estimate of signals that run into the silence (the false decode at 11.8 s read +22.5 dB), and lets one OSD codeword through on noise at both cut points.

With the audio absent and the full-slot OSD rule, one noise slot gives a false OSD decode at 11.8 s (`3E7AJI LY8UAG/P RQ09`, DT 2.06 s, -23.9 dB). At DT 2.06 s the signal would lack its last 21 symbols, 42 code bits. The full-slot rule counts an erased bit as a hard error only when the codeword has a 1 there, so a codeword resting on 132 received bits passes the same limit of 30. Counting every erased bit as a hard error (`ldpc.osd_erasures_as_errors`, now part of the OSD presets) removes it. The stress test (sync threshold 0 dB, 140 candidates per noise slot, 700000 LDPC attempts at each cut point) gives 0 false decodes at 11.8 s and 13.5 s with the rule, and the same 1 at 11.8 s without it. The rule costs 3.4 points of share at 11.8 s on the public files and 3.6 on SARTS, and 0.2 and 0 points at 13.5 s. Full slots have no erased bits: their decodes do not change on any of the 5720 slots.

Early decodes that the full slot does not have: 7 on the public files and 16 on SARTS at 11.8 s, 11 and 5 at 13.5 s. Most match the reference lists; the 6 at 11.8 s and the 6 at 13.5 s that do not carry only callsigns that other slots decode, so they look like real stations whose decode order changed with the cut.

Share at 11.8 s by the full-slot decode's DT and SNR (SARTS and public together, 4341 decodes):

| DT | Decodes | Share | | SNR | Decodes | Share |
| --- | --- | --- | --- | --- | --- | --- |
| below 0 s | 356 | 0.975 | | below -18 dB | 113 | 0.540 |
| 0 to 0.5 s | 2718 | 0.885 | | -18 to -12 dB | 915 | 0.764 |
| 0.5 to 1 s | 842 | 0.893 | | -12 to -6 dB | 1152 | 0.914 |
| 1 to 1.5 s | 260 | 0.881 | | -6 dB and up | 2161 | 0.944 |
| 1.5 s and later | 165 | 0.727 | | | | |

Weak signals lose most: the 6 to 15 erased bits take the last margin that belief propagation and OSD had. Signals of -6 dB and up that the early pass misses (121) are mostly in crowded SARTS slots, overlapped by other signals; the pass without the erasure rule finds 43 of them. At 13.5 s every DT and SNR bucket keeps 95.8 % or more.

Time per slot, single-threaded native, each slot's best of 3 runs over the 410 recorded slots:

| | Full slot | 11.8 s | 13.5 s |
| --- | --- | --- | --- |
| `public/ft8_lib` p50 | 68.5 ms | 71.9 ms | 70.0 ms |
| SARTS p50 | 19.9 ms | 25.1 ms | 22.0 ms |
| Slowest slot | 110 ms | 90 ms | 105 ms |

An early pass costs about the same as a full-slot decode: fewer frames to search, more candidates that fail. With the factor of 1.6 to 3.2 from native M4 to WebAssembly on phones from A18 Pro to A13 (experiments 0001 and 0002), the slowest early pass takes about 145 to 290 ms on a phone. Not tested on a device.

Against the hypothesis: the share at 11.8 s (0.898 public, 0.884 SARTS) is above the expected 75 to 85 % and above the 85 % WSJT-X reports for its own early pass; at 13.5 s (0.986, 0.998) it is at the top of the expected 93 to 98 %. No false decodes with the erasure rule, as expected; the rule was not part of the hypothesis.

The session refactor that carries both parts changes no decode: `compare` against the commit before it gives 0 gained and 0 lost over the 5410 recorded and noise slots and the 310 other synthetic slots, and single-threaded time per slot is unchanged (best of 3 per slot over 490 slots: p50 29.0 ms before, 28.6 ms after; mean 40.4 ms and 40.1 ms).

### Part 2: deeper passes after the deadline

Each candidate stage ran alone after stage 1 (the shipped `subtract-3-osd2`) with `rr73-bench run --then`, over the public files, the 350 SARTS slots, `crowded` and the 5000 noise slots. A stage starts from the residual left by all stage 1 decodes and returns only new decodes. "Matched" and "unmatched" count the stage's new decodes against the reference lists; stage 1 alone has recall 0.8937 (public) and 0.7394 (SARTS).

| Stage 2 (`subtract-3-osd2` plus) | Public: matched, unmatched, recall | SARTS: matched, unmatched, recall | `crowded` matched | False, 5000 noise slots and `crowded` |
| --- | --- | --- | --- | --- |
| nothing (3 more passes) | 1, 0, 0.8945 | 4, 0, 0.7404 | 1 | 0 |
| `search.max_candidates=400` | 1, 0, 0.8945 | 4, 0, 0.7404 | 1 | 0 |
| 400 candidates, `search.min_score_db=2` | 2, 5, 0.8952 | 25, 1, 0.7454 | 1 | 0 |
| `ldpc.max_iterations=100` | 3, 1, 0.8960 | 13, 0, 0.7425 | 2 | 0 |
| `ldpc.osd_window=91` | 10, 5, 0.9014 | 51, 2, 0.7515 | 3 | 0 |
| `spectrogram.time_osr=4` | 32, 20, 0.9183 | 198, 5, 0.7865 | 14 | 0 |
| `time_osr=4`, 280 candidates | 32, 20, 0.9183 | 201, 5, 0.7872 | 14 | 0 |
| `time_osr=4`, 400 candidates, threshold 2 dB | 32, 22, 0.9183 | 214, 7, 0.7903 | 14 | 0 |
| `time_osr=4`, `osd_window=91` | 37, 26, 0.9222 | 254, 7, 0.7998 | 16 | 0 |
| `time_osr=8` | 40, 23, 0.9245 | 241, 5, 0.7967 | 16 | 0 |
| `freq_osr=4`, `window_symbols=2` | 22, 6, 0.9106 | 121, 5, 0.7682 | 10 | 0 |
| `time_osr=4`, `freq_osr=4`, `window_symbols=2` | 54, 27, 0.9353 | 299, 7, 0.8105 | 16 | 0 |
| `time_osr=8`, `freq_osr=4`, `window_symbols=2` | 56, 32, 0.9368 | 332, 10, 0.8183 | 19 | 0 |
| `time_osr=4`, `freq_osr=4`, `window_symbols=2`, `osd_window=91`, 400 candidates, threshold 2 dB | 62, 35, 0.9414 | 386, 18, 0.8311 | 19 | 0 |
| `time_osr=8`, the same | 67, 42, 0.9453 | 420, 23, 0.8392 | 21 | 0 |

The chain of `time_osr=4`, `freq_osr=4`, `window_symbols=2` (stage 2) and the deepest stage above with `time_osr=8` (stage 3) ends at the same recall as the deepest stage alone (0.9453 public, 0.8392 SARTS): stage 2 adds 54 matched and 27 unmatched on the public files and 299 and 7 on SARTS, stage 3 another 13 and 15, and 121 and 15. Neither made a false decode on the noise slots or `crowded`.

`spectrogram.window_symbols=2` keeps the 2-symbol Hann window and zero-pads it to the 4-symbol FFT, so `freq_osr=4` gives bins a quarter of a tone spacing apart without smearing symbols together (new option; `None` keeps the ft8_lib layout).

The finer search grid gives most of the gain, as expected; extra passes, more candidates and more BP iterations give least. Time oversampling matters more than frequency oversampling, and the two add. On SARTS the deepest stage measured adds 0.100 recall, twice the top of the expected 0.02 to 0.05. No stage made a false decode on the 5000 noise slots or on `crowded`. On the recordings the unmatched decodes grow with depth (65 for the deepest stage, 43 of them OSD). Of the 34 unmatched decodes of the `time_osr=4`, `freq_osr=4` stage, 28 carry only callsigns that appear in some reference list or stage 1 decode; the other 6 are standard messages, 2 of them with a grid that fits the callsign's prefix (`CQ SM5MNB JO89`, `DF6WZ SV2OIT KN10`). That check is not yet done for the deeper stages.

The times printed by these runs (10 threads, host load average 15 to 16) are not usable for the budget. Steps of the session now compute at most 32 spectrogram frames and subtract at most 2 earlier decodes each; the longest step has not been measured on a quiet host.

#### Measured 2026-10-14, after merging 0.12.0

The chain of stage 2 `time_osr=4`, `freq_osr=4`, `window_symbols=2` and stage 3 `time_osr=8`, `freq_osr=4`, `window_symbols=2`, `osd_window=91`, 400 candidates from 2 dB ships, with the sync silence option and an OSD floor of -23 dB in both later stages. Decision 0007 has its recall, false decodes, SNR50, stress, partly silent slots, unmatched decodes and time per slot, native and in WebKit and Chromium workers. Against the hypothesis: recall on SARTS rises by 0.100 (expected 0.02 to 0.05) and SNR50 falls by 0.86 dB on AWGN and 1.58 dB with fading (expected 0.3 to 0.8 dB); no stage made a false decode on the 5000 noise slots or in the stress runs, as expected.

Stage 3 alone after the preset gives the same final recall (0.945 public, 0.839 SARTS) as the chain. Stage 3 with 600 candidates from 1 dB adds 7 matches on SARTS for 35 % more stage time and is not used. The sessions' 32-frame spectrogram steps change no decode: `subtract-3-osd2` through a session gives the same decodes, frequencies, DTs, SNRs and passes as 0.12.0's one-shot pipeline on 7400 slots.

#### Silent frames

0.12.0 leaves frames that overlap digital silence out of the SNR estimate. Two more options do the same for the sync score (`search.skip_silent_frames`) and the demodulator (`demod.skip_silent_frames`: symbols in such frames are erased and left out of the LLR variance). Each was measured with `subtract-3-osd2` on slots with part of the audio set to zeros (`--silent-s`), over the public files, SARTS, the 5000 noise slots, `crowded`, `smoke` and the SNR sweep.

| Silent span | Sync option: matched | Demodulator option: matched | Both |
| --- | --- | --- | --- |
| 0 to 2 s | +180 | -52 | +115 |
| 0 to 4 s | +60 | -80 | -26 |
| 6 to 6.5 s | +4 | -144 | -142 |
| 12.5 to 15 s | +203 | -4 | +193 |

No option made a false decode. Silence counted in the sync score reads 0 dB against silence and pulls the mean down by about a third when a Costas array lies in it; the option restores the score of the arrays in the audio. Over 11 silent spans the sync option gains 771 matches in all, but in 4 of them one set loses 1 to 4 decodes or 0.2 dB of SNR50, so the preset keeps its sync score and the option runs in the later stages only, where it cannot lose a stage 1 decode. The demodulator option loses decodes and is not used.
