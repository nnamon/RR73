# Experiment 0012: overlapping signals, the preset's threshold and hashed callsigns

Status: accepted 2026-10-21 for the retries of overlapping candidates and weak FT8 candidates from 4 dB, both on in the preset; rejected for FT4's sync gate and weak FT4 candidates. Hypothesis recorded 2026-10-16 on 0.24.2, after the baseline miss breakdown and before the measurements below; results measured 2026-10-16 to 2026-10-21 on main's decoder, 0.24.2's.

## Question

After 0.24.2 the three stages miss 235 of the 5508 reference decodes on the 403 recorded slots with at least one, with no false decode on any noise or stress set (experiment 0011). Which of the remaining misses can the decoder recover without false decodes and within its time budget, in this order:

1. Overlapping signals that fail together. 141 failed candidates through three stages have another reference decode within 50 Hz. With the neighbours the run never decodes subtracted as well, 38 of them decode at their position (experiment 0011). Measured again on 0.24.2: 35 failures within 50 Hz have a missed neighbour within 50 Hz, 18 of them a stronger one; the oracle recovers 25 of the 35. Typical case: `YO3GK JA2KGH PM84` (+0 dB) and `DF1BN JH6XOD PM52` (-9 dB) on 1406 Hz, 0.4 s apart, and the run decodes neither.
2. The preset's sync threshold at 4 dB, which brings 50 SARTS decodes into stage 1 but takes 1.8 times the LDPC attempts on recordings and 12 times on noise (experiment 0011).
3. Hashed callsigns as the operator sees them: the bench clears learnt callsigns before every slot, and the app carries them from slot to slot.
4. FT4's sync gate for the normalised set: 9 of 16 sync symbols on their sent tone, 2.25 times chance against FT8's 9 of 21 at 3.5 times. FT4's preset costs about 20 % more time with the normalised set.
5. If time allows, the second normalised set in stage 3 only (SARTS 4010 through three stages with stage 1 unchanged, experiment 0011).

## Why the changes should help

### Overlapping signals

The block demodulator reads each candidate on a complex baseband of its own band, refined from its sync symbols. A second signal within 50 Hz puts its tones in that band. When the neighbour decodes, the next pass subtracts it and the candidate gets a clean try. When neither decodes, each corrupts the other's soft bits in every pass and stage.

A failed candidate still says much about its signal. With 12 or more of its 21 sync symbols on their sent tone it is a signal (chance gives 2.6), and the hard decisions of its block soft bits name most of its data tones: a candidate that fails with 30 to 40 hard errors in 174 code bits has its tones right in about 80 % of its 58 data symbols. Removing that tone sequence, with an amplitude estimated as the slot subtraction estimates it, takes most of the neighbour's energy out of the candidate's band. The symbols it gets wrong put back about as much interference as they leave.

Proposed: at the end of each pass, every failed candidate with an overlapping neighbour gets its block sets again with its neighbours removed from its baseband. The neighbours are the pass's failed candidates with strong sync, as tones from their hard decisions, and candidates decoded by an earlier retry, as their message's tones. A retry that decodes queues again the neighbours already tried. The retries work on the candidate's baseband at 30 samples per symbol, so they cost no slot transform and no slot subtraction. A decode found there passes the same checks as any other and the next pass subtracts it from the audio.

The other approach named in experiment 0011, a pass that re-tries failed candidates next to each new decode, is mostly what the passes do already: each pass after the first searches the residual with the earlier decodes subtracted. Only the last pass of the last stage has no later pass. Experiment 0010 measured a fourth pass at +4 decodes.

### The preset's threshold

Stage 1 keeps 140 candidates from a 5 dB sync threshold. Most of the 4 to 5 dB candidates on noise fail the block demodulator's sync gate only narrowly: the gate is 5 of 21 sync symbols on their sent tone, and noise gives 2.6 on average. A stricter gate for the candidates below 5 dB, at 8 or 9 of 21, keeps the weak signals the lower threshold finds (a -20 dB signal has 12 of 21, experiment 0008) and drops most noise candidates before any LDPC attempt.

### Hashed callsigns

The app's decoder context keeps the callsigns it learns from slot to slot. A bench option that decodes each directory's slots in time order with one context measures what the operator sees. The references are `jt9` runs on each slot alone and show a callsign they could not resolve as `<...>`, so the matcher has to accept a decode that shows the callsign there.

### FT4's gate

For noise, each of FT4's 16 sync symbols has its sent tone strongest with probability 1/4: 9 or more of 16 occur in 0.75 % of noise candidates, 10 or more in 0.16 %, 11 or more in 0.03 %. FT8's 9 of 21 occurs in 0.05 %. A gate of 10 or 11 of 16 should cut FT4's attempts on noise to near FT8's rate and lose few FT4 decodes.

## Method

- Each change is a configuration option, off until measured: `pairs.*` for the retries, `demod.weak_score_db` with `demod.ft8_weak_min_sync` and `demod.ft4_weak_min_sync` for the threshold's extra candidates, `rr73-bench run --carry-callsigns` for the context, and the existing `demod.ft4_extra_min_sync` and `demod.ft4_min_sync` for FT4.
- A synthetic set, `overlap`: two random messages per slot, base tones 0 to 50 Hz apart and starts 0 to 1 s apart in FT8 (0 to 80 Hz and 0 to 0.5 s in FT4), the stronger at -16 to +4 dB in 4 dB steps (FT4 -12 to +8 dB) and the weaker 0 to 10 dB below it; FT8 in AWGN and with moderate fading, FT4 in AWGN.
- Measurements as in experiments 0008 to 0011: `rr73-bench run`, `compare` and `misses` in the `rust` container on the 60 public files, the 350 readable SARTS slots, `snr-sweep`, `crowded`, `late-start` (20 per step), `ap-sweep` (40 per step, 5000 noise slots), `ft4-sweep` (40 per step, 20 crowded, 10000 noise slots), `band-edge`, `overlap`, 5000 FT8 noise slots, and stress runs with the sync threshold at 0 dB (stage 2 and stage 3 each after the preset on the 5000 FT8 noise slots with `crowded`, every stage on 5000 FT4 noise slots). Each for the preset and the three stages (`DEEP`).
- Time per slot natively, single-threaded, each slot's fastest of 3 runs with the configurations alternating, with the host's load average; and in a WebKit worker with `tools/wasm-cost`, scaled to an A13 with experiment 0009's factor of 2.2.

## Expected effect

| Measure | 0.24.2 | Expected |
| --- | --- | --- |
| Misses with a missed neighbour within 50 Hz, three stages | 35 | 20 to 25 |
| SARTS and public matched, preset | 3896, 1253 | +20 to +40 |
| SARTS and public matched, three stages | 4013, 1260 | +10 to +25 |
| `overlap` matched | measured first | more, with the largest gain where the pair is close in level |
| Preset at 4 dB with the stricter gate: SARTS, preset | 3896 | +30 to +50, at under 1.3 times the LDPC attempts on recordings and under 2 times on noise |
| False decodes, noise sets and stress | 0 | 0 |
| Preset time per slot | WebKit p95 87 ms (0011) | within 10 % |
| Three stages | within 2 s on an A13 | within 2 s |

## Acceptance

As in experiments 0008 to 0011: a change is kept only if it adds true decodes or lowers SNR50, adds no false decode on the noise sets and in the stress runs, keeps the preset near its current cost and the later stages within decision 0007's 2 s on a phone. Negative results are recorded here.

## Results

Measured 2026-10-16 to 2026-10-21 with a release build of `rr73-bench` in the `rust` container on the Apple M4 (10 CPUs), main's decoder being 0.24.2's throughout (0.24.20 changed no decoder code). "Main" is `origin/main`'s binary, "off" the branch's binary with every option off, "retries" `pairs.enabled=true`, "weak" `search.ft8_weak_score_db=4 demod.ft8_weak_min_sync=8` with `demod.ft8_weak_grid_sync` at 6 or 8 as stated, and "taken" the retries with weak at grid 8, the configuration `subtract-3-osd2` now has. "Three stages" is the app's plan (`DEEP`), each stage with the same options. Accuracy runs used 10 threads with other work on the host; decodes do not depend on load.

The bench's matcher now accepts a decode that shows a callsign where the `jt9` reference shows `<...>`. With it main's own decodes count 4 more on SARTS and 2 more on `public/ft8_lib` (preset 3900 and 1255, three stages 4017 and 1262); the gains below are against those counts.

### Recordings

| Matched of 4210 SARTS and 1298 public | Main | Retries | Weak, grid 6 | Both, grid 6 | Taken |
| --- | --- | --- | --- | --- | --- |
| Preset | 3900, 1255 | 3957, 1257 | 3948, 1256 | 4005, 1258 | 4001, 1259 |
| Three stages | 4017, 1262 | 4054, 1264 | 4028, 1263 | 4062, 1264 | 4061, 1265 |
| Unmatched, preset | 127, 182 | 175, 208 | 143, 188 | 193, 218 | 190, 215 |
| Unmatched, three stages | 202, 237 | 245, 258 | 209, 239 | 252, 264 | 250, 262 |
| LDPC attempts per slot, preset | 140.6, 353.2 | 145.5, 366.9 | 175.6, 419.9 | 182.9, 441.4 | 168.9, 418.0 |
| Retries per slot, preset | 0 | 4.7, 11.1 | 0 | 6.0, 15.7 | 5.4, 14.2 |
| Retries per slot, three stages | 0 | 20.1, 50.6 | 0 | 21.4, 55.4 | 20.7, 53.9 |

The two changes add more together than apart: at grid 6, 108 more matches in the preset against 59 and 49 alone. A weak candidate that fails gives the retries a neighbour to remove, and a retry that decodes one gives the next pass a cleaner residual.

Through three stages the taken configuration misses 182 of the 5508 reference decodes (235 on main, 229 with the matcher's new rule): failed 179 to 146, search 20 to 11, hashed 22 to 12, 6 of them through the matcher's rule. Of the misses within 50 Hz of another reference decode, 8 have a missed neighbour (35 on main): 4 with a stronger one missed (18) and 4 with only weaker ones (17).

The new unmatched decodes, sorted as in experiment 0011: in the preset, of 98 that main does not have, 54 repeat a text decoded in another slot and 31 carry only callsigns that the directory's references or matched decodes hold. The other 13 are standard messages between plausible callsigns, such as `D2ACE JA3VLD PM74` (3 of them from D2ACE, active in the same hour), `CQ SCI PP5GP GG52`, `EA8BIA EB2FBI IN93` and `CU2DX RA1WZ KO47`; 5 are OSD codewords with 25 to 30 hard errors. Through three stages: 77 new, 44 repeat, 23 known callsigns, 10 others.

### The weak candidates' grid gate

`demod.ft8_weak_grid_sync` turns a weak candidate away on the search grid before it gets a baseband. With the retries and weak candidates at 4 dB, preset:

| Grid gate (of 21) | 0 | 4 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- |
| SARTS, public matched | 4005, 1258 | 4005, 1258 | 4005, 1258 | 4002, 1259 | 4001, 1259 | 3997, 1259 |
| LDPC attempts per SARTS slot | 191.4 | 189.1 | 182.9 | 176.3 | 168.9 | 161.2 |
| LDPC attempts per noise slot (main 3.7) | 9.3 | 9.1 | 7.9 | 6.8 | 5.5 | 4.5 |

Taken at 8: the attempts on noise at 1.5 times main's, inside the expected 2 times, for 4 SARTS decodes fewer than at 6. On `late-start` 8 also loses 5 FT8 decodes against 6 (4947 to 4942 in the preset).

### Synthetic sets

| Set | Main, preset | Taken, preset | Main, three stages | Taken, three stages |
| --- | --- | --- | --- | --- |
| `snr-sweep` FT8 AWGN, SNR50 | -21.3 dB (551) | -21.4 dB (555) | -21.6 dB (565) | -21.6 dB (565) |
| `snr-sweep` FT8 fading, SNR50 | -18.3 dB (432) | -18.6 dB (444) | -18.9 dB (455) | -19.0 dB (458) |
| `crowded` n20-overlap | 396 | 396 | 397 | 397 |
| `ft4-sweep` AWGN, fading, SNR50 | -17.1, -14.3 dB | the same | -17.6, -14.9 dB | the same |
| `ft4-sweep` matched, of 1540 | 1014 | 1014 | 1060 | 1060 |
| `late-start` FT8, FT4 | 4885, 3843 | 4942, 3843 | 5077, 4064 | 5083, 4064 |
| `ap-sweep` callers, SNR50 | 144, -21.1 dB | 151, -21.3 dB | 157, -21.4 dB | 157, -21.4 dB |
| `ap-sweep` qso, SNR50 | 188, -22.2 dB | 209, -22.7 dB | 228, -23.2 dB | 229, -23.2 dB |
| `band-edge` | 573 | 581 | 577 | 584 |
| `overlap` FT8, SNR50 (off) | 456, -20.9 dB | 456, -20.9 dB | 457, -21.1 dB | 457, -21.1 dB |
| `overlap` FT8 fading, SNR50 (off) | 397, -16.9 dB | 405, -17.1 dB | 408, -17.5 dB | 411, -17.5 dB |
| `overlap` FT4, SNR50 (off) | 449, -17.1 dB | 449, -17.1 dB | 452, -17.4 dB | 452, -17.4 dB |

`overlap` has no main column: main's bench has no such set, and "off" is the branch's binary with the options off. The FT4 rows are the retries alone, as FT4 keeps 5 dB: the retries changed no FT4 decode on any set, at 0.02 retries per FT4 noise slot in the preset and 0.71 through three stages.

The retries gain little on `overlap`, 8 of its 1440 signals in the preset, against 57 on SARTS. Most pairs in the set decode without them (93 to 95 % in steady conditions); the recordings' failures are pairs of stations that both fail in every pass, mostly faded.

### False decodes

None added. 5000 FT8 noise slots, the 10000 FT4 noise slots of `ft4-sweep`, the 5000 of `ap-sweep`, the 1000 of `band-edge` and the stress runs (each later stage at a 0 dB threshold after the preset on 5000 FT8 noise slots with `crowded`, every stage at 0 dB on 5000 FT4 noise slots): 0 false decodes in every configuration run, preset and three stages. The 3 false decodes of `late-start` through three stages (27 to 29 hard errors each) are main's: main has 4, the taken configuration the same 3 of them. The 1 on `overlap` FT4 through three stages, `U51TRX/P 8W0XSC R AM36`, comes with the options off as well.

### Hashed callsigns as the operator sees them

`rr73-bench run --carry-callsigns` decodes each directory's slots in time order with one decoder context, as the app's worker does. With the retries and weak candidates at grid 6, decodes that show `<...>` fall from 218 to 51 in the preset and from 225 to 53 through three stages, and matched counts stay the same. The bench's default stays one context per slot, so the gate does not depend on the order of the files.

### FT4's sync gate

On `ft4-sweep` (760 AWGN, 760 fading, 20 crowded and 10000 noise slots) and `late-start`, against main:

| Option | Matched, preset | Matched, three stages | LDPC attempts per noise slot, preset, three stages |
| --- | --- | --- | --- |
| Main (`ft4_min_sync` 7, `ft4_extra_min_sync` 9) | 1014 | 1060 | 44.2, 628.7 |
| `demod.ft4_extra_min_sync=10` | 1013 | 1060 | 40.8, 581.7 |
| `demod.ft4_extra_min_sync=11` | 1013 | 1060 | 39.2, 560.3 |
| `demod.ft4_min_sync=8` | 1014 | 1059 | 29.0, 403.7 |
| `demod.ft4_min_sync=8`, `demod.ft4_extra_min_sync=10` | 1013 | 1059 | 25.5, 355.5 |

`demod.ft4_min_sync=8` also loses 1 FT4 `late-start` decode in the preset and 4 through three stages, and 1 `overlap` FT4 decode in the preset. Single-threaded on 154 FT4 slots, with the retries on, it takes the preset from 8.8 to 7.4 ms at the mean and the three stages from 73.4 to 58.4 ms. Rejected: each variant loses decodes and gains none, and FT4's three stages already end within 100 ms natively.

### Time

Native, single-threaded (`--threads 1`), each slot's fastest of 3 runs, main's binary and the branch's in turn, the 410 recorded slots, 1-minute load 4.1 to 12.7 for the preset and 1.1 to 3.4 for the three stages:

| ms: p50, p95, max, mean | Main | Taken |
| --- | --- | --- |
| Preset | 16.1, 79.0, 100.4, 31.2 | 17.6, 93.5, 139.9, 34.9 |
| Three stages: stage 1 ends | 15.7, 80.0, 99.5, 31.0 | 18.0, 91.7, 115.0, 36.1 |
| Stage 2 ends | 32.9, 131.4, 213.9, 55.9 | 37.2, 149.2, 243.1, 63.7 |
| Stage 3 ends | 96.5, 329.2, 528.1, 139.5 | 101.9, 343.5, 493.8, 149.7 |

The preset's cost by option, the branch's binary, same method, load 1.0 to 2.2: off 15.7, 79.0, 97.7, 30.9; retries 16.3, 84.6, 108.5, 32.1; weak 17.2, 82.9, 100.9, 33.1; both 17.6, 90.9, 110.0, 34.6.

WebKit 26.6 (Playwright, `tools/wasm-cost/ab.mjs`), a dedicated module worker, each slot's fastest of 3 runs, stepped as the app steps the later stages, one release build of the branch with the options off and on in turn for every slot; 103 of the recorded slots (every fourth) and 154 FT4 slots:

| ms: p50, p95, max, mean | FT8, off | FT8, taken | FT4, off | FT4, taken |
| --- | --- | --- | --- | --- |
| Stage 1 ends | 18, 85, 101, 33.0 | 20, 104, 119, 37.5 | 9, 21, 26, 10.6 | 9, 21, 27, 10.5 |
| Stage 2 ends | 36, 174, 225, 62.9 | 41, 194, 252, 70.4 | 31, 44, 62, 31.9 | 31, 44, 61, 32.0 |
| Three stages end | 112, 360, 584, 161.6 | 118, 389, 565, 165.9 | 90, 104, 118, 90.0 | 90, 104, 117, 90.3 |
| Decodes by stage | 1405, 38, 27 | 1458, 31, 17 | 255, 1, 0 | 255, 1, 0 |

In WebKit the preset costs 14 % more at the mean and 22 % more at the 95th percentile; the three stages 3 % and 8 %. With experiment 0009's factor of 2.2 for an A13, the three stages' 95th percentile is 860 ms and the slowest slot 1240 ms, inside the 2 s budget. Not tested on a device.

## Against the expectations

| Measure | Expected | Measured |
| --- | --- | --- |
| Misses with a missed neighbour within 50 Hz, three stages | 20 to 25 | 8 (35 on main) |
| SARTS and public matched, preset | +20 to +40 | +101 and +4 |
| SARTS and public matched, three stages | +10 to +25 | +44 and +3 |
| `overlap` matched | more, most where the pair is close in level | +8 in the preset (FT8 fading), +3 through three stages, FT4 none |
| Preset at 4 dB with the stricter gate, SARTS | +30 to +50 at under 1.3 times the attempts on recordings, under 2 on noise | +48 with grid 6 at 1.25 and 2.1 times; with the retries and grid 8, +44 over the retries alone at 1.20 and 1.49 times |
| False decodes, noise sets and stress | 0 | 0 |
| Preset time per slot | within 10 % | +12 % natively and +14 % in WebKit at the mean; +18 % and +22 % at the 95th percentile |
| Three stages | within 2 s on an A13 | WebKit p95 389 ms, max 565 ms on the M4; about 860 and 1240 ms on an A13 |

## Decision and open risks

Accepted: the retries of failed candidates with their overlapping neighbours removed (`pairs.enabled`), and FT8 candidates from 4 dB with 8 of 21 sync symbols on their sent tone on the search grid and on the baseband, both on in `subtract-3-osd2` and so in every stage of the app's plan. Kept as bench options: `--carry-callsigns` and the matcher's rule for `<...>` references.

The preset costs 12 % more at the mean natively and 14 % in WebKit, past the 10 % expected, for 105 more matched decodes on the recordings (2.0 % of the references), and the three stages 7 % and 3 % more. Each option alone stays within 10 % (4 % and 7 %) for about half the gain; together they add more than the sum of their gains.

Rejected: FT4's sync gate at 8 of 16 for the block sets or 10 or 11 of 16 for the normalised set (each loses FT4 decodes and gains none; the first would save 16 to 20 % of FT4's time), weak FT4 candidates at 4 dB (`ft4-sweep`'s noise slots filled the list of 140 candidates, 1.7 times the attempts, for 0.3 dB of SNR50), and the weak grid gate at 6 (2.1 times the attempts on noise for 4 SARTS decodes).

Not attempted: the second normalised set in stage 3 (item 5).

Open risks:

- Not tested on a device: the time on an iPhone. The preset's 95th percentile rose 22 % in WebKit, more than its mean.
- The new unmatched decodes on the recordings cannot be checked against a reference: 13 of the preset's 98 have no support in other slots, 5 of them OSD codewords with 25 to 30 hard errors. The noise sets cannot show interference-shaped false decodes, and a retry works where interference is.
- A retry removes a neighbour's hard decisions, so it can decode a copy of that neighbour some tone spacings away. The decode goes to whichever of the two has the stronger sync; a copy whose sync is stronger than its source's would still be reported at the wrong place.
- The retries did nothing for FT4 on any set. No FT4 recordings.

## Next

- The 8 misses left with a missed neighbour within 50 Hz, and the 72 failures with no reference within 50 Hz, mostly below -20 dB.
- The second normalised set in stage 3 only, if the later stages have time to spare on a phone.
- FT4's sync gate at 8 of 16, should FT4's time on a phone ever need to fall.
