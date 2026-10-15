# Experiment 0010: search, refinement and subtraction

Status: hypothesis recorded 2026-10-15, before the changes below were built. The miss breakdown (part 1) was measured first, with a diagnostic added to the bench for it, and sets the expectations.

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

| Measure | Now | Expected |
| --- | --- | --- |
| SNR50 AWGN, stage 1 | -19.02 dB | -19.5 to -20.0 dB with refinement |
| SNR50 fading, stage 1 | -15.67 dB | -16.0 to -16.6 dB |
| SARTS recall, stage 1 | 0.739 | 0.76 to 0.79 |
| SARTS recall, three stages | 0.839 | 0.845 to 0.86 |
| `public/ft8_lib` recall, three stages | 0.945 | 0.945 to 0.955 |
| `crowded` recall, three stages | 0.993 | 0.993 to 0.997 |
| `late-start` FT8 `shift` at 3 s, preset | lost | most decode with a wider DT range |
| False decodes, noise sets and stress | 0 | 0 |
| Stage 1 time per slot | p50 21.5 ms, max 96 ms (0007) | within 30 % of that |
| Later stages | within the 2 s budget | within the 2 s budget |

Refinement should carry most of the gain. Local-maximum suppression should change recall little and save LDPC time. The miss breakdown limits what search and subtraction changes can add: 48 search misses and 10 genie-decodable failures after three stages.

## Acceptance

A change is kept only if it adds true decodes or lowers SNR50, adds no false decode on the noise sets and in the stress run, and keeps the preset near its current cost and the later stages within decision 0007's 2 s budget on a phone. Negative results are recorded here.
