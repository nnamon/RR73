# Experiment 0009: decoding speed

Status: hypothesis recorded 2026-10-15, before profiling or optimising. Results for the decoder before block soft bits recorded 2026-10-16.

## Question

1. Where does the FT8 and FT4 decoder spend its time per slot, natively and in the browsers' WebAssembly workers, for the shipped preset, the early pass and the app's three-stage plan (decision 0007)? Where is WebAssembly much slower than native?
2. How much of that time can go without changing a single decode: the same messages, frequencies, DTs, SNRs, passes and stages on every slot?
3. Can a second decoder worker shorten a slot's decoding in WebKit, at what memory cost and risk, given that workers share no memory (decision 0004)?

Speed counts twice. The first decodes of a slot should arrive early: the early pass decodes the first 13.5 s of an FT8 slot (6 s in FT4) and the whole slot follows at its end. The later stages find more the more of them fit in their 2 s budget on a slow phone.

## Why it should be possible

From reading the code (`crates/rr73-decode`, `crates/rr73-dsp`), before any measurement:

- Every pass recomputes the spectrogram. Each sample is fetched through a bounds check, a finiteness test and a clamp, twice per paired frame, and each stored bin takes a `log10`. Stage 3 (8 frames per symbol, 4 bins per tone spacing) stores about 750 frames of about 1800 bins: 1.35 million logarithms per pass, up to 3 passes.
- The Costas search scores every candidate position on its own, walking the 21 sync symbols with bounds and silence checks for each. Stage 3 scores about 430 000 positions per pass. Within one frame every bin of the search range makes the same comparisons in the same order, so the scores of a whole frame can be computed as slice operations over the bins, which SIMD lanes run independently with the same sums as now.
- Belief propagation runs its 25 iterations on every candidate that fails, gathering messages through index arrays edge by edge. The tanh and atanh approximations are elementwise and can run over all edges at once.
- OSD of order 2 over 91 positions (stage 3) evaluates 4095 pairs per failed candidate. Each pair walks the bits two generator rows share and calls a branching lookup per bit; a table of signed reliabilities gives the same sums without the branch.
- `rr73-wasm` is built with WebAssembly SIMD (`.cargo/config.toml`), but only rustfft uses explicit SIMD. LLVM vectorises a loop only where bounds checks and branches allow, and never reorders a floating-point sum.
- The session rebuilds the spectrogram plan, its window and the SNR scale whenever the configuration changes: three times per slot with the app's plan, and once more for the early pass.

Exactness rule: an optimisation may change how values are computed only where every value comes from the same floating-point operations in the same order. Vectorising across independent values (bins, edges, checks) qualifies; reordering a sum does not.

## Method

- Profile. Native: `rr73-bench run --threads 1` stage timings, and a sampling profiler (`perf` in a container) for the split inside stages. Browsers: `tools/wasm-cost/ft8.mjs` in Chromium and WebKit workers, with stage timings from an opt-in clock in `rr73-wasm` (the decoder's stopwatch reads zero on wasm32 today). Sets: the 60 ft8_lib public files, the 360 SARTS slots and `crowded` (80 slots); FT4 from `ft4-sweep`. Runs: the preset alone, the early pass (`--audio-s 13.5`, FT4 `--audio-s 6`) and the three-stage plan of `.github/workflows/ci.yml`.
- Optimise one kernel per commit. Each keeps its old implementation as a reference in a unit test that checks the new one bit for bit. Each commit carries `rr73-bench compare` against the commit before, which must show 0 gained and 0 lost, and an exact check that every decode field (text, frequency, DT, SNR, pass, stage, LDPC iterations, hard errors, sync score, OSD distance) and every slot's counters are unchanged, on the public files, SARTS, `crowded`, `smoke`, `noise-ci`, the 5000 noise slots and `snr-sweep`, for the preset, the early pass and the three-stage plan. A change that moves any floating-point value is reported with the decodes it moves.
- Time. Single-threaded native and the browser workers, each slot's best of 3 or more runs, the host's 1-minute load average reported with every timing, final numbers taken when the load is low.
- Parallelism. Model the app's timeline for a second worker that runs the later stages while the first takes the next slot. Prototype in `tools/wasm-cost` a split of the band into two halves across two workers, each decoding candidates in its half with an overlap at the boundary, and measure the wall time in WebKit, the memory of the second worker, and the decodes gained and lost against one worker.

## Expected effect

| Measure | Expected |
| --- | --- |
| Decodes, all sets and plans | identical |
| Spectrogram time | 2 to 3 times faster (the logarithm stays) |
| Search time | 3 to 6 times faster |
| Belief propagation time | 1.3 to 2 times faster |
| OSD time | 2 to 4 times faster |
| Three-stage plan, native p50 (242 ms in decision 0007) | about 120 ms |
| Preset alone and early pass, native p50 (about 21 ms on the 410 recordings) | about 12 ms |
| Ratio of WebAssembly to native time | unchanged or lower |
| Second worker for the later stages | no gain at today's 2 s budget: the later stages end long before the next slot's early pass (13.5 s after slot end in FT8, 6 s in FT4) |
| Band split over two workers, preset stage | 1.4 to 1.7 times shorter wall time in WebKit, a few decodes moved at the boundary, about 10 MB more memory |

The candidate stages (belief propagation and OSD) should take most of the time in stage 3, and the spectrogram and search most of it in the preset.

## Results

### Changes

Five commits change the decoder, one kernel each. Each keeps the old code as a reference in a unit test that checks the new code bit for bit. `rr73-bench compare --exact` against each commit's parent found every decode field and every slot counter identical, 0 decodes gained and 0 lost, in all eight runs: the FT8 preset, early pass (`--audio-s 13.5`) and three-stage plan on 7410 slots (the public files, SARTS, `crowded`, `smoke`, `noise-ci`, the 5000 noise slots and `snr-sweep`), the same three on `ft4-sweep` (900 slots, `--audio-s 6`), and the preset and three-stage plan on `ap-sweep` (760 slots). The commit messages carry the output.

| Commit | Kernel | Change | Stage mean before and after, three-stage plan, public files, native A/B against the parent |
| --- | --- | --- | --- |
| a54d45b | OSD | Order-2 overlaps of each window row with every later row over a 0/1 membership table, which vectorises; a table of signed reliabilities; integer sort keys; elimination without a branch per row | LDPC 561.9 to 285.9 ms (VM load 50 to 58) |
| eca3f72 | Belief propagation | Checks grouped by degree, 8 per vector step on contiguous memory; tanh saturation chosen after the rational value; parity counted on packed words | LDPC 141.4 to 129.4 ms (load 19 to 26) |
| cd71d6d | Costas search | All bins of a frame scored at once as slice operations | Search 129.6 to 14.5 ms (load 16 to 19) |
| 7926e22 | Spectrogram | Frames inside the audio read as slices; separation of paired frames and the dB conversion in separate loops | Spectrogram 68.2 to 59.1 ms (load 10 to 13) |
| d169257 | Belief propagation | Suffix step as three elementwise loops, which LLVM left scalar on aarch64 as one loop; parity words packed in a register | LDPC 122.6 to 101.4 ms (load 16 to 22) |

Measurement tools, with no change to decodes: ec5e6e2 (a stage clock for browser workers), fd0db23 (`compare --exact`), 2c5357e (`DecoderSession.partial` and `ft8.mjs --audio-s`, to time the early pass in browsers) and 917faa4 (`tools/wasm-cost/split.mjs`, the band split below).

### Time per slot, native

`rr73-bench run --threads 1` in the `rust` container on the Apple M4 (10 CPUs). Before: the decoder at the start of the experiment (915616d). After: d169257. Each slot's fastest of 3 runs, before and after alternating within each run. Other workloads held the Docker VM's 1-minute load average at 9 to 55 during these runs (decision 0007 measured at 2.2 to 2.6), so absolute times run high: before, the three-stage plan's p50 reads 377.8 ms here against 242.1 ms in decision 0007. Subtraction, whose code did not change, reads 4 to 17 % lower in the after runs, which bounds the share of each speed-up that came from load.

410 recorded slots (60 public files, 350 SARTS):

| p50, p95, max | Before | After | p50 ratio |
| --- | --- | --- | --- |
| Preset alone | 42.4, 156.0, 211.3 ms | 20.2, 86.8, 122.0 ms | 2.1 |
| Early pass (first 13.5 s) | 46.9, 152.5, 193.0 ms | 20.5, 81.3, 105.9 ms | 2.3 |
| Three stages: stage 1 ends | 41.0, 141.3, 217.5 ms | 20.6, 80.0, 112.8 ms | 2.0 |
| Stage 2 ends | 116.7, 302.1, 434.1 ms | 50.5, 145.5, 200.1 ms | 2.3 |
| Stage 3 ends | 376.9, 890.0, 1192.6 ms | 129.3, 301.6, 386.9 ms | 2.9 |

Mean time per pipeline stage, ms per slot, 410 recorded slots:

| | Spectrogram | Search | Demodulator | LDPC and OSD | Validation | Subtraction | Slot |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Preset, before | 8.15 | 15.29 | 0.53 | 21.86 | 0.29 | 21.30 | 67.8 |
| Preset, after | 5.92 | 1.49 | 0.38 | 9.01 | 0.32 | 18.37 | 35.8 |
| Early pass, before | 7.43 | 13.61 | 0.71 | 28.30 | 0.27 | 20.61 | 71.4 |
| Early pass, after | 5.21 | 1.28 | 0.45 | 11.88 | 0.28 | 16.91 | 36.3 |
| Three stages, before | 58.01 | 107.55 | 3.92 | 256.00 | 0.35 | 21.75 | 448.8 |
| Three stages, after | 47.71 | 12.35 | 2.52 | 72.01 | 0.39 | 20.36 | 156.3 |

Over the three-stage plan the search runs 8.7 times faster, LDPC and OSD 3.6 times, the spectrogram 1.2 times and the whole slot 2.9 times (means). Subtraction now takes half of the preset's time (18.4 of 35.8 ms), and the spectrogram a third of the three stages' (47.7 of 156.3 ms).

`crowded` (80 slots): preset p50 84.6 to 52.0 ms, three stages 350.7 to 138.6 ms. FT4 on `ft4-sweep` with 3 slots per step (154 slots, as in decision 0007): preset p50 11.6 to 5.7 ms, early pass (first 6 s) 13.4 to 7.2 ms, three stages 233.9 to 70.3 ms (p95 302.9 to 97.0, max 454.5 to 133.9 ms). LDPC and OSD take 54.3 ms of the FT4 three stages' 73.4 ms mean after.

### Time per slot, browser workers

Release builds of `rr73-wasm` (wasm-pack, with wasm-opt) before (915616d's decoder with the stage clock) and after (d169257), wasm-pack release with wasm-opt, decoding in dedicated module workers in Playwright's Chromium 153 and WebKit 26.6 in the `e2e` container. For every slot and run the two builds decode in turn, so load drift hits both alike; each slot's fastest of 3 runs; stage timings on (they add a few clock reads per step). VM load 13 to 18 when the runs started. Subtraction, unchanged, reads the same before and after (WebKit 15.2 and 15.2 ms per slot for the preset), so these ratios carry no load bias. The decodes per stage are equal in both builds and to the native ones: 4341, 387 and 164.

410 recorded slots, p50, p95, max:

| | Chromium before | Chromium after | WebKit before | WebKit after |
| --- | --- | --- | --- | --- |
| Preset alone | 44.5, 205.8, 319.8 ms | 19.8, 133.1, 182.5 ms | 30, 95, 115 ms | 16, 63, 84 ms |
| Early pass (first 13.5 s) | 48.7, 128.8, 189.6 ms | 21.9, 80.0, 148.7 ms | 45, 138, 195 ms | 24, 95, 142 ms |
| Three stages: stage 1 ends | 46.6, 202.9, 333.9 ms | 19.2, 133.3, 177.0 ms | 31, 95, 143 ms | 17, 63, 113 ms |
| Stage 2 ends | 134.0, 467.1, 639.6 ms | 43.7, 233.1, 350.5 ms | 90, 213, 324 ms | 39, 112, 177 ms |
| Stage 3 ends | 427.3, 1203.6, 1953.0 ms | 133.0, 445.6, 660.4 ms | 302, 654, 818 ms | 116, 240, 288 ms |

Mean per pipeline stage, ms per slot, three-stage plan:

| | Spectrogram | Search | Demodulator | LDPC and OSD | Subtraction | Slot |
| --- | --- | --- | --- | --- | --- | --- |
| Chromium, before | 59.5 | 182.9 | 4.7 | 263.5 | 29.5 | 543.1 |
| Chromium, after | 45.6 | 13.3 | 3.9 | 85.8 | 28.4 | 179.7 |
| WebKit, before | 41.7 | 78.0 | 2.6 | 204.7 | 17.6 | 345.8 |
| WebKit, after | 32.6 | 9.8 | 1.9 | 59.8 | 17.7 | 122.9 |

In WebKit the three stages end 2.6 times sooner at the median and 2.7 times at the 95th percentile; the preset alone takes about half its time. Chromium gains 3.2 times on the three stages: its search before ran 2.3 times slower than WebKit's, a scalar loop V8 compiled worse, and the per-frame search closes most of that gap. WebKit's WebAssembly runs these loops at about native speed on the M4, as decision 0007 found (264 against 242 ms), so the ratio of WebAssembly to native time did not grow.

### Estimate for an iPhone

Not tested on a device. Experiments 0001 and 0002 put an iPhone's single-core speed at 90 % (A18 Pro) to 45 % (A13, the oldest iOS 26 device) of an M4 core, so the phone's times are the WebKit worker's times above multiplied by 1.1 to 2.2:

| WebKit p50, p95, max on the M4, after | A18 Pro | A13 |
| --- | --- | --- |
| Preset alone: 16, 63, 84 ms | 18, 69, 92 ms | 35, 139, 185 ms |
| Early pass: 24, 95, 142 ms | 26, 105, 156 ms | 53, 209, 312 ms |
| Three stages end: 116, 240, 288 ms | 128, 264, 317 ms | 255, 528, 634 ms |

Before the changes the A13 estimate for the three stages was 664, 1439 and 1800 ms, close to the 2 s budget at the slowest slots.

### Where the time goes now

Share of the decoder's self time by part, I/O and the harness left out. Native: `perf` in the `rust` container (rr73-perf image) on the 60 public files. WebAssembly: V8 CPU profiles in Node 24 over the same files, of builds without wasm-opt so functions keep their names.

| Three-stage plan | Native, before | Native, after | WebAssembly, before | WebAssembly, after |
| --- | --- | --- | --- | --- |
| OSD | 39 % | 20 % | 36 % | 22 % |
| Belief propagation | 15 % | 22 % | 16 % | 23 % |
| Costas search | 23 % | 6 % | 25 % | 6 % |
| Spectrogram: FFT, logarithm, frames | 12 % | 26 % | 13 % | 26 % |
| Subtraction | 7 % | 19 % | 8 % | 20 % |
| Demodulator | 1 % | 2 % | 1 % | 2 % |

| Preset alone | Native, before | Native, after | WebAssembly, before | WebAssembly, after |
| --- | --- | --- | --- | --- |
| Subtraction | 35 % | 54 % | 40 % | 62 % |
| Belief propagation and OSD | 35 % | 25 % | 32 % | 24 % |
| Costas search | 16 % | 3 % | 15 % | 2 % |
| Spectrogram: FFT, logarithm, frames | 9 % | 11 % | 8 % | 8 % |

In the spectrogram after the changes, the FFT takes 16 to 17 % of the three stages' time, about half of it in rustfft's out-of-place transposes for the mixed-radix sizes 3840 and 7680; the logarithm of each stored bin 5 % in WebAssembly (libm's log10f, in software) and 8 % natively (glibc's log10f and logf); loading and separating frames 3 to 5 %.

### WebAssembly SIMD

`.cargo/config.toml` builds wasm32 with simd128 and `rr73-wasm` turns on rustfft's wasm-simd kernels; both were on before this experiment. SIMD instructions per function in the release module before wasm-opt, counted from wabt's disassembly by the name section:

| Function | Before | After |
| --- | --- | --- |
| `CostasSearch::score`, now `frame_scores` | 0 | 28 (`f32x4.sub`, `f32x4.add`) |
| `SpectrogramPlan::compute_frames` | 0 | 108 (`f32x4.mul`, `f32x4.add`) |
| `SumProduct::decode` | 72, mostly zeroing | 309 (70 `f32x4.mul`, 44 `f32x4.add`, 9 `f32x4.div`) |
| `BpOsd::decode` | 216, mostly zeroing | 140 (`f32x4.mul`, `i64x2.add`) |
| `ModelSubtract::subtract`, `Model::advance` | 15, 0 | 15, 0 |
| `MaxLogDemod::llrs`, `SnrScale::estimate` | 2, 0 | 2, 0 |

Subtraction, the demodulator and the SNR estimate stay scalar. Subtraction runs serial f64 recurrences per sample, which SIMD lanes cannot split.

### Allocations, plans and repeated work

- No heap allocation per candidate in the search, demodulator, belief propagation, OSD or validation of a candidate that fails: their buffers live in the decoder context, which each worker keeps across slots. A decode allocates its tone list and text. `normalise_variance_over` allocates when `demod.skip_silent_frames` is on, which no shipped stage sets.
- `FftPlans` keeps rustfft's plans by length in the context, so each worker plans each FFT size once. The spectrogram plan, its window and the SNR scale are rebuilt when the stage's grid changes, 3 times per slot in the app's plan; the step that sets up a stage takes 0.12 ms at the median, too little for a cache.
- Repeated work across stages: stage 3's even frames sit where stage 2's frames sit, with the same FFT size and window. The spectrogram transforms frames in pairs, one real frame in each half of a complex FFT, and stage 3 pairs them differently, so its values differ in the last bits; reusing stage 2's frames would move decodes and was left out. No other work repeats on equal inputs: each stage starts on audio with the previous stage's decodes subtracted.

### What stays, and why

- Subtraction: 54 % of the preset's time natively and 62 % in WebAssembly. Each subtraction runs serial f64 recurrences per sample (phase, carrier, modulation and the moving sum) over the 151 680 samples of an FT8 signal. Experiment 0010 is changing the model on its branch (frequency, drift, smoothing), so this experiment leaves the code alone. Two directions for that work: compute the model and the products block by block, so the per-sample products vectorise with the same values in the same order; or a cheaper model, such as f32 arithmetic or the phase from the pulse sums at block centres (`phase_at_block_centres`), which changes values and needs the decoder gate.
- The logarithm of each spectrogram bin and rustfft's transposes: faster versions give different values in the last bits, outside this experiment's rule. Together they take about 15 % of the three stages.
- Belief propagation spends most of what remains on the gathers between bits and checks, which neither NEON nor wasm SIMD vectorises.

### Parallelism

#### The app's timeline

In FT8 the worker decodes slot N's first 13.5 s at 13.5 s (the early pass, preset alone), then the whole slot at 15.0 s with the three stages, which stop at the latest 2.0 s after they start. Its next work is slot N+1's early pass at 28.5 s. In FT4 the same steps fall at 6.0 s, 7.5 s, 9.5 s at the latest and 13.5 s. The budget stops the later stages whatever the phone's speed, so the worker idles at least 11.5 s of every 15 s in FT8 and 4.0 s of every 7.5 s in FT4. A second worker that runs the later stages while the first takes the next slot never overlaps anything: no gain at today's budget, as expected.

Time per slot matters in three places: the early pass, which must end within the 1.5 s before the slot ends (a busy decoder skips the next pass); stage 1 of the whole slot, whose decodes the sequencer answers within the late-start limit (`LATE_S`: 4 s in FT8, 1.25 s in FT4); and how much of stages 2 and 3 fits the 2 s budget on a slow phone. Splitting one slot's work over two workers is the only parallelism that shortens any of them.

#### Band split over two workers

`tools/wasm-cost/split.mjs`: each slot decoded by one worker over the whole band, and by two workers, one over 200 to 1660 Hz and one over 1540 to 3000 Hz (a split at 1600 Hz with 60 Hz of overlap, set with `spectrogram.freq_min_hz` and `spectrogram.freq_max_hz` on every stage). The split's decodes are the union by text. Each worker computes the whole FFT of every frame, stores and searches its half, decodes its candidates and subtracts its own decodes.

Time per slot with two workers is measured after the rebase onto the block soft bits (below).

Decodes, natively with `rr73-bench` on the full corpus (7400 FT8 slots, three-stage plan, the union of the two halves against the whole band by slot and text):

| Set | Whole band: matched, unmatched | Split: matched, unmatched | Gained: matched, unmatched | Lost: matched, unmatched |
| --- | --- | --- | --- | --- |
| SARTS (350 slots) | 3533, 29 | 3542, 30 | 14, 2 | 5, 1 |
| Public files (60) | 1227, 103 | 1224, 108 | 3, 8 | 6, 3 |
| `crowded` (80) | 1788, 0 | 1789, 0 | 1, 0 | 0, 0 |
| `snr-sweep` (1680) | 885, 0 | 886, 0 | 1, 0 | 0, 0 |
| `smoke`, `noise-ci`, 5000 noise slots | 64, 0 | 64, 0 | 0, 0 | 0, 0 |

Both halves decoded 278 of the messages, near the split, so a merge has to drop duplicates. Each half has its own candidate list (140 in stages 1 and 2, 400 in stage 3), which accounts for most of the gains. 3 of the 6 matched losses on the public files are one message, `<9A9A> F6DEO/QRP`, which the split reads as `<...> F6DEO/QRP`: the callsign hash was learnt in the other half. The two workers would have to share learnt callsigns after each slot, and each would hold the QSO context for a priori decoding.

#### Candidate split

Decision 0004 plans to split candidates across workers. Each worker would compute the same spectrogram and search, try every other candidate, and both would subtract every decode of a pass in the same order so the residuals stay equal, which needs an exchange of decodes after every pass. The duplicate check and callsign learning follow candidate order, so the merge would replay them in that order. Only the demodulator, LDPC, OSD and validation split: after the changes 27 % of the preset's native time and 48 % of the three stages', which bounds two workers at 1.16 and 1.32 times faster before any messaging. Subtraction, the largest part of stage 1, stays whole in both workers.
