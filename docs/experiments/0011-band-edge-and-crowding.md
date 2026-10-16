# Experiment 0011: the band edge, crowded spectrum and weak signals

Status: hypothesis recorded 2026-10-16, on 0.22.4, after the first measurements of the band edge in the recordings (part 1) and before any change to the decoder.

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

## Why the changes should help

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
