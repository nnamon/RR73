# WSJT-X reference

The `wsjtx` image runs WSJT-X's `jt9` decoder and `ft8sim` simulator so that RR73's decoders can be measured against WSJT-X. `reference.py` decodes corpus slots with `jt9` and stores the decodes in each slot's sidecar under `reference.jt9-d3`.

## Setup

```sh
docker compose build wsjtx
```

The image is built from `ubuntu:24.04` and the distribution's `wsjtx` package, version `2.7.0~rc3+repack-1build2`, which reports itself as WSJT-X 2.7.0-rc3. The final stage keeps `jt9`, `ft8sim` and the libraries they link (FFTW, Qt 5 Core, gfortran), plus Python 3 and pytest. It takes about 290 MB on disk, of which the Ubuntu base layers are shared.

`jt9` on the PATH is a small wrapper (`jt9.sh`): unless `-a` or `-t` is given, it points both at a temporary directory that is removed afterwards, so `docker compose run --rm wsjtx jt9 -8 -d 3 <file.wav>` leaves no `decoded.txt`, `timer.out` or `jt9_wisdom.dat` in the repository. The binary itself is `/usr/local/libexec/wsjtx/jt9`.

WSJT-X is GPL-3. RR73 runs the binaries as a reference and never reads, links or copies their source. The package's copyright file is in the image at `/usr/share/doc/wsjtx/copyright`.

## Reference decodes

```sh
docker compose run --rm wsjtx reference.py corpus/kiwi
docker compose run --rm wsjtx reference.py --jobs 4 corpus/kiwi/sarts-web888/20261013
docker compose run --rm wsjtx reference.py --print --mode FT8 corpus/public/ft8_lib
```

- Arguments are slot WAV files or directories, searched recursively.
- The mode comes from the sidecar: `jt9 -8 -d 3` for FT8, `jt9 -5 -d 3` for FT4.
- The result goes into `reference["jt9-d3"]` as `tool` (for example `jt9 2.7.0-rc3 -8 -d 3`) and `decodes` (`text`, `freq_hz`, `dt_s`, `snr_db`). Every other sidecar field is kept, and the file is replaced atomically.
- Slots whose `jt9-d3` already came from the same version and flags are skipped. `--force` decodes them again.
- `--print` writes one JSON line per WAV file to standard output and changes no files. WAV files without a sidecar are accepted in this mode, with the mode from `--mode`.
- Each `jt9` run gets its own temporary working directory, so its `decoded.txt`, `timer.out` and `jt9_wisdom.dat` never land in the corpus. Runs are parallel across files, one per CPU by default.
- Sidecars whose `format` is not `rr73-slot/1` are rejected. WAV files must be 12000 Hz, mono, 16-bit.
- The exit status is 1 when any slot failed. Failed slots keep their sidecar unchanged.

`jt9` takes about 5 s per FT8 slot at depth 3 on one core of an Apple M-series machine under Docker.

## Decode lists for the bench

```sh
docker compose run --rm wsjtx python3 tools/wsjtx/decode_list.py --fresh \
  --my-call K1ABC --his-call W9XYZ --qso-progress 1 \
  --out results/jt9-ft4.txt --times results/jt9-ft4.times corpus/synthetic/ft4-sweep
docker compose run --rm rust rr73-bench import --decodes results/jt9-ft4.txt --label jt9-ft4-d3 \
  --out results/jt9-ft4.json corpus/synthetic/ft4-sweep
```

- `decode_list.py` decodes every slot below the paths with `jt9 -d 3`, one `jt9` process per slot, in the mode its sidecar names, and writes the decode list `rr73-bench import` reads (`docs/bench.md`): a line `== <path below corpus/ without extension>` per slot, in path order, followed by `jt9`'s decode lines unchanged, `?` and `aN` marks included. Sidecars are never changed, so synthetic slots work too.
- `--my-call`, `--his-call` and `--qso-progress` pass `-c`, `-x` and `-Q` to `jt9`. With no options `jt9` tries CQ hypotheses and marks what they decode `a1`; `rr73-bench import` scores such lines like any other decode. With callsigns that occur in no slot, as above, `jt9` printed no `aN` decode on `ft4-sweep` and `snr-sweep` (experiment 0007). `--times` records the options in its tool string.
- Each worker thread keeps one `jt9` working directory for its slots, so `jt9` reuses its FFTW wisdom between slots as WSJT-X does. `--fresh` gives every slot a new directory; on the 3540 `ft4-sweep` and 1680 `snr-sweep` slots both give the same decodes.
- `--times` writes one JSON line per slot: the tool, the decode count, the wall time and CPU time of the `jt9` process, and `jt9_s`, the total of the `jt9` row in its `timer.out`, in seconds.

## Output parsing

`jt9` prints one line per decode, then `<DecodeFinished>` with the decode count:

```text
110130  -4  0.9 1291 ~  CQ R7IW LN35
000005 -22 -0.0 1200 ~  CQ K1ABC FN42                       ? a1
<DecodeFinished>   0   5        0
```

FT8 lines carry `~` and FT4 lines `+`. The message field is padded to a fixed width. A priori decodes add `aN` and low-confidence decodes add `?` after the padding. `a1` (CQ) appears without `-c`: 2 of 53 decodes in a 40m slot from the SARTS receiver carry it. Both annotations are removed from `text`. The parser rejects output without `<DecodeFinished>`, output whose count differs from the decode lines, decode lines that do not parse, and lines with the other mode's marker. `-0.0` DT is stored as `0.0`.

## Codec vectors

```sh
docker compose run --rm wsjtx python3 tools/wsjtx/vectors.py tools/wsjtx/cases.txt fixtures/ft8/wsjtx.json
tools/wsjtx/decodes.sh
```

- `vectors.py` runs `ft8sim` on every message in `cases.txt` (359 messages) and writes `fixtures/ft8/wsjtx.json`: the input, the text WSJT-X displays, i3.n3, the 77 message bits and the 79 FT8 channel symbols. `ft8sim` prints n3 as `*` for some type 4 messages; the file stores null. Each run uses a temporary directory, so its WAV file never lands in the repository.
- `decodes.sh` runs on the host. It builds FT8 and FT4 slots from `decode_cases.txt` with the `slot_wav` example of rr73-ft8 (12 signals per slot, 180 Hz apart), decodes them with `jt9` through `decodes.py`, and writes `fixtures/ft8/wsjtx_decodes.json`: each payload with the text `jt9` shows for it, or null. The slots live in `results/wsjtx-decodes/` and are removed afterwards. `decodes.py` accepts decode lines with an empty message, which `jt9` prints for some payloads it cannot unpack.
- `crates/rr73-ft8/tests/wsjtx.rs` and `wsjtx_decodes.rs` check rr73-ft8 against both files and list each place where rr73-ft8 differs on purpose.

## Tests

```sh
docker compose run --rm wsjtx python3 -m pytest tools/wsjtx
```

The fixtures in `tests/fixtures/` are `jt9` 2.7.0-rc3 output captured from real runs: ft8_lib test WAVs at commit 9fec6ca (`191111_110130`, `191111_110615`, `191111_110645`, `websdr_test11`), an `ft8sim` signal at −23 dB decoded with `-c 9V1NE` to produce an `a1` annotation, an `ft8sim` signal at −35 dB with no decodes, an FT4 slot synthesised from `ft4code` channel symbols, and a 40m slot recorded by rr73-kiwi on the SARTS receiver (`261012_215130`, 53 decodes). One test runs the real `jt9` on an `ft8sim` slot.

## Check on ft8_lib test files

Six ft8_lib test WAVs at commit 9fec6ca, decoded with `reference.py --print`, against the WSJT-X decode lists that ship with them:

| File | Listed decodes | jt9 decodes | Listed and decoded |
| --- | --- | --- | --- |
| `191111_110130` | 5 | 5 | 5 |
| `191111_110615` | 20 | 22 | 20 |
| `191111_110645` | 19 | 19 | 19 |
| `websdr_test1` | 18 | 19 | 17 |
| `websdr_test4` | 22 | 27 | 22 |
| `websdr_test11` | 21 | 25 | 21 |

The one listed message `jt9` missed is `LZ1CWK DC8VA RR73` in `websdr_test1`.

## WSPR

The image also holds `wsprsim`, `wsprcode` and `wsprd` from the same package. `wsprd` on the PATH is a wrapper (`wsprd.sh`) that, unless `-a` is given, points it at a temporary directory removed afterwards, so `ALL_WSPR.TXT`, `wspr_spots.txt`, `hashtable.txt`, `wspr_timer.out` and `wspr_wisdom.dat` never land in the repository and no callsign hash table carries over between runs.

```sh
docker compose run --rm wsjtx python3 tools/wsjtx/wspr_vectors.py tools/wsjtx/wspr_cases.txt fixtures/wspr/wsjtx.json
```

- `wspr_vectors.py` runs `wsprsim -cd` and `wsprcode` on every message in `wspr_cases.txt` (314 lines: 236 of type 1, 47 of type 2, 31 of type 3; 85 picked by hand, the rest drawn once at random) and writes `fixtures/wspr/wsjtx.json`: the input, the text `wsprcode` decodes, the power field, the 11 bytes `wsprsim` prints (50 message bits and the zero tail) and the 162 channel symbols.
- `crates/rr73-wspr/tests/wsjtx.rs` checks that rr73-wspr packs every message to the same bytes and symbols and unpacks it to the text `wsprcode` shows. `wsprcode` prints type 3 callsigns as `<...>` because it has no hash table, and shows the locator of `0M0DRQ RO04 10` as `RO  `; the test lists that difference.
- `wsprsim` exits with status 1 after printing when it writes no file. It packs any text without checks: lower case, powers outside the 19 levels and 6-character locators in a type 1 message (it keeps the first 4) all give a packed message. The case list therefore holds only messages that rr73-wspr accepts, and rr73-wspr refuses the rest with a reason.
- The type 2 prefix and suffix layout and the type 3 hash were read from `wsprsim -d` output for chosen messages; see `crates/rr73-wspr/src/message.rs`.
