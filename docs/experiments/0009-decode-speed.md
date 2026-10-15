# Experiment 0009: decoding speed

Status: hypothesis recorded 2026-10-15, before profiling or optimising.

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
