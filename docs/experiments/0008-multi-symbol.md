# Experiment 0008: soft bits from multi-symbol block detection

Status: hypothesis recorded 2026-10-15, before implementation.

## Question

Do soft bits from noncoherent detection of blocks of symbols (1, 2 and 3 FT8 symbols; 1, 2 and 4 FT4 symbols), computed from complex tone amplitudes at a refined start and frequency, lower SNR50 and raise recall over the shipped preset's single-symbol LLRs, with no added false decodes and within the time budget? Does the demodulator belong in the preset or in a later stage (decision 0007)?

## Why it should work

The preset's demodulator is ft8_lib's: for each symbol on its own, the dB magnitudes of the 8 (FT8) or 4 (FT4) tones in a spectrogram with a 2-symbol Hann window, 2 frames per symbol and 2 bins per tone spacing. It loses sensitivity three ways:

- Grid offsets. A candidate sits up to a quarter symbol off in time and a quarter tone spacing off in frequency. The finer grids of the later stages recover 0.86 dB of SNR50 in AWGN (decision 0007), most of it this loss.
- The window. A Hann window over 2 symbols mixes each symbol with half of each neighbour and does not match the rectangular symbol.
- Single-symbol detection. Each symbol is detected by its energy alone, so the phase relation between consecutive symbols goes unused.

FT8 and FT4 are continuous-phase FSK with modulation index 1. Each tone completes a whole number of cycles per symbol relative to tone 0, so the phase at the middle of every symbol is the same whatever the data, apart from the carrier's own rotation. Gaussian smoothing (BT 2 in FT8, BT 1 in FT4, QEX 2020 section 5) bends the phase only during the transitions between tones. Averaged over a symbol, the phase of the correlation with the sent tone moves by about 0.007 rad per step of tone difference in FT8 and 0.028 rad in FT4 (the mean of the transition's phase error, `2π / (8 (k BT)²)` with `k = 5.336`); the unit tests check this against the codec's waveform. The complex correlations of consecutive symbols with their sent tones therefore add in phase, and detecting N symbols together collects up to N times the energy per decision, less the loss of noncoherent combining.

The QEX paper (Franke, Somerville and Taylor, "The FT4 and FT8 Communication Protocols", QEX July/August 2020, section 6 and table 5) describes this method and reports, for WSJT-X in AWGN: FT8 thresholds of -19.6 dB with single-symbol soft bits and belief propagation, -20.3 dB with blocks of 1, 2 and 3 symbols, and -20.8 dB adding OSD; FT4 -15.3, -16.9 and -17.5 dB with blocks of 1, 2 and 4. With 1 Hz of Doppler spread the blocks gain 0.5 dB in FT8 and 1.3 dB in FT4. The soft bit is the largest block correlation magnitude among the tone sequences with the bit set, minus the largest among those with it clear, times a constant; sets of soft bits for each block length go to the decoder in turn, starting with 1.

The preset reaches SNR50 -19.02 dB in FT8 and -14.25 dB in FT4 in AWGN (with OSD). FT4 trails the paper's -17.5 dB by 3.2 dB and FT8 its -20.8 dB by 1.8 dB, so FT4 has the most to gain. In this crate the WSPR decoder gained 2.6 dB of SNR50 from block detection (experiment 0004).

Risks:

- Fading and frequency error break coherence across a block. On the WSPR recordings, 7-symbol blocks alone lost two thirds of the decodes that single symbols found (experiment 0004); FT8's 3-symbol block lasts 0.48 s and FT4's 4-symbol block 0.19 s, against 4.8 s for WSPR's 7.
- Each extra set of soft bits is one more belief propagation and OSD attempt per failing candidate, and most candidates fail. False decodes and time grow with the attempts.

## Method

A demodulator option, `demod.kind=block`, selected by configuration overrides. The presets stay as they are until the measurements justify a change.

- Per decoding pass, one FFT of the residual audio: 192 000 points for FT8 (16 s), 97 200 for FT4 (8.1 s), zero-padded.
- Per candidate, the band from 1.5 tone spacings below tone 0 to 1.5 above the top tone, with a raised-cosine taper over one more spacing each side, is shifted so tone 0 lies at 0 Hz and transformed back to a complex baseband of 32 samples per symbol (200 Hz for FT8, 3200 points; 666.7 Hz for FT4, 5400 points).
- Refinement: start time within half a symbol of the candidate in steps of 1/32 symbol, and frequency within half a tone spacing, chosen to maximise the sum over the sync groups (Costas arrays) of the power of the coherent sum of each sync symbol's correlation with its known tone. Frequency comes from a grid of 1/32 tone spacing, then parabolic interpolation. The coherent sum makes the metric sharp in frequency: a 7-symbol FT8 Costas array spans 1.12 s.
- Tone amplitudes: each symbol interval correlated with each tone at the refined start and frequency.
- Soft bits for block length N: for each data symbol, the N consecutive symbols around it (N = 3: one each side; N = 2: the symbol and the next; N = 4: one before and two after). Every tone sequence over the block is scored by the magnitude of the sum of its complex amplitudes; sync symbols inside a block take their known tone only, and symbols outside the transmission are left out. A bit's LLR is the largest score with the bit set minus the largest with it clear (max-log, as in the paper). The 174 LLRs are then scaled to the preset's variance of 24, so belief propagation and the OSD limits (hard errors, weighted distance, SNR floor) see the same scale as now. Symbols cut by the end of a partial slot read zero and give zero LLRs, as erasures do now.
- Order of attempts: optionally the spectrogram LLRs first (`demod.spectrogram_first`), then each block length in the order of `demod.ft8_blocks` (default `[1,2,3]`) or `demod.ft4_blocks` (`[1,2,4]`). Each set goes through belief propagation and OSD; the first codeword that validates is the decode. A priori decoding runs as now, on the first set's LLRs.
- The session's steps stay bounded: a candidate step tries fewer candidates when several sets are tried, and the FFT is a step of its own.

Variants: the block sets alone and after the spectrogram LLRs; each block length alone; OSD on every set or on the last only; and the demodulator in a later stage (`--then`) after the preset, alone and with the stages of decision 0007.

Measurements, each against the shipped preset (`subtract-3-osd2`) with the option off, using `rr73-bench run` and `compare` (`docs/bench.md`) in the `rust` container:

- Recordings: the 60 ft8_lib public files and the SARTS slots (`corpus/public corpus/kiwi`).
- `--synth snr-sweep` (40 per step, AWGN and fading), `--synth crowded`, `--synth late-start` (40 per step), `--synth ap-sweep` (40 per step, 5000 noise slots with the QSO context), `--synth ft4-sweep` (40 per step, 20 crowded slots, 10000 FT4 noise slots).
- False decodes on `--synth noise --noise-count 5000` and the FT4 noise slots, and a stress run with the sync threshold at 0 dB on 5000 FT8 and 5000 FT4 noise slots, as experiment 0003 did.
- Time per slot single-threaded (`--threads 1`), each slot's best of 3 runs, with the host's load average; for the final candidate, in WebKit and Chromium workers with `tools/wasm-cost/ft8.mjs` (FT8 and `--mode FT4`).

## Expected effect

| Measure | Preset now | Expected with block soft bits in the preset |
| --- | --- | --- |
| SNR50, FT8 AWGN | -19.02 dB | -19.8 to -20.5 dB |
| SNR50, FT8 fading (0.5 Hz, 1 ms) | -15.67 dB | -16.2 to -17.0 dB |
| SNR50, FT4 AWGN | -14.25 dB | -15.8 to -17.0 dB |
| SNR50, FT4 fading | -10.83 dB | -11.8 to -13.0 dB |
| SARTS recall | 0.739 | +0.02 to +0.05 |
| `public/ft8_lib` recall | 0.894 | +0.01 to +0.03 |
| False decodes, noise sets and stress | 0 | 0 |
| Time per slot, single-threaded native | p50 21.5 ms, slowest 96 ms (decision 0007) | about twice that |

Most of the FT8 gain should come from the refinement and the matched correlation (the loss the finer grids recover now), and less from blocks longer than 1. In FT4 both parts should count. After the later stages of decision 0007 the grid loss is gone already, so a block stage there should add less in FT8 (0.3 to 0.6 dB) and more in FT4 (1 to 1.5 dB).

## Acceptance

Keep a change only if it adds true decodes or lowers SNR50, with zero added false decodes on the noise sets (5000 FT8 slots, 10000 FT4 slots) and in the stress runs, within the time budget: the preset stage near its current cost, later stages within decision 0007's 2 s on the phone. Negative results are recorded here.
