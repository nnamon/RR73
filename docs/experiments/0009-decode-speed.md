# Experiment 0009: decoding speed

Status: hypothesis recorded 2026-10-15, before profiling or optimising. Measured 2026-10-16 on 0.21.8 and again on 0.22.2 (block soft bits): ten commits make decoding 2 to 3 times faster with identical decodes, and the decoder keeps one worker.

## Question

1. Where does the FT8 and FT4 decoder spend its time per slot, natively and in the browsers' WebAssembly workers, for the shipped preset, the early pass and the app's three-stage plan (decision 0007)? Where is WebAssembly much slower than native?
2. How much of that time can go without changing a single decode: the same messages, frequencies, DTs, SNRs, passes and stages on every slot?
3. Can a second decoder worker shorten a slot's decoding in WebKit, at what memory cost and risk, given that workers share no memory (decision 0004)?

Speed matters at two points. The first decodes of a slot should arrive early: the early pass decodes the first 13.5 s of an FT8 slot (6 s in FT4) and the whole slot follows at its end. The later stages find more the more of them fit in their 2 s budget on a slow phone.

## Rationale

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

Five commits change the decoder, one kernel each (hashes after the rebase onto 0.22.2). Each keeps the old code as a reference in a unit test that checks the new code bit for bit. `rr73-bench compare --exact` against each commit's parent found every decode field and every slot counter identical, 0 decodes gained and 0 lost, in all eight runs: the FT8 preset, early pass (`--audio-s 13.5`) and three-stage plan on 7410 slots (the public files, SARTS, `crowded`, `smoke`, `noise-ci`, the 5000 noise slots and `snr-sweep`), the same three on `ft4-sweep` (900 slots, `--audio-s 6`), and the preset and three-stage plan on `ap-sweep` (760 slots). The commit messages carry the output.

| Commit | Kernel | Change | Stage mean before and after, three-stage plan, public files, native A/B against the parent |
| --- | --- | --- | --- |
| d395219 | OSD | Order-2 overlaps of each window row with every later row over a 0/1 membership table, which vectorises; a table of signed reliabilities; integer sort keys; elimination without a branch per row | LDPC 561.9 to 285.9 ms (VM load 50 to 58) |
| d5e0e7b | Belief propagation | Checks grouped by degree, 8 per vector step on contiguous memory; tanh saturation chosen after the rational value; parity counted on packed words | LDPC 141.4 to 129.4 ms (load 19 to 26) |
| 160655d | Costas search | All bins of a frame scored at once as slice operations | Search 129.6 to 14.5 ms (load 16 to 19) |
| 5eb3c01 | Spectrogram | Frames inside the audio read as slices; separation of paired frames and the dB conversion in separate loops | Spectrogram 68.2 to 59.1 ms (load 10 to 13) |
| bbf3a8d | Belief propagation | Suffix step as three elementwise loops, which LLVM left scalar on aarch64 as one loop; parity words packed in a register | LDPC 122.6 to 101.4 ms (load 16 to 22) |

Measurement tools, with no change to decodes: 0b43613 (a stage clock for browser workers), c2eb2d8 (`compare --exact`), c4c4e70 (`DecoderSession.partial` and `ft8.mjs --audio-s`, to time the early pass in browsers) and ec5eeb8 (`tools/wasm-cost/split.mjs`, the band split below).

### Time per slot, native

`rr73-bench run --threads 1` in the `rust` container on the Apple M4 (10 CPUs). Before: 0.21.8 (d5677a0). After: 0.21.8 with the five commits, rebased since as bbf3a8d. Each slot's fastest of 3 runs, before and after alternating within each run. Other workloads held the Docker VM's 1-minute load average at 9 to 55 during these runs (decision 0007 measured at 2.2 to 2.6), so absolute times run high: before, the three-stage plan's p50 reads 377.8 ms here against 242.1 ms in decision 0007. Subtraction, whose code did not change, reads 4 to 17 % lower in the after runs, which bounds the share of each speed-up that came from load.

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

Release builds of `rr73-wasm` (wasm-pack, with wasm-opt) before (0.21.8's decoder with the stage clock) and after (with the five commits), decoding in dedicated module workers in Playwright's Chromium 153 and WebKit 26.6 in the `e2e` container (`tools/wasm-cost/ab.mjs`). For every slot and run the two builds decode in turn, so load drift hits both alike; each slot's fastest of 3 runs; stage timings on (they add a few clock reads per step). VM load 13 to 18 when the runs started. Subtraction, unchanged, reads the same before and after (WebKit 15.2 and 15.2 ms per slot for the preset), so these ratios carry no load bias. The decodes per stage are equal in both builds and to the native ones: 4341, 387 and 164.

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

### Remaining costs

- Subtraction: 54 % of the preset's time natively and 62 % in WebAssembly. Each subtraction runs serial f64 recurrences per sample (phase, carrier, modulation and the moving sum) over the 151 680 samples of an FT8 signal. At this point experiment 0010 was changing the model on its branch, so this experiment left the code alone; 0010 then kept the model, and dee19cd (below) takes the first of two directions: compute the model and the products block by block, so the per-sample products vectorise with the same values in the same order; or a cheaper model, such as f32 arithmetic or the phase from the pulse sums at block centres (`phase_at_block_centres`), which changes values and needs the decoder gate.
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

Decision 0004 plans to split candidates across workers. Each worker would compute the same spectrogram and search, try every other candidate, and both would subtract every decode of a pass in the same order so the residuals stay equal, which needs an exchange of decodes after every pass. The duplicate check and callsign learning follow candidate order, so the merge would replay them in that order. Only the demodulator, LDPC, OSD and validation split: on 0.21.8's preset after the changes, 27 % of the preset's native time and 48 % of the three stages', which bounds two workers at 1.16 and 1.32 times faster before any messaging. Subtraction, the largest part of stage 1, stays whole in both workers. The block soft bit preset raises these shares (below).

## Results on the block soft bit preset (0.22.2)

Release 0.22.2 made the block soft bits of experiment 0008 the preset: each candidate's band is cut to a complex baseband, refined from its sync symbols, and correlated symbol by symbol for soft bits from blocks of 1 and 3 FT8 symbols (1 and 4 in FT4). The branch was rebased onto it, and three more commits followed.

### Decodes

`rr73-bench compare --exact` of origin/main (ca34933) against the rebased branch with the five commits above, and of each new commit against its parent, found every decode field and slot counter identical, 0 decodes gained and 0 lost, in all ten runs: the FT8 preset, early pass and three-stage plan on 7410 slots; the same three on `ft4-sweep` (900 slots); the preset and three-stage plan on `ap-sweep` (760); and, gated in CI as well, the `baseline` preset on the public files and the synthetic sets (7050 slots) and the `wspr` preset on `wspr-smoke`, `wspr-noise` and `wspr-snr-sweep` (225 slots).

| Commit | Change | Stage time before and after, native, public files, A/B against the parent |
| --- | --- | --- |
| d9a3bdc | Block demodulator: the sync search sums every frequency offset of a start side by side; each symbol's correlation runs every tone side by side; the block LLRs take lane-wise maxima | Block refinement 25.7 to 11.7 ms per slot, preset (VM load 19 to 21) |
| 13bcebb | Session steps: 16 spectrogram frames, 4 search frames, 4 sets of soft bits (one candidate with the block demodulator), 1 subtraction per step | Longest step of work 7.0 to 4.0 ms in WebKit, 7.3 to 4.3 ms in Chromium; time per slot unchanged |
| dee19cd | Subtraction: the model a block at a time, its products over the whole span, the moving sum's steady part without bounds checks | Subtraction 20.5 to 16.7 ms per slot, preset, and 21.2 to 16.9 ms, early pass, on the 410 recorded slots (load about 15) |

### Time per slot, native

As before: single thread, each slot's fastest of 3 runs, the four builds alternating within each run, VM load 26 falling to 4 over the runs. Before: origin/main (ca34933). After: dee19cd. 410 recorded slots:

| p50, p95, max | Before | After | p50 ratio |
| --- | --- | --- | --- |
| Preset alone | 29.0, 142.3, 256.2 ms | 20.2, 93.2, 116.7 ms | 1.4 |
| Early pass (first 13.5 s) | 32.1, 127.3, 195.4 ms | 20.0, 83.1, 102.2 ms | 1.6 |
| Three stages: stage 1 ends | 32.9, 127.2, 162.6 ms | 17.1, 79.5, 96.0 ms | 1.9 |
| Stage 2 ends | 75.5, 239.4, 361.2 ms | 35.0, 121.2, 185.4 ms | 2.2 |
| Stage 3 ends | 297.2, 800.6, 1219.1 ms | 98.7, 296.9, 493.4 ms | 3.0 |

Mean time per pipeline stage, ms per slot, 410 recorded slots (refinement is the block demodulator's baseband cut, sync search and correlations; the slot transform is its FFT per pass):

| | Spectrogram | Slot transform | Search | Refinement | Demodulator | LDPC and OSD | Subtraction | Slot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Preset, before | 4.47 | 2.27 | 8.28 | 7.31 | 0.67 | 14.98 | 15.93 | 54.5 |
| Preset, after | 4.25 | 2.31 | 1.09 | 3.93 | 0.90 | 6.63 | 18.83 | 38.4 |
| Early pass, before | 3.80 | 2.33 | 7.06 | 8.82 | 0.75 | 16.93 | 14.74 | 54.8 |
| Early pass, after | 3.56 | 2.39 | 0.91 | 4.98 | 1.02 | 7.75 | 14.54 | 35.6 |
| Three stages, before | 32.20 | 4.47 | 63.73 | 23.63 | 5.30 | 224.83 | 16.51 | 371.8 |
| Three stages, after | 27.76 | 4.02 | 8.90 | 15.40 | 5.29 | 59.46 | 14.24 | 136.1 |

Subtraction's means here move by up to 15 % between runs of the same code; the A/B in the table of commits measures its change. FT4 on `ft4-sweep` (154 slots): preset p50 11.2 to 7.7 ms, early pass 12.3 to 8.6 ms, three stages 181.8 to 71.7 ms. `crowded` (80 slots): three stages p50 252.9 to 103.9 ms.

### Time per slot, browser workers

`tools/wasm-cost/ab.mjs`, as above: wasm-pack release builds of origin/main's decoder (with this branch's stage clock and partial sessions), of the rebased five commits alone, and of dee19cd, decoding in turn for every slot and run in dedicated workers; each slot's fastest of 2 runs (3 for FT4); VM load 7 to 25. The decodes per stage are equal in every build: 5329, 122 and 108 on the recordings. Before is origin/main, after is dee19cd; 3ea27b7 (OSD's integer keys) came after these runs and takes a further 7 to 9 % off the LDPC and OSD stage in the browsers.

410 recorded slots, p50, p95, max:

| | Chromium before | Chromium after | WebKit before | WebKit after |
| --- | --- | --- | --- | --- |
| Preset alone | 49.4, 181.2, 268.3 ms | 20.2, 89.1, 112.0 ms | 61, 226, 356 ms | 32, 124, 248 ms |
| Early pass (first 13.5 s) | 47.8, 178.5, 318.6 ms | 21.4, 91.5, 173.6 ms | 58, 196, 316 ms | 33, 125, 186 ms |
| Three stages: stage 1 ends | 49.4, 189.5, 248.7 ms | 20.1, 88.4, 116.5 ms | 63, 223, 364 ms | 31, 121, 212 ms |
| Stage 2 ends | 119.3, 346.2, 476.8 ms | 44.0, 154.4, 209.6 ms | 141, 411, 698 ms | 66, 205, 335 ms |
| Stage 3 ends | 402.1, 1054.8, 1673.3 ms | 141.7, 388.3, 610.3 ms | 469, 1230, 2238 ms | 186, 485, 762 ms |

Mean per pipeline stage, ms per slot, three-stage plan, WebKit (Chromium in brackets):

| | Spectrogram and slot transform | Search | Block refinement | Demodulator (block LLRs) | LDPC and OSD | Subtraction | Slot |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Before | 68.3 (46.6) | 110.1 (129.2) | 44.9 (32.5) | 25.5 (18.8) | 301.5 (247.0) | 30.4 (25.1) | 584.5 (501.2) |
| Rebased five commits | 55.1 (36.6) | 14.1 (10.5) | 42.4 (31.4) | 24.0 (18.5) | 101.8 (79.7) | 29.8 (24.9) | 270.3 (203.4) |
| After | 54.7 (36.9) | 13.9 (10.8) | 30.4 (22.3) | 12.0 (8.9) | 101.5 (80.4) | 17.8 (12.8) | 233.4 (174.0) |

The preset alone takes about half of its time before (WebKit p50 61 to 32 ms, Chromium 49 to 20 ms) and the three stages end 2.5 times sooner in WebKit and 2.8 times in Chromium at the median, 2.5 and 2.7 times at the 95th percentile. FT4 on `ft4-sweep` (154 slots), WebKit: preset p50 15 to 8 ms, early pass (first 6 s) 14 to 9 ms, three stages 207 to 81 ms (p95 296 to 124 ms).

### Estimate for an iPhone, block soft bit preset

Not tested on a device. The WebKit times after, multiplied by 1.1 (A18 Pro) to 2.2 (A13), the factors of experiments 0001 and 0002:

| WebKit p50, p95, max on the M4 | A18 Pro | A13 |
| --- | --- | --- |
| Preset alone: 32, 124, 248 ms | 35, 136, 273 ms | 70, 273, 546 ms |
| Early pass: 33, 125, 186 ms | 36, 138, 205 ms | 73, 275, 409 ms |
| Three stages end: 186, 485, 762 ms | 205, 534, 838 ms | 409, 1067, 1676 ms |

Before, the A13 estimate for the three stages was 1032, 2706 and 4924 ms: the 2 s budget would have stopped stage 3 on 45 of the 410 recorded slots (2 on an A18 Pro). After, none.

### Where the time goes now

Share of the decoder's self time, V8 CPU profiles in Node 24 of the final build without wasm-opt, the 60 public files, I/O left out:

| Part | Preset alone | Three stages |
| --- | --- | --- |
| Subtraction (model, removal, refinement) | 35 % | 11 % |
| Block demodulator (sync search, correlations, LLRs) | 17 % | 13 % |
| Belief propagation | 15 % | 22 % |
| OSD | 11 % | 29 % |
| FFT (slot transforms, baseband cuts, spectrogram) | 11 % | 12 % |
| Spectrogram frames and logarithm | 4 % | 6 % |
| Costas search | 2 % | 5 % |

The model of each subtracted signal, whose phase and two rotation chains run sample by sample in f64, is now the largest single function in the preset (14 %). In the three stages, OSD's sort of its candidate list by distance took 5 %; 3ea27b7 sorts packed integer keys in its place, the same order, and takes 7 to 9 % off the LDPC and OSD stage in the browsers.

### Parallelism on the new preset

`tools/wasm-cost/split.mjs` with the final build, the three-stage plan, the 410 recorded slots, each slot's fastest of 3 runs per layout, the layouts alternating, VM load 4 to 16. One worker against two workers that each decode one side of 1600 Hz with 60 Hz of overlap:

| p50, p95, max | One worker | Two workers, band split | Ratio at p50, p95 |
| --- | --- | --- | --- |
| WebKit, stage 1 ends | 21, 84, 137 ms | 16, 67, 119 ms | 1.31, 1.25 |
| WebKit, stage 3 ends | 134, 358, 523 ms | 118, 292, 463 ms | 1.14, 1.23 |
| Chromium, stage 1 ends | 19, 104, 190 ms | 14, 77, 146 ms | 1.36, 1.35 |
| Chromium, stage 3 ends | 115, 401, 819 ms | 107, 345, 721 ms | 1.07, 1.16 |

The split decodes 65 messages one worker does not and loses 36 (WebKit; Chromium 64 and 36), by slot and text, of 5523 in both; 201 messages came from both workers. Each worker's WebAssembly memory peaks at 20.4 MiB with the whole band and 16.1 MiB with the upper half.

The split gains far less than the 1.4 to 1.7 times expected, for two reasons. Each worker still transforms the whole slot: every spectrogram frame's FFT and, per pass, the block demodulator's transform of the whole slot (196 608 samples). And each half keeps its own candidate list of up to 140 (stages 1 and 2) or 400 (stage 3) candidates, so where the list is full, as in stage 3 on busy and noisy slots, the two workers together try up to twice as many candidates as one: the extra work is what finds the 65 extra messages.

#### Candidate split

Decision 0004 plans to split candidates across workers. Each worker would compute the same spectrogram, slot transform and search, try every other candidate, and both would subtract every decode of a pass in the same order so their residuals stay equal, which needs an exchange of decodes after every pass. The duplicate check and callsign learning follow candidate order, so the merge would replay them in that order; done so, the decodes stay identical. Only the candidates' own work splits: the block refinement, the demodulator, LDPC, OSD and validation, after these changes 40 % of the preset's time and 62 % of the three stages' in WebKit (30 % and 59 % natively). That bounds two workers at 1.25 times faster for the preset and 1.45 times for the three stages, before any messaging, and subtraction, the preset's largest part, stays whole in both workers.

#### Recommendation

Keep one decoder worker. After these changes the estimate for the slowest supported iPhone (A13) puts the early pass at 275 ms and the three stages at 1067 ms at the 95th percentile, against windows of 1.5 s and 2 s, and the budget no longer stops stage 3 on any recorded slot. A second worker would add 16 to 20 MiB of WebAssembly memory, a second module instance, and merging, duplicate removal and shared callsigns in the app, for 1.1 to 1.35 times (band split, measured) or at most 1.25 to 1.45 times (candidate split, bound). The block soft bits made the preset about 1.6 times slower; with these changes it runs about as fast as 0.21.8's preset did (WebKit p50 32 ms against 30 ms, in runs at different loads), and the three stages end sooner (186 against 302 ms). More exact kernel work remains the cheaper way to speed the decoder up. If a later decoder change does need a second worker, split candidates in the later stages with an ordered merge after each pass: it keeps decodes identical and divides the per-candidate work that the block demodulator and OSD dominate. Splitting the band duplicates the slot transforms and doubles the candidate lists.

#### Timeline

A second worker that runs the later stages while the first takes the next slot gains nothing at the 2 s budget: in FT8 the later stages end at the latest 2 s after the slot, and the next work, the next slot's early pass, starts 13.5 s after it; in FT4, 2 s against 6 s.

#### Step length

`DecodeSession::step` bounds the work between yields of the app's worker, which steps stages 2 and 3 in slices of 40 ms. The longest step of work on the 60 public files, each slot's shortest maximum over 3 runs (runs under load add preemption: single runs gave 30 to 170 ms in either build): before 13bcebb 7.0 ms in WebKit and 7.3 ms in Chromium, after it 4.0 and 4.3 ms, with no change in time per slot. On an A13 that is about 9 ms. Single runs at load 20 to 24 reached 59 to 172 ms in WebKit with either build while no slot's shortest run exceeded 7.3 ms, so steps that long, such as the 109 ms seen during the block soft bit integration, are the worker waiting for a CPU. origin/main's step lengths were not measured this way.

## Expected and measured

| Measure | Expected | Measured |
| --- | --- | --- |
| Decodes, all sets and plans | identical | identical: every commit against its parent on 7410 FT8, 900 FT4 and 760 a priori slots, plus `baseline` and `wspr` after the rebase |
| Spectrogram time | 2 to 3 times faster | 1.2 times: the FFT and the logarithm stay |
| Search time | 3 to 6 times faster | 8.7 times natively, 8 to 12 times in the browsers |
| Belief propagation time | 1.3 to 2 times faster | about 1.9 times natively (from the profile shares) |
| OSD time | 2 to 4 times faster | about 5 times natively (from the profile shares) |
| Three-stage plan, native p50 | about 120 ms (242 ms in decision 0007) | 377.8 to 129.7 ms on 0.21.8 and 297.2 to 98.7 ms on 0.22.2, both under load 4 to 55 |
| Preset and early pass, native p50 | about 12 ms (21 ms) | 42.4 to 20.2 and 46.9 to 20.5 ms on 0.21.8; 29.0 to 20.2 and 32.1 to 20.0 ms on 0.22.2 |
| Ratio of WebAssembly to native time | unchanged or lower | unchanged: WebKit runs these loops at about native speed on the M4 |
| Second worker for the later stages | no gain at the 2 s budget | no gain: the timeline leaves no overlap |
| Band split, preset stage | 1.4 to 1.7 times shorter in WebKit, a few decodes moved, about 10 MB | 1.31 times at p50 (stage 1) and 1.14 times for the three stages; 65 gained and 36 lost of 5523; 16 to 20 MiB per worker |
| Time spent mostly in candidate stages (stage 3) and spectrogram and search (preset) | as stated | stage 3 as expected; in the preset subtraction took most of the time, then the candidates |

## Decision

- Keep the ten decoder and session commits: d395219 (OSD), d5e0e7b and bbf3a8d (belief propagation), 160655d (search), 5eb3c01 (spectrogram), d9a3bdc (block demodulator), 13bcebb (steps), dee19cd (subtraction), 3ea27b7 (OSD candidate keys). Each decodes identically to its parent on every set above, so the CI gates and their baselines stand.
- Keep one decoder worker (Recommendation above). Decision 0004's candidate split stays the plan if a second worker is ever needed.
- Next exact targets: the subtraction model's serial chains (14 % of the preset in WebAssembly), the block demodulator's per-candidate twiddles (about 320 sine and cosine pairs per candidate), and belief propagation's gathers. The spectrogram's logarithm and rustfft's transposes (about 15 % of the three stages) need a change of values and the decoder gate.

## Open risks

- Not tested on a device. The iPhone figures scale the M4's WebKit worker by single-core benchmark ratios; Playwright's WebKit on Linux is not Safari on iOS, and the iPhone's JIT, memory and thermal limits may differ.
- Every timing ran on a shared host, with the Docker VM's load average between 4 and 55. Builds alternated within each run, and in the browsers within each slot, so ratios carry little load bias, but absolute times run 1.2 to 1.5 times above a quiet host's.
- Subtraction now keeps the model and products of a whole signal: 4.9 MB more WebAssembly memory per worker in FT8 (20.4 MiB at peak with the three stages).
- The search and spectrogram changes touch code that experiment 0010's branch also changes (`search.rs`); its rebase will conflict there.
