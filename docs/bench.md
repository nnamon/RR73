# Decoder bench

`rr73-bench` measures decoder configurations against the corpus (`docs/corpus.md`): it writes synthetic slots with exact truth, decodes every slot with a named preset, scores the decodes, compares two runs and gates CI on regressions. All commands run in the `rust` container from the repository root.

```sh
docker compose run --rm rust sh tools/corpus/fetch-ft8lib.sh             # public test files
docker compose run --rm rust rr73-bench synth --set smoke --set noise-ci  # synthetic sets
docker compose run --rm -e RR73_GIT_SHA=$(git rev-parse --short=12 HEAD) \
  rust rr73-bench run --preset baseline corpus/public corpus/synthetic
docker compose run --rm rust rr73-bench compare results/a.json results/b.json
docker compose run --rm rust rr73-bench gate results/ci.json --baseline bench/baseline.json
```

`tools/bin/rr73-bench` builds and runs the release binary, so the first call compiles.

## Corpus sets

A set is the directory of a slot below `corpus/`, such as `public/ft8_lib` or `synthetic/snr-sweep/awgn`. Results are summarised per set.

### Public files

`tools/corpus/fetch-ft8lib.sh` fetches ft8_lib (MIT) at commit `9fec6ca39886edbf96f4f5e71edc76da5074e871`, reads only `test/wav`, and writes `corpus/public/ft8_lib/`. Each WAV that has a WSJT-X decode list next to it in ft8_lib (`<name>.txt`) becomes a slot; its sidecar's `reference.wsjtx` holds that list. The country names WSJT-X appends after the message are dropped. Files in `test/wav/20m_busy/` get the stem prefix `20m_busy_`.

At the pinned commit this gives 60 slots and 1298 reference decodes: 9 slots named `191111_*`, 13 `websdr_test*` and 38 `20m_busy_test_*`. Skipped for lack of a decode list: `websdr_test14` to `websdr_test20` and the `_12k` copies of 14 and 15 (the originals are 6400 Hz).

The decode lists record neither the WSJT-X version nor the decode depth. Some entries hold hashed callsigns WSJT-X had resolved from earlier slots, such as `<9A9A> F6DEO/QRP`; a decoder that sees only this slot prints `<...>` and cannot match them.

### Synthetic sets

`rr73-bench synth --set <name> [--set <name> ...] [--out corpus/synthetic]` renders slots with `rr73-chansim` and writes the exact truth into each sidecar. A set's directory is replaced on each run. Every slot has its own seed (a hash of the set name plus the slot index), so the same command writes the same audio.

| Set | Directory | Slots | Content |
| --- | --- | --- | --- |
| `smoke` | `smoke/ft8` | 24 | FT8: 12 steady signals from -16 to -6 dB, 4 with Watterson fading (-12 to -6 dB), 2 drifting at 0.3 Hz/s (-8 dB), 4 bands of 10 signals (-16 to -2 dB), 2 noise-only. |
| | `smoke/ft4` | 6 | FT4: steady signals from -14 to -4 dB. |
| `noise-ci` | `noise-ci` | 50 | Noise only. |
| `noise` | `noise` | `--noise-count`, default 1000 | Noise only. |
| `snr-sweep` | `snr-sweep/awgn`, `snr-sweep/fading` | 21 x `--per-step` each, default 40 | One signal per slot at -28 to -8 dB in 1 dB steps; `fading` adds Watterson fading at 0.5 Hz spread and 1 ms delay (ITU-R F.1487 moderate). |
| `crowded` | `crowded/n10`, `n20`, `n40`, `n20-overlap` | `--crowded-count` each, default 20 | 10, 20 or 40 signals per slot, SNR uniform in -18 to 0 dB, base tones at least 60 Hz apart; `n20-overlap` places 20 signals at uniform random frequencies. |

Signals are random standard QSO messages (CQ with a grid, call pairs with a grid, report, R-report, RRR, RR73, 73) at a base tone uniform in 300 to 2700 Hz and DT uniform in -0.5 to 0.5 s. SNR is the WSJT-X convention: signal power over the noise power in 2500 Hz. Noise is white Gaussian with 0.02 RMS per sample; a slot whose peak would pass 0.98 is scaled down as a whole. Fading SNR is the average over the fading process.

## Running

`rr73-bench run --preset <name> [--set key=value ...] [--threads N] [--reference KEY] [--out FILE] <paths>...`

- Finds every slot under the paths, decodes them in parallel (one decoder context per thread, callsign hashes cleared before each slot), and scores each slot.
- `--set` overrides a preset value by dotted key: `--set ldpc.max_iterations=50`, `--set ldpc.kind=min-sum`. `rr73-bench presets baseline` prints every key.
- `--threads 1` gives single-thread timing. The default uses every CPU.
- Writes `results/<git-sha>-<preset>.json`; with overrides the name gains `-<hash>` of the override list. `--out` names the file instead.
- The commit comes from `RR73_GIT_SHA` when set, else from `git` (with `-dirty` for uncommitted changes to tracked files), else `unknown`. Inside the container a worktree's git metadata is outside the mount, so pass the variable.

### Scoring

Each slot is scored against its truth (synthetic), nothing (noise-only), or a reference decode list (recordings). With no `--reference`, a slot with one reference uses it, and a slot with several uses `jt9-d3` if present, else the first key in sorted order.

A decode matches an expected entry when the message text is equal after trimming, upper-casing and collapsing spaces, the frequency is within 10 Hz and DT within 0.5 s. Each decode and each entry match at most once; closer pairs (sum of frequency and DT differences, each over its tolerance) are taken first.

### Results format

`rr73-bench-results/1`, pretty JSON:

| Field | Meaning |
| --- | --- |
| `format` | `rr73-bench-results/1`. |
| `created_utc` | When the run finished. |
| `git_sha` | Commit of the decoder, see above. |
| `preset`, `overrides` | The preset and the `key=value` overrides, in order. |
| `config` | The full decoder configuration that ran. |
| `reference_key` | `--reference`, or `null`. |
| `environment` | `os`, `arch`, `cpus`, `threads` used, build `profile`, `bench_version`. |
| `wall_s` | Wall time of the run, including reading files and scoring, in seconds. |
| `slim` | `true` when per-slot lists were removed (`rr73-bench slim`). |
| `sets` | Summary per set, below. |
| `slots` | One record per slot, sorted by path, below. |

Slot record:

| Field | Meaning |
| --- | --- |
| `path`, `set`, `mode` | WAV path as found, set name, `FT8` or `FT4`. |
| `kind` | `synthetic` (truth), `noise` (noise-only) or `real` (reference list). |
| `expected` | Truth or reference entries. |
| `decoded`, `matched`, `unique` | Decodes, entries matched, decodes matching nothing. |
| `time_s` | Wall time of the decode call (excluding file reading and scoring), in seconds. |
| `stages` | Decoder time per stage, in seconds: `spectrogram_s`, `search_s`, `refine_s`, `demod_s`, `ldpc_s`, `validate_s` (CRC, unpack, duplicates, SNR), `subtract_s`, `total_s`. |
| `stats` | Decoder counters: `candidates`, `ldpc_attempts`, `ldpc_converged`, `crc_failures`, `zero_payloads`, `unpack_failures`, `duplicates`. |
| `decodes` | Each decode: `text`, `freq_hz`, `dt_s`, `snr_db`, `pass`, `ldpc_iterations`, `hard_errors`, `score` (sync score, dB), `matched`. Left out in slim files. |
| `entries` | Each expected entry: `text`, `freq_hz`, `dt_s`, `snr_db`, `matched`. Left out in slim files. |
| `error` | Present when the slot could not be read; such a slot counts in `errors` and nowhere else. |

Set summary:

| Field | Meaning |
| --- | --- |
| `slots`, `errors` | Slots in the set and slots that could not be read. |
| `expected`, `decodes`, `matched` | Sums over the set. |
| `recall` | `matched / expected`, or `null` with nothing expected. |
| `false_decodes` | Unmatched decodes on synthetic and noise-only slots. Truth is complete there, so each is a false decode. |
| `unique_real` | Unmatched decodes on recordings: candidates for review, true only if the callsign is valid and the station appears in a neighbouring slot. A higher count can mean a better decoder. |
| `snr50` | Logistic fit of decoded or not against truth SNR over the set's synthetic signals: `snr50_db` (SNR at which half decode), `slope_per_db`, `width_10_90_db`, `signals`, `extrapolated` (true when SNR50 lies outside the SNRs measured). Fitted by maximum likelihood; `null` with fewer than two SNRs or when every signal has the same outcome. |
| `steps` | Signals and decodes per truth SNR (rounded to 0.1 dB), for sets with at least two SNRs. |
| `time` | Decode time per slot in milliseconds: `mean_ms`, `p50_ms`, `p90_ms`, `p99_ms`, `max_ms` (nearest-rank percentiles). |
| `stage_mean_ms` | Mean stage time per slot, in milliseconds. |

## Comparing

`rr73-bench compare a.json b.json [--limit N]` prints, per set, recall, matched, false decodes, unmatched real decodes, SNR50 and the median and 90th percentile time per slot for a and b with the change; then time per slot over all slots; then every decode gained (present in b and missing from a) and lost (present in a and missing from b) with its slot path, SNR, frequency, DT and whether it matched an expected entry. Two decodes are the same signal when their text is equal and their frequencies are within 10 Hz. Slim files compare summaries only. Decoder commits carry this output (AGENTS.md).

## Other decoders

`rr73-bench import --decodes out.txt --label NAME [--dt-offset S] --out results/NAME.json <paths>` scores another decoder's text output on the same slots and writes a results file for `compare`. The output file holds a line `== <stem>` per slot followed by decode lines in the WSJT-X layout (`HHMMSS SNR DT FREQ ~ MESSAGE`), as `jt9` and ft8_lib's `decode_ft8` print them. `--dt-offset` is subtracted from every DT: `decode_ft8` prints the start of symbol 0 plus 0.16 s, which is DT + 0.66 s. Timing fields are zero.

## Gate

`rr73-bench gate results.json --baseline bench/baseline.json [--thresholds bench/gate.toml]` exits with status 1 when any check fails, 2 on a usage or file error, and 0 otherwise. For each set present in both files:

| Check | Fails when |
| --- | --- |
| slots | The slot count differs from the baseline or any slot is unreadable. |
| recall | Recall falls more than `max_recall_drop` (absolute) below the baseline. |
| false decodes | False decodes rise more than `max_false_increase` above the baseline. |
| SNR50 | The baseline has a fit and SNR50 rises more than `max_snr50_rise_db`; without a fit now, when recall also fell. |
| time | `max_time_ratio` is above 0 and the median time per slot exceeds the baseline's by that factor. |

Every set in `required_sets` must be in the results. `[default]` holds the limits for all sets and `[sets."<name>"]` overrides them for one set.

`bench/baseline.json` is a slim results file (summaries and per-slot counts) from the baseline run below. To record a new one after an intended change: run the CI sets, slim the results and commit both the file and the numbers.

```sh
docker compose run --rm rust sh tools/corpus/fetch-ft8lib.sh
docker compose run --rm rust rr73-bench synth --set smoke --set noise-ci
docker compose run --rm -e RR73_GIT_SHA=$(git rev-parse --short=12 HEAD) \
  rust rr73-bench run --preset baseline --out results/ci.json corpus/public corpus/synthetic
docker compose run --rm rust rr73-bench slim results/ci.json --out bench/baseline.json
```

CI (`.github/workflows/ci.yml`) runs the same fetch, synth and run, then the gate.

## Decoder presets

`baseline` is the ft8_lib method (`crates/rr73-decode`, `DecoderConfig::baseline`): a spectrogram with 2 frames per symbol and 2 bins per tone spacing (Hann window over 2 symbols, 200 to 3000 Hz), the Costas sync score over 60 time steps (DT -2.3 to 2.5 s for FT8), the 140 best candidates scoring at least 5 dB, max-log LLRs from dB magnitudes scaled to variance 24, 25 iterations of sum-product belief propagation, CRC-14 check and unpack, one pass. `rr73-bench presets baseline` prints it.

The decoder reports for each decode the base-tone frequency, DT from the nominal start (0.5 s into the slot), SNR in 2500 Hz, pass, LDPC iterations, hard errors (code bits changed from the channel decision) and the sync score. SNR compares the mean power of the transmitted-tone cells with the 20th percentile of the cells around the transmission's footprint, converted to a mean and to 2500 Hz from the window's noise bandwidth.
