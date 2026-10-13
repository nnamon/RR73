# Experiment 0003: anytime decoding

Status: hypothesis recorded 2026-10-13, before implementation.

## Question

Two separate questions about when decoding happens:

1. Early decoding: how many of the shipped preset's full-slot decodes does it already find in a partial slot (the first 11.8 s or 13.5 s of audio), at what cost in false decodes and time? The app could show them before the slot ends and the sequencer could prepare its reply earlier.
2. Deeper passes after the deadline: once the shipped preset has run at slot end, do further stages that spend more compute on the residual and on more candidates find more true decodes, without false ones, within the time left before the next slot's early pass?

## Why it should work

An FT8 transmission at DT 0 runs from 0.5 s to 13.14 s. At 11.8 s it lacks its last 9 symbols: 2 data symbols (6 of 174 code bits) and the third Costas array. Missing symbols become zero LLRs (erasures), which the LDPC code fills in when the rest is clean, and the first two Costas arrays still give the sync score. Late starters lose more: at 11.8 s a signal at DT +0.5 s lacks its last 12 symbols, 5 of them data symbols (15 code bits). WSJT-X reports about 85 % of its decodes at its 11.8 s pass.

The shipped preset spends about 100 ms of a 15 s slot. It stops after 3 passes, keeps the 140 best candidates scoring at least 5 dB, searches a grid of 2 frames per symbol and 2 bins per tone spacing, and runs OSD of order 2 over 40 positions. Each limit leaves signals behind: weak signals sitting between grid points lose up to 1.4 dB to scalloping and timing offset, candidates beyond the 140th are never tried, and OSD stops at 40 positions. The time before the next slot's early pass (about 10 s on a phone) can pay for lifting these limits on the residual.

## Method

- Part 1: `rr73-bench run --audio-s 11.8` and `--audio-s 13.5` decode only the first seconds of every slot. Two ways to treat the rest are measured: absent (the spectrogram stops where the audio stops, so cut symbols are erasures) and zero-filled. The early decodes are compared with the full-slot decodes of the same preset: the share of full-slot decodes already found, early decodes that the full slot does not have, false decodes on 5000 noise slots, and time.
- Part 2: a staged decoder. Stage 1 is the shipped preset at slot end. Each later stage starts from the residual left by all earlier decodes and returns only new decodes. Candidate stages, each measured alone on top of stage 1: more passes; more candidates and a lower sync threshold; a finer search grid (4 frames per symbol, 4 bins per tone spacing); deeper OSD with the same acceptance checks. Stages that add true decodes without false ones are then chained, cheapest first.
- API: `decode_partial` for part 1, and a `DecodeSession` that runs stage by stage and step by step in bounded work units (a spectrogram and search, a batch of candidates, a batch of subtractions), so a caller can stop between units and a new slot always wins. `rr73-wasm` exposes both. The web app is not changed.

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

Pending.
