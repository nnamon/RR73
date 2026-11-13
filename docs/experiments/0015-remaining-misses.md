# Experiment 0015: remaining misses, OSD locators and WebKit timing

Status: accepted 2026-11-13 for a residual rebuilt strongest first at the start of stage 3, in slots with at most 55 decodes, and for an OSD locator check against the sender's country in every stage. Rejected: looser OSD limits in stage 3, a stricter one (29 hard errors) next to the rebuild, the rebuild in stage 2, and the locator check without its exemptions. Measured on 0.28.1, whose FT8 decoder is experiment 0013's with experiment 0014's kernels.

## Question

Experiment 0013 left 2074 of the 44840 `jt9` references on the six public receivers unmatched through three stages, 411 of its failed misses `jt9` a priori decodes. The owner made decoding accuracy and speed in the field the top priority. Four work items:

1. Break the remaining misses down by cause and go after the largest causes that can be fixed.
2. Check a stage 3 OSD decode's callsign prefix against its locator, keep the check only if it removes false decodes we have today or lets a looser OSD setting gain true decodes with no false decode added.
3. Time the three stages per slot in WebKit on the most crowded slots, against the slot deadline on a phone-class budget.
4. Record more slots from the public receivers, if items 1 to 3 leave time.

The receivers are labelled by region, as in experiment 0013: Europe A and B, North America A and B, South America, Australia, and Singapore.

## Method

- `rr73-bench run` and `misses --oracle` in the `rust` container on the Apple M4 (10 CPUs), preset and the two `DEEP` stages, on the 1648 slots of the six receivers, the 350 readable Singapore slots and the 60 public files. Other workloads ran on the host throughout (load 4 to 26); decodes do not depend on load.
- `jt9`'s a priori marks come from `tools/wsjtx/decode_list.py` run again over the six receivers: the same 44840 decodes, with `a1` and `a2` kept.
- Unmatched decodes on the recordings are sorted as in experiment 0013: a text decoded in another slot of the same receiver (repeat), only callsigns the receiver's references or matched decodes hold (known), and the rest (unexplained). Unexplained is the only check for interference-shaped false decodes, which white noise does not make. It is not proof: a station heard at one site only lands there too.
- False decodes: 5000 FT8 noise slots, `ft4-sweep`'s 10000 FT4 noise slots, 5000 noise slots each of `ap-sweep` and the three `band-edge` noise subsets, LQ8's 5000, and the stress runs of experiment 0013 (stages 2 and 3 at a 0 dB sync threshold on the FT8 noise slots and `crowded`; every stage at 0 dB on 5000 FT4 noise slots).
- Weak signals: `snr-sweep` (40 per step), `crowded`, `ap-sweep`, `overlap`, `late-start`, `ft4-sweep` and `band-edge` (20 per step), `lq8-sweep` (160 per step). The synthetic messages carry random locators. A new bench option, `--home-locators`, places each one within about 300 km of the position the country file gives its sender's prefix, as a real station's locator is, and leaves the audio otherwise the same. Both were run: home locators as the realistic case, random ones as the worst case for the locator check.
- Time natively: `--threads 1` on every fourth recorded FT8 slot (515), base and final in turn, 3 rounds, each slot's fastest. In WebKit: `tools/wasm-cost/ft8.mjs` in Playwright's WebKit 26.6, the app's plan in a dedicated worker stepped as the app steps it with the 2000 ms budget, on the 182 slots that are the 100 with the most references or the 100 slowest natively; each slot's fastest of 3 runs. Both plans run in the same worker, slot by slot. The A13 figures multiply WebKit by 2.2, the factor of experiments 0001, 0002, 0009 and 0014.

## Results

### Item 1: where the misses are

Each miss is put in the first class it fits, in the order of the table. "Overlap" covers failed misses with another reference within 50 Hz, or that the stages decode once every other reference is subtracted (the oracle); "decodable at the exact position" are failed misses whose transmitted codeword the first stage's decoder returns at the genie position, which the candidate search did not reach.

| Cause | Base | Final | Oracle decodes, base |
| --- | --- | --- | --- |
| Overlap: another signal within 50 Hz | 957 | 831 | 498 |
| `jt9` a priori only, `a1` (CQ hypothesis) | 443 | 422 | 62 |
| `jt9` a priori only, `a2` (its built-in K1ABC, noise) | 13 | 13 | 0 |
| Strong (from -16 dB), isolated, undecodable at every position | 153 | 156 | 0 |
| Decodable at the exact position (refinement) | 125 | 116 | 55 |
| Hashed callsign resolved by `jt9` from an earlier slot | 119 | 115 | |
| Sync and search: no candidate within 3.2 Hz and 0.09 s | 87 | 75 | 26 |
| Another text decoded at the place (overlap) | 80 | 71 | 18 |
| Weak (below -16 dB), isolated | 59 | 57 | 0 |
| DT or frequency edge (DT range, under 200 Hz, over 2900 Hz) | 27 | 27 | 5 |
| Decoded outside the match tolerance | 5 | 5 | |
| OSD rule or SNR floor | 6 | 2 | 3 |
| All | 2074 | 1890 | |

Overlap is the largest cause by far. Of the 957 overlapped misses, the stages decode 498 once all other references are subtracted, strongest first. The block demodulator at the reference position tells where the rest of that gap lies: subtracting only the run's own decodes, strongest first from the slot audio, decodes 129 failed misses there against 47 on the run's residual. The residual subtracts each decode in the order it was found, and a weak decode subtracted before a strong neighbour carries part of the neighbour with it. That led to the rebuild below.

The 456 `jt9` a priori references are the second cause. Experiment 0013 accepted the CQ hypothesis with belief propagation only, and rejected it with OSD for its unexplained decodes; nothing here changes that.

The 153 strong isolated misses have 15 to 30 hard errors at the refined position with no neighbour, many at +5 to +19 dB on long paths (Japan to Europe, Brazil to Russia, Indonesia to Ukraine). Belief propagation fails on them with as few as 15 errors, so the wrong bits carry confident LLRs. Fast fading or a drifting transmitter would do that; which one is unverified.

### Residual rebuilt strongest first

`subtract.restart=true` makes a stage start from the slot audio with every earlier decode subtracted again, strongest SNR first. Three stages, both with the locator check (below):

| Rebuild at | 6 receivers | Singapore | Public | Unexplained, 6 receivers |
| --- | --- | --- | --- | --- |
| None | 42766 | 4081 | 1267 | 137 |
| Stages 2 and 3 | 42948 | 4086 | 1273 | 147 |
| Stage 2 | 42944 | 4086 | 1273 | 147 |
| Stage 3 | 42963 | 4089 | 1272 | 148 |
| Stage 3, slots with at most 55 decodes | 42950 | 4089 | 1272 | 149 |

The gain sits in busy slots: of the 210 decodes stage 3's rebuild gains over all recordings, 171 come from slots with 30 to 59 decodes before stage 3. Those slots are also the slowest, so the limit of 55 decodes keeps 197 of the 210 and leaves the 52 busiest slots, which set the worst time, without the rebuild (time below).

Unexplained unmatched decodes rise from 137 to 149 on the six receivers against the locator check alone, and from 146 to 149 against base; over all recordings 222 in base and 223 final. Most new ones are OSD codewords with 25 to 30 hard errors in stage 3, such as `T97XWM/R 2P7UCZ/R NF36`, against 8 such codewords that the rebuild removes. A stage 3 OSD limit of 29 hard errors takes the rebuilt plan to 140 unexplained, below base, but loses 10 true decodes on the synthetic sets, so it is dropped.

The rebuild changes no decode on any synthetic set, random or home locators: one signal per slot gives it nothing to reorder, and the `crowded` slots decode in full already.

### Item 2: callsign prefix against locator

`validate.osd_locator_max_km` rejects an OSD codeword, or a CQ hypothesis decode, whose locator lies farther than that from every DXCC entity its sender's prefix belongs to. Belief propagation decodes are never checked.

- The prefixes come from the Big CTY release the app already ships. `tools/refdata/prefixes.mjs` writes `crates/rr73-decode/data/prefixes.txt` (60 kB), which the decoder compiles in with `include_str!` and parses on first use, so the worker and the bench read one table with no request. A prefix carries its entity's position and the positions of the entities of the exact callsigns that start with it: W calls cover Hawaii and Alaska. `update-bigcty.mjs` rewrites the file with each release, and a tools test fails when it is stale.
- Exempt: senders whose prefix is in no entity, and senders from a country whose prefixes span several CQ zones (the USA, Canada, Asiatic and European Russia, China, Australia, Antarctica, found from the CQ zone overrides in the country file). One position cannot stand for those. `/MM` and `/AM` cannot occur: a standard FT8 callsign carries only `/R` or `/P`, and OSD messages must be standard.
- 6000 km: the farthest true locator from its entity among matched decodes on the recordings is 5422 km (`CQ UA9SHH IO63`, a station sending a grid far from home), apart from 6 decodes of one station sending `JD11` from Sicily, all from belief propagation.

On the recordings it removes 9 decodes, all unexplained and all from stage 3, and no matched decode:

| Decode | Sender's entity | Locator | Distance | SNR |
| --- | --- | --- | --- | --- |
| `NC9CGA IY6WHM/R AQ97` | Italy | AQ97 | 6631 km | -12.4 dB |
| `JL6AFF XE1MVA KA79` | Mexico | KA79 | 13106 km | -2.8 dB |
| `V41UBS UU8NPP RN85` | Ukraine | RN85 | 8929 km | -20.4 dB |
| `4U5GFV SF8NOT FM72` | Sweden | FM72 | 6423 km | -14.1 dB |
| `416SYZ/P FL1VVK/P CM81` | France | CM81 | 9777 km | -17.3 dB |
| `UE9VF/R LJ1VUQ EN71` | Norway | EN71 | 6265 km | -15.2 dB |
| `IO8SRB A24MJW FF25` | Botswana | FF25 | 9416 km | -19.3 dB |
| `7L8MLD TP2VHE/R QF76` | France | QF76 | 17340 km | +0.5 dB |
| `GP8KIA/R AW1GCH HD08` | India | HD08 | 13771 km | -5.7 dB |

Each pairs callsigns heard nowhere in the corpus, most with a rover or portable flag, with a locator in the ocean or on another continent. Without the exemptions the check removed 16; the other 7 came from senders in the USA and China (`K3SF NN1ZRN NL01`, `AC8EUZ BK6NWH/R NA05`) and from prefixes in no entity (`CQ DPFS JZ1EPT HA60`, `RG9DQC Y10TKZ/R NO52`, `S68OVJ/R X14BED HM23`).

On the synthetic sets with home locators the check changes no decode. With random locators it rejects true OSD decodes as it would false ones: 8 of 81 `ap-sweep` callers, 103 of 9192 `late-start` decodes, 4 of 210 in `overlap` with fading (SNR50 -18.19 to -17.62 dB), 9 of 1025 in `snr-sweep` (fading SNR50 -19.00 to -18.83 dB) and 4 of 435 in `ft4-sweep`. The CI gates use random locators, so the a priori gate's callers fall from 39 to 37 and the FT4 early pass's fading slots from 46 to 44.

Looser OSD limits behind the check, in stage 3 only, gain true decodes but add more unexplained ones than the check removes:

| Stage 3 OSD | 6 receivers | Unexplained, 6 receivers |
| --- | --- | --- |
| 30 hard errors, distance 0.07, with the check | 42766 | 137 |
| 33 hard errors | 42894 | 217 |
| distance 0.08 | 42841 | 154 |

Most added codewords pass the check because their senders are exempt or their locator happens to fall near the sender's country.

### False decodes and LQ8

Final against base, three stages:

| Set | Base | Final |
| --- | --- | --- |
| 5000 FT8 noise slots | 0 | 0 |
| 10000 FT4 noise slots | 0 | 0 |
| `ap-sweep`, `band-edge` noise (5000 each, 4 sets) | 1 (`band-edge` noise-soft) | 0 |
| Stress: stages 2 and 3 at 0 dB, FT8 noise and `crowded` | 0 | 0 |
| Stress: every stage at 0 dB, 5000 FT4 noise slots | 0 | 0 |
| `late-start`, random locators | 3 | 2 |
| LQ8 noise, 5000 slots | 0 | 0 |

LQ8 decodes are identical in every field and counter on `lq8-sweep` (160 per step) and its noise slots: LQ8 has its own OSD rule, and its single-signal slots give the rebuild nothing to do. Its unit tests pass.

### Item 3: WebKit timing on the busiest slots

The 100 busiest of the 182 slots hold 52 to 71 references each. ms per slot from the start of decoding, each slot's fastest of 3 runs:

| Plan, worker | Stage 1 ends p50, p95, max | Three stages p50 | p95 | max |
| --- | --- | --- | --- | --- |
| Base, slow worker | 112, 143, 154 | 416 | 661 | 836 |
| Base, fast worker, best of 2 sessions | | 301 | 467 | 592 |
| Final, fast worker, best of 2 sessions | | 344 | 490 | 593 |

WebKit workers differ by 20 to 60 % for a whole session (experiment 0014); the slow-worker run is the one to scale. On the A13 scale the base plan ends at 1.45 s at the 95th percentile and 1.84 s for the slowest slot. The final plan adds 5 % at the 95th percentile and nothing at the worst slot, which the 55-decode limit keeps out of the rebuild: about 1.53 s and 1.84 s, inside the 2 s budget. No slot reached the budget, and the longest step was 2 to 7 ms against the worker's 40 ms slices.

Mean time per slot by pipeline stage, base plan, one run in WebKit: LDPC and OSD 144.3 ms (45 %), spectrogram 43.4 ms, refinement in the demodulator 40.7 ms, subtraction 36.6 ms, demodulation 25.0 ms, search 15.9 ms, validation 2.4 ms, total 322 ms. No stage blows the budget. LDPC includes the CQ hypothesis's belief propagation on every failed candidate (experiment 0013); a decode-identical speedup there would need the work of experiment 0014 again and was not attempted.

Natively, single thread, 515 recorded slots, ms:

| Three stages | p50 | p95 | max | mean |
| --- | --- | --- | --- | --- |
| Base | 166.1 | 335.8 | 449.8 | 179.1 |
| Final | 188.9 | 374.3 | 479.1 | 199.6 |

Stage 1 and 2 run the same code in both, and differ by 5 to 8 % in favour of whichever ran second in each round, so the native figures carry that much noise.

### Item 4: more recordings

FT8 only: `tools/kiwi` has no FT4 mode, which needs FT4 dials and 7.5 s slots in the recorder. The recorder ran detached for 2.5 hours on 2026-11-13 from 05:40 UTC with its politeness rules and wrote 450 slots in 10 sessions (about 1.9 hours of audio) on 40m to 17m from Europe A and B and North America A and B. Singapore's status page timed out, South America's returned HTTP 404, and Australia had too few free channels at every attempt, so the recorder made no session there. North America B closed one session early; the recorder counted it as an error and backed off. No receiver reported a time limit, `ext_api` refusal or `too_busy`.

`reference.py` gave 441 of the slots `jt9` references (9940 decodes). Decoded by the plans tuned on the October slots, these slots are a held-out check:

| Three stages | Matched of 9940 | Unexplained unmatched |
| --- | --- | --- |
| Base | 9546 | 25 |
| Locator check | 9546 | 25 |
| Final | 9599 | 28 |

The rebuild gains 53 (0.56 %) against 0.43 % on the October slots. Of its 4 new unexplained decodes, 2 look real (`VK3YZ ON6DZ JO20`, `UR5UU UT5MB R-13`) and 2 do not (`HP7QHV F2TSJ +45`, `K49MJU 5P9KHZ HQ08`). The locator check removes nothing on these slots.

## Expected and measured

No hypothesis was recorded before the measurements; the acceptance rules of experiment 0013 apply.

| Measure | Rule | Measured |
| --- | --- | --- |
| True decodes or SNR50 | gain | 6 receivers 42766 to 42950, Singapore 4081 to 4089, public 1267 to 1272, held-out slots 9546 to 9599; SNR50 equal on the realistic synthetic sets |
| False decodes on noise and stress sets | none added | none added; 1 removed |
| Time | three stages inside 2 s on the A13 scale | p95 about 1.53 s, slowest about 1.84 s |
| LQ8 | tests, noise, sweep | identical |

## Decision

Accepted:

- `validate.osd_locator_max_km=6000` in `subtract-3-osd2`, so in every stage, with unknown prefixes and countries spanning several CQ zones exempt.
- `subtract.restart=true subtract.restart_max_decodes=55` in stage 3 of `DEEP`.
- `--home-locators` in the bench, for synthetic sets whose locators fit their callsigns.

Rejected:

- Stage 3 OSD at 33 hard errors or a distance of 0.08: 128 and 75 more true decodes for 80 and 17 more unexplained ones.
- Stage 3 OSD at 29 hard errors next to the rebuild: unexplained decodes below base, but 10 true decodes lost on the synthetic sets.
- The rebuild in stage 2 or in both later stages: fewer decodes than in stage 3 alone, and two rebuilds cost more.
- The rebuild in every slot: 13 more decodes for the slowest slots' worst case.
- The locator check without exemptions: 7 more junk decodes removed, at the risk of true decodes from the large countries and new prefixes.

## Open risks

- The locator check trusts the sender's locator. A station sending a wrong grid from more than 6000 km away loses its OSD decodes; its belief propagation decodes stay. On the recordings that happened to no matched decode.
- The rebuild adds about 3 unexplained decodes on 1648 busy slots against base, 12 against the locator check alone. The noise sets cannot show interference-shaped codewords.
- The 55-decode limit counts decodes, which follow the band's crowding; the phone's speed plays no part. A phone slower than 2.2 times the M4 can still end stage 3 at the budget on a busy band.
- The session keeps a copy of the slot audio for the rebuild, 720 kB per FT8 slot.
- Not tested on a device. The A13 figures scale the M4's WebKit times.

## Next

- Overlap: 831 misses, 396 of them recovered by the oracle. A rebuild that also re-estimates each decode's amplitude with its neighbours removed, or subtracts failed candidates' hard decisions, would close part of the gap the oracle shows.
- The 156 strong isolated misses: measure frequency drift and fading across a transmission on them.
- LDPC and OSD take 45 % of WebKit time, most of it the CQ hypothesis.
