# Experiment 0010: search, refinement and subtraction

Status: hypothesis recorded 2026-10-15, before the changes below were built. The miss breakdown (part 1) was measured first, with a diagnostic added to the bench for it, and sets the expectations. Results measured 2026-10-16. The changes stay overrides until they are measured again on top of the block soft bits of experiment 0008.

## Question

On the SARTS recordings RR73 matches 74 % of `jt9 -8 -d 3`'s decodes with the shipped preset alone and 84 % with the later stages (decision 0007). Which of the stages around the demodulator lose the rest: the candidate search and its sync score, the time and frequency at which symbol levels are read, or subtraction and the order of passes? Which changes there recover decodes with no added false decode, within the time the preset and the later stages have?

The demodulator itself (its bit metrics) is out of scope here; experiment work on multi-symbol metrics runs separately.

## Part 1: where the misses are

`rr73-bench misses` decodes each recorded slot as `run` does, with a trace of every candidate tried, and puts each reference decode the run misses in one class: a hashed callsign RR73 cannot resolve, the same text decoded outside the match tolerance, a DT outside the search, no candidate within 3.2 Hz and 0.09 s (search miss), a candidate there that decoded as another message, or candidates there that failed to decode. For each miss it rebuilds the transmitted codeword from the text and finds the spectrogram position within 5 Hz and 0.25 s whose LLRs disagree least with it (the genie position), on the original audio and on the residual after every decode of the run is subtracted, on the preset's grid and on the finest later-stage grid, and runs the preset's belief propagation and OSD there.

The 60 public files and the 343 SARTS slots with at least one reference decode (5508 reference decodes):

| Class | Preset alone | Three stages |
| --- | --- | --- |
| Matched | 4273 | 4760 |
| Missed | 1235 | 748 |
| Hashed callsign | 47 | 34 |
| Same text outside the tolerance | 9 | 9 |
| DT outside the search | 0 | 0 |
| Search miss | 114 | 48 |
| Decoded as another message | 7 | 6 |
| Candidates there, none decoded | 1058 | 651 |

Of the 651 failed candidates after three stages, the genie position on the residual decodes 7, and 3 decode on the original audio only. The other 641 do not decode with max-log LLRs at any grid position: their best positions carry 20 to 40 hard errors (501 of 651). By reference SNR they spread evenly: 185 below -20 dB, 113 from -20 to -16, 128 from -16 to -12, 114 from -12 to -6 and 111 at -6 dB and above. 147 have another reference decode within 10 Hz and 280 within 25 Hz. Most misses are signals that RR73 finds and cannot demodulate cleanly: weak ones, and strong ones in crowded spectrum where neighbours and their subtraction residue corrupt the LLRs. Search misses are 6 % of the misses after three stages.

## Why the changes should help

- Symbol levels at the refined time and frequency. Stage 1 reads each symbol from a spectrogram cell on a grid of half a symbol and half a tone spacing, through a 2-symbol Hann window. A signal between grid points loses up to 1.4 dB to the frequency offset and timing (experiment 0003), and the Hann window over 2 symbols captures 0.5 dB less than a 1-symbol window aligned on the symbol, while picking up the neighbouring symbols. The later stages owe most of their gain to finer grids (0003: 4 frames per symbol alone added 198 matches on SARTS). Refining each candidate's start and frequency from its Costas arrays, then reading the symbols with a 1-symbol window at that position from a complex baseband of the candidate's band, should give the fine grid's gain in stage 1 and add to the later stages. The QEX paper on FT4 and FT8 describes this downconversion and fine synchronisation for WSJT-X. The genie measures it directly: misses whose LLRs at the refined position decode.
- Candidate list. ft8_lib's search keeps every grid point that scores, so a strong signal fills several of the 140 places with its neighbouring time and frequency positions, each costing an LDPC attempt. Keeping only local maxima of the sync score frees places for weaker signals and LDPC time.
- Sync score. The score compares sync tones with their neighbours in dB, averaged over the Costas symbols inside the spectrogram. A per-band noise normalisation and the handling of arrays outside the slot change which candidates rank in the 140.
- DT range. FT8 searches DT up to 2.5 s; RR73 itself starts replies up to 4 s late (`LATE_S`), and the `late-start` set loses those messages. A search to 3 s or more with the missing symbols erased reaches them.
- Subtraction. The model follows the amplitude with a 0.16 s moving average at a fixed frequency. Residue from imperfect subtraction of strong signals sits in exactly the crowded spectrum where the strong failed misses are. A cleaner subtraction (frequency and drift from the decoded tones, a smoothing window matched to the signal's fading), and a pass order or count that lets weak signals see a clean residual, should recover some of them. The residual energy after subtracting strong signals measures it directly.

## Method

Each change is a configuration option; the presets stay unchanged until a change is justified.

1. The miss breakdown above, for the preset and for the three-stage plan (`DEEP`, decision 0007).
2. Search: local-maximum suppression of candidates, the sync score's normalisation, the FT8 and FT4 DT ranges, a coarse-to-fine search.
3. Refinement before demodulation: a `SyncRefine` implementation that refines start and frequency from the Costas arrays on a complex baseband of the candidate's band and gives the demodulator symbol levels read at that position with a 1-symbol window. The demodulator's code is not changed.
4. Subtraction: frequency and drift in the model, the smoothing window, the order of subtraction and the number of passes, measured by the residual energy left by strong decoded signals and by recall.

Measurements, each change in stage 1 and within the later stages: the 60 public files and the 350 SARTS slots; `--synth snr-sweep` (40 per step, AWGN and fading); `--synth crowded`; `--synth late-start`; `--synth ap-sweep`; `--synth ft4-sweep`; false decodes on `--synth noise --noise-count 5000` and on 10000 FT4 noise slots (`ft4-sweep` noise); the stress run of experiment 0003 (sync threshold 0 dB on the noise slots). Time per slot natively, single-threaded, each slot's best of 3, with the host's load average reported.

## Expected effect

| Measure | Now | Expected | Measured (2026-10-16, results below) |
| --- | --- | --- | --- |
| SNR50 AWGN, stage 1 | -19.02 dB | -19.5 to -20.0 dB with refinement | -19.98 dB |
| SNR50 fading, stage 1 | -15.67 dB | -16.0 to -16.6 dB | -16.72 dB |
| SARTS recall, stage 1 | 0.739 | 0.76 to 0.79 | 0.835 |
| SARTS recall, three stages | 0.839 | 0.845 to 0.86 | 0.873 |
| `public/ft8_lib` recall, three stages | 0.945 | 0.945 to 0.955 | 0.960 |
| `crowded` recall, three stages | 0.993 | 0.993 to 0.997 | 0.996 |
| `late-start` FT8 `shift` at 3 s, preset | lost | most decode with a wider DT range | 127 of 160 |
| False decodes, noise sets and stress | 0 | 0 | 0 |
| Stage 1 time per slot | p50 21.5 ms, max 96 ms (0007) | within 30 % of that | refinement: mean +0 to 19 %; with the wider DT range: mean +31 %, p50 +47 % |
| Later stages | within the 2 s budget | within the 2 s budget | 9 to 22 % less time than before |

Refinement should carry most of the gain. Local-maximum suppression should change recall little and save LDPC time. The miss breakdown limits what search and subtraction changes can add: 48 search misses and 10 genie-decodable failures after three stages.

## Acceptance

A change is kept only if it adds true decodes or lowers SNR50, adds no false decode on the noise sets and in the stress run, and keeps the preset near its current cost and the later stages within decision 0007's 2 s budget on a phone. Negative results are recorded here.

## Results

Measured 2026-10-16 on the tree of the commits that follow this note's hypothesis: a release build of `rr73-bench` in the `rust` container on the Apple M4 (10 CPUs). Accuracy runs used 10 threads while other work loaded the host (1-minute load average 11 to 64); decodes and false decodes do not depend on load. Times are in their own section. "Three stages" is the app's plan (`DEEP`, decision 0007); "refined" sets `refine.kind=baseband` in every stage that runs. Recall counts reference decodes matched within 10 Hz and 0.5 s, as in decision 0007.

### Refinement before demodulation

`refine.kind=baseband` (`crates/rr73-decode/src/refine.rs`) works on one FFT of the pass's audio (192 000 points for FT8, 0.0625 Hz bins). Per candidate it cuts the band from 0.75 tone spacings below tone 0 to 0.75 above the top tone, with raised-cosine edges, to a complex baseband of 32 samples per symbol (16 in FT4); finds the start from the energy of the 21 sync tones, one baseband sample at a time over half a search frame each side; finds the frequency from correlations coherent over each Costas array, 0.04 tone spacings apart with a parabolic peak; searches the start again within 2 samples at that frequency; and reads each symbol's 8 tone levels with a one-symbol rectangular window (a 32-point FFT). The max-log demodulator reads those levels in place of the spectrogram. A candidate whose refined position repeats one already tried in the pass (same start sample, frequency within 0.02 tone spacings) is skipped: neighbouring grid points of one signal refine to the same position. On the test signals of `crates/rr73-decode/tests/session.rs` decodes land within 0.1 Hz and 1 ms of the truth; the preset's grid leaves up to 1.6 Hz and 40 ms.

| Set | Preset alone | Preset, refined | Three stages | Three stages, refined |
| --- | --- | --- | --- | --- |
| SARTS (350 slots, 4210 reference decodes), recall | 0.739 (3113) | 0.835 (3514) | 0.839 (3533) | 0.873 (3677) |
| `public/ft8_lib` (60 slots, 1298), recall | 0.894 (1160) | 0.951 (1235) | 0.945 (1227) | 0.960 (1246) |
| `crowded` (80 slots, 1800 signals), matched | 1767 | 1788 | 1788 | 1793 |
| `crowded/n20-overlap`, matched of 400 | 374 | 388 | 388 | 393 |
| SNR50, AWGN sweep | -19.02 dB | -19.98 dB | -19.88 dB | -20.07 dB |
| SNR50, fading sweep | -15.67 dB | -16.72 dB | -17.25 dB | -17.37 dB |
| `ft4-sweep/awgn`, matched, SNR50 | 350, -14.25 dB | 386, -15.14 dB | 397, -15.42 dB (0007) | 402, -15.55 dB (1) |
| `ft4-sweep/fading`, matched, SNR50 | 215, -10.83 dB | 252, -11.77 dB | 268, -12.19 dB (0007) | 276, -12.39 dB (1) |
| `ft4-sweep/crowded`, matched of 200 | 183 | 194 | 198 (0007) | 196 (1) |
| `late-start` at 20 slots per step, FT8, matched of 11200 | 3015 | 3399 | not run | not run |
| `late-start` at 20 slots per step, FT4, matched of 10240 | 2460 | 2738 | not run | not run |
| Unmatched on the recordings (public, SARTS) | 61, 7 | 97, 26 | 103, 29 | 132, 46 |
| False: 5000 noise slots, 10000 FT4 noise slots, sweeps, `crowded`, `late-start` | 0 | 0 | 0 | 0 (1), `late-start` not run |
| False, stress: sync threshold 0 dB on the 5000 noise slots and `crowded` | 0 (0007) | 0 | 0 (0007) | not run |

(1) With the wider DT range of the next section as well; it changes nothing on `ft4-sweep` in the preset. The three stages with both changes match 3669 SARTS and 1248 public reference decodes (3677 and 1246 refined alone) and give the same SNR50 as refined alone.

`compare`, preset against preset refined: on the recordings 563 decodes gained (499 matched, 64 unmatched) and 32 lost (23 matched); on the sweeps and `crowded` 106 gained and 5 lost, all matched. Three stages against three stages refined: on the recordings 265 gained (205 matched, 60 unmatched) and 56 lost (42 matched). The lost matches are weak signals (-20 to -15 dB) that the grid's levels decode and the refined levels do not.

Early pass and a priori decoding, preset against preset refined: on the first 13.5 s of the recorded slots 3112 to 3520 SARTS and 1157 to 1228 public matches; on the first 6 s of `ft4-sweep` 350, 215 and 183 to 386, 252 and 194 matched (AWGN, fading, crowded; the same as the whole slots), with 0 false decodes on 2000 FT4 noise slots; on `ap-sweep` (decision 0009) `qso` 168 to 187 matched (SNR50 -21.70 to -22.17 dB) and `callers` 76 to 104 (-19.39 to -20.10 dB), with 0 false decodes on its 1000 noise slots. With both changes, refinement and the wider DT range of the next section: 0 false decodes on 5000 FT8 noise slots cut at 13.5 s, on 10000 FT4 noise slots cut at 6 s and on 10000 `ap-sweep` noise slots, and the same `ap-sweep` counts.

The preset refined matches about as many SARTS decodes as the three stages without refinement (3514 against 3533), and more on `public/ft8_lib` (1235 against 1227). Refinement in stage 1 gives the gain the finer grids of stages 2 and 3 bought, at the preset's grid.

Unmatched decodes: of the 64 that refinement adds in stage 1, 50 carry only callsigns that a reference list in the corpus holds. The other 14 are standard messages, such as `CQ DO2HC JO50`, `EY8MM YB1BML 73` and `OH1PH R80SAA R-16`; one looks doubtful (`LU5HA UA9TK R-20`, an OSD codeword with 24 hard errors reported at +4.7 dB). Of the 60 that refinement adds in the three stages, 48 carry known callsigns; the other 12 are standard messages between plausible callsigns, such as `CQ SCI PP5GP GG52` and `ZL2OK PD1PDR JO21`.

### Where the misses are now

`rr73-bench misses` on the same 403 slots with at least one reference decode (5508 reference decodes), against part 1:

| Class | Preset alone | Preset, refined | Three stages | Three stages, refined |
| --- | --- | --- | --- | --- |
| Matched | 4273 | 4749 | 4760 | 4923 |
| Missed | 1235 | 759 | 748 | 585 |
| Hashed callsign | 47 | 31 | 34 | 30 |
| Same text outside the tolerance | 9 | 9 | 9 | 9 |
| Search miss | 114 | 100 | 48 | 40 |
| Decoded as another message | 7 | 7 | 6 | 5 |
| Candidates there, none decoded | 1058 | 612 | 651 | 501 |

After the three refined stages, 471 of the 501 failed candidates decode at no genie position (preset grid, fine grid or refined, original audio or residual), and 30 do at one. By reference SNR the 501 spread as before: 156 below -20 dB, 95 from -20 to -16, 97 from -16 to -12, 82 from -12 to -6 and 71 at -6 dB and above; 194 have another reference decode within 25 Hz. These are for the demodulator: the levels at the right position do not carry the message through max-log LLRs.

Of the 40 search misses, 15 are at -6 dB or above and 13 of those are one station, 9A7W, at 2996 Hz, from +10 to +26 dB: its tones reach 3040 Hz, above the 3000 Hz limit of the search (`spectrogram.freq_max_hz`), and `jt9` decodes it in all 13 slots. At their genie positions all 40 score under 5 dB on the preset's grid (18 under 2 dB), the 13 because their top tones lie outside the spectrogram, and 25 of the other 27 are under -6 dB.

Raising the search limit to 3200 Hz or 4000 Hz (`spectrogram.freq_max_hz`), refined, finds 12 of the 13 and `YO3GK JE6EFG PM53` at 2962 Hz, and nothing else on the recordings (4761 matches at either limit, against 4749). Their reported SNR reads +39 to +46 dB, against +10 to +26 dB from `jt9`. Unverified cause: the SNR estimate takes its noise from the cells around the signal, which read low where a receiver's passband falls off. Not adopted until the SNR estimate handles a receiver's band edge.

### Search

- Local maxima only (`search.kind=costas-peaks`, a candidate only where no neighbouring frame or bin scores higher): with refinement, 63 fewer matches on the recordings (4686 against 4749) and 3 fewer on the sweeps and `crowded`. A weak signal one bin or frame from a stronger one is no local maximum and loses its place, and the repeats the plain search spends places on cost only a refinement each once `refine.skip_repeats` skips them. Rejected; the code is not kept.
- DT range. The sequencer starts RR73's own replies up to 4 s late in FT8 and 1.25 s in FT4 (`LATE_S`), and the preset searched DT up to 2.5 s and 1.0 s. With the search to 4.5 s in FT8 and 1.5 s in FT4 (`search.ft8_dt_max_s=4.5`, `search.ft4_dt_max_s=1.5`), refined, the `late-start` subsets that send the whole message late (`shift` and `replace`) decode at each delay up to the new limit at about the rate of an on-time message: FT8 `shift` at 3.0, 3.5, 4.0 and 4.5 s 127, 127, 124 and 119 of 160, FT4 `shift` at 1.25 and 1.5 s 104 and 104 of 160, all 0 before. `late-start` gains 992 FT8 matches (3399 to 4391 of 11200) and 416 FT4 matches (2738 to 3154 of 10240), loses none, and has no false decode. The limit 4.0 s gave 4154 FT8 matches; FT4 at 1.75 s added 1 match over 1.5 s.
- On the recordings the wider range adds 59 decodes the reference lacks and 2 it holds, and loses 1. The 59 are stations whose DT lies between 2.5 and 4.5 s, outside `jt9`'s search, decoded in consecutive slots at the same frequency and DT: `CQ ON3JJT JO20` at +5 to +16 dB and DT 2.65 s in 9 files of `20m_busy_test`, `JO1COV M6ENS IO83` at DT 3.17 s, `LW8DKC JO4ESJ PM64` at DT 3.84 s in 3 SARTS slots. False decodes with the wider range: 0 on the 5000 noise slots, the 10000 FT4 noise slots and `crowded`, and 0 in the stress run at a 0 dB sync threshold.

### Subtraction

`rr73-bench subtraction` (part of this work) measures how much of a decoded signal the subtractor leaves, 40 slots per case, median in dB of the signal's energy:

| Case | Preset | Preset, refined | Refined, `subtract.refine=false` | Amplitude ramps modelled, refined |
| --- | --- | --- | --- | --- |
| Steady, -10 dB | -15.6 | -16.0 | -15.9 | -16.1 |
| Steady, 0 dB | -24.5 | -24.7 | -24.6 | -26.0 |
| Steady, +10 dB | -29.2 | -29.3 | -29.1 | -35.8 |
| Steady, +20 dB | -30.2 | -30.2 | -30.0 | -45.5 |
| Moderate fading, +10 dB | -29.4 | -29.4 | -28.8 | -32.6 |
| Disturbed fading, +10 dB | -25.8 | -26.1 | -25.3 | -28.0 |
| Drift 0.2 Hz/s, +10 dB | -26.0 | -26.1 | -25.7 (90th percentile -16.9) | -28.1 |

- Placement: without its own refinement the subtractor leaves -6 to -9 dB from the grid's start and frequency. The refined decode's start and frequency remove as much as the subtractor's own refinement, except for drifting signals, whose frequency the Costas arrays measure only at three points.
- Amplitude ramps. Strong steady signals stop at -30 dB because the model lacks the transmitter's amplitude ramps (FT8: a raised cosine over 20 ms at each end, FT4: over the first and last symbols), and the 0.16 s moving average smears the step. Modelling them, with the average weighted by the envelope squared, takes a noiseless signal from -30 to -64 dB in FT8 and from -24 to -64 dB in FT4, and the table's +20 dB case to -45 dB. Recall does not move: with refinement, 4746 against 4749 matches on the recordings in the preset, 4924 against 4923 through three stages, and the same counts on the sweeps, `crowded` and `ft4-sweep`. The residue of strong signals is not what limits recall. Not kept.
- Smoothing window, preset refined, recordings: 0.08 s 4605 matches, 0.16 s (as now) 4749, 0.24 s 4759 (SARTS +28, public -18), 0.32 s 4730. 0.16 s stays.
- Passes: a fourth pass in the preset, refined, adds 4 matches on the recordings. Not worth a pass.

### Later stages

With every stage refined, stage 2 adds 95 decodes (68 matched) and stage 3 134 (106 matched) on the recordings, against 387 and 164 without refinement. Two-stage plans with refinement, the preset followed by one stage with stage 3's search (400 candidates from 2 dB, OSD over all 91 information bits) on a 4 x 4 grid or on the preset's 2 x 2 grid, match 4902 and 4857 on the recordings against 4923 for the three refined stages, and in the 10-thread runs their one stage took longer than stages 2 and 3 together. The three stages stay.

### Time

Native, single-threaded (`--threads 1`), each slot's fastest of 3 runs, with the configurations run in turn so that each saw the same load. The host was shared: 1-minute load average 15 to 32 for the first three rows, 6 to 16 for the DT row and 9 to 15 for the last row. Decision 0007 measured the preset at p50 21.5 ms and the three stages at p50 242.1 ms at a load of 2.2 to 2.6, so these times run about 1.1 to 1.8 times as long.

| Slots, ms: p50, p95, max, mean | Preset alone | Preset, refined | Three stages | Three stages, refined |
| --- | --- | --- | --- | --- |
| Recordings, 410 slots | 39.4, 141.8, 187.6, 63.0 | 43.5, 131.1, 182.5, 63.2 | 397.1, 866.5, 1204.0, 468.4 | 370.5, 782.1, 1105.0, 426.0 |
| `snr-sweep` at 5 per step and 200 noise slots, 410 slots | 10.0, 27.7, 46.8, 12.8 | 11.0, 27.5, 40.9, 13.9 | 279.4, 313.1, 552.3, 284.0 | 210.8, 280.6, 405.0, 222.3 |
| `ft4-sweep` at 3 per step, 20 crowded and 100 noise slots, 234 slots | 7.8, 24.6, 32.0, 10.7 | 9.2, 26.9, 37.7, 12.7 | 175.9, 215.5, 341.9, 182.0 | 146.7, 168.9, 258.9, 151.0 |
| Recordings, refined, DT to 2.5 and 1.0 s, then to 4.5 and 1.5 s | | 25.1, 86.5, 111.1, 41.5 then 33.2, 98.7, 146.6, 50.6 | | |
| Recordings, the preset as it was, then refined with DT to 4.5 and 1.5 s | 22.9, 85.3, 125.1, 39.4 | 33.7, 102.7, 167.6, 51.8 | | |

- The preset refined costs 0 to 19 % more on average than the preset (mean per slot), and finds 13 % more on the recordings. Per slot the refinement takes about as long as the search (SARTS: 7.4 against 9.4 ms per slot at the low load). Belief propagation converges sooner on refined levels, and repeats skip LDPC altogether, which pays back part of it.
- The three stages refined take 9 to 22 % less time than the three stages without: stage 1 finds most of what stages 2 and 3 found before, so they run fewer passes, and on their fine grids many neighbouring candidates refine to one position and are skipped as repeats.
- The wider DT range costs 22 % in the preset's mean time per slot: the search keeps 31 % more candidates (73513 against 55904 over the 410 slots) and LDPC runs 38 % more often. Past DT 2.5 s the third Costas array lies outside the slot, so the score averages two arrays, and more positions in noise reach the 5 dB threshold (unverified). A higher sync threshold for positions past DT 2.5 s could take back part of the cost; not tried. Both changes together, against the preset as it was, at load 9 to 15: p50 22.9 to 33.7 ms, p95 85.3 to 102.7 ms, max 125.1 to 167.6 ms, mean 39.4 to 51.8 ms (+31 %). Of the decodes past DT 2.5 s, 1042 of 1077 on `late-start` and 44 of 45 on the recordings score at least 7 dB.
- Longest single step of a session, recordings, three stages: 26.2 ms without refinement and 28.1 ms with, under the app's 40 ms slices.

## Decision and open risks

The presets stay as they are for now. The block soft bits of experiment 0008 (`demod.kind=block`), which bring their own baseband and refinement inside the demodulator, go into the shipped preset first; each change below is then measured again on top of them, and the miss breakdown with it. Until then they are overrides:

- `refine.kind=baseband` in the preset and the later stages. On the max-log demodulator it is the largest gain measured here. With the block soft bits it may add nothing to demodulation; its refined start and frequency may still serve the subtraction and the reported DT and frequency.
- `search.ft8_dt_max_s=4.5 search.ft4_dt_max_s=1.5`: independent of the demodulator. This costs 22 % of the preset's mean time per slot, and with refinement the preset takes 31 % more on average than before, past the 30 % this note expected. A higher sync threshold past DT 2.5 s is the next step if that is too much: 7 dB keeps 97 % of the late decodes.
- `DEEP` keeps its three stages: refined, they keep more decodes than the two-stage plans tried, and take less time than the three stages without refinement.

Rejected, with the measurements above: local maxima only in the search, the amplitude ramps in the subtraction model, other smoothing windows, a fourth pass, two-stage plans and, for now, a search band above 3000 Hz.

Open risks:

- Not tested in a browser or on a device. Refinement adds an FFT per pass and an inverse FFT per candidate; natively the preset's mean time per slot rises 0 to 19 % and the three stages' falls, but the WebAssembly cost is unmeasured.
- Refinement loses some weak decodes that the grid's levels find: 23 matched in stage 1 and 42 through three stages on the recordings, against 499 and 205 gained. A fallback to the grid's levels was not tried.
- Experiment 0008 and this work each add a baseband step per pass. Rebasing this branch onto it will conflict in `crates/rr73-decode/src/session.rs` and `pipeline.rs`, and one baseband and one refined position should then serve the demodulator, the subtraction and the reports.
- The wider DT range adds decodes the reference cannot have; on the recordings they are consistent across slots, but interference-shaped false decodes cannot be measured on the noise sets.
- After the three refined stages, 501 of the 585 misses on the recordings are candidates at the right place whose levels do not decode at any position tried: a matter for the demodulator.
