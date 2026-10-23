# Experiment 0014: decoding speed, round 2

Status: hypothesis recorded 2026-10-23 on 0.27.0, before the measurements. The kernels were written on 0.24.2 (2026-10-16) and moved onto 0.27.0 first.

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
| Preset | `public/ft8_lib` and every recorded site under `kiwi/` (SARTS on 12 and 13 October and 6 sites recorded on 21 and 22 October: `aprs-kuopio`, `k1vl-vermont`, `va6ok-coronation`, `vinhedo-br`, `vk5arg-tarlee-2`, `wessex-g8jnj`); the FT8 preset refuses SARTS's 10 WSPR slots | 2068 |
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

Experiment 0013 runs on the same host, so each run records the Docker VM's 1-minute load average. The builds take turns within each slot in WebKit and within each directory natively, so load drift falls on all of them alike.
