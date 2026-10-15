# Decoder bench

`rr73-bench` measures decoder presets against the corpus (`docs/corpus.md`). It writes synthetic slots with exact truth, decodes every slot with a named preset and scores the decodes. It also compares two runs and gates CI on regressions. All commands run in the `rust` container from the repository root.

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
| `noise-ci` | `noise-ci` | 200 | Noise only. |
| `noise` | `noise` | `--noise-count`, default 1000 | Noise only. |
| `snr-sweep` | `snr-sweep/awgn`, `snr-sweep/fading` | 21 x `--per-step` each, default 40 | One signal per slot at -28 to -8 dB in 1 dB steps; `fading` adds Watterson fading at 0.5 Hz spread and 1 ms delay (ITU-R F.1487 moderate). |
| `crowded` | `crowded/n10`, `n20`, `n40`, `n20-overlap` | `--crowded-count` each, default 20 | 10, 20 or 40 signals per slot, SNR uniform in -18 to 0 dB, base tones at least 60 Hz apart; `n20-overlap` places 20 signals at uniform random frequencies. |
| `wspr-smoke` | `wspr-smoke` | 25 | WSPR: 12 steady type 1 signals from -26 to -15 dB, types 2 and 3 at -20 dB, 4 drifting at ±0.01 and ±0.03 Hz/s, 2 with slow fading (0.1 Hz spread, 1 ms), 2 windows of 15 signals (-26 to -10 dB, 10 Hz apart), 2 noise-only. |
| `wspr-noise` | `wspr-noise` | `--noise-count`, default 1000 | WSPR noise only (120 s slots). |
| `wspr-snr-sweep` | `wspr-snr-sweep/awgn`, `wspr-snr-sweep/fading` | 15 x `--per-step` each, default 40 | One type 1 WSPR signal per slot at -34 to -20 dB in 1 dB steps; `fading` adds Watterson fading at 0.1 Hz spread and 1 ms delay. |
| `wspr-band` | `wspr-band` | `--crowded-count`, default 20 | 20 WSPR signals per slot, SNR uniform in -28 to -10 dB, centres at least 8 Hz apart, drift uniform in ±0.01 Hz/s. |
| `late-start` | `late-start/<mode>-<how>-<late s>`, such as `late-start/ft8-cut-3.000` | 8 x `--per-step` each, default 40 | One steady signal per slot started late: FT8 0 to 6 s at -22 to -8 dB, FT4 0 to 2.5 s at -20 to -6 dB, in 2 dB steps, DT 0 before the delay. `shift` sends the whole message late, cut at the end of the slot; `cut` keeps it on time and leaves out its first part; `replace` and `splice` are `shift` and `cut` after a CQ at the same frequency for the first part, as when a reply replaces our CQ on air. 4 x 12 subsets for FT8 and 4 x 11 for FT4: 18400 slots and about 4.8 GB at `--per-step 25`. |
| `ft4-sweep` | `ft4-sweep/awgn`, `ft4-sweep/fading`, `ft4-sweep/crowded`, `ft4-sweep/noise` | 19 x `--per-step` each, default 40; `--crowded-count` crowded slots; `--noise-count` noise slots | FT4 alone: one message per slot at -24 to -6 dB in AWGN, and with Watterson fading at 0.5 Hz spread and 2 ms delay; 10 signals per crowded slot at -16 to 0 dB, base tones at least 100 Hz apart; FT4 noise slots. Experiment 0006. |
| `ap-sweep` | `ap-sweep/qso`, `ap-sweep/callers`, `ap-sweep/noise` | 13 x `--per-step` each, default 40; `--noise-count` noise slots | Messages to 9V1NE at -30 to -18 dB in AWGN: from K1ABC ending in a report, an R-report, RRR, RR73 and 73 (`qso`), and from other stations with a grid (`callers`); noise slots. Each slot's source carries the QSO context (`ap`: 9V1NE, K1ABC, K1ABC's frequency in `qso`, none for `callers`, one drawn from the seed for `noise`), which `run` gives the decoder; `--ap-my`, `--ap-dx` and `--ap-dx-hz` give one context to every slot instead. Decision 0009. |

Signals are random standard QSO messages (CQ with a grid, call pairs with a grid, report, R-report, RRR, RR73, 73) at a base tone uniform in 300 to 2700 Hz and DT uniform in -0.5 to 0.5 s. WSPR signals are random type 1 messages (standard callsign, 4-character locator, one of the 19 power levels) with the centre uniform in 1405 to 1595 Hz and DT uniform in -1 to 2 s; their truth gives the centre frequency and DT from 1 s into the slot. SNR is the WSJT-X convention: signal power over the noise power in 2500 Hz. Noise is white Gaussian with 0.02 RMS per sample; a slot whose peak would pass 0.98 is scaled down as a whole. Fading SNR is the average over the fading process.

## Running

`rr73-bench run --preset <name> [--set key=value ...] [--then STAGE ...] [--threads N] [--reference KEY] [--audio-s SECONDS [--audio-fill absent|zero]] [--silent-s START:END ...] [--out FILE] <paths>...`

- Finds every slot under the paths, decodes them in parallel (one decoder context per thread, callsign hashes cleared before each slot), and scores each slot.
- `--set` overrides a preset value by dotted key: `--set ldpc.max_iterations=50`, `--set ldpc.kind=min-sum`. `rr73-bench presets baseline` prints every key.
- `--threads 1` gives single-thread timing. The default uses every CPU.
- `--then "<preset> key=value ..."` adds a later stage that runs on the residual after the preset (and after earlier `--then` stages) and keeps only new decodes; repeat it for more stages. Each decode records its `stage` (0 for the preset), each slot its `stage_s` times, and the run prints decodes, matches and time per stage. Every slot records `step_max_s` and `step_max_by_kind`, the longest single step of the session.
- `--audio-s 11.8` decodes only the first 11.8 s of each slot (early decoding). With `--audio-fill absent` (the default) the audio ends there and the decoder treats the slot as partial: cut symbols become erasures. `--audio-fill zero` pads the slot with zeros instead.
- `--silent-s 0:2` sets that span of each slot (seconds from the slot start) to zeros before decoding, as the app writes where no audio arrived: before capture started, or in a hole after an interruption. Repeat it for more spans.
- `--synth <set>` renders a synthetic set in memory and decodes it as `synth` would write it, with the same seeds and 16-bit rounding, so the results match a run over the written files. It saves disk for WSPR sets: a 120 s slot is 2.9 MB, so 1000 noise slots would take 2.9 GB. `--noise-count`, `--per-step` and `--crowded-count` size the sets as for `synth`.
- A WSPR preset (`wspr`, `wspr-deep`) decodes WSPR slots; an FT8 preset decodes FT8 and FT4 slots. A slot of the other family counts as an error.
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
| `audio_s`, `audio_fill` | `--audio-s` and `--audio-fill`, or `null` for whole slots. |
| `silent_s` | The `--silent-s` spans as `[start, end]` pairs, omitted when there are none. |
| `then` | The `--then` stages, omitted when there are none. |
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
| `stages` | Decoder time per stage, in seconds: `spectrogram_s`, `search_s`, `refine_s`, `demod_s`, `ldpc_s`, `validate_s` (CRC, unpack, duplicates, SNR), `subtract_s`, `baseband_s` (the block demodulator's slot transforms), `total_s`. |
| `stats` | Decoder counters: `candidates`, `ldpc_attempts`, `ldpc_converged`, `crc_failures`, `zero_payloads`, `unpack_failures`, `duplicates`. |
| `decodes` | Each decode: `text`, `freq_hz`, `dt_s`, `snr_db`, `pass`, `ldpc_iterations`, `hard_errors`, `score` (sync score, dB), `matched`, and `block` (the block length of the soft bits that decoded it, for the block demodulator). Left out in slim files. WSPR decodes give the signal centre as `freq_hz`, Fano decoder steps as `ldpc_iterations`, data bits that disagree with the re-encoded message as `hard_errors`, the sync score in standard deviations above noise as `score`, and add `drift_hz_per_s`. |
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

`rr73-bench compare a.json b.json [--limit N] [--exact]` prints, per set, recall, matched, false decodes, unmatched real decodes, SNR50 and the median and 90th percentile time per slot for a and b with the change; then time per slot over all slots; then every decode gained (present in b and missing from a) and lost (present in a and missing from b) with its slot path, SNR, frequency, DT and whether it matched an expected entry. Two decodes are the same signal when their text is equal and their frequencies are within 10 Hz. Slim files compare summaries only. Decoder commits carry this output (AGENTS.md). `--exact` adds a check that every decode field (text, frequency, DT, SNR, pass, stage, LDPC iterations, hard errors, sync score, OSD distance, AP kind) and every slot's counters are the same, and lists the slots that differ with their first difference; changes that must not move any decode, such as speed work, carry it (experiment 0009).

## Misses

`rr73-bench misses [--preset NAME] [--set key=value ...] [--then STAGE ...] [--threads N] [--reference KEY] [--out FILE] <paths>` decodes each recorded slot as `run` does, with the session's candidate trace on (`DecodeSession::set_trace`), and classifies every reference decode the run does not match: `hashed` (a callsign the reference resolved from its hash table), `elsewhere` (the same text decoded outside the match tolerance), `unpackable`, `dt-range`, `search` (no candidate within 3.2 Hz and 0.09 s in any stage or pass), `other-text` (a candidate there decoded another message) and `failed` (candidates there, none decoded). For each miss it rebuilds the transmitted codeword from the text and reads the LLRs at every spectrogram position within 5 Hz and 0.25 s; the position with the fewest hard errors is the genie position, where the first stage's belief propagation and OSD are run. This is done on the original audio and on the residual with every decode of the run subtracted, on the preset's grid and on the finest later-stage grid (8 frames per symbol, 4 bins per tone spacing, 2-symbol window), and at the fine grid's genie position refined as `refine.kind=baseband` refines a candidate. It prints the classes against the genie outcome, reference SNR, DT, the nearest other reference decode, genie hard errors and sync score; `--out` writes every miss as JSON. Experiment 0010 has the breakdown.

`rr73-bench subtraction [--preset NAME] [--set key=value ...] [--per-case N] [--threads N]` measures how much of a decoded FT8 signal the subtractor removes. Each slot holds one random message rendered twice with the same seed, alone and in white noise, so the noise is known exactly; the noisy slot is decoded with the configuration (default `subtract-3-osd2`), and that decode is subtracted from the noisy audio with the configuration's subtractor. The depth is the energy of the residual minus the noise over the energy of the signal, in dB. It prints the 10th, 50th and 90th percentile depth over `--per-case` slots (default 40) for steady signals at -10, 0, +10 and +20 dB, moderate and disturbed Watterson fading at +10 dB and a drift of 0.2 Hz/s at +10 dB.

## Other decoders

`rr73-bench import --decodes out.txt --label NAME [--dt-offset S] --out results/NAME.json <paths>` scores another decoder's text output on the same slots and writes a results file for `compare`. The output file holds a line `== <name>` per slot followed by decode lines in the WSJT-X layout (`HHMMSS SNR DT FREQ ~ MESSAGE`, with `+` in place of `~` for FT4), as `jt9` and ft8_lib's `decode_ft8` print them. The name is the slot's path below `corpus/` without extension, a trailing part of it, or the bare stem when no other slot shares it. `--dt-offset` is subtracted from every DT: `decode_ft8` prints the start of symbol 0 plus 0.16 s, which is DT + 0.66 s. Timing fields are zero. `tools/wsjtx/decode_list.py` writes such a file from `jt9 -d 3` in each slot's mode, one `jt9` process per slot, with each slot's times in a file of its own (`tools/wsjtx/README.md`, experiment 0007). `import` scores every decode line, a priori decodes (tagged `aN`) included. With no options `jt9` decodes some CQs from a CQ hypothesis and tags them `a1`; experiment 0007 passes it callsigns that occur in no slot (`--my-call K1ABC --his-call W9XYZ --qso-progress 1`), and with them it prints no `aN` decode on `ft4-sweep` and `snr-sweep`. On `ft4-sweep` and `snr-sweep` the DT `jt9` prints lies within 0.11 s of the truth and its frequency within 5 Hz, so its lists need no offset.

## End-to-end fixture

`rr73-bench loop-fixture [--out web/e2e/fixtures/ft8-loop] [--check-only] [--preset NAME ...] [--step-s 0.05]` writes the audio that the Playwright `decode` project plays as Chromium's fake microphone, then checks it. Chromium loops the file from the moment capture starts, so the offset between the loop and the UTC slots is arbitrary, and on a loaded host it moves by seconds between runs and drifts during a run.

The file is one 15 s FT8 slot at 12 kHz (`<out>.wav`, 360 KB) that loops without a break: `rr73_chansim::render_loop` carries a transmission that runs past the end of the file over to its start. It holds 4 messages, each sent 4 times, consecutive copies 3.75 s and 90 Hz apart, in white noise at the reference level (seed 2026):

| Message | SNR | Copies: base tone and DT from the start of the file |
| --- | --- | --- |
| `CQ 9M2TRX OJ02` | -10 dB | 1022 Hz at 0.1 s, 1112 Hz at 3.85 s, 1202 Hz at 7.6 s, 1292 Hz at 11.35 s |
| `9V1NE JA1KXM PM95` | -12 dB | 1418 Hz at 0.2 s, 1508 Hz at 3.95 s, 1598 Hz at 7.7 s, 1688 Hz at 11.45 s |
| `CQ VK3QRP QF22` | -14 dB | 1846 Hz at 0 s, 1936 Hz at 3.75 s, 2026 Hz at 7.5 s, 2116 Hz at 11.25 s |
| `JH1RRT YB0AZK RR73` | -16 dB | 2210 Hz at 0.1 s, 2300 Hz at 3.85 s, 2390 Hz at 7.6 s, 2480 Hz at 11.35 s |

Copies of a message start every 3.75 s, so whatever the offset, one of them has a DT between -1.62 and 2.5 s in every slot: its 58 data symbols lie inside the slot (only the first or last Costas array, 1.12 s, may be cut) and every preset searches that DT. No two copies share spectrum. The sidecar (`<out>.json`) is an `rr73-slot/1` file whose truth lists all 16 copies with DT measured from the start of the file.

The check decodes the file as a slot starting at every offset `--step-s` apart, with each `--preset` (default `subtract-3-osd2`, the preset the app ships), and exits with status 1 unless every offset gives each message from at least one copy, with frequency within 3 Hz and SNR within 4 dB of that copy (the limits the end-to-end test applies), and no false decodes. The decoder drops repeats of a message within a slot, so each offset gives each message once. `--check-only` checks the committed files without writing them, for use after a decoder change.

On 2026-10-13 (aarch64 container, release 0.6.0), all 1500 offsets 10 ms apart pass for all four presets: worst frequency error 1.88 Hz, worst SNR error 2.16 dB, no false decodes. Regenerating the file on the same machine gives identical bytes. `rr73-bench run` scores the file as one slot that starts at sample 0: it decodes the 4 copies at DT 0 to 0.2 s (matched 4 of 16 expected, recall 0.25) and nothing false; the other 12 copies lie outside the DT search at that offset.

To rebuild the fixture after changing the messages or the layout:

```sh
docker compose run --rm rust rr73-bench loop-fixture
```

## Gate

`rr73-bench gate results.json --baseline bench/baseline.json [--thresholds bench/gate.toml]` exits with status 1 when any check fails, 2 on a usage or file error, and 0 otherwise. For each set present in both files:

| Check | Fails when |
| --- | --- |
| slots | The slot count differs from the baseline or any slot is unreadable. |
| recall | Recall falls more than `max_recall_drop` (absolute) below the baseline. |
| false decodes | False decodes rise more than `max_false_increase` above the baseline. |
| SNR50 | The baseline has a fit and SNR50 rises more than `max_snr50_rise_db`; without a fit now, when recall also fell. |
| time | `max_time_ratio` is above 0 and the median time per slot exceeds the baseline's by that factor. |

Every set in `required_sets` must be in the results. `[default]` holds the limits for all sets and `[sets."<name>"]` overrides them for one set. The results must also come from the same preset and overrides as the recorded file; a `preset` check fails otherwise.

### CI gate

The `bench` job in `.github/workflows/ci.yml` fetches the public files, synthesises `smoke` and `noise-ci`, and gates two presets and the later stages, each against its own recorded file with the thresholds in `bench/gate.toml`:

| Preset | Recorded file | Why CI gates it |
| --- | --- | --- |
| `baseline` | `bench/baseline.json` | The ft8_lib method, kept unchanged as the research reference. It checks the stages every preset shares (spectrogram, search, demodulator, belief propagation, validator) and the bench itself. |
| `subtract-3-osd2` | `bench/subtract-3-osd2.json` | The preset the app ships from 0.4.0. Its numbers are what operators get from the first decodes of a slot. |
| `subtract-3-osd2` with two `--then` stages | `bench/subtract-3-osd2-deep.json` | The later stages the app runs after the preset on FT8 and FT4 slots (`DEEP` in `web/src/lib/decode/worker-client.ts`, decision 0007). FT4 enters the gate through the 6 FT4 slots of `smoke`. The gate requires the same stages; a Vitest test holds `DEEP` to the recorded file. |

A priori decoding (decision 0009) has a gate of its own: `subtract-3-osd2` on `ap-sweep` with `--per-step 10 --noise-count 300`, rendered in memory, against `bench/subtract-3-osd2-ap.json` with the thresholds in `bench/gate-ap.toml`. To record it again:

```sh
docker compose run --rm -e RR73_GIT_SHA=$(git rev-parse --short=12 HEAD) rust rr73-bench run \
  --preset subtract-3-osd2 --synth ap-sweep --per-step 10 --noise-count 300 --out results/ci-ap.json
docker compose run --rm rust rr73-bench slim results/ci-ap.json --out bench/subtract-3-osd2-ap.json
```

The early pass (experiment 0006) has two gates: `subtract-3-osd2 --audio-s 13.5` on the CI sets against `bench/subtract-3-osd2-early.json` with `bench/gate.toml`, and `subtract-3-osd2 --audio-s 6` on `ft4-sweep` with `--per-step 5 --crowded-count 5 --noise-count 300`, rendered in memory, against `bench/subtract-3-osd2-ft4-early.json` with `bench/gate-ft4.toml`. The preset check includes the cut, so a whole-slot run fails against them. To record them again:

```sh
docker compose run --rm -e RR73_GIT_SHA=$(git rev-parse --short=12 HEAD) rust rr73-bench run \
  --preset subtract-3-osd2 --audio-s 13.5 --out results/ci-early.json corpus/public corpus/synthetic/smoke corpus/synthetic/noise-ci
docker compose run --rm rust rr73-bench slim results/ci-early.json --out bench/subtract-3-osd2-early.json
docker compose run --rm -e RR73_GIT_SHA=$(git rev-parse --short=12 HEAD) rust rr73-bench run \
  --preset subtract-3-osd2 --audio-s 6 --synth ft4-sweep --per-step 5 --crowded-count 5 --noise-count 300 --out results/ci-ft4-early.json
docker compose run --rm rust rr73-bench slim results/ci-ft4-early.json --out bench/subtract-3-osd2-ft4-early.json
```

A further gate covers WSPR: the `wspr` preset on `wspr-smoke` (25 slots, 51 signals) and 50 `wspr-noise` slots, rendered in memory with `--synth`, against `bench/wspr.json` with the thresholds in `bench/gate-wspr.toml`. To record it again:

```sh
docker compose run --rm -e RR73_GIT_SHA=$(git rev-parse --short=12 HEAD) rust rr73-bench run \
  --preset wspr --synth wspr-smoke --synth wspr-noise --noise-count 50 --out results/ci-wspr.json
docker compose run --rm rust rr73-bench slim results/ci-wspr.json --out bench/wspr.json
```

`subtract-3`, shipped in 0.3.0, is no longer gated: `subtract-3-osd2` runs all of its code (subtraction, refinement, passes) and only adds OSD, so a regression in `subtract-3` shows in the shipped preset's gate, and a third run would add CI time without a check of its own.

The shipped preset's steps run even when the `baseline` gate fails, so one CI run reports both. On the CI sets (290 slots) the decodes take 0.7 s (`baseline`) and 3.2 s (`subtract-3-osd2`) on 4 threads of the dev machine (Apple M4); the x86_64 runner took 1.3 s and 3.0 s for `baseline` and `subtract-3` in the last CI run, and `subtract-3-osd2` is expected near 5 s there. The release build dominates the job.

Each recorded file is a slim results file (summaries and per-slot counts) of its preset on the CI sets. To record a new one after an intended change, run the CI sets only (the shared corpus may hold other synthetic sets), slim the results and commit the file with the numbers:

```sh
docker compose run --rm rust sh tools/corpus/fetch-ft8lib.sh
docker compose run --rm rust rr73-bench synth --set smoke --set noise-ci
docker compose run --rm -e RR73_GIT_SHA=$(git rev-parse --short=12 HEAD) rust rr73-bench run \
  --preset subtract-3-osd2 --out results/ci-subtract-3-osd2.json corpus/public corpus/synthetic/smoke corpus/synthetic/noise-ci
docker compose run --rm rust rr73-bench slim results/ci-subtract-3-osd2.json --out bench/subtract-3-osd2.json
```

## Decoder presets

`baseline` is the ft8_lib method (`crates/rr73-decode`, `DecoderConfig::baseline`): a spectrogram with 2 frames per symbol and 2 bins per tone spacing (Hann window over 2 symbols, 200 to 3000 Hz), the Costas sync score over 60 time steps (DT -2.3 to 2.5 s for FT8), the 140 best candidates scoring at least 5 dB, max-log LLRs from dB magnitudes scaled to variance 24, 25 iterations of sum-product belief propagation, CRC-14 check and unpack, one pass. `rr73-bench presets baseline` prints it. `spectrogram.time_osr` and `spectrogram.freq_osr` set the grid; the window spans the whole FFT (`freq_osr` symbols) unless `spectrogram.window_symbols` makes it shorter, with zero padding around it.

`subtract-3` is `baseline` with up to 3 passes. After each pass that finds new messages, each new decode is rebuilt with a complex GFSK model matched to `rr73_ft8::synth::gfsk`, its start and frequency are refined from its known tones, its complex amplitude is estimated with a 0.16 s moving average, and the rebuilt signal is subtracted; the next pass decodes the residual. A pass that finds nothing new ends decoding. `docs/experiments/0001-subtraction.md` has the measurements. Overrides: `subtract.smooth_s`, `subtract.refine`, `passes`.

`subtract-3-osd1` and `subtract-3-osd2` are `subtract-3` with ordered-statistics decoding (OSD) when belief propagation fails: order 1 over all 91 information positions, or order 2 over the 40 least reliable ones, with reliabilities from the channel LLRs. An OSD codeword is accepted only with at most 30 hard errors, a reliability-weighted distance of at most 0.07 of the total, an estimated SNR of at least -24 dB (-19 dB in FT4), and a standard message whose callsigns are sent in full and could have been issued (not starting with Q or 0, and starting with 1 only as 1A or 1S). `docs/experiments/0002-osd.md` has the measurements. In a partial slot every erased bit counts as a hard error (`docs/experiments/0003-anytime.md`). Overrides: `ldpc.kind=bp-osd`, `ldpc.osd_order`, `ldpc.osd_window`, `ldpc.osd_source` (`channel` or `bp`), `ldpc.osd_max_hard_errors`, `ldpc.osd_max_distance`, `ldpc.osd_erasures_as_errors`, `validate.osd_messages` (`any`, `standard`, `standard-known`), `validate.osd_min_snr_db`, `validate.osd_ft4_min_snr_db` (none for the FT8 floor).

`demod.kind=block` replaces the spectrogram's single-symbol LLRs with soft bits from noncoherent detection of blocks of symbols (`crates/rr73-decode/src/block.rs`, `docs/experiments/0008-multi-symbol.md`). Each pass transforms the residual once; each candidate's band is cut to a complex baseband of 30 samples per symbol, its start and frequency are refined within one grid step from the coherent power of the sync groups, and every symbol is correlated with every tone. For each block length in `demod.ft8_blocks` (default `[1,2,3]`) or `demod.ft4_blocks` (`[1,2,4]`), in turn, every tone sequence over the block around each data symbol is scored by the magnitude of the sum of its complex amplitudes, a bit's LLR is the best score with the bit set minus the best with it clear, the LLRs are scaled to `demod.llr_variance`, and the LDPC decoder runs; the first set that gives a valid message decodes the candidate. `demod.spectrogram_first=true` tries the spectrogram LLRs first, and `demod.bp_only_blocks` lists block lengths decoded with belief propagation alone, and `demod.block_score=log` scores tone sequences by the log of the magnitude. `demod.ft8_min_sync` and `demod.ft4_min_sync` (default 0, off) skip the block sets, and a priori decoding, for a candidate with fewer sync symbols (of 21 in FT8, 16 in FT4) whose strongest tone at the refined start and frequency is the sent one. A priori decoding uses the first set tried. `subtract-3-osd2` uses blocks of `[1,3]` FT8 and `[1,4]` FT4 symbols with the gate at 5 and 7; `demod.kind=max-log` restores the spectrogram LLRs it used before experiment 0008.

`refine.kind=baseband`, off in every preset, refines each candidate before demodulation (`crates/rr73-decode/src/refine.rs`): one FFT of the pass's audio, the candidate's band cut to a complex baseband of 32 samples per symbol (16 in FT4), the start from the energy of the sync tones, the frequency from correlations coherent over each Costas array, and each symbol's tone levels read with a one-symbol window at that start and frequency. The demodulator reads those levels in place of the spectrogram, and the decode reports the refined frequency and DT. A candidate whose refined position repeats one already tried in the pass is skipped unless `refine.skip_repeats=false`. With `demod.kind=block` the block demodulator starts its own search from the refined start and frequency, and the refined levels feed only the spectrogram LLRs (`demod.kind=max-log`, or `demod.spectrogram_first`). `search.partial_min_score_db`, unset in every preset, sets a sync threshold of its own for candidates whose Costas arrays do not all lie inside the slot: a transmission that starts before the slot, or in FT8 one later than DT 1.9 s. With a search past DT 2.5 s (`search.ft8_dt_max_s`) it removes most of the noise candidates the longer range adds. `docs/experiments/0010-search-refine-subtract.md` has the measurements.

`wspr` is the WSPR decoder (`rr73_decode::wspr`, `WsprConfig::wspr`): one FFT of the 120 s slot cut to a 375 Hz complex baseband around 1500 Hz; a one-symbol spectrogram (0.73 Hz bins, quarter-symbol hop); sync-vector correlation over signal centres 1400 to 1600 Hz, DT -2 to 6 s and drift up to ±4 Hz over the transmission, ranked by the sync sum as a fraction of the power read, keeping up to 60 local maxima at 4 standard deviations or more; refinement of start, frequency and drift from the phase coherence of 5-symbol blocks; soft bits from 7-symbol noncoherent block detection, then from single symbols when that gives no message; the Fano decoder (10000 steps per bit, threshold step 1, bias 0.4); unpack, callsign layout and re-encoding checks; a second pass after subtracting the first pass's decodes from the baseband, with candidates within 4.5 Hz of a decode skipped in its own pass and within 2 Hz and 1 s of a subtracted one. `wspr-deep` allows 120 candidates and 50000 steps per bit. `docs/experiments/0004-wspr.md` has the measurements. Overrides: `search.*` (`search.guard_hz` for the skip distance), `refine.kind` (`none`, `grid`, `coherent`), `refine.block`, `demod.kind` (`noncoherent`, `block`), `demod.blocks` (a JSON list such as `[7,1]`), `demod.llr_scale`, `fano.max_cycles_per_bit`, `fano.delta`, `fano.bias`, `validate.max_hard_errors`, `validate.min_snr_db`, `passes`.

The decoder reports for each decode the base-tone frequency, DT from the nominal start (0.5 s into the slot), SNR in 2500 Hz, pass, LDPC iterations, hard errors (code bits changed from the channel decision) and the sync score. SNR compares the mean power of the transmitted-tone cells with the 20th percentile of the cells around the transmission's footprint, converted to a mean and to 2500 Hz from the window's noise bandwidth. Both leave out spectrogram frames whose window overlaps digital silence: a run of at least 32 zero samples, as the app writes where no audio arrived (`crates/rr73-decode/src/silence.rs`). A slot that audio joined partway through then reports the SNR of the audio it holds. `search.skip_silent_frames` leaves such frames out of the sync score as well, and `demod.skip_silent_frames` erases the symbols in them and leaves them out of the LLR variance; both are off in every preset, and the app's later stages turn the sync option on (`docs/experiments/0003-anytime.md`, `docs/decisions/0007-deeper-ft8-stages.md`).

## Baseline, 2026-10-13

Decoder commit `6d47dd35661e`, preset `baseline`, release build in the `rust` container (Docker Desktop on an aarch64 Mac, 10 CPUs). Other workloads ran on the host throughout (load average about 14, one container using about 4.4 cores), so times vary between runs; the figures below give the spread over 5 runs. Sets as in the tables above, written by `rr73-bench synth` with the default sizes (`--per-step 40`, `--crowded-count 20`, `--noise-count 1000`); regenerating `smoke` and `crowded` at this commit gives bit-identical WAV files.

ft8_lib's own `decode_ft8`, built at 9fec6ca in the same container and scored with `rr73-bench import --dt-offset 0.66`, is the check that the preset reproduces the ft8_lib method. On the public files `compare` lists 6 decodes gained and 4 lost out of about 960; the differences come from ft8_lib's 0.5 dB quantisation of the waterfall and the order of candidates with equal scores.

### Recordings

| Set | Slots | Reference | Matched | Recall | Unmatched | ft8_lib `decode_ft8` |
| --- | --- | --- | --- | --- | --- | --- |
| `public/ft8_lib` | 60 | 1298 (WSJT-X lists shipped with ft8_lib) | 933 | 0.719 | 28 | 932 matched, 27 unmatched |
| `kiwi/sarts-web888/20261012` (40 m) | 26 | 1070 (`jt9 2.7.0-rc3 -8 -d 3`) | 491 | 0.459 | 0 | not run |

### Synthetic sets

| Set | Slots | Signals | Matched | Recall | SNR50 | 10 to 90 % width | False decodes | ft8_lib `decode_ft8` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `snr-sweep/awgn` | 840 | 840 | 454 | 0.540 | -18.85 dB | 1.86 dB | 0 | 456 matched, SNR50 -18.90 dB |
| `snr-sweep/fading` | 840 | 840 | 307 | 0.365 | -15.17 dB | 5.89 dB | 0 | 305 matched, SNR50 -15.12 dB |
| `crowded/n10` | 20 | 200 | 198 | 0.990 | | | 0 | 198 matched |
| `crowded/n20` | 20 | 400 | 398 | 0.995 | | | 0 | 398 matched |
| `crowded/n40` | 20 | 800 | 795 | 0.994 | | | 0 | 794 matched |
| `crowded/n20-overlap` | 20 | 400 | 305 | 0.762 | | | 0 | 304 matched |
| `noise` | 1000 | 0 | | | | | 0 | 0 |
| `noise-ci` | 200 | 0 | | | | | 0 | not run |
| `smoke/ft8` | 24 | 58 | 58 | 1.000 | | | 0 | not run |
| `smoke/ft4` | 6 | 6 | 6 | 1.000 | | | 0 | not run |

Decoded out of 40 per SNR step in `snr-sweep/awgn`: none at -22 dB and below, 1 at -21, 3 at -20, 14 at -19, 36 at -18, all 40 from -17 dB up. In `snr-sweep/fading`: none at -19 dB and below, 5 at -18, 7 at -17, 20 at -16, 25 at -15 and -14, 35 at -13, 36 at -12, 38 at -11, 36 at -10, all 40 at -9 and -8. The crowded sets miss only signals between -18 and -16.6 dB (9 of 1400 outside the overlap set), so their SNR50 fits are extrapolated and left out.

### Time per slot

| Run | Value |
| --- | --- |
| `public/ft8_lib`, 1 thread | median of the per-run p50 9.9 ms (runs from 9.4 to 16.1 ms), p90 11.3 to 25.4 ms |
| `public/ft8_lib`, 10 threads | 60 slots in 0.26 s (median of runs; 0.19 to 0.76 s), about 4.3 ms per slot; per-slot p50 19 to 58 ms under contention |
| Stage means, `public/ft8_lib`, 1 thread, quietest run | spectrogram 2.1 ms, search 2.9 ms, demodulation 0.2 ms, LDPC 4.3 ms, validation and SNR 0.3 ms, total 9.8 ms |
| All 3076 slots, 1 thread | 118 s including reading the files |
| All 3076 slots, 10 threads | 21 s including reading the files |

### SNR estimate

- Against truth on `snr-sweep/awgn` decodes, the mean estimate is within 0.3 dB of the true SNR at every step from -19 to -8 dB.
- Against `jt9 2.7.0-rc3 -d 3` on the SARTS slots (491 shared decodes): median difference -0.7 dB, mean -1.8 dB, 10th to 90th percentile -9.6 to +4.2 dB.
- Against the lists shipped with ft8_lib the estimate reads 6 to 11 dB higher (median per file group). `jt9 2.7.0-rc3` on `websdr_test11` (the fixture in `tools/wsjtx/tests`) also reads 3 to 7 dB above that file's list, and the estimate is within a median 0.7 dB of jt9 2.7 there (12 shared decodes). The lists come from an older WSJT-X with a different SNR scale; which version is unverified.

### Gate baseline

`bench/baseline.json` holds the CI sets (`public/ft8_lib`, `smoke/ft8`, `smoke/ft4`, `noise-ci`; 290 slots) from the same commit, slimmed. The gate passes against it for the CI run and for the full run above.

## RTTY

`rr73-bench rtty` measures the RTTY decoder (`rr73-rtty`) on continuous transmissions with known text, with minimodem as the reference. Results and the decision are in `docs/experiments/0005-rtty.md`.

```sh
docker compose run --rm rust rr73-bench rtty synth --set awgn --set ccir-good --set ccir-moderate --set ccir-poor --set noise
docker compose run --rm rust rr73-bench rtty run --out results/rtty/rr73.json corpus/rtty/synthetic
docker compose run --rm minimodem decode.sh corpus/rtty/synthetic corpus/rtty/out/minimodem
docker compose run --rm rust rr73-bench rtty import --label minimodem --texts corpus/rtty/out/minimodem \
  --out results/rtty/minimodem.json corpus/rtty/synthetic
docker compose run --rm rust rr73-bench rtty report results/rtty/minimodem.json results/rtty/rr73.json
```

| Set | Directory | Files | Content |
| --- | --- | --- | --- |
| `awgn` | `corpus/rtty/synthetic/awgn` | 17 x `--per-step`, default 3 | -16 to 0 dB in 1 dB steps. |
| `ccir-good` | `ccir-good` | 13 x `--per-step` | -12 to +12 dB in 2 dB steps; Watterson fading at 0.1 Hz spread and 0.5 ms delay (CCIR 520 good). |
| `ccir-moderate` | `ccir-moderate` | 15 x `--per-step` | -12 to +16 dB in 2 dB steps; 0.5 Hz and 1 ms (CCIR 520 moderate). |
| `ccir-poor` | `ccir-poor` | 15 x `--per-step` | -12 to +16 dB in 2 dB steps; 1 Hz and 2 ms (CCIR 520 poor). |
| `noise` | `noise` | `--noise-files`, default 10 | Noise only, `--seconds` long. |

Each file holds `--seconds` (default 60) of keying at 45.45 baud, 170 Hz shift, 1.5 stop bits, mark 1585 Hz and space 1415 Hz, from the `rr73-rtty` encoder, with 1 s of noise before and after. SNR is in 3000 Hz. The sidecar `<stem>.json` (`rr73-rtty/1`) holds the text, the line code, the tones, the channel and the seed. The text mixes callsigns, serial numbers, contest and conversation words in lines of 6 to 10 words, using letters, digits and `- ? : ( ) . , /`, which the ITA2 and US figures tables share. Seeds come from the set name, the SNR and the file number, so the same command writes the same audio.

- `rtty run [--label NAME] [--set key=value ...] [--threads N] --out FILE <paths>` decodes each file with the default `DecoderConfig`, the sidecar's line code and tones, and the overrides (dotted keys, as for `run`; `squelch_db=null` turns the squelch off).
- `tools/minimodem/decode.sh <corpus dir> <out dir> [minimodem options]` runs `minimodem --rx -q -f <file> -M <mark> -S <space> [options] rtty` on every file and writes `<set>/<stem>.txt` and `<set>/<stem>.time` (CPU seconds, user plus system). `RR73_JOBS` sets the files decoded at once. `rtty import` scores the texts.
- CER is the edit distance between the text sent and the text received over the characters sent, after CR LF becomes LF and control characters are dropped. Characters printed from the noise around a transmission count as insertions. `rtty report` interpolates the SNR for 1 % and 10 % CER in log CER between the steps either side of the last crossing, counts characters printed per minute of the `noise` set and divides decoding CPU time by audio time. For timing, run with `--threads 1` and `RR73_JOBS=1`.

The cost of the WebAssembly exports in browsers comes from `tools/wasm-cost/rtty.mjs`:

```sh
docker compose run --rm rust wasm-pack build crates/rr73-wasm --release --target web --out-dir ../../target/rtty-pkg
docker compose run --rm node npm --prefix web ci
docker compose run --rm e2e node tools/wasm-cost/rtty.mjs target/rtty-pkg chromium webkit
```
