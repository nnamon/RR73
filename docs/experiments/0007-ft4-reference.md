# Experiment 0007: FT4 against the reference decoder

Status: measured 2026-10-15 on the tree of commit d5677a0 (0.21.8). Corrected 2026-10-16: the reference counts no a priori decodes. The first version counted 29 `jt9` CQ decodes marked `a1` in its headline figures. No decoder code changed.

## Question

How far is RR73's FT4 decoder behind WSJT-X's on the same signals, in SNR50, recall, false decodes and time per slot? Where in the SNR range does it lose decodes the reference keeps, and how does that compare with FT8?

## Method

- Reference: `jt9` from WSJT-X 2.7.0-rc3 in the `wsjtx` container, `-5 -d 3` for FT4 and `-8 -d 3` for FT8, with `-c K1ABC -x W9XYZ -Q 1`: own callsign, the other station's callsign and QSO progress, as `jt9 --help` lists them. Depth 3 is the deepest `jt9` accepts (1 to 3). Neither callsign occurs in the 3400 messages of the two sets, so no a priori hypothesis built on them can match a signal. Only decode lines without an `aN` tag count, and this run printed none on the 5220 slots.
- With no callsign or QSO options, `jt9` tries CQ hypotheses: it marks 14 of its 1075 `ft4-sweep` decodes and 15 of its 966 `snr-sweep` decodes `a1` (table below). All 29 are true CQ messages, and no other `aN` tag occurs. On those 29 slots, `-c K1ABC -x W9XYZ` alone, with `-Q 0` or with `-Q 5` gives the same 29 `a1` decodes; `-Q 1` to `-Q 4` give none. `jt9 --help` names 1 as the default QSO progress, but leaving `-Q` out keeps the `a1` decodes and `-Q 1` removes them. On `ft4-sweep` the decode lists at `-Q 1` and `-Q 2` are identical.
- The reference run's untagged decodes equal the default run's on every slot but one: FT4 AWGN slot `260101_003915_s0314`, where the default run printed an `a1` decode in place of the same CQ decoded without a priori. Dropping the `aN` lines from a default run would lose that decode. The reference holds every untagged decode of the default run and that one, so it is the fairer of the two.
- `tools/wsjtx/decode_list.py`, added with this note, starts one `jt9` process per slot, so no state carries over within a process. A reused working directory keeps `decoded.txt`, `jt9_wisdom.dat` and `timer.out` between slots; the reference runs give every slot a new directory (`--fresh`). With the default options, reused and new directories give byte-identical decode lists on all 3540 FT4 and 1680 FT8 slots.
- `rr73-bench import` scores each list against the truth with the bench's matching (text equal, 10 Hz, 0.5 s) and fits SNR50 the same way as for RR73. It scores `aN` lines like any other decode. `jt9`'s DT lies within 0.11 s and its frequency within 5 Hz of the truth on every matched decode, so no offset applies. Its SNR estimate has a median error of 0 dB on both sets, so the synthetic SNR scale and WSJT-X's agree.
- RR73: `subtract-3-osd2` alone (what the early pass and slots RR73 transmitted in get) and with the two `--then` stages of `DEEP` (decision 0007, the `bench` job's deep step in `.github/workflows/ci.yml`), which FT8 and FT4 slots run in the app.
- FT4 signals: `ft4-sweep` written to disk with `--per-step 40 --crowded-count 20 --noise-count 2000`: one message per slot at -24 to -6 dB in 1 dB steps, 760 slots in AWGN and 760 with Watterson fading at 0.5 Hz spread and 2 ms delay; 20 crowded slots of 10 signals at -16 to 0 dB, base tones at least 100 Hz apart; 2000 FT4 noise slots. FT8 signals: `snr-sweep` with `--per-step 40`, one message per slot at -28 to -8 dB, 840 slots each in AWGN and with fading at 0.5 Hz and 1 ms. All 1680 `snr-sweep` WAV files equal those in the shared corpus, which 0.4.3 wrote.
- Each gap carries a 95 % interval from 300 paired bootstrap resamples of the signals, refitting both curves with the bench's logistic fit (reimplemented for this note in Python; it reproduces the bench's SNR50 values to 0.01 dB).
- Settings: the preset with one or more `--set` overrides on the FT4 AWGN, fading and noise subsets, to see which part of RR73 moves SNR50.
- Time per slot: 424 FT4 slots (every 5th AWGN and fading slot, the 20 crowded slots, every 20th noise slot) and 84 FT8 slots (every 20th of each `snr-sweep` subset), one thread for RR73 (`--threads 1`) and one `jt9` process at a time, 3 rounds alternating the decoders, each slot's fastest round. `jt9`'s time is its own `timer.out` total, which leaves out process start. `jt9` ran with its default options in these rounds. In 3 further rounds that alternated the default and the reference options on the same slots, the reference options changed each slot's time by a median factor of 1.00 for FT4 and 1.04 for FT8, and gave the same decodes as the reference run. Release build in the `rust` container on the Apple M4 (10 CPUs). Other jobs loaded the host throughout (1-minute load 17 to 30 during the timing rounds), so times are upper bounds. The load does not change what either decoder decodes.

```sh
docker compose run --rm rust rr73-bench synth --set ft4-sweep --per-step 40 --crowded-count 20 --noise-count 2000
docker compose run --rm wsjtx python3 tools/wsjtx/decode_list.py --fresh \
  --my-call K1ABC --his-call W9XYZ --qso-progress 1 \
  --out results/jt9-ft4.txt --times results/jt9-ft4.times corpus/synthetic/ft4-sweep
docker compose run --rm rust rr73-bench import --decodes results/jt9-ft4.txt --label jt9-ft4-d3 \
  --out results/jt9-ft4.json corpus/synthetic/ft4-sweep
docker compose run --rm rust rr73-bench run --preset subtract-3-osd2 \
  --then "<stage 2 of DEEP>" --then "<stage 3 of DEEP>" --out results/rr73-ft4.json corpus/synthetic/ft4-sweep
docker compose run --rm rust rr73-bench compare results/jt9-ft4.json results/rr73-ft4.json
```

## Results

### A priori decodes in `jt9`'s default run

Matched decodes of `jt9 -d 3` with no callsign or QSO options, by tag. Every decode of this run and of the reference run matched the truth.

| Subset | No tag | `a1` | `a1` decodes per SNR step |
| --- | --- | --- | --- |
| `ft4-sweep/awgn` | 484 | 5 | 2 at -18 dB, 3 at -17 dB |
| `ft4-sweep/fading` | 377 | 9 | 1 each at -22, -17, -13 and -9 dB, 3 at -16 dB, 2 at -15 dB |
| `ft4-sweep/crowded` | 200 | 0 | none |
| `ft4-sweep/noise` | 0 | 0 | none |
| `snr-sweep/awgn` | 520 | 4 | 2 at -22 dB, 1 at -21 dB, 1 at -20 dB |
| `snr-sweep/fading` | 431 | 11 | 1 at -22 dB, 3 at -19 dB, 3 at -18 dB, 1 at -17 dB, 2 at -16 dB, 1 at -15 dB |

### FT4

| `ft4-sweep` subset | `jt9 -5 -d 3`, no a priori | RR73 preset | RR73 through stage 3 |
| --- | --- | --- | --- |
| `awgn` (760), matched, recall | 485, 0.638 | 350, 0.461 | 397, 0.522 |
| `awgn`, SNR50, 10 to 90 % width | -17.63 dB, 1.84 dB | -14.25 dB, 1.96 dB | -15.42 dB, 1.43 dB |
| `fading` (760), matched, recall | 377, 0.496 | 215, 0.283 | 268, 0.353 |
| `fading`, SNR50, 10 to 90 % width | -14.92 dB, 6.81 dB | -10.83 dB, 6.63 dB | -12.19 dB, 6.37 dB |
| `crowded` (200 signals), matched | 200 | 183 | 198 |
| False decodes, all subsets and 2000 noise slots | 0 | 0 | 0 |
| Time per slot, 424 slots, one thread, p50, p95 | 27, 172 ms | 15, 45 ms | 338, 494 ms |
| Time per slot, the 20 crowded slots, p50 | 246 ms | 49 ms | 393 ms |

Gap at SNR50, `jt9` against RR73, with 95 % intervals: in AWGN 3.38 dB (3.05 to 3.68) for the preset and 2.20 dB (1.91 to 2.52) through stage 3; with fading 4.09 dB (3.53 to 4.54) and 2.74 dB (2.28 to 3.19). With its default options `jt9` reaches -17.73 dB in AWGN and -15.15 dB with fading, and the gaps through stage 3 would read 2.30 dB and 2.96 dB. RR73 has no a priori hypothesis without a QSO context.

`compare` of `jt9` against RR73 through stage 3: RR73 decodes no signal that `jt9` misses, and misses 199 that `jt9` decodes. Decodes per SNR step, out of 40. In AWGN all three decode none below -19 dB and all 40 above -13 dB:

| AWGN step | -19 | -18 | -17 | -16 | -15 | -14 | -13 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `jt9` | 1 | 14 | 30 | 40 | 40 | 40 | 40 |
| RR73 preset | 0 | 0 | 0 | 1 | 7 | 24 | 38 |
| RR73 through stage 3 | 0 | 0 | 0 | 7 | 30 | 40 | 40 |

| Fading step | -20 | -18 | -17 | -16 | -15 | -14 | -13 | -12 | -11 | -10 | -9 | -8 | -7 | -6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `jt9` | 3 | 7 | 9 | 12 | 21 | 28 | 28 | 33 | 38 | 39 | 38 | 40 | 40 | 40 |
| RR73 preset | 0 | 0 | 0 | 0 | 1 | 8 | 8 | 11 | 20 | 32 | 27 | 35 | 36 | 37 |
| RR73 through stage 3 | 0 | 0 | 2 | 1 | 4 | 13 | 16 | 20 | 27 | 36 | 33 | 39 | 39 | 38 |

`jt9` also decodes 1 of 40 at -19 dB with fading; RR73 none below -17 dB.

- In AWGN the curves have the same shape, and RR73's through stage 3 sits 2.2 dB above `jt9`'s. The preset misses signals from -13 dB down and the stages from -15 dB down; `jt9` decodes all 40 down to -16 dB.
- With fading RR73 loses decodes at every step up to -6 dB: through stage 3 it misses 2, 1 and 1 of 40 at -6, -7 and -8 dB, and 7 at -9 dB, where `jt9` misses none from -8 dB and 2 at -9 dB.
- Every message type loses. In AWGN RR73 through stage 3 decodes 76 to 89 % of the messages `jt9` decodes per type; CQ is lowest (88 against 116).
- No DT or frequency range accounts for the loss. From -18 to -14 dB in AWGN, RR73 through stage 3 decodes 31 to 66 % of `jt9`'s decodes in each fifth of the DT range (-0.5 to 0.5 s) and of the band (300 to 2700 Hz), with 27 to 41 `jt9` decodes per fifth.

### FT8, for comparison

| `snr-sweep` subset | `jt9 -8 -d 3`, no a priori | RR73 preset | RR73 through stage 3 |
| --- | --- | --- | --- |
| `awgn` (840), matched, recall, SNR50 | 520, 0.619, -20.50 dB | 461, 0.549, -19.02 dB | 495, 0.589, -19.88 dB |
| `fading` (840), matched, recall, SNR50 | 431, 0.513, -18.28 dB | 327, 0.389, -15.67 dB | 390, 0.464, -17.25 dB |
| False decodes | 0 | 0 | 0 |
| Time per slot, 84 slots, one thread, p50, p95 | 1480, 2516 ms | 24, 44 ms | 445, 570 ms |

Gap at SNR50, with 95 % intervals: in AWGN 1.48 dB (1.20 to 1.76) for the preset and 0.62 dB (0.38 to 0.86) through stage 3; with fading 2.60 dB (2.16 to 3.06) and 1.03 dB (0.74 to 1.33). With its default options and 15 `a1` decodes `jt9` reaches -20.60 dB and -18.55 dB, and the gaps through stage 3 would read 0.72 dB and 1.30 dB. RR73 through stage 3 decodes 6 signals `jt9` misses (4 of them at DT 0.46 to 0.50 s, the edge `docs/design/sequencer.md` notes for `jt9`) and misses 72. In AWGN `jt9` decodes 1, 12 and 30 of 40 at -22, -21 and -20 dB, RR73 through stage 3 0, 4 and 17. From -18 dB up RR73 through stage 3 decodes every signal and `jt9` all but 3 (2 at -15 dB, 1 at -11 dB).

### Which RR73 settings move FT4 SNR50

The preset with overrides, on the FT4 AWGN and fading subsets and the 2000 noise slots:

| Overrides on `subtract-3-osd2` | AWGN SNR50 | Fading SNR50 | False decodes |
| --- | --- | --- | --- |
| none (the preset) | -14.25 dB | -10.83 dB | 0 |
| `ldpc.max_iterations=100` | -14.30 dB | -10.86 dB | 0 |
| `demod.llr_variance=12`, `=48` | -14.20 dB, -14.20 dB | -10.83 dB, -10.81 dB | 0 |
| `validate.osd_ft4_min_snr_db=null` | -14.25 dB | -10.83 dB | 0 |
| `ldpc.osd_window=91` | -14.37 dB | -10.99 dB | 0 |
| `search.min_score_db=0 search.max_candidates=1000` | -14.27 dB | -10.88 dB | 0 |
| grid 4 x 4, 2-symbol window (stage 2's) | -15.15 dB | -11.82 dB | 2 |
| grid 8 x 4, 2-symbol window (stage 3's) | -15.22 dB | -12.03 dB | 1 |
| grid 8 x 8, 2-symbol window | -15.40 dB | -12.26 dB | 1 |
| grid 8 x 4, 1-symbol window | -13.40 dB | -9.82 dB | 0 |
| grid 4 x 2, 1-symbol window | -13.00 dB | -9.27 dB | 2 |
| grid 4 x 4, 3-symbol window | -13.95 dB | -10.45 dB | 0 |
| grid 8 x 8, OSD over 91 bits, 100 iterations, 400 candidates from 2 dB, no FT4 OSD floor | -15.58 dB | -12.49 dB | 25 |
| RR73 through stage 3, for reference | -15.42 dB | -12.19 dB | 0 |

A grid is frames per symbol by bins per tone spacing (`spectrogram.time_osr`, `spectrogram.freq_osr`), the window `spectrogram.window_symbols`. The false decodes in the grid rows are OSD codewords at 28 to 30 hard errors on the slots' true signals, or the true message 10 to 11 Hz from its frequency; the last row's 25 are OSD codewords at 22 to 30 hard errors, 11 of them in the noise slots, and 23 report -20.8 to -23.0 dB, below the FT4 OSD floor that row removes.

## What it means

- FT4 is 2.2 dB behind `jt9` in AWGN and 2.7 dB with fading through RR73's three stages, with `jt9`'s a priori decodes left out. The preset alone, which early-pass and transmit slots use, is 3.4 and 4.1 dB behind. FT8 through the same stages is 0.6 and 1.0 dB behind. FT4 therefore carries a deficit of 1.6 to 1.7 dB that FT8 does not, with the same search, demodulator, LDPC and OSD code; the FT4 and FT8 intervals do not overlap.
- In operating terms: a station `jt9` decodes in every slot at -16 dB in AWGN, RR73 decodes in 7 of 40 slots through stage 3 and in 1 of 40 with the preset alone.
- No decoder setting closes the gap. Belief propagation iterations, the LLR scale, the FT4 OSD floor, OSD over all 91 bits and a search of 1000 candidates from a 0 dB threshold each move SNR50 by 0.16 dB or less. Only the spectrogram grid moves it, by up to 1.15 dB in AWGN and 1.43 dB with fading, and the later stages already take that gain. All settings at once reach -15.58 dB with 25 false decodes.
- At 8 frames per symbol and 8 bins per tone spacing the grid comes within 3 ms and 1.3 Hz of any signal, and 2.2 dB remain. The loss therefore sits after the candidate is placed, in how each symbol's tone energies become bit LLRs: RR73 has one demodulator for FT8 and FT4, a per-symbol max-log metric on dB magnitudes from a 2-symbol Hann window. At the same grid a 1-symbol or 3-symbol window is worse by 1.2 to 2.2 dB, so the metric's input alone moves SNR50 by that much.
- RR73's WSPR decoder measured a loss of the same size (experiment 0004): single-symbol soft bits were 2.6 dB worse at SNR50 than 7-symbol coherent block detection with start, frequency and drift refined from phase. FT4 is continuous-phase 4-GFSK with a modulation index of 1 (`crates/rr73-ft8/src/synth.rs`), so the method applies to it. Unverified for FT4: no multi-symbol demodulator was measured here.
- `jt9` decodes FT4 at a p50 of 27 ms per slot on one thread, against 338 ms for RR73's three stages, and its time grows with the signals in the slot (12 ms on noise, 246 ms with 10 signals), where RR73's later stages add 320 to 350 ms (p50) to every slot, noise slots included. In FT8 the balance is the other way: `jt9 -8 -d 3` takes 1480 ms (p50), 3.3 times RR73's three stages. A better FT4 demodulator in the preset could replace much of the finer-grid search that stages 2 and 3 pay for.
- FT4 sensitivity work looks worth doing: 2.2 to 2.7 dB is 1.7 to 1.9 times the transmitter power, with fading RR73 still misses signals at -6 dB, and no setting recovers it. A demodulator change would apply to FT8 as well, where 0.6 to 1.0 dB remain.

## Open risks

- Synthetic signals only: AWGN and one Watterson channel, DT within ±0.5 s, no drift, no FT4 recordings in the corpus. On the air the gap may differ.
- The reference leaves out all of `jt9`'s a priori decoding: the CQ decodes it adds with its default options, and what it can decode from the callsigns of a QSO under way (`-c`, `-x`). RR73's counterpart (decision 0009, `ap-sweep`) was not compared with it.
- That no a priori hypothesis matched rests on `jt9`'s output: it printed no `aN` tag on the 5220 slots. Whether it still tries hypotheses with the absent callsigns is not known.
- The cause named above rests on what the settings did not change. No multi-symbol or coherent FT4 demodulator was built to confirm it.
- Times come from a loaded host and are upper bounds for both decoders. `jt9`'s timer leaves out its process start; RR73's leaves out reading the file. In the 3 later rounds, at a 1-minute load of 11 to 33, `jt9`'s default p50 was 16 ms for FT4 and 781 ms for FT8, 41 and 47 % below the tables. RR73 was not timed again, so the ratios between the decoders come from the first rounds only.
