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

- `vectors.py` runs `ft8sim` on every message in `cases.txt` (346 lines) and writes `fixtures/ft8/wsjtx.json`: the input, the text WSJT-X displays, i3.n3, the 77 message bits and the 79 FT8 channel symbols. `ft8sim` prints n3 as `*` for some type 4 messages; the file stores null. Each run uses a temporary directory, so its WAV file never lands in the repository.
- `decodes.sh` runs on the host. It builds FT8 and FT4 slots from `decode_cases.txt` with the `slot_wav` example of rr73-ft8 (12 signals per slot, 180 Hz apart), decodes them with `jt9` through `decodes.py`, and writes `fixtures/ft8/wsjtx_decodes.json`: each payload with the text `jt9` shows for it, or null. The slots live in `results/wsjtx-decodes/` and are removed afterwards. `decodes.py` accepts decode lines with an empty message, which `jt9` prints for some payloads it cannot unpack.

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
