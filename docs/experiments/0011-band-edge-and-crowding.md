# Experiment 0011: the band edge, crowded spectrum and weak signals

Status: accepted 2026-10-16 for the band edge, a normalised set of soft bits and hashed callsigns resolved in the slot; rejected for power-scored sets, a second normalised set and a wider stage 3. Hypothesis recorded 2026-10-16, on 0.22.4, after the first measurements of the band edge in the recordings (part 1) and before any change to the decoder; results measured the same day on 0.23.1, whose decoder is 0.22.4's.

- Accepted: `subtract-3-osd2` follows the receiver's passband edge in its SNR estimate, searches tones to 3200 Hz (stage 3 of `DEEP` keeps 3000 Hz), and tries soft bits of 3 FT8 or 4 FT4 symbols scored normalised after its block sets, for candidates with 9 or more sync symbols on their sent tone. SARTS 3852 to 3896 of 4210 in the preset and 3967 to 4013 through three stages, `public/ft8_lib` 1249 to 1253 and 1256 to 1260; FT8 AWGN SNR50 -21.25 to -21.27 dB (three stages -21.55 to -21.63 dB), FT4 -17.02 to -17.07 dB; no false decode added. Time natively, mean per slot: the preset 29.7 to 31.8 ms, the three stages 127.4 to 142.0 ms; in a WebKit 26.6 worker the three stages p95 291 to 364 ms. Not tested on a device.
- Accepted: the session renders decodes with a hashed callsign again at the end of each stage.
- Rejected: normalised soft bits in place of the amplitude scores, a power-scored set, a second normalised set, stage 3 to 3200 Hz and a search to 4000 Hz. Deferred: the preset's sync threshold at 4 dB.

## Question

After 0.22.4, the three stages miss 285 of the 5508 reference decodes on the 403 recorded slots with at least one (experiment 0010's breakdown, measured again on 0.22.4: 5223 matched). Which of the remaining misses can the decoder recover without false decodes and within its time budget, in this order:

1. The receiver's passband edge. 13 misses are one station, 9A7W at 2996 Hz, whose tones pass the 3000 Hz limit of the search. A wider search found them in experiment 0010, with SNRs of +39 to +46 dB against `jt9`'s +10 to +26 dB. Where does the audio a real radio delivers end, and can the SNR estimate (and anything else that reads the noise floor) be made right up to that edge, so the search can go there?
2. Crowded spectrum. 78 of the 214 failed candidates have another reference decode within 25 Hz. What limits them: residue of subtracted neighbours, the order of subtraction, neighbours we never decode, the neighbour's energy in the block demodulator's tones, or the candidate lists?
3. Weak signals below stage 1's sync threshold (89 search misses in the preset alone, 72 of them scoring 2 to 5 dB at their best position), and hashed callsigns (23 misses).
4. Anything else the classifier shows is cheap to win.

## Part 1: where the audio ends

Measured on the recordings before any change, with a numpy script in the `kiwi` container that is not kept: for each slot, the 20th percentile over time of each 6.25 Hz bin's power, averaged in dB over a group of slots, against its median over 500 to 2500 Hz.

| Recordings | Slots | -6 dB, high side | -20 dB, high side | Below the edge |
| --- | --- | --- | --- | --- |
| SARTS, 12 October | 146 | 3000 Hz | 3025 Hz | -60 dB at 3050 Hz, -78 dB from 3100 Hz |
| SARTS, 13 October | 214 | 3000 Hz | 3025 Hz | -61 dB at 3050 Hz, -81 dB from 3100 Hz |
| `public/ft8_lib`, `191111_*` | 9 | 2869 Hz | 2950 Hz | -26 dB from 3000 Hz |
| `public/ft8_lib`, `20m_busy_*` | 38 | 2688 Hz | none | -12 dB from 2775 Hz to 3600 Hz |
| `public/ft8_lib`, `websdr_test*` | 13 | 2875 Hz | 3375 Hz | -36 dB from 3500 Hz |

The SARTS edge is the recorder's own: `rr73-kiwi` asks the KiwiSDR for a 100 to 3000 Hz passband and keeps 100 to 3000 Hz of its IQ stream with 50 Hz raised-cosine edges (`tools/kiwi/README.md`). On the low side the floor is down 6 dB at 100 to 140 Hz (SARTS, `191111_*`) and 290 to 330 Hz (`websdr_test*`, `20m_busy_*`).

The radios' documents give the filter's width and leave its place in the audio unstated. The IC-705 Basic Manual (A7560D-1EX-9, p. 4-5) gives USB-D's FIL1 as 3.0 kHz, FIL2 1.2 kHz and FIL3 500 Hz, each adjustable from 50 Hz to 3.6 kHz; its selectivity for SSB with the 2.4 kHz filter is more than 2.4 kHz at -6 dB and less than 3.4 kHz at -40 dB (p. 11-2). No IC-705 document gives the receive passband's low or high edge in Hz; the only edges in Hz are for transmit, 300 to 2700 Hz in SSB-D (p. 4-8). The KX2 Owner's Manual (rev. B2) gives no width or centre for USB or DATA A. By that width, an IC-705 at its default USB-D setting delivers audio to about 3.0 kHz above its filter's lower edge, and its skirt passes a strong station some hundreds of hertz further; with FIL1 widened to 3.6 kHz it delivers more. Unverified on a device.

## Rationale

### The band edge

The SNR estimate takes its noise from a low percentile of the cells 18 tone spacings either side of a signal, and treats the noise as flat there. Within 110 Hz of a passband edge part of that region lies in the stopband, 20 to 80 dB down, and pulls the percentile down: the SNR reads high by up to the stopband's depth. The SNR also gates OSD decodes (the -24 dB floor) and a priori decodes, so a wrong SNR near the edge also loosens that gate.

A receiver attenuates signal and noise alike, so the ratio at each frequency is the SNR at the antenna. Proposed: measure each pass's noise floor across the band (the 20th percentile over time of every bin, smoothed across 25 Hz with a median, which keeps a monotonic edge where it is); when a signal's reference region holds bins more than 10 dB below the region's passband level, leave those out of the reference, raise the cells on the skirt by their attenuation, and take the noise at each of the signal's tones as the reference level times that tone's attenuation. A strong signal lifts the floor of its own bins, so the attenuation at its tones comes from the frames outside its transmission. Elsewhere the estimate stays exactly as it is.

With the SNR right at the edge, the search can extend to the audio's edge. A search to 3200 Hz covers tones to 3200 Hz: 9A7W, the SARTS edge with its skirt, and a 3.0 kHz filter whose lower edge lies at 200 Hz or below.

### Crowded spectrum

A candidate whose band holds another signal gets soft bits disturbed by that signal's tones, at full strength when it is not yet decoded and subtracted, and at the subtraction's residue (experiment 0010: -25 to -30 dB of the signal's energy for strong steady signals) when it is. Measure, for each crowded failure on the recordings, what the block demodulator makes of it at its reference position on the original audio, on the run's residual, and on the audio with every other reference decode subtracted (an oracle that has decoded every neighbour), and whether the three stages decode it from that oracle audio. A failure that decodes from the oracle audio is lost to its neighbours: either to neighbours the run does not decode, or to the order in which it subtracts them. One that does not is limited by the signal itself (fading, distortion, weakness) or by subtraction residue.

Proposed changes, each only if the measurement points to it: more passes or a pass after the last decode in each stage, so a signal under a neighbour decoded in the last pass gets a clean try; subtraction of a neighbour as soon as it decodes, before the next candidate in the same pass; and a candidate list that keeps more places near decoded signals.

### Weak signals and hashed callsigns

The preset keeps 140 candidates from a 5 dB sync threshold; stage 3 searches from 2 dB for 400. A lower threshold in stage 1 brings the weak search misses into stage 1, at the cost of LDPC attempts on noise; the block demodulator's sync gate (5 of 21 sync symbols on their sent tone, experiment 0008) already skips most noise candidates. The score itself is the mean of dB differences between the sync tone and its neighbours; a ratio of sums is a more efficient detector of a weak tone in noise. Both are measured.

Of the 23 hashed misses, 20 are `<...>` in the reference itself: `jt9` did not resolve them either, and they are search and decode failures under another name. 3 are messages whose hash `jt9` resolved from a callsign it decoded later in the same slot. RR73 learns a callsign when it decodes it, so a hashed message decoded first keeps `<...>`. Proposed: after each stage, render hashed decodes again with what the slot taught.

## Method

- Each change is a configuration option, off until it is justified.
- Measurements on the 60 public files and 350 readable SARTS slots; `snr-sweep` (40 per step), `crowded`, `late-start` (20 per step), `ap-sweep` (40 per step, 5000 noise slots), `ft4-sweep` (40 per step, 20 crowded, 10000 noise slots), 5000 FT8 noise slots, and stress runs with every stage's sync threshold at 0 dB on the 5000 FT8 noise slots with `crowded`, and on 5000 FT4 noise slots. Each for the preset and for the three stages (`DEEP`).
- A new synthetic set, `band-edge`: one message per slot at -24 to +16 dB through a receiver passband, with the passband applied to signal and noise together, so the truth SNR is the SNR at the antenna; FT8 at 2850 to 3050 Hz through a sharp edge like the SARTS recorder's, at 2700 to 3150 Hz and 150 to 450 Hz through 400 Hz skirts, FT4 at 2850 to 3050 Hz through the sharp edge, and filtered noise slots for false decodes.
- `rr73-bench misses --oracle` adds, for each search, failed and other-text miss, the block demodulator at its reference position on the original audio, the residual and the oracle audio, and whether the stages decode it from the oracle audio.
- Time per slot natively, single-threaded, each slot's best of 3, and in a WebKit worker with `tools/wasm-cost`, with the host's load average.

## Expected effect

| Measure | Now (0.22.4) | Expected |
| --- | --- | --- |
| SNR error at the edge, `band-edge` | up to +60 dB with a wider search | within 2 dB where the skirt is above the receiver's own floor |
| SARTS and public matched, three stages | 3967, 1256 | +12 to +14 (9A7W and `YO3GK JE6EFG PM53`) |
| Crowded failures recovered | 0 of 78 | a third of those the oracle decodes |
| Hashed misses | 23 | 20 (the 3 resolved in the slot) |
| False decodes, noise sets and stress | 0 | 0 |
| Preset time per slot | WebKit p50 about 53 ms (0010) | within 10 % |
| Three stages | within 2 s | within 2 s |

## Acceptance

As in experiments 0008 to 0010: a change is kept only if it adds true decodes or lowers SNR50, adds no false decode on the noise sets and in the stress runs, keeps the preset near its current cost and the later stages within decision 0007's 2 s on a phone. Negative results are recorded here.

## Results

Measured 2026-10-16 on 0.23.1 (whose decoder is 0.22.4's) with the commits of this experiment: a release build of `rr73-bench` in the `rust` container on the Apple M4 (10 CPUs). Accuracy runs used 10 threads while other work shared the host (1-minute load average 2 to 33); decodes do not depend on load. Times are in their own section. "Preset" is `subtract-3-osd2`; "three stages" is the app's plan (`DEEP`, decision 0007). Recall counts reference decodes matched within 10 Hz and 0.5 s by text.

### The SNR estimate at the band edge

`snr.passband=true` (`crates/rr73-decode/src/passband.rs`, `snr.rs`, described under Rationale above). On the `band-edge` set, with the search to 3200 Hz, the reported SNR of matched decodes minus the true SNR at the antenna, median by base tone:

| Subset, base tone | Flat estimate | With the floor |
| --- | --- | --- |
| FT8, sharp edge, 2850 to 2900 Hz | +4.9 dB | +0.0 dB |
| FT8, sharp edge, 2900 to 2950 Hz | +44.4 dB | -0.3 dB |
| FT8, sharp edge, 2950 to 3000 Hz | +43.5 dB | +0.2 dB |
| FT8, 400 Hz skirt, 2800 to 2850 Hz | +3.5 dB | -1.0 dB |
| FT8, 400 Hz skirt, 2900 to 2950 Hz | +12.0 dB | +0.2 dB |
| FT8, 400 Hz skirt, 2950 to 3000 Hz | +27.3 dB | -0.5 dB |
| FT8, 400 Hz skirt, 3000 to 3050 Hz | +18.7 dB | -0.7 dB |
| FT8, 400 Hz skirt at the low edge, 250 to 450 Hz | +1.1 to +3.4 dB | -1.6 to +1.3 dB |
| FT4, sharp edge, 2850 to 3000 Hz | +44.8 to +49.0 dB | -0.4 to +0.2 dB |

With the search at 3000 Hz, as before, the flat estimate read up to 5.3 dB high on the 400 Hz skirts (median +3.5 dB at 2800 to 2850 Hz). Signals whose tones lie wholly past the -6 dB point (sharp edge from 3000 Hz, FT4 from 3040 Hz, skirt from 3100 Hz) read 20 to 27 dB low with either estimate: they decode because the floor there is the receiver's own, 70 dB down, and their SNR at the antenna cannot be measured. The unit tests in `snr.rs` hold the estimate within 2.5 dB of the truth at a sharp and a soft edge, and bit for bit equal to the flat one away from an edge.

On the recordings, with the search left at 3000 Hz, the floor changes the SNR of 353 of 5383 decodes in the preset and no decode: 249 in `20m_busy_*` and 66 in `websdr_*`, whose receivers' floors fall 6 to 12 dB between 2690 and 2875 Hz and slope within the band, and 38 elsewhere; by -8.2 to +6.3 dB, median -0.4 dB. On SARTS our SNR minus `jt9`'s varies smoothly with frequency, from +9 dB below 250 Hz through -4 dB at 500 to 1000 Hz and +4 dB at 1500 to 2000 Hz to -17 dB at 2750 to 3000 Hz, with either estimate (medians over 26 to 444 decodes per 250 Hz). Our estimate takes its noise within 110 Hz of each signal; the 9A7W decodes read +2 to +10 dB, against `jt9`'s +10 to +26 dB, in line with that curve. Unverified which of the two is right near the edge; on `band-edge`, where the truth is known, ours is.

### Search to 3200 Hz

With the floor, the preset searching tones to 3200 Hz (`spectrogram.freq_max_hz=3200`) and, first, every stage doing so:

| Set | 0.23.1 | Every stage to 3200 Hz | Stages 1 and 2 to 3200 Hz, stage 3 to 3000 Hz | Every stage to 4000 Hz |
| --- | --- | --- | --- | --- |
| SARTS, preset | 3852 | 3863 | | 3863 |
| SARTS, three stages | 3967 | 3981 | 3979 | 3981 |
| `public/ft8_lib`, both | 1249, 1256 | the same | the same | the same |
| `ap-sweep` callers, qso, three stages | 156, 228 | 155, 227 | 156, 228 | not run |
| `late-start` FT4, three stages | 4036 | 4033 | 4036 | not run |
| Sweeps, `crowded`, `ft4-sweep`, noise and stress | | the same, 0 false | the same | the same where run |

The SARTS gains are 9A7W's 12 decodes at 2997 Hz, `YO3GK JE6EFG PM53` at 2962 Hz twice and `UA9SY F6IRA -07`. With stage 3 searching to 3200 Hz, its 400 places from a 2 dB threshold fill with noise candidates beyond 3000 Hz and 5 weak synthetic signals (-17.7 to -25.3 dB) lost their place; stage 3 keeps 3000 Hz, which loses 3 SARTS decodes that stage 3 found at 3200 Hz (2 of them at 2962 and 2997 Hz) and gains 1. 4000 Hz finds nothing 3200 Hz does not. On `band-edge`, preset: FT8 sharp 108 to 138 of 220, soft 125 to 170, low 160 to 161, FT4 sharp 89 to 102, and no false decode in 3000 filtered noise slots.

### What limits the crowded failures

`rr73-bench misses --oracle` on 0.23.1, three stages, the 214 failed candidates by the nearest other reference decode: how many the block demodulator decodes at the reference position on each audio, and how many the three stages decode from the oracle audio.

| Nearest other reference | Failed | Original audio | Run's residual | Run's decodes subtracted strongest first | Run's matched decodes only | Run's decodes and the missed references | Every other reference | Three stages on that |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| under 10 Hz | 49 | 0 | 3 | 5 | 3 | 20 | 21 | 23 |
| 10 to 25 Hz | 29 | 0 | 0 | 1 | 0 | 5 | 7 | 11 |
| 25 to 50 Hz | 63 | 1 | 2 | 4 | 2 | 13 | 14 | 17 |
| 50 Hz or more | 73 | 3 | 3 | 3 | 3 | 3 | 3 | 0 |

- Subtraction residue and order limit few of them: subtracting the run's own decodes strongest first gains 4 over the order found, and leaving out the run's unmatched decodes gains nothing.
- Neighbours the run never decodes limit many: with those subtracted as well, 38 of the 141 failures within 50 Hz decode at their position, and 51 decode through the three stages. They come in groups that fail together. Of the 53 misses the oracle recovers (all classes), 20 have every neighbour within 50 Hz decoded by the run, 17 only weaker neighbours missed and 16 a stronger neighbour missed; `YO3GK JA2KGH PM84` (+0 dB) and `DF1BN JH6XOD PM52` (-9 dB) share 1406 Hz, 0.4 s apart, and the run decodes neither.
- The neighbour's energy in the block demodulator's tones is a limit too. At the reference positions on the run's residual, soft bits scored normalised (each bit's difference of magnitudes over the larger, `demod.block_score=normalised`) decode 28 (1 symbol) and 29 (3 symbols) of the 214, against 5 and 8 for the amplitude scores the preset uses, and 16 for the power of 3-symbol blocks. Of the 34 misses of any class that only a normalised set decodes there, 28 have no other reference within 25 Hz and 28 are at -16 dB or above: strong signals whose symbols a neighbour, a fading peak or an impulse dominates. Every normalised win has 9 or more of its 21 sync symbols on the sent tone.
- Candidate lists: the failed class has candidates by definition. The one effect of a full list measured here is stage 3's at 3200 Hz, above.

### Normalised soft bits as a further set

A normalised set alone in place of the amplitude scores loses 1 dB with fading (preset -18.30 to -17.35 dB) and 168 SARTS decodes in the preset; as a further set after `[1,3]` (`demod.ft8_extra_sets`) it only adds. On the recordings, with each set in every stage:

| Further sets (FT8; FT4 uses 4 in place of 3) | SARTS, preset | Public, preset | SARTS, three stages | Public, three stages | LDPC attempts per slot, preset, three stages |
| --- | --- | --- | --- | --- | --- |
| None (0.23.1) | 3852 | 1249 | 3967 | 1256 | 140, 834 |
| 1 symbol normalised | 3881 | 1255 | 3997 | 1264 | |
| 3 symbols normalised | 3889 | 1255 | 4005 | 1263 | |
| 1 and 3 normalised | 3896 | 1257 | 4012 | 1266 | 226, 1582 |
| 1 and 3 normalised, from 9 sync symbols | 3894 | 1257 | 4010 | 1266 | 194, 1166 |
| 1 and 3 normalised, from 12 sync symbols | 3893 | 1257 | 4008 | 1266 | 178, 1041 |
| 1 normalised, 3 power | 3903 | 1255 | 4008 | 1264 | |
| 1 and 3 normalised in stage 3 only, from 9 | | | 4010 | 1264 | 1138 |

The power set adds the most in the preset and the least plausible decodes: of its 49 new unmatched decodes in the preset, 11 neither repeat in another slot nor carry callsigns known from the references, most OSD codewords with 23 to 30 hard errors such as `DO2JHE M13DCK MI26` and `UL3RLL/R CG3WHY R JQ05`, against 4 of 38 for two normalised sets. Rejected. With 1 and 3 symbols normalised from 9 sync symbols (`x3g9`), on every set: no false decode on the noise sets and in the stress runs, SNR50 FT8 AWGN -21.25 to -21.27 dB (three stages -21.55 to -21.63 dB), FT4 AWGN -17.02 to -17.07 dB, fading unchanged, `late-start` FT8 +17 and FT4 +36 in the preset.

### Hashed callsigns

19 of the 23 hashed misses through three stages are `<...>` in `jt9`'s list as well: `jt9` runs on each slot alone and did not resolve them either, so they are failed and search misses under another name. Of the other 4, `<OR80AF> R3FE KO85` (-24 dB) did not decode, and 3 are `<N5HHS> JA9EIX/3` and `<LU7EAT> JA9EIX/3`, which RR73 decoded as `<...> JA9EIX/3` before the message carrying the callsign in full. RR73 learns a callsign when it decodes it. In the app the decoder context, and its callsigns, carry over from slot to slot (`crates/rr73-wasm`, `CONTEXT`), so a callsign heard in an earlier slot resolves; the bench clears it before every slot, as `jt9` does. The session now renders hashed decodes again at the end of each stage (`DecodeSession::resolve_hashes`). On the recordings 11 decodes change text; `jt9`'s list names the callsign in 3 and keeps `<...>` in 7, as `jt9` resolves only from callsigns decoded before, so matching by text gains 3 and loses 7 (net -4, in the figures below). No decode is gained or lost. The app's first stage, which it reads with `next_stage`, gets the resolved text; decodes of the later stages that a step returned before its stage ended keep theirs.

### Weak signals: the preset's sync threshold

| Preset threshold, candidates | SARTS | Public | AWGN SNR50 | Fading SNR50 | LDPC attempts per recorded slot, per noise slot |
| --- | --- | --- | --- | --- | --- |
| 5 dB, 140 (0.23.1, with resolved hashes) | 3850 | 1247 | -21.25 dB | -18.30 dB | 140, 3 |
| 4 dB, 140 | 3900 | 1248 | -21.37 dB | -18.63 dB | 255, 36 |
| 3 dB, 140 | 3902 | 1248 | -21.37 dB | -18.83 dB | 376, 136 |
| 3 dB, 200 | 3910 | 1248 | -21.37 dB | -18.83 dB | 517, 188 |

No false decode on 5000 noise slots in any row. Through three stages the 4 dB preset adds 13 SARTS decodes and 0.05 dB with fading, as stage 3 already searches from 2 dB. It takes 1.8 times the preset's LDPC attempts on recordings and 12 times on noise, and this experiment leaves it out (Next).

### The change taken

`subtract-3-osd2` from this experiment: the floor in the SNR estimate, the search to 3200 Hz, and one further set of 3 FT8 or 4 FT4 symbols scored normalised for candidates with 9 or more sync symbols on their sent tone; stage 3 of `DEEP` keeps 3000 Hz. Two normalised sets (1 and 3) add 8 SARTS and 2 public decodes over one, for 4.5 % more time in stage 1 and 7 % in the three stages (below); one is taken.

| Set | 0.23.1 | This experiment |
| --- | --- | --- |
| SARTS (350 slots, 4210), preset | 3852 (0.915) | 3896 (0.925) |
| SARTS, three stages | 3967 (0.942) | 4013 (0.953) |
| `public/ft8_lib` (1298), preset, three stages | 1249, 1256 | 1253, 1260 |
| Unmatched on the recordings, preset (public, SARTS) | 164, 118 | 184, 131 |
| `snr-sweep` AWGN SNR50, preset, three stages | -21.25, -21.55 dB | -21.27, -21.63 dB |
| `snr-sweep` fading SNR50 | -18.30, -18.88 dB | the same |
| `ft4-sweep` AWGN SNR50 | -17.02, -17.55 dB | -17.07, -17.58 dB |
| `ft4-sweep` fading SNR50, crowded | -14.30, -14.92 dB; 199, 200 | the same |
| `crowded`, matched of 1800 | 1796, 1797 | the same |
| `late-start` (20 slots per step), FT8 of 11200, preset, three stages | 4873, 5062 | 4885, 5077 |
| `late-start`, FT4 of 10240 | 3820, 4036 | 3843, 4064 |
| `ap-sweep` callers, qso | 144, 188; 156, 228 | 144, 188; 157, 228 |
| `band-edge`, preset: FT8 sharp, soft, low; FT4 sharp | 108, 125, 160, 89 | 138, 172, 161, 102 |
| False: 5000 FT8 and 10000 FT4 noise slots, 5000 `ap-sweep` noise slots, 3000 `band-edge` noise slots, sweeps, `crowded` | 0 | 0 |
| False, stress: every stage at a 0 dB sync threshold, 5000 FT8 noise slots with `crowded`, 5000 FT4 noise slots | 0 | 0 |
| False: `late-start` FT8, three stages | 4 | the same 4 |

`compare` on the recordings, preset: 96 decodes gained (56 matched) and 15 lost (8 matched, 7 of them the hashed decodes above). Of the 40 new unmatched decodes, 19 repeat a text decoded in another slot and 15 carry only callsigns the references or matched decodes hold; the other 6 are 4 hashed decodes now shown with their callsign and `TI3ESG JH3FHQ RR73` and `KE0EE N1RDN R-18`, standard messages between plausible callsigns. Through three stages: 114 gained (59 matched), 16 lost (9 matched); of 58 new unmatched, 31 repeat and 19 carry known callsigns. On the synthetic sets the change gains 38 to 47 and loses 3 to 4 weak `late-start` FT4 signals, all matched.

The miss breakdown with the change, against 0.23.1:

| Class | Preset, 0.23.1 | Preset, now | Three stages, 0.23.1 | Three stages, now |
| --- | --- | --- | --- | --- |
| Matched | 5101 | 5149 | 5223 | 5273 |
| Missed | 407 | 359 | 285 | 235 |
| Hashed callsign | 27 | 28 | 23 | 22 |
| Same text outside the tolerance | 10 | 10 | 11 | 11 |
| Search miss | 92 | 78 | 34 | 20 |
| Decoded as another message | 5 | 5 | 3 | 3 |
| Candidates there, none decoded | 273 | 238 | 214 | 179 |

Of the 179 failures left through three stages, 65 have another reference within 25 Hz (78 before) and 55 are below -20 dB.

### Time

Native, single-threaded (`--threads 1`), each slot's fastest of 3 runs, the configurations in turn, the 410 recorded slots, 1-minute load 2.3 to 6.5:

| ms: p50, p95, max, mean | 0.23.1 | Floor and 3200 Hz | Taken (one normalised set) | Two normalised sets |
| --- | --- | --- | --- | --- |
| Stage 1 ends | 16.2, 72.2, 94.1, 29.7 | 15.7, 72.8, 92.6, 29.6 | 16.2, 83.5, 120.3, 31.8 | 16.8, 88.7, 112.3, 33.2 |
| Stage 2 ends | 30.5, 116.7, 175.3, 51.4 | 31.3, 116.7, 191.6, 52.3 | 33.4, 131.3, 214.2, 57.2 | 33.9, 143.8, 250.7, 61.1 |
| Stage 3 ends | 90.4, 272.4, 427.2, 127.4 | 92.5, 280.1, 461.8, 129.2 | 98.2, 330.5, 528.0, 142.0 | 102.6, 364.9, 623.4, 152.5 |

FT4, 154 slots of `ft4-sweep` at 3 per step with 20 crowded and 20 noise slots, load 9.8 to 13.2: stage 1 p50 6.7 to 8.5 ms, mean 8.2 to 9.8 ms; three stages p50 67.6 to 79.6 ms, p95 81.9 to 98.2 ms.

WebKit 26.6 (Playwright, `tools/wasm-cost/ab.mjs`), a dedicated module worker, each slot's fastest of 3 runs, stepped as the app steps the later stages, the release build with both plans run in turn for every slot; 103 of the recorded slots (every fourth) and the 154 FT4 slots; load 4.5 to 10 at the start:

| ms: p50, p95, max | FT8, 0.23.1 | FT8, now | FT4, 0.23.1 | FT4, now |
| --- | --- | --- | --- | --- |
| Stage 1 ends | 17, 76, 90 | 18, 87, 104 | 10, 26, 48 | 11, 27, 49 |
| Stage 2 ends | 32, 128, 196 | 38, 155, 235 | 32, 51, 73 | 35, 59, 86 |
| Three stages end | 109, 291, 504 | 119, 364, 611 | 91, 127, 167 | 102, 138, 167 |
| Longest step | 2 | 2 | 4 | 4 |
| Decodes by stage | 1386, 35, 21 | 1405, 38, 27 | 255, 1, 0 | 255, 1, 0 |

The preset costs 7 % more time on average natively (p50 unchanged, p95 +16 %) and 10 % more in WebKit at the mean; the three stages 11 % natively and 17 % in WebKit at the mean, 25 % at the 95th percentile. With experiment 0009's factors for an iPhone (1.1 for an A18 Pro to 2.2 for an A13), the WebKit 95th percentile of the three stages is 400 to 800 ms and the slowest slot 670 to 1340 ms, inside the 2 s budget. Not tested on a device. The floor and the wider band cost under 2 %; the normalised set is the rest, one more LDPC attempt for each candidate past 9 sync symbols that the block sets do not decode (140 to 168 attempts per recorded slot in the preset, 834 to 1011 through three stages).

## Expected and measured

| Measure | Expected | Measured |
| --- | --- | --- |
| SNR error at the edge, `band-edge` | within 2 dB above the receiver's own floor | median within 1.6 dB at every base tone with its tones above the -6 dB point; 20 to 27 dB low past it |
| SARTS and public, three stages | +12 to +14 | +46 and +4: the band edge +12 and 0, the normalised set about +36 and +6, hashed text -2 and -2 |
| Crowded failures recovered | a third of those the oracle decodes | 13 of the 78 within 25 Hz (65 left); the oracle recovers 34 of them |
| Hashed misses | 20 | 22: 3 resolved and 5 `<...>` references decoded, and 7 `<...>` references now differ by text from RR73's resolved decode |
| False decodes | 0 | 0 |
| Preset time | within 10 % | +7 % natively, +10 % in WebKit (means) |
| Three stages | within 2 s | WebKit p95 364 ms, max 611 ms on the M4 |

## Decision and open risks

Accepted: the floor in the SNR estimate, the search to 3200 Hz with stage 3 at 3000 Hz, one further set of soft bits (3 FT8 or 4 FT4 symbols, normalised, from 9 sync symbols) in `subtract-3-osd2` and so in every stage, and hashed callsigns resolved at the end of each stage. The `baseline` preset keeps the ft8_lib method; its gate file moved by the one hashed decode.

Rejected: soft bits scored normalised in place of the amplitude scores (1 dB lost with fading); a power-scored further set (the least plausible new decodes); a second normalised set (8 SARTS decodes for 4.5 % more stage 1 time); stage 3 to 3200 Hz (its full list loses weak signals); a search to 4000 Hz (nothing beyond 3200 Hz); the preset's sync threshold at 3 or 4 dB in this experiment (1.8 to 2.7 times the LDPC attempts for 13 decodes through three stages). Measured and not changed: subtraction order and the run's unmatched decodes, which do not limit the crowded failures.

Open risks:

- Not tested on a device: the band edge of the IC-705 and the KX2 in their data modes, and the time on an iPhone.
- The edge of the audio a radio delivers is not in its manual: the IC-705's FIL1 is 3.0 kHz wide in USB-D and can be set to 3.6 kHz (Basic Manual p. 4-5), the KX2's manual gives no figure. A radio that delivers audio past 3200 Hz has stations there the search does not reach.
- Signals wholly past a receiver's -6 dB point report an SNR 20 to 27 dB low, so an OSD decode there falls below the -24 dB floor and is refused. Only strong stations decode there.
- Near a soft edge inside the passband, as on the `20m_busy_*` files, the estimate moved 353 recorded decodes by up to 8 dB in either direction; the truth is unknown there.
- The normalised set adds unmatched decodes (6 of the preset's 40 new ones have no support elsewhere, and 4 of those are hashed decodes shown with their callsign). The noise sets cannot show interference-shaped false decodes.
- FT4's gate of 9 of 16 sync symbols is 2.25 times chance against FT8's 9 of 21 at 3.5 times; FT4's preset costs 20 % more natively for its gains (2 on `ft4-sweep`, 23 on `late-start`). No FT4 recordings.
- Later stages' decodes returned by a step keep `<...>` when the callsign arrives later in the stage.

## Next

- The groups of overlapping signals that fail together (41 recoverable at their position once the missed neighbours are subtracted): decode the stronger of a pair with the weaker treated as interference, for example by retrying a candidate after subtracting a hypothesis of its neighbour from the trace's near candidates, or a pass that re-tries failed candidates next to each new decode.
- The preset's sync threshold at 4 dB with the block demodulator's sync gate raised for the added candidates, to bring the 50 SARTS decodes into stage 1 at less than 1.8 times the attempts.
- The two-set normalised variant in stage 3 only (4010 SARTS, 1264 public, preset unchanged) if the later stages have time to spare on a phone.
- A bench option that carries callsigns from slot to slot in time order, as the app does, to measure hashed decodes as the operator sees them.
