# Experiment 0013: recordings from six more sites

Status: accepted 2026-10-23 for OSD messages without `R` before a locator, the CQ hypothesis with belief propagation, and a 1-symbol normalised set in stage 3; rejected for `/R` callsigns from OSD, the set in every stage and the CQ hypothesis with OSD. Hypothesis recorded 2026-10-23 on 0.27.0, whose decoder is 0.24.2's with experiment 0012's retries and weak FT8 candidates, before any measurement on the new recordings.

## Question

Experiments 0008 to 0012 measured the decoder on one receiver in Singapore (350 readable FT8 slots on 40m, 20m, 17m, 15m and 10m) and the 60 public files. The corpus now holds 1648 more FT8 slots from 6 public KiwiSDR receivers in Europe, North America, South America and Australia, recorded 2026-10-21 and 2026-10-22 on 40m to 10m, each with a `jt9 2.7.0-rc3 -8 -d 3` reference list. The sites differ in antenna (loops, a doublet, a monopole), noise and crowding.

1. Does the decoder's recall against `jt9` on the Singapore slots (95.0 % in the preset and 96.5 % through three stages, experiment 0012) hold at each new site? Which sites fall short, and in which class of miss?
2. Which of the largest miss classes on the new data can the decoder recover without false decodes and within its time budget?
3. Does a second normalised set of soft bits in stage 3 only (experiment 0012, item 5) earn its time on the larger corpus?

## Expected differences between sites

- Europe and North America on 40 m and 20 m in the evening carry more signals per slot than the Singapore loop hears. More signals give more overlapping pairs (0012's retries), more candidates competing for the 140 places of stage 1 and more decodes for the passes to subtract.
- A larger antenna hears more weak signals near `jt9`'s floor, where most failed misses sit.
- Receivers differ in passband shape and audio level. Experiment 0011 measured one passband edge (3000 Hz, sharp); others may fall off lower or have a soft skirt.
- Impulsive noise (local QRN, power line noise) lifts the soft bits' variance estimate, a case the synthetic sets do not hold.
- KiwiSDR timing over NTP: each slot's correction is under 20 ms, so DT should not limit matching.

## Proposed changes

Decided after the per-site picture and the miss breakdown, each a configuration option off until measured:

1. The class that holds the most misses on the new data: `failed` (candidates there, none decoded) has dominated every breakdown since experiment 0010, and `search` misses near crowded parts of the band are the next candidate.
2. The second normalised set in stage 3 only: soft bits of 1 symbol scored normalised after the 3-symbol normalised set (`demod.ft8_extra_sets`), in stage 3 of `DEEP`, which runs in the app's spare time. Experiment 0011 measured +8 SARTS decodes for two sets in every stage, at 4.5 % more stage 1 time; in stage 3 alone it costs nothing in stage 1.

## Method

- The new slots enter the bench as recorded sets of their own: one per site and date directory (`kiwi/<site>/<date>`), summarised per site and over the 6 sites together.
- `rr73-bench run`, `compare` and `misses` in the `rust` container on the 1648 new slots, the 350 readable Singapore slots and the 60 public files, for the preset and the three stages (`DEEP`). Per site: matched, unmatched, misses by class and time per slot. Unmatched decodes are sorted as in experiment 0012: those that repeat a text decoded in another slot of the same site, those that carry only callsigns the site's references or matched decodes hold, and the rest.
- False decodes: 5000 FT8 noise slots, `ft4-sweep`'s 10000 FT4 noise slots, `ap-sweep`'s and `band-edge`'s noise slots, and the stress runs of experiment 0012 (later stages at a 0 dB threshold on noise and `crowded`). Weak signals: `snr-sweep`, `late-start`, `overlap`, `crowded`.
- Time per slot natively, single-threaded, configurations alternating slot by slot, each slot's fastest of 3 runs, with the host's load average; another worktree's speed work runs on the host at the same time.

## Expected effect

| Measure | 0.27.0 on Singapore | Expected on the new sites |
| --- | --- | --- |
| Recall, preset | 95.0 % | 90 to 96 % per site |
| Recall, three stages | 96.5 % | 92 to 97 % per site |
| Largest miss class, three stages | failed (146 of 182) | failed, then search on the crowded sites |
| Second normalised set in stage 3 | +6 in 0011 (4004 to 4010 through three stages with two sets from 9) | +0.2 to +0.5 % of the references through three stages, stage 3 time up 5 to 10 % |
| False decodes on noise sets and stress | 0 | 0 |

## Acceptance

As in experiments 0008 to 0012: a change is kept only if it adds true decodes or lowers SNR50, adds no false decode on the noise sets and in the stress runs, keeps the preset near its current cost and the three stages within decision 0007's 2 s on a phone. Negative results are recorded here.

## Results

Measured 2026-10-23 with a release build of `rr73-bench` in the `rust` container on the Apple M4 (10 CPUs), 0.27.0's decoder throughout. "Base" is 0.27.0; "final" is `subtract-3-osd2` from this experiment through three stages (`DEEP`). Accuracy runs used 4 to 6 threads with another worktree's speed work on the host (1-minute load 7 to 25); decodes do not depend on load. The six sites are labelled by region: Europe A and B, North America A and B, South America, Australia.

### The sites against `jt9`

| Site | Slots | References | Preset, base | Preset, final | Three stages, base | Three stages, final | Unmatched, three stages, base and final |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Europe A | 293 | 7433 | 6875 (92.5 %) | 6915 (93.0 %) | 7043 (94.8 %) | 7103 (95.6 %) | 440, 452 |
| Europe B | 327 | 6186 | 5603 (90.6 %) | 5649 (91.3 %) | 5806 (93.9 %) | 5859 (94.7 %) | 371, 378 |
| North America A | 456 | 15951 | 14674 (92.0 %) | 14743 (92.4 %) | 15021 (94.2 %) | 15126 (94.8 %) | 1131, 1164 |
| North America B | 281 | 8907 | 8426 (94.6 %) | 8451 (94.9 %) | 8559 (96.1 %) | 8604 (96.6 %) | 593, 609 |
| South America | 153 | 2319 | 1974 (85.1 %) | 2012 (86.8 %) | 2110 (91.0 %) | 2149 (92.7 %) | 144, 151 |
| Australia | 138 | 4044 | 3795 (93.8 %) | 3808 (94.2 %) | 3895 (96.3 %) | 3925 (97.1 %) | 362, 365 |
| 6 sites | 1648 | 44840 | 41347 (92.2 %) | 41578 (92.7 %) | 42434 (94.6 %) | 42766 (95.4 %) | 3041, 3119 |
| Singapore | 350 | 4210 | 4001 (95.0 %) | 4013 (95.3 %) | 4061 (96.5 %) | 4081 (96.9 %) | 250, 251 |
| `public/ft8_lib` | 60 | 1298 | 1259 | 1260 | 1265 | 1267 | 262, 271 |

The new sites hear 27 reference decodes per slot against Singapore's 12, and North America A 35. Recall falls short of Singapore's at every new site but Australia, by up to 5.5 points through three stages at the South American site.

Unmatched decodes, sorted as in experiment 0012, through three stages on the 6 sites: base 3041, of which 1920 repeat a text decoded in another slot of the site, 968 carry only callsigns the site's references or matched decodes hold, and 153 neither. Final 3119: 1986, 987 and 146.

### The 153 unexplained unmatched decodes

Sorted further on 0.27.0 before any change:

| Kind | Decodes | Likely false |
| --- | --- | --- |
| Every callsign unknown at every site, 22 of 24 OSD codewords with 27 to 30 hard errors, mostly in stage 3, half of them with a rover callsign or `R` before a locator | 24 | about 21 |
| At a matched reference's frequency and DT with another text, 11 of 16 OSD codewords | 16 | 8 to 11 |
| The unknown callsign heard at another site | 48 | few |
| One callsign unknown: QSO sequences such as a report and then RR73 between the same two stations, grids that fit the callsign's country | 65 | 10 to 15 |

About 40 to 50 of the 153 are false, 0.1 % of the matched decodes; the noise sets show none of them, as white noise does not make the interference these codewords come from. One form is not HF traffic: `R` before a locator, sent in VHF contests. It occurs in 0 of the 50348 references outside `jt9`'s own a priori decodes (all 11 such references are `jt9`'s `K1ABC` or noise-shaped messages) and in no matched decode, and about half of random type 1 and 2 payloads carry it. A rover callsign (`/R`) is as rare (30 references) and carries most of the rest, but real traffic sends it: a station answering a rover callsign, decoded here at 30 hard errors and matched by `jt9` in the next slot, was answering a false decode of its own software, and rejecting `/R` lost that decode and, through the missing subtraction, a matched decode 47 Hz away. No hard-error or OSD-distance limit separates the rest: stage 3 has 132 matched OSD decodes at distance 0.06 or more against about 15 likely false.

### Where the misses are

`rr73-bench misses` through three stages on the 6 sites, base: 2406 misses, failed 2043, search 131, hashed 125, other-text 91, dt-range 10, elsewhere 6. The failed class differs from Singapore's: 930 of the 2043 have a reference SNR of -12 dB or more, and 910 are CQ messages.

`jt9`'s marks explain part of it. Run again with `tools/wsjtx/decode_list.py`, which keeps them, `jt9` gives the same 44840 decodes, 921 of them a priori: 907 `a1` (the CQ hypothesis it tries without a QSO context) and 14 `a2`, all `K1ABC` messages from its built-in callsign, which are false. 209 of the 921 are also marked low-confidence. Base matches 340 of the 921; 584 of the misses are a priori references (failed 536, search 38).

At the reference position on the residual, the block demodulator's soft bits of 1 symbol scored normalised decode 70 failed misses that no other set decodes, and 3 symbols scored by power 31 (experiment 0011 rejected that set for its implausible decodes).

### Changes

| Matched, three stages | 6 sites | Singapore | Public | New unmatched (repeat, known, other) |
| --- | --- | --- | --- | --- |
| Base | 42434 | 4061 | 1265 | |
| `R` before a locator rejected from OSD | 42434 | 4061 | 1265 | 11 lost (all unexplained), 2 new (1 plausible) |
| and `/R` rejected | 42433 | 4061 | 1265 | 22 lost, 1 matched lost |
| R-locator rule, 1-symbol normalised set in stage 3 | 42587 | 4065 | 1266 | 53 (34, 17, 2) |
| R-locator rule, 1-symbol normalised set in every stage | 42593 | 4064 | 1267 | 119 (75, 34, 10) |
| R-locator rule, set in stage 3, `ap.cq` with belief propagation | 42766 | 4081 | 1267 | 54 (41, 12, 1) against the row above |
| the same with OSD for `ap.cq` | 42981 | 4093 | 1267 | 207 (158, 32, 17) against the same row |

The normalised set in every stage gains 6 more for 66 more unmatched decodes, 8 of them unexplained, such as a rover callsign sending R+28; in stage 3 alone it adds 2 unexplained. `ap.cq` with OSD adds 215 matched decodes and 16 unexplained ones such as CQ from rover callsigns; with belief propagation alone the unexplained count falls by 2.

Counters per slot on the 6 sites, three stages: LDPC attempts 1950 (base), 2249 with the stage 3 set, 2222 with `ap.cq` added (its decodes leave fewer failed candidates), OSD codewords 13.9, 15.3, 15.0, pair retries 60.9, 62.0, 61.2. `ap.cq`'s belief propagation runs are counted apart, as `ap_attempts`: 671.5 per slot, for 0.3 a priori decodes per slot.

### False decodes and synthetic sets

Base against final, three stages: 5000 FT8 noise slots, the 5000 noise slots each of `ap-sweep`, `ft4-sweep` and the three noise subsets of `band-edge` (20 per step, 20 crowded), and the stress runs (stages 2 and 3 at a 0 dB threshold after the preset on the 5000 FT8 noise slots and `crowded`; every stage at 0 dB on 5000 FT4 noise slots). Final adds no false decode: the stress runs change no decode, and the one false decode on the noise sets, a rover message on `band-edge` noise-soft, is base's. On the synthetic signal sets base has 7 false decodes and final 5; the 2 removed are `R` before a locator. All 7 are OSD codewords with 27 to 30 hard errors, 6 of them from stage 3.

| Set | Base | Final |
| --- | --- | --- |
| `snr-sweep` FT8 AWGN, SNR50 | 565, -21.63 dB | 565, -21.63 dB |
| `snr-sweep` FT8 fading, SNR50 | 458, -18.95 dB | 460, -19.00 dB |
| `crowded` | 1797 | 1797 |
| `late-start` FT8, 20 per step | gains 30 matched: 28 CQ messages cut by 2.5 to 6 s or spliced after 3.5 to 5 s, and 2 replies spliced after 3 and 3.5 s from the stage 3 set |
| `late-start` FT4 | gains 16 matched CQ messages cut by 0.75 to 2 s or spliced after 1.5 and 2 s; 1 of them replaces the same message matched 10 Hz away in base |
| `ap-sweep`, `ft4-sweep`, `band-edge` | unchanged |
| `overlap` FT8 fading | 209 | 210 |

`ap.cq` brings FT4 its first gain since experiment 0011, on `late-start` only; the preset's FT4 sets are unchanged.

### Time

Native, single-threaded (`--threads 1`), every fourth recorded slot (500 FT8 slots from the 7 receivers), base and final in turn for each slot, each slot's fastest of 3 rounds; 1-minute load 3.3 to 7.3 (5-minute 3.8 to 4.9) with the other worktree's runs on the host.

| ms: p50, p95, max, mean | Base | Final |
| --- | --- | --- |
| Stage 1 ends (the preset) | 65.5, 115.7, 133.4, 64.8 | 68.2, 122.0, 151.2, 67.9 |
| Stage 2 ends | 106.1, 203.0, 242.3, 107.7 | 112.5, 214.2, 264.6, 114.2 |
| Stage 3 ends | 208.3, 429.2, 569.1, 223.7 | 242.8, 516.2, 696.2, 265.6 |

The preset costs 5 % more at the mean, the three stages 19 % (stage 3 alone 31 %). Experiment 0012 measured WebKit at about 1.13 times native for the three stages' 95th percentile, and experiment 0009 an A13 at 2.2 times WebKit: on that scale the three stages end within about 1.3 s at the 95th percentile and 1.75 s for the slowest slot, against 1.07 s and 1.42 s for base. Not measured in WebKit; not tested on a device.

## Expected and measured

| Measure | Expected | Measured |
| --- | --- | --- |
| Recall, preset, per site | 90 to 96 % | 85.1 to 94.6 % (base); 86.8 to 94.9 % (final) |
| Recall, three stages, per site | 92 to 97 % | 91.0 to 96.3 % (base); 92.7 to 97.1 % (final) |
| Largest miss class, three stages | failed, then search on the crowded sites | failed (2043 of 2406), then search (131) and hashed (125); a quarter of the misses are `jt9` a priori decodes |
| Second normalised set in stage 3 | +0.2 to +0.5 % of the references, stage 3 time up 5 to 10 % | +0.34 % (153 on the 6 sites); with `ap.cq`, stage 3 alone 31 % more time |
| False decodes on noise sets and stress | 0 | 0 added |

## Decision

Accepted, in `subtract-3-osd2` and so in every stage: OSD messages without `R` before a locator (`validate.osd_messages=standard-hf`), and the CQ hypothesis with belief propagation on every candidate that fails (`ap.cq`). Accepted in stage 3 of `DEEP`: soft bits of 1 symbol scored normalised after the 3-symbol set (`demod.ft8_extra_sets=[[3,"normalised"],[1,"normalised"]]`). Together, on the 6 sites: preset 41347 to 41578, three stages 42434 to 42766 of 44840 references; Singapore 4061 to 4081 and the public files 1265 to 1267 through three stages; unexplained unmatched decodes 153 to 146; no false decode added on any noise set or stress run.

Rejected: `/R` callsigns from OSD (real traffic sends them; 1 true decode and 1 matched decode lost), the 1-symbol normalised set in every stage (6 more decodes for 8 more unexplained ones), and `ap.cq` with OSD (215 more decodes for 16 unexplained ones, such as CQ from rover callsigns).

Kept as tools: `tools/wsjtx/decode_list.py` to tag `jt9`'s a priori and low-confidence references.

## Open risks

- The three stages cost 19 % more natively at the mean; the slowest recorded slot reaches about 1.75 s on the A13 scale, inside the 2 s budget with less margin than before. Not measured in WebKit; not tested on a device.
- The CQ hypothesis runs on every failed candidate: 671 belief propagation runs per slot on the busy sites. The noise sets and stress runs give no false decode, but they cannot show interference-shaped codewords; the unexplained unmatched count on the recordings is the only check there, and it fell from 153 to 146.
- About 40 to 50 false decodes per 1648 busy slots remain, mostly OSD codewords with 27 to 30 hard errors in stage 3. A check of the locator against the callsign's country would remove most of them; the decoder has no prefix table.
- 921 of the references are `jt9` a priori decodes, 14 of them certainly false and 209 low-confidence. Matched counts against `jt9` include them.

## Next

- The 2074 misses left on the 6 sites: failed 1726 (411 of them `jt9` a priori decodes), search 127, hashed 119, other-text 87. 1315 failed misses are plain `jt9` decodes, 300 of them at -6 dB or more.
- Callsign prefix against locator as a plausibility check for OSD decodes in stage 3.
- WebKit timing of the three stages on the busiest slots.
