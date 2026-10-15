# Experiment 0006: the early pass in the app

Status: accepted 2026-10-15. Measured on the tree of commit 6eb11d3 with the `ft4-sweep` set added to the bench.

## Decision

- The app decodes each FT8 slot from its first 13.5 s and each FT4 slot from its first 6 s while the slot is still being received (`EARLY_S` in `web/src/lib/clock/slots.ts`). `SlotAssembler` hands over a copy of those samples as soon as they are written, and the worker decodes them as a partial slot with `decode_partial` (experiment 0003): symbols after the cut count as erasures. The decodes show in the list about 1.5 s before the slot ends.
- At slot end the whole slot is decoded as before, with the later FT8 stages. Its decodes join the early pass's: early rows keep their place and take the whole slot's SNR, DT and frequency, and new messages follow them. A message only the early pass found stays.
- The sequencer gets the early pass as `early`, where calling CQ with Repeat CQ adds callers to the queue, and the joined decodes as `final`, where it decides as before. PSK Reporter reports from the final and later passes only.
- No early pass for a slot RR73 transmits in, a slot with less than half the audio up to the cut, or a slot whose audio began after the cut. A busy decoder skips it. When the decoder is too busy for the whole slot, the early pass's decodes stand for it.
- CI gates both cuts: `subtract-3-osd2 --audio-s 13.5` on the CI sets against `bench/subtract-3-osd2-early.json`, and `--audio-s 6` on a small `ft4-sweep` against `bench/subtract-3-osd2-ft4-early.json` with `bench/gate-ft4.toml`. The gate's preset check now includes the cut.

## Question

Experiment 0003 measured early decoding of FT8 at 11.8 s and 13.5 s, before a priori decoding (decision 0009) and without FT4. Which cut points should the app use, and what do they cost in decodes and false decodes with today's preset?

## Method

- FT8: `subtract-3-osd2` on the whole slot and on the first 13.5 s, over the 60 ft8_lib public files, the 360 SARTS slots, `snr-sweep` (40 per step), `late-start`, `ap-sweep` (40 per step, 5000 noise slots with a QSO context) and 5000 noise slots.
- FT4: a new set, `ft4-sweep`: one FT4 message per slot at -24 to -6 dB in AWGN and with moderate Watterson fading (40 per step), 20 crowded slots of 10 signals at -16 to 0 dB at least 100 Hz apart, and noise slots. Whole slots against cuts at 5.8, 6.0 and 6.2 s with 2000 noise slots; 10000 noise slots at 6.0 s and whole; the FT4 `late-start` subsets at 6.0 s. A message at DT 0 ends 5.54 s into an FT4 slot.
- In the app: `decode.spec.ts` in Chromium with the fake microphone's loop, recording when each slot first appears in the list.

## Results

FT8, matched decodes (false decodes were 0 in every set, both ways):

| Set | Whole slot | First 13.5 s |
| --- | --- | --- |
| `public/ft8_lib` (1298 references) | 1160 | 1157 |
| SARTS 20261012 (2284) | 1638 | 1639 |
| SARTS 20261013 (1926) | 1475 | 1473 |
| `snr-sweep/awgn`, SNR50 | 461, -19.02 dB | 461, -19.02 dB |
| `snr-sweep/fading`, SNR50 | 327, -15.67 dB | 327, -15.67 dB |
| `ap-sweep/qso`, SNR50 | 168, -21.70 dB | 167, -21.67 dB |
| `ap-sweep/callers` | 76 | 76 |
| 5000 noise slots, 5000 `ap-sweep` noise slots | 0 false | 0 false |

The cut loses late starters, whose messages end after 13.5 s: sent whole from 2.0 s late, 243 of 320 against 232; from 2.5 s late, 210 against 195. The whole-slot pass at slot end finds them.

FT4 on `ft4-sweep`, matched decodes:

| Set | Whole slot | 5.8 s | 6.0 s | 6.2 s |
| --- | --- | --- | --- | --- |
| `awgn` (760), SNR50 -14.2 dB | 350 | 350 | 350 | 350 |
| `fading` (760), SNR50 -10.8 dB | 215 | 214 | 215 | 215 |
| `crowded` (200) | 183 | 183 | 183 | 183 |
| 2000 noise slots | 0 false | 0 false | 0 false | 0 false |

On the FT4 `late-start` subsets the 6.0 s cut matches the whole slot up to 0.625 s late, then loses messages that end after the cut: sent whole from 0.75 s late, 196 against 199; from 0.875 s, 178 against 184; from 1.0 s, 142 against 157. False decodes over all FT4 subsets are 7 either way: one at 0.875 s cut goes, and one appears with a reply sent 0.25 s late after a CQ (`6M6MPC/P 5O8IEZ GI78`, -20.8 dB, OSD).

On 10000 FT4 noise slots, whole slots and the 6.0 s cut give the same 2 false decodes, both OSD: `BL7CXS 9C5UQI/P PK50` at -22.1 dB and `N81ETB WL4CVB R GM61` at -20.2 dB. The early pass adds none. FT8 gave none on 10000.

In Chromium every slot appeared in the list 13.53 to 13.58 s after it started, 5 slots in a row. Time per slot of an early pass is about that of a whole slot (experiment 0003, single-threaded: p50 70.0 ms against 68.5 ms on the public files); not measured again.

13.5 s for FT8 keeps 0003's choice: at 11.8 s the early pass misses about 10 % of the slot's decodes, so most slots would grow again at their end. 6.0 s for FT4 is the earliest cut measured that loses nothing on `ft4-sweep`, with 0.46 s after a DT 0 message ends, as 13.5 s leaves 0.36 s in FT8.

## Alternatives rejected

- 11.8 s for FT8: about 10 % of the decodes wait for slot end (0003).
- Decisions on the early pass: the sequencer would answer a reply 1.5 s sooner, but a reply missing at 13.5 s is not yet a missed reply. The sequencer keeps deciding at slot end.
- Dropping at slot end the messages only the early pass found: rows would leave the list under a finger, and 0003 found most such messages to be real stations.

## Open risks

- Not tested on a device: the early pass's time on an iPhone. 0003 estimated 145 to 290 ms for the slowest slot.
- FT4 accepts OSD codewords at -22 and -20 dB on noise (2 in 10000 slots, whole and early alike), where real FT4 decodes do not reach. An SNR floor for FT4 OSD is the next decoder change.
- No FT4 recordings in the corpus: the FT4 cut rests on synthetic signals with DT within ±0.5 s and the `late-start` set.
