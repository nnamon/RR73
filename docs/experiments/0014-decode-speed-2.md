# Experiment 0014: decoding speed, round 2

Status: accepted 2026-10-23 for five kernels on 0.27.0, whose decoder 0.27.1 keeps; the sixth, the refinement of the subtraction, rejected. Hypothesis recorded 2026-10-23, before the measurements below. The kernels were written on 0.24.2 (2026-10-16) and moved onto 0.27.0 first.

## Question

Experiment 0009 made 0.22.3 decode 2.5 times faster with the same decodes. Since then 0.24.2 added the SNR estimate at the band edge, the search to 3200 Hz and the normalised set of soft bits (experiment 0011), and 0.26 the retries of overlapping candidates and weak FT8 candidates from 4 dB (experiment 0012): the preset costs 14 % more in WebKit at the mean and 22 % more at the 95th percentile than before 0012, and the three stages reach p95 389 ms on the M4. How much of that time can go without changing a single decode?

0009 left three exact targets: the subtraction model's serial f64 chains, about 14 % of the preset in WebAssembly; about 320 sine and cosine pairs per candidate in the block demodulator; and the gathers of belief propagation. A V8 profile on 0.24.2 (below) added OSD, which led the three stages.

## Hypothesis

Six kernels, each decode-identical, take the time per slot down by at least 15 % at the mean for the preset and for the three stages, in WebKit and natively:

| Kernel | Change | Expected |
| --- | --- | --- |
| OSD order-2 search | Each candidate's hard errors, an integer count of 64-bit words, tested before its distance is summed; only candidates within the limit get a distance | Most of OSD's search in the three stages, where about 1 pair in 100 passes the limit on noise |
| OSD elimination | Gauss-Jordan elimination with the rows stored word by word, so clearing a column runs over whole vectors | A part of OSD's remaining time |
| Subtraction, model and removal | The model computed half a window ahead inside the moving sum's loop, so the two latency chains overlap | 20 to 30 % of the subtraction |
| Belief propagation | Each check slot holds a copy of its bit's total in fixed-size arrays, so the messages come from contiguous memory without bounds checks; hard decisions packed from the totals once per iteration | 20 % of belief propagation |
| Block demodulator | Sine and cosine from Taylor polynomials after one reduction, rounded to f32 only where every value within 2^-44 rounds the same way, else the maths library; the per-tone maxima shared between sets of one block length | Most of the block demodulator's time in the maths library |
| Subtraction, refinement | Four blocks summed side by side; the energies of every shift from one function | Half of the refinement |

Any kernel that changes a decode, a decode field or a slot counter on any set below, or that is not faster in WebKit, is dropped.

## Method

The rules of experiment 0009:

- An optimisation may change how values are computed only where every value comes from the same floating-point operations in the same order. Work that cannot change the result may be skipped: a value nobody reads, or a candidate that an integer test rules out.
- One kernel per commit, each with the code it replaces kept as a reference in a unit test that checks the new code bit for bit.
- Each commit decodes identically to its parent: `rr73-bench compare --exact` shows 0 decodes gained, 0 lost and every decode field and slot counter equal on every run of the suite below.

The exactness suite, 9 runs and 41,609 slot decodes per commit, each commit's decodes compared with its parent's and with 0.27.0's:

| Run | Sets | Slots |
| --- | --- | --- |
| Preset | `public/ft8_lib` and every recorded site under `kiwi/` (SARTS on 12 and 13 October and 6 sites in Europe, North America, South America and Australia recorded on 21 and 22 October); the FT8 preset refuses SARTS's 10 WSPR slots | 2068 |
| Three stages | the same | 2068 |
| Preset | the synthetic sets on disk: `crowded`, `noise`, `noise-ci`, `smoke`, `snr-sweep` | 6990 |
| Three stages | the same | 6990 |
| Preset | `late-start`, `band-edge`, `ft4-sweep`, `ap-sweep` and `overlap` in memory, 10 per step, 10 crowded, 300 noise slots | 10130 |
| Three stages | the same | 10130 |
| Early pass (first 13.5 s), three stages | the recordings, `crowded`, `smoke`, `noise-ci` | 2378 |
| Early pass (first 6 s), three stages | `ft4-sweep`, 10 per step, 10 crowded, 300 noise slots | 690 |
| `wspr` preset | `wspr-smoke`, 50 `wspr-noise`, `wspr-snr-sweep` at 3 per step | 165 |

Those 10 WSPR slots decode with the `wspr` preset as a tenth run. "Three stages" is the app's plan (`DEEP` in `web/src/lib/decode/worker-client.ts`, decision 0007).

Time, on the 410 FT8 slots of `public/ft8_lib` and SARTS:

- Native: `rr73-bench run --threads 1` in the `rust` container on the Apple M4 (10 CPUs), the three stages with each stage's time, so stage 1 gives the preset. The 7 builds (0.27.0 and each commit) take turns per directory (60, 146 and 214 slots), in a rotated order in each of 3 rounds; each slot's fastest of the 3.
- WebKit: `tools/wasm-cost/ab.mjs` in the `e2e` container, wasm-pack release builds of the 7 builds decoding each slot in turn in dedicated module workers of Playwright's WebKit 26.6, stepped as the app's worker steps the later stages, each slot's fastest of 3 runs. A copy of the script outside the repository also hashes each slot's decodes (every field the worker returns) and serves the page cross-origin isolated, for timers at 20 µs.
- A13: the WebKit times multiplied by 2.2, the factor of experiments 0001, 0002 and 0009. Not tested on a device.

Experiment 0013 ran on the same host throughout, and other workloads held the Docker VM's 1-minute load average at 2.5 to 24.9 during the native timing runs and 2.6 to 13.8 during the browser runs. The builds take turns within each slot in WebKit and within each directory natively, so load drift falls on all of them alike.

## Exactness

Every commit decodes identically to its parent and to 0.27.0 on all 9 runs of the suite: 0 decodes gained, 0 lost, and 0 slots that differ in any decode field or counter. Per commit, against its parent:

| Run | Slots | Decodes | Slots that differ |
| --- | --- | --- | --- |
| Preset, recordings | 2068 | 49295 | 0 |
| Three stages, recordings | 2068 | 51313 | 0 |
| Preset, synthetic sets | 6990 | 2859 | 0 |
| Three stages, synthetic sets | 6990 | 2884 | 0 |
| Preset, in-memory sets | 10130 | 5434 | 0 |
| Three stages, in-memory sets | 10130 | 5638 | 0 |
| Early pass, three stages | 2378 | 52843 | 0 |
| FT4 early pass, three stages | 690 | 312 | 0 |
| `wspr` | 165 | 123 | 0 |

The 10 recorded WSPR slots give the same 31 decodes in 0.27.0 and the final build.

The suite runs natively. In WebAssembly the one change that could round apart from the native build is the block demodulator's sine and cosine, which match the maths library only because both libraries stay within 2^-44 of the polynomial (`crates/rr73-decode/src/trig.rs`). Each build decoded the 410 timed slots once more, one run per slot, in WebKit and in Chromium, and the decodes of every slot (every field the worker returns, hashed) were equal across all 7 builds in both. In the timed runs below websdr_test3 gives other decodes from one run to the next in every build, 0.27.0's included: the worker keeps its callsign hashes from one session to the next, so its second run resolves a callsign the first could not.

## Time

### Natively

Single-threaded, ms per slot, each slot's fastest of 3 runs, 410 slots:

| Build | Preset mean | p50 | p95 | max | Three stages mean | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.27.0 | 47.4 | 26.7 | 121.9 | 234.1 | 191.9 | 134.3 | 418.7 | 761.4 |
| OSD search | 42.9 | 23.0 | 108.5 | 156.2 | 158.6 | 112.0 | 344.7 | 538.2 |
| OSD elimination | 46.9 | 25.2 | 118.3 | 182.8 | 183.0 | 131.3 | 384.6 | 629.5 |
| Subtraction | 41.9 | 23.7 | 108.0 | 164.2 | 175.9 | 126.8 | 382.4 | 609.1 |
| Belief propagation | 37.7 | 21.0 | 93.0 | 151.6 | 143.1 | 103.0 | 305.4 | 498.0 |
| Block demodulator (final) | 36.5 | 20.3 | 88.7 | 131.6 | 140.0 | 105.0 | 292.0 | 460.9 |
| Refinement (rejected) | 35.2 | 20.1 | 84.6 | 134.3 | 137.7 | 102.1 | 286.4 | 486.3 |

Mean of each pipeline stage through the three stages, ms per slot, every run:

| Build | Spectrogram | Demodulation | LDPC and OSD | Subtraction | Total |
| --- | --- | --- | --- | --- | --- |
| 0.27.0 | 43.0 | 9.4 | 88.3 | 21.0 | 207.4 |
| OSD search | 42.2 | 9.4 | 56.0 | 18.4 | 170.8 |
| OSD elimination | 56.9 | 16.0 | 53.9 | 19.6 | 193.4 |
| Subtraction | 58.7 | 16.2 | 54.7 | 15.0 | 192.3 |
| Belief propagation | 43.5 | 9.6 | 46.2 | 16.0 | 161.1 |
| Block demodulator (final) | 42.3 | 7.5 | 45.8 | 15.5 | 152.8 |
| Refinement (rejected) | 42.9 | 7.5 | 45.3 | 13.4 | 150.9 |

The builds of the OSD elimination and subtraction commits run the spectrogram and the demodulator 14 and 7 ms slower, code those commits do not touch; the next build is back at 0.27.0's times. That is the native code layout of those two builds. Their own stages are faster: LDPC and OSD 2.1 ms with the elimination, subtraction 4.6 ms with the fused model.

On the 1648 slots of the 6 sites recorded on 21 and 22 October, 0.27.0 against the final build, as above: the preset 65.7 to 49.0 ms at the mean (p95 110.2 to 79.5 ms) and the three stages 238.1 to 161.4 ms (p95 444.7 to 278.7 ms, max 669.0 to 405.9 ms), 25 % and 32 % less, at load 2.5 to 5.2.

### WebKit

ms per slot in a WebKit 26.6 worker, each slot's fastest of 3 runs, 410 slots:

| Build | Preset mean | p50 | p95 | max | Three stages mean | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.27.0 | 40.7 | 20.9 | 108.6 | 157.6 | 176.7 | 126.1 | 401.6 | 592.1 |
| OSD search | 38.1 | 20.5 | 99.7 | 127.3 | 149.4 | 108.0 | 330.5 | 476.5 |
| OSD elimination | 38.2 | 20.2 | 100.2 | 143.2 | 147.8 | 108.5 | 325.6 | 468.5 |
| Subtraction | 36.2 | 20.4 | 94.6 | 119.9 | 145.3 | 107.8 | 314.2 | 460.5 |
| Belief propagation | 34.5 | 19.0 | 88.5 | 118.1 | 136.7 | 101.3 | 291.7 | 425.9 |
| Block demodulator (final) | 33.3 | 18.7 | 85.0 | 121.2 | 129.6 | 96.4 | 269.8 | 392.7 |
| Refinement (rejected) | 32.9 | 19.0 | 83.2 | 98.7 | 129.8 | 96.0 | 265.9 | 392.5 |

Mean of each pipeline stage through the three stages in WebKit, ms per slot:

| Build | Spectrogram | Refinement in the demodulator | Demodulation | LDPC and OSD | Subtraction | Total |
| --- | --- | --- | --- | --- | --- | --- |
| 0.27.0 | 31.7 | 21.3 | 11.5 | 76.3 | 13.7 | 174.7 |
| OSD search | 31.4 | 20.6 | 11.5 | 50.4 | 13.3 | 147.5 |
| OSD elimination | 31.5 | 20.8 | 11.4 | 48.0 | 13.7 | 145.9 |
| Subtraction | 31.5 | 20.8 | 11.4 | 47.8 | 11.4 | 143.4 |
| Belief propagation | 31.2 | 20.9 | 11.5 | 40.0 | 11.4 | 134.8 |
| Block demodulator (final) | 31.1 | 20.0 | 9.0 | 39.5 | 11.4 | 127.8 |
| Refinement (rejected) | 31.1 | 20.1 | 9.2 | 39.7 | 11.0 | 128.0 |

### WebKit worker instances

Two workers of the same build can run at different speeds for a whole session. A run of 137 slots (every third of the 410) with two workers per build, 14 workers in turn per slot, each slot's fastest of 3 runs, VM load 2.6 to 8:

- 6 of the 14 workers ran every stage 20 to 60 % slower than the others: spectrogram 35.5 against 29.0 ms, search 15.8 against 9.7 ms, LDPC and OSD 55 against 38 ms for the same build. Both workers of the belief propagation build were slow; at least one worker of every other build was fast.
- Workers of the refinement build ran the subtraction at 17.7 to 18.5 ms in 3 of 6 sessions over 4 runs (the 410-slot run above, this run, a run of that build against its parent on the 410 slots, and a run with two workers of each of the two builds on the 137 slots), against 10.3 to 11.1 ms in the other 3, with every other stage at its usual time. No worker of any other build showed that, and the parent's 6 sessions ran the subtraction at 10.5 to 12.0 ms.

The first kind falls on every build alike. Its cause is unverified: the M4 has performance and efficiency cores, and the VM's threads can run on either. The second comes with the refinement's code in WebKit.

### On an A13

Not tested on a device. The WebKit times of the final build multiplied by 2.2:

| ms | 0.27.0 p50 | p95 | max | Final p50 | p95 | max |
| --- | --- | --- | --- | --- | --- | --- |
| Preset | 46 | 239 | 347 | 41 | 187 | 267 |
| Three stages | 277 | 884 | 1303 | 212 | 594 | 864 |

## Changes

| Commit | Kernel | Effect against the parent, three stages |
| --- | --- | --- |
| 7661e64 | OSD order-2 search: hard errors as an integer test before any distance | LDPC and OSD 88.3 to 56.0 ms natively, 76.3 to 50.4 ms in WebKit |
| e90c5e8 | OSD elimination word by word | LDPC and OSD 56.0 to 53.9 ms natively, 50.4 to 48.0 ms in WebKit |
| c53d97b | Subtraction model fused with the moving sum | Subtraction 19.6 to 15.0 ms natively, 13.7 to 11.4 ms in WebKit |
| 00a5e46 | Belief propagation from contiguous slot totals, hard decisions packed from the totals | LDPC and OSD 54.7 to 46.2 ms natively, 47.8 to 40.0 ms in WebKit |
| cd52fd6 | Block demodulator: polynomial sine and cosine, shared maxima | Demodulation 9.6 to 7.5 ms natively, 11.5 to 9.0 ms in WebKit |

## Rejected

- The refinement of the subtraction (four blocks side by side, the shift energies in one function). Exact, and 2.1 ms faster natively (subtraction 15.5 to 13.4 ms), but in WebKit 0.4 ms faster in a good session and 7 ms slower in half the sessions measured.
- The modulation phase summed in a loop of its own after the fused loop's rotations, in the model and the fused removal (the same additions in the same order). Exact by construction and its unit tests; one subtraction of a decode took 0.66 ms against 0.58 to 0.60 ms with the phase in the loop in WebKit, and 0.665 against 0.585 to 0.605 ms in Chromium, over 4 runs of 60 rounds with the builds alternating.

## Decision

Take the five kernels. Against 0.27.0 the preset takes 18 % less time per slot in WebKit at the mean (40.7 to 33.3 ms) and 22 % less at the 95th percentile, and the three stages 27 % and 33 % less (176.7 to 129.6 ms, p95 401.6 to 269.8 ms); natively 23 % and 27 % less at the mean. The hypothesis held: at least 15 % at the mean for both in both. With the factor of 2.2 the three stages' 95th percentile on an A13 falls from 884 to 594 ms and the slowest of the 410 slots from 1303 to 864 ms, against the 2 s budget.

## Open risks

- Not tested on a device. The A13 figures scale the M4's WebKit times.
- WebKit's speed differs between worker instances by up to 60 % for a whole session. The tables above come from one run in which all 7 builds' workers show the same spectrogram time; the ratios between builds hold within that run, and absolute times in the app depend on the worker the phone gets. Unverified on iOS.
- The sine and cosine rest on glibc and musl keeping their documented error of 1 unit in the last place. The suite covers the native build; WebKit and Chromium cover the 410 timed slots.
- The early passes were checked for exactness and not timed.

## Next

- Why one build's subtraction runs 70 % slower in some WebKit sessions; the refinement kernel may be worth a form WebKit compiles the same way every time.
- OSD still takes 40 ms of the 128 ms of the three stages in WebKit, and the spectrogram 31 ms.
