# Experiment 0008: soft bits from multi-symbol block detection

Status: measured 2026-10-16 with the block demodulator on 0.21.8 (commit 945b59d after rebasing onto 0.22.1, whose changes leave the decoder as it was); hypothesis recorded 2026-10-15, before implementation. Accepted 2026-10-16: `subtract-3-osd2` ships with block soft bits from the next release after 0.22.1, and the later stages take them through the preset.

## Question

Do soft bits from noncoherent detection of blocks of symbols (1, 2 and 3 FT8 symbols; 1, 2 and 4 FT4 symbols), computed from complex tone amplitudes at a refined start and frequency, lower SNR50 and raise recall over the shipped preset's single-symbol LLRs, with no added false decodes and within the time budget? Does the demodulator belong in the preset or in a later stage (decision 0007)?

## Rationale

The preset's demodulator is ft8_lib's: for each symbol on its own, the dB magnitudes of the 8 (FT8) or 4 (FT4) tones in a spectrogram with a 2-symbol Hann window, 2 frames per symbol and 2 bins per tone spacing. It loses sensitivity three ways:

- Grid offsets. A candidate sits up to a quarter symbol off in time and a quarter tone spacing off in frequency. The finer grids of the later stages recover 0.86 dB of SNR50 in AWGN (decision 0007), most of it this loss.
- The window. A Hann window over 2 symbols mixes each symbol with half of each neighbour and does not match the rectangular symbol.
- Single-symbol detection. Each symbol is detected by its energy alone, so the phase relation between consecutive symbols goes unused.

FT8 and FT4 are continuous-phase FSK with modulation index 1. Each tone completes a whole number of cycles per symbol relative to tone 0, so the phase at the middle of every symbol is the same whatever the data, apart from the carrier's own rotation. Gaussian smoothing (BT 2 in FT8, BT 1 in FT4, QEX 2020 section 5) bends the phase only during the transitions between tones. Averaged over a symbol, the phase of the correlation with the sent tone moves by about 0.007 rad per step of tone difference in FT8 and 0.028 rad in FT4 (the mean of the transition's phase error, `2π / (8 (k BT)²)` with `k = 5.336`); the unit tests check this against the codec's waveform. The complex correlations of consecutive symbols with their sent tones therefore add in phase, and detecting N symbols together collects up to N times the energy per decision, less the loss of noncoherent combining.

The QEX paper (Franke, Somerville and Taylor, "The FT4 and FT8 Communication Protocols", QEX July/August 2020, section 6 and table 5) describes this method and reports, for WSJT-X in AWGN: FT8 thresholds of -19.6 dB with single-symbol soft bits and belief propagation, -20.3 dB with blocks of 1, 2 and 3 symbols, and -20.8 dB adding OSD; FT4 -15.3, -16.9 and -17.5 dB with blocks of 1, 2 and 4. With 1 Hz of Doppler spread the blocks gain 0.5 dB in FT8 and 1.3 dB in FT4. The soft bit is the largest block correlation magnitude among the tone sequences with the bit set, minus the largest among those with it clear, times a constant; sets of soft bits for each block length go to the decoder in turn, starting with 1.

The preset reaches SNR50 -19.02 dB in FT8 and -14.25 dB in FT4 in AWGN (with OSD). FT4 trails the paper's -17.5 dB by 3.2 dB and FT8 its -20.8 dB by 1.8 dB, so FT4 has the most to gain. In this crate the WSPR decoder gained 2.6 dB of SNR50 from block detection (experiment 0004).

Risks:

- Fading and frequency error break coherence across a block. On the WSPR recordings, 7-symbol blocks alone lost two thirds of the decodes that single symbols found (experiment 0004); FT8's 3-symbol block lasts 0.48 s and FT4's 4-symbol block 0.19 s, against 4.8 s for WSPR's 7.
- Each extra set of soft bits is one more belief propagation and OSD attempt per failing candidate, and most candidates fail. False decodes and time grow with the attempts.

## Method

A demodulator option, `demod.kind=block` (`crates/rr73-decode/src/block.rs`), selected by configuration overrides. The presets stay as they are. What was built, with the changes from the plan:

- Per decoding pass, one FFT of the residual audio: 196 608 points for FT8 (16.4 s), 98 304 for FT4 (8.2 s), zero-padded. The plan named 192 000 and 97 200 points; sizes of `3 × 2^k` transform faster.
- Per candidate, the band from 1.5 tone spacings below tone 0 to 1.5 above the top tone, with a raised-cosine taper over one more spacing each side, is shifted so tone 0 lies at 0 Hz and transformed back to a complex baseband of 30 samples per symbol: 187.5 Hz and 3072 points for FT8, 625 Hz and 5120 points for FT4. The plan named 32 samples per symbol; 30 follows from the transform sizes.
- Refinement: start within one search grid step of the candidate (half a symbol on the preset's grid) in steps of 1/30 symbol, and frequency within one grid step (half a tone spacing) in steps of 1/32 spacing, chosen to maximise the sum over the sync groups of the power of the coherent sum of each sync symbol's correlation with its known tone. Parabolic interpolation then places the frequency between steps and the start between samples; the tone references turn by the fractional start, so consecutive symbols on different tones stay in phase. The sync correlation slides one sample at a time.
- Tone amplitudes and soft bits as planned: every symbol correlated with every tone; for block length N, every tone sequence over the N symbols around each data symbol scored by the magnitude of the sum of its complex amplitudes, sync symbols with their known tone only; max-log LLR; the 174 LLRs scaled to the preset's variance of 24. `demod.block_score=log` scores by the log of the magnitude instead.
- Order of attempts as planned: optionally the spectrogram LLRs first (`demod.spectrogram_first`), then each block length of `demod.ft8_blocks` or `demod.ft4_blocks` through belief propagation and OSD; `demod.bp_only_blocks` skips OSD for the listed lengths. A priori decoding reads the first set.
- Sync gate, added after the first timings: `demod.ft8_min_sync` and `demod.ft4_min_sync` skip the block sets, and a priori decoding, for a candidate with fewer sync symbols whose strongest tone at the refined position is the sent one. Chance alone matches 2.6 of FT8's 21 sync symbols and 4 of FT4's 16; a unit test finds a -20 dB FT8 signal at 12 of 21 and refined positions in noise at 1 to 7.
- Each pass gets a `baseband` session step for the transform; a candidate step tries 16 sets of soft bits, so 8 candidates with 2 sets each.

Measurements against `subtract-3-osd2` with `rr73-bench run` and `compare` in the `rust` container, release builds on the Apple M4 (10 CPUs), on the sets the plan lists: the 60 ft8_lib public files (1298 WSJT-X decodes) and 350 readable SARTS slots (4210 `jt9 -8 -d 3` decodes); `snr-sweep` (40 per step, 840 slots each in AWGN and fading), `crowded`, `late-start` (40 per step), `ap-sweep` (40 per step, 5000 noise slots), `ft4-sweep` (40 per step, 20 crowded slots, 10000 noise slots); 5000 FT8 noise slots; stress runs with the sync threshold at 0 dB on 5000 FT8 and 5000 FT4 noise slots. Accuracy runs used 10 or 4 threads while other jobs loaded the host (1-minute load 12 to 53); the load does not change what the decoder decodes, and every run of one configuration on one set gave the same decodes across the builds measured. "Block [1,3]" below means `demod.ft8_blocks=[1,3] demod.ft4_blocks=[1,4]`.

## Acceptance

Keep a change only if it adds true decodes or lowers SNR50, with zero added false decodes on the noise sets (5000 FT8 slots, 10000 FT4 slots) and in the stress runs, within the time budget: the preset stage near its current cost, later stages within decision 0007's 2 s on the phone. Negative results are recorded here.

## Results

### Variants

SNR50 and signals decoded (of 840 per FT8 subset and 760 per FT4 subset), and matched references on the recordings (SARTS both days, 4210; public, 1298):

| Configuration | FT8 AWGN | FT8 fading | FT4 AWGN | FT4 fading | SARTS | public |
| --- | --- | --- | --- | --- | --- | --- |
| Preset: spectrogram LLRs | -19.02 dB (461) | -15.67 dB (327) | -14.25 dB (350) | -10.83 dB (215) | 3113 | 1160 |
| Block [1] | -20.10 dB (504) | -17.20 dB (388) | -15.60 dB (404) | -12.74 dB (290) | 3560 | 1213 |
| Block [2] | -20.88 dB (535) | -17.85 dB (414) | -16.35 dB (434) | -13.67 dB (327) | | |
| Block [3] in FT8, [4] in FT4 | -21.25 dB (550) | -18.30 dB (432) | -17.02 dB (461) | -14.27 dB (351) | 3789 | 1240 |
| Block [4] in FT8, [3] in FT4 | -21.32 dB (553) | -18.25 dB (430) | -16.80 dB (452) | -14.04 dB (342) | | |
| Block [1,2] | -20.90 dB (536) | -17.90 dB (416) | -16.35 dB (434) | -13.77 dB (331) | | |
| Block [1,3] | -21.25 dB (550) | -18.30 dB (432) | -17.02 dB (461) | -14.30 dB (352) | 3854 | 1250 |
| Block [1,2,3], FT4 [1,2,4] | -21.27 dB (551) | -18.40 dB (436) | -17.05 dB (462) | -14.35 dB (354) | 3884 | 1251 |
| Block [1,3], spectrogram LLRs first | -21.25 dB (550) | -18.38 dB (435) | -17.02 dB (461) | -14.30 dB (352) | | |
| Block [1,3], OSD on the first set only | -20.85 dB (534) | -17.70 dB (408) | -16.73 dB (449) | -13.87 dB (335) | | |
| Block [1,3], OSD on the second set only | -21.25 dB (550) | -18.30 dB (432) | -17.02 dB (461) | -14.27 dB (351) | 3826 | 1246 |
| Block [1,3], log score | -21.12 dB (545) | -17.35 dB (394) | -16.88 dB (455) | -12.88 dB (296) | 3725 | 1248 |
| Block [1,3], LLR variance 12 | -21.27 dB (551) | -18.20 dB (428) | -17.05 dB (462) | -14.22 dB (349) | | |
| Block [1,3], LLR variance 48 | -21.25 dB (550) | -18.28 dB (431) | -17.02 dB (461) | -14.27 dB (351) | | |
| Block [1,3], FT4 OSD floor -21 dB | -21.25 dB (550) | -18.30 dB (432) | -17.02 dB (461) | -14.30 dB (352) | | |
| Block [1,3], sync gate 5 of 21, 7 of 16 | -21.25 dB (550) | -18.30 dB (432) | -17.02 dB (461) | -14.30 dB (352) | 3854 | 1250 |
| Block [1,3], sync gate 7 of 21, 8 of 16 | -21.25 dB (550) | -18.30 dB (432) | -17.02 dB (461) | -14.30 dB (352) | 3853 | 1250 |

No configuration in the table made a false decode on the sweeps or the FT4 crowded slots (195 to 200 of 200 matched with blocks, 183 with the preset).

- Single-symbol block soft bits, the matched one-symbol correlation at the refined position, give 1.1 dB (FT8) and 1.35 dB (FT4) in AWGN and 1.5 and 1.9 dB with fading. Longer blocks add 1.15 and 1.4 dB in AWGN and 1.1 and 1.6 dB with fading.
- The longest block alone reaches the SNR50 of every combination within 0.15 dB. On the recordings the single-symbol set first adds 65 SARTS and 10 public decodes, from signals that fade within a block.
- Log scores lose 1.0 dB (FT8) and 1.4 dB (FT4) with fading, and 129 SARTS and 2 public decodes: a faded symbol gets as large an LLR as a strong one.
- OSD on the first set only loses 0.4 dB everywhere. OSD on the second set only matches the sweeps within 1 decode and loses 28 SARTS and 4 public decodes.
- The spectrogram LLRs first, the LLR variance and the FT4 OSD floor move SNR50 by at most 0.1 dB.
- The sync gate at 5 of 21 and 7 of 16 changes no decode in the table and cuts belief propagation and OSD attempts by 31 % on the recordings (222 to 153 per slot) and by 62 % on noise (22.5 to 8.5 per FT8 slot, 95.4 to 36.5 per slot of `ft4-sweep`, most of them noise), below the preset's 11.3 and 46.9. At 7 of 21 and 8 of 16 it loses 1 SARTS decode.

### The candidate in the preset

`subtract-3-osd2` with `demod.kind=block demod.ft8_blocks=[1,3] demod.ft4_blocks=[1,4] demod.ft8_min_sync=5 demod.ft4_min_sync=7`, against the preset alone:

| Set | Preset | With block soft bits |
| --- | --- | --- |
| `public/ft8_lib`, recall | 0.894 (1160) | 0.963 (1250) |
| SARTS 12 October (146 slots), recall | 0.717 (1638) | 0.895 (2045) |
| SARTS 13 October (204 slots), recall | 0.766 (1475) | 0.939 (1809) |
| SARTS, both | 0.739 (3113) | 0.915 (3854) |
| Unmatched on the recordings (public, SARTS) | 61, 7 | 113, 112 |
| `snr-sweep` AWGN, SNR50 | -19.02 dB (461) | -21.25 dB (550) |
| `snr-sweep` fading, SNR50 | -15.67 dB (327) | -18.30 dB (432) |
| `ft4-sweep` AWGN, SNR50 | -14.25 dB (350) | -17.02 dB (461) |
| `ft4-sweep` fading, SNR50 | -10.83 dB (215) | -14.30 dB (352) |
| `ft4-sweep` crowded, matched of 200 | 183 | 199 |
| `crowded`, matched of 1800 | 1767 | 1796 |
| `ap-sweep` callers, SNR50 | -19.39 dB (76 of 520) | -21.10 dB (144) |
| `ap-sweep` QSO messages, SNR50 | -21.70 dB (168 of 520) | -22.20 dB (188) |
| `late-start`, matched of 42 880 in 29 440 slots | 11 032 | 14 320 |
| False decodes: 5000 FT8 and 10 000 FT4 noise slots, 5000 `ap-sweep` noise slots, sweeps, `crowded` | 0 | 0 |
| False decodes: `late-start` | 1 | 1 |
| Stress, sync threshold 0 dB: false decodes on 5000 FT8 and 5000 FT4 noise slots | 0 | 0 |

`compare` on the recordings: 1023 decodes gained (854 matched), 35 lost (23 matched). On the sweeps 197 FT8 and 279 FT4 signals gained, 3 and 15 lost: signals the spectrogram LLRs decode and the block sets do not.

- The `late-start` false decodes differ. The preset's is `292RZQ S47NQS R RR91` in an FT4 slot cut at 0.625 s; the candidate's is `DT3ZRS 6U2PTX/R DQ85` in an FT4 slot spliced at 0.5 s, an OSD codeword with 29 hard errors from the single-symbol set, 46 Hz above two -12 dB signals. Without the sync gate the candidate made 2 there.
- Of the 225 unmatched decodes on the recordings, 129 repeat a text decoded in another slot and 67 more name only callsigns the references or matched decodes contain; 29 do neither, against 12 of the preset's 68 and 25 of the 132 unmatched through decision 0007's three stages. Unverified: whether those 29 are on the air.
- On the recordings 142 of the candidate's 371 matched OSD decodes have 27 to 30 hard errors (the limit is 30), against 61 of the preset's 220. A lower limit for block sets would cost true decodes.

### Later stages

The preset unchanged, then later stages (decision 0007's `DEEP`: stage 2 on a 4 × 4 grid, stage 3 on 8 × 4 with 400 candidates and OSD over 91 bits), each stage's soft bits as listed:

| After the preset | FT8 AWGN | FT8 fading | FT4 AWGN | FT4 fading | SARTS | public |
| --- | --- | --- | --- | --- | --- | --- |
| Nothing | -19.02 dB (461) | -15.67 dB (327) | -14.25 dB (350) | -10.83 dB (215) | 3113 | 1160 |
| `DEEP` as shipped | -19.88 dB (495) | -17.25 dB (390) | -15.42 dB (397) | -12.19 dB (268) | 3533 | 1227 |
| One block stage on the preset's grid | -21.25 dB (550) | -18.38 dB (435) | -17.02 dB (461) | -14.30 dB (352) | 3863 | 1252 |
| A block stage, then `DEEP` | -21.27 dB (551) | -18.60 dB (444) | -17.05 dB (462) | -14.45 dB (358) | 3924 | 1262 |
| `DEEP` with block soft bits in both stages | -21.55 dB (562) | -18.85 dB (454) | -17.55 dB (482) | -14.92 dB (377) | 3960 | 1257 |
| A block stage, then `DEEP` with block soft bits | -21.55 dB (562) | -18.90 dB (456) | -17.55 dB (482) | -14.92 dB (377) | 3972 | 1257 |
| `jt9 -d 3` (experiment 0007) | -20.60 dB (524) | -18.55 dB (442) | -17.73 dB (489) | -15.15 dB (386) | | |
| `jt9 -d 3` without its `a1` decodes | -20.50 dB | -18.28 dB | -17.60 dB (484) | -14.92 dB (377) | | |

Block soft bits use `demod.ft8_blocks=[1,3] demod.ft4_blocks=[1,4] demod.ft8_min_sync=5 demod.ft4_min_sync=7` in every row. The block stage on the preset's grid adds `search.skip_silent_frames=true validate.osd_min_snr_db=-23 ap.my_anywhere=false`, as the later stages do. None of the rows made a false decode on the sweeps, `crowded` (all 1800 signals but 3 in `n20-overlap` for every block row, 12 for `DEEP` as shipped) or the FT4 crowded slots. A later stage cannot lose an earlier decode.

`DEEP` with block soft bits in both stages, after the preset: no false decode on 5000 FT8, 10 000 FT4 and 5000 `ap-sweep` noise slots, and none with stage 2 or stage 3 alone after the preset at a sync threshold of 0 dB on 5000 FT8 and 5000 FT4 noise slots. On `ap-sweep` they reach -21.37 dB for callers (155 of 520) and -23.25 dB for QSO messages (230 of 520).

### The preset with blocks, then the later stages

The preset with block soft bits, then `DEEP` with block soft bits: -21.55 dB (562) and -18.88 dB (455) in FT8, -17.55 dB (482) and -14.92 dB (377) in FT4, 3967 SARTS and 1255 public decodes. No false decode on 5000 FT8 noise slots, 10 000 FT4 noise slots, `crowded` (all 1800 signals but 3) or the sweeps. With `DEEP` as shipped after the preset with blocks (an earlier build without the sync gate, which changed no decode wherever both were measured): -21.27, -18.60, -17.05 and -14.45 dB, 3932 and 1262.

### Time per slot

Native, one thread (`--threads 1`), each slot's fastest of 3 rounds that alternate the plans, on the 410 readable recorded FT8 slots and 154 FT4 slots of `ft4-sweep` rendered with 3 slots per step (57 AWGN, 57 fading, 20 crowded, 20 noise). Other jobs loaded the host throughout (1-minute load 12 to 34; decision 0007 measured the preset at 2.2 to 2.6, p50 21.5 ms), so these times are upper bounds and only the ratios carry over.

| Plan | FT8 recordings: p50, p95, max, mean | FT4: p50, p95, max, mean |
| --- | --- | --- |
| Preset | 31.0, 127.5, 201.7, 49.7 ms | 13.6, 41.8, 48.5, 18.5 ms |
| Preset with block soft bits | 51.6, 195.4, 283.8, 80.2 ms | 16.5, 37.9, 45.1, 19.7 ms |
| Preset, then `DEEP` | 371.7, 864.9, 1301.8, 445.6 ms | 229.4, 293.8, 479.7, 237.2 ms |
| Preset, then `DEEP` with block soft bits | 467.6, 1338.9, 1895.2, 607.9 ms | 274.5, 348.3, 402.4, 277.1 ms |

- Block soft bits make the preset 1.6 times as long on the FT8 recordings (mean and p50) and 1.06 to 1.2 times on the FT4 slots. In the first round, the least loaded, the FT8 and FT4 slots together took 47.0 s against 34.5 s. Half the added time is the per-candidate baseband, refinement and correlations (9.9 ms per slot in that round) and the slot transform (2.7 ms); the other half is subtraction and later passes for the extra decodes (5.4 and 4.8 ms).
- Without the sync gate the preset with blocks tried 222 sets of soft bits per recorded slot; with it 153, against the preset's 138. On noise the gate leaves fewer decoder attempts than the preset makes: 8.5 against 11.3 per FT8 noise slot, and 36.5 against 46.9 per slot of `ft4-sweep`, most of them noise.
- Block soft bits in `DEEP` make the later stages 1.36 times as long on the FT8 recordings (mean) and 1.17 times on the FT4 slots.

Browsers: `tools/wasm-cost/ft8.mjs` in the `e2e` container, decoding in a dedicated module worker with the app's 2000 ms budget, each slot's fastest of 3 runs, the release build of `rr73-wasm`. The two plans are the app's now (the preset, then `DEEP`) and with block soft bits in all three stages. Other jobs and accuracy runs of this experiment loaded the host (1-minute load 12 to 27); decision 0007 measured the app's plan on the same slots at p50 30 ms (Chromium) and 24 ms (WebKit) for the preset and 321 and 264 ms through stage 3.

| 410 recorded FT8 slots, p50, p95, max | Chromium, now | Chromium, blocks | WebKit, now | WebKit, blocks |
| --- | --- | --- | --- | --- |
| Stage 1 ends at | 58, 214, 350 ms | 72, 312, 627 ms | 60, 179, 308 ms | 72, 256, 362 ms |
| Stage 2 ends at | 188, 478, 734 ms | 173, 570, 937 ms | 160, 391, 721 ms | 164, 470, 806 ms |
| Whole plan | 551, 1281, 1791 ms | 562, 1729, 2005 ms | 497, 1090, 1559 ms | 561, 1416, 2004 ms |
| Slots the budget stopped | 0 | 8 | 0 | 3 |
| Longest step | 82.9 ms | 65.2 ms | 56.0 ms | 109.0 ms |
| Decodes by stage | 4341, 387, 164 | 5329, 122, 107 | 4341, 387, 164 | 5329, 122, 107 |

| 154 FT4 slots, p50, p95, max | Chromium, now | Chromium, blocks | WebKit, now | WebKit, blocks |
| --- | --- | --- | --- | --- |
| Stage 1 ends at | 14, 47, 79 ms | 18, 54, 85 ms | 12, 29, 33 ms | 16, 35, 41 ms |
| Whole plan | 235, 339, 645 ms | 255, 341, 420 ms | 194, 286, 384 ms | 207, 297, 405 ms |
| Longest step | 19.4 ms | 21.3 ms | 44.0 ms | 17.0 ms |
| Decodes by stage | 228, 18, 2 | 255, 1, 0 | 228, 18, 2 | 255, 1, 0 |

No FT4 slot reached the budget. In FT4 the preset with blocks decodes 255 messages in stage 1, more than the three stages decode now (248).

## Expected and measured

| Measure | Preset | Expected with block soft bits in the preset | Measured |
| --- | --- | --- | --- |
| SNR50, FT8 AWGN | -19.02 dB | -19.8 to -20.5 dB | -21.25 dB |
| SNR50, FT8 fading (0.5 Hz, 1 ms) | -15.67 dB | -16.2 to -17.0 dB | -18.30 dB |
| SNR50, FT4 AWGN | -14.25 dB | -15.8 to -17.0 dB | -17.02 dB |
| SNR50, FT4 fading | -10.83 dB | -11.8 to -13.0 dB | -14.30 dB |
| SARTS recall | 0.739 | +0.02 to +0.05 | +0.176 |
| `public/ft8_lib` recall | 0.894 | +0.01 to +0.03 | +0.069 |
| False decodes, noise sets and stress | 0 | 0 | 0 |
| Time per slot, single-threaded native | p50 21.5 ms, slowest 96 ms (decision 0007) | about twice that | 1.6 times, on a loaded host: p50 31.0 to 51.6 ms, slowest 201.7 to 283.8 ms |

The plan expected a block stage after decision 0007's stages to add 0.3 to 0.6 dB in FT8 and 1 to 1.5 dB in FT4. Block soft bits in those stages add 1.67 dB and 1.60 dB (FT8 AWGN, fading) and 2.13 dB and 2.73 dB (FT4).

## Interpretation

- Block soft bits are the largest single gain measured in this decoder. In the preset they lower SNR50 by 2.2 dB (FT8 AWGN), 2.6 dB (FT8 fading), 2.8 dB (FT4 AWGN) and 3.5 dB (FT4 fading), and raise SARTS recall from 0.739 to 0.915 and public recall from 0.894 to 0.963. The preset with blocks alone beats decision 0007's three stages on every set.
- The hypothesis expected less: -19.8 to -20.5 dB in FT8 AWGN (measured -21.25), -15.8 to -17.0 dB in FT4 AWGN (-17.02), and SARTS recall up by 0.02 to 0.05 (0.18). Both parts count in both modes: the matched single-symbol correlation at the refined position (1.1 to 1.9 dB) and the longer blocks (1.1 to 1.6 dB).
- Against `jt9 -d 3` without its a priori decodes, the preset with blocks is 0.75 dB ahead in FT8 AWGN, level with fading, and 0.6 dB behind in FT4 in both channels. With block soft bits in the later stages as well, FT8 is 1.05 dB ahead in AWGN and 0.6 dB with fading, and FT4 is level in both. Experiment 0007's FT4 deficit, 2.2 to 2.7 dB through stage 3, is gone.
- Fading does not break the blocks: 3-symbol (FT8) and 4-symbol (FT4) blocks gain as much with 0.5 Hz of Doppler spread as in AWGN. Log scores, the counterpart of the spectrogram's dB magnitudes, lose 1.0 to 1.4 dB with fading.
- False decodes stay at the preset's: none on 20 000 noise slots and in the stress runs, 1 in `late-start` against 1, and unmatched decodes on the recordings of the same kinds as decision 0007's stages added.
- Time: the preset with blocks takes 1.6 times the preset's time natively on the FT8 recordings and 1.06 to 1.2 times on FT4 slots, half of the increase for decoding the added signals. In the browsers, on a loaded host, stage 1 ends at a p50 of 72 ms against 58 to 60 ms and a p95 of 256 to 312 ms against 179 to 214 ms. With block soft bits in every stage the whole plan takes a p50 of 561 to 562 ms against 497 to 551 ms and a p95 of 1416 to 1729 ms against 1090 to 1281 ms, and the 2 s budget stopped 3 (WebKit) and 8 (Chromium) of 410 slots.

## Decision

Accepted 2026-10-16: `subtract-3-osd2` takes its soft bits from blocks of 1 and 3 FT8 symbols or 1 and 4 FT4 symbols, with the sync gate at 5 of 21 and 7 of 16. The app's later stages are written as overrides of the preset, so they take block soft bits as well. The plan strings, CI's stage strings and the gate files keep their names, and the gate files were recorded again with the change.

- Reason for the preset: the early pass and the slots RR73 transmitted in decode with the preset alone (decision 0007), and stage 1's decodes reach the sequencer first. The preset with blocks alone beats the three stages it replaces in recall and SNR50 on every set.
- Cost: 1.6 times the preset's time natively on the FT8 recordings; in WebKit on a loaded host stage 1 ends at p50 72 ms (60 ms now) and p95 256 ms (179 ms). Half the added time decodes the added signals. The three stages together take p50 561 ms (497 ms now) and p95 1416 ms (1090 ms) in WebKit; 3 of 410 slots reached the 2 s budget, which ends stage 3 early as designed. A phone is slower than the M4: more slots will reach the budget there. Not tested on a device.
- Rejected: block soft bits in the later stages only. They reach nearly the same SNR50 after stage 3 but leave the early pass and the transmit slots at today's sensitivity, and a new `DEEP` needs a new gate file. Blocks [1,2,3]: 30 more SARTS decodes and 0.1 dB with fading for a third set per candidate. Spectrogram LLRs first: a third set for no gain. Log scores and OSD on one set only: the losses above.

## Open risks

- Synthetic channels are AWGN and one Watterson channel (0.5 Hz, 1 ms in FT8, 2 ms in FT4) without drift. The refinement finds one frequency per transmission, so a drifting signal is off frequency towards both ends: at 0.1 Hz/s an FT8 signal is 0.63 Hz off at either end, which turns the phase by 0.63 rad from symbol to symbol and costs a 3-symbol block about 1.2 dB. The single-symbol set does not depend on phase. Not measured; the SARTS recordings carry whatever drift the stations on the air had.
- No FT4 recordings: FT4 rests on synthetic slots alone.
- 29 unmatched decodes on the recordings have no support in other slots or the references. Unverified whether they are on the air.
- OSD accepts many block decodes with 27 to 30 hard errors. Its limits were set for spectrogram LLRs (experiment 0002); the noise and stress runs found no false decode, and the `late-start` one has 29.
- The longest step in WebKit was 109 ms with block soft bits against 56 ms now, on the loaded host; decision 0007 measured 8.0 ms on an idle one. A step that long delays a request to pack or synthesise a transmission by as much. Not measured on an idle host.
- The block demodulator keeps the slot transform and its input, 0.8 MB each in FT8, besides the FFT's scratch. Not tested on a device.
