# WSJT-X reference

The `wsjtx` image runs WSJT-X's `jt9` decoder and `ft8sim` simulator so that RR73's decoders can be measured against WSJT-X. `reference.py` decodes corpus slots with `jt9` and stores the decodes in each slot's sidecar under `reference.jt9-d3`.

## Setup

```sh
docker compose build wsjtx
```

The image is built from `ubuntu:24.04` and the distribution's `wsjtx` package, version `2.7.0~rc3+repack-1build2`, which reports itself as WSJT-X 2.7.0-rc3. The final stage keeps `jt9`, `ft8sim` and the libraries they link (FFTW, Qt 5 Core, gfortran), plus Python 3 and pytest. It takes about 290 MB on disk, of which the Ubuntu base layers are shared.

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

## Output parsing

`jt9` prints one line per decode, then `<DecodeFinished>` with the decode count:

```text
110130  -4  0.9 1291 ~  CQ R7IW LN35
000005 -22 -0.0 1200 ~  CQ K1ABC FN42                       ? a1
<DecodeFinished>   0   5        0
```

FT8 lines carry `~` and FT4 lines `+`. The message field is padded to a fixed width. A priori decodes add `aN` and low-confidence decodes add `?` after the padding. Both annotations are removed from `text`. The parser rejects output without `<DecodeFinished>`, output whose count differs from the decode lines, decode lines that do not parse, and lines with the other mode's marker. `-0.0` DT is stored as `0.0`.

## Tests

```sh
docker compose run --rm wsjtx python3 -m pytest tools/wsjtx
```

The fixtures in `tests/fixtures/` are `jt9` 2.7.0-rc3 output captured from real runs: ft8_lib test WAVs at commit 9fec6ca (`191111_110130`, `191111_110615`, `191111_110645`, `websdr_test11`), an `ft8sim` signal at −23 dB decoded with `-c 9V1NE` to produce an `a1` annotation, an `ft8sim` signal at −35 dB with no decodes, and an FT4 slot synthesised from `ft4code` channel symbols. One test runs the real `jt9` on an `ft8sim` slot.

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
