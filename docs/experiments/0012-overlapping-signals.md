# Experiment 0012: overlapping signals, the preset's threshold and hashed callsigns

Status: hypothesis recorded 2026-10-16 on 0.24.2, after the baseline miss breakdown and before the measurements below.

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
