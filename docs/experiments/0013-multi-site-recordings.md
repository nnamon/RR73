# Experiment 0013: recordings from six more sites

Status: hypothesis recorded 2026-10-23 on 0.27.0, whose decoder is 0.24.2's with experiment 0012's retries and weak FT8 candidates, before any measurement on the new recordings.

## Question

Experiments 0008 to 0012 measured the decoder on one receiver in Singapore (350 readable slots on 40 m, 30 m and 20 m) and the 60 public files. The corpus now holds 1648 more FT8 slots from 6 public KiwiSDR receivers in Europe, North America, South America and Australia, recorded 2026-10-21 and 2026-10-22 on 40 m to 17 m, each with a `jt9 2.7.0-rc3 -8 -d 3` reference list. The sites differ in antenna (loops, a doublet, a monopole), noise and crowding.

1. Does the decoder's recall against `jt9` on the Singapore slots (95.0 % in the preset and 96.5 % through three stages, experiment 0012) hold at each new site? Which sites fall short, and in which class of miss?
2. Which of the largest miss classes on the new data can the decoder recover without false decodes and within its time budget?
3. Does a second normalised set of soft bits in stage 3 only (experiment 0012, item 5) earn its time on the larger corpus?

## Why the new sites may differ

- Europe and North America on 40 m and 20 m in the evening carry more signals per slot than the Singapore loop hears. More signals give more overlapping pairs (0012's retries), more candidates competing for the 140 places of stage 1 and more decodes for the passes to subtract.
- A larger antenna hears more weak signals near `jt9`'s floor, where the failed class lives.
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
