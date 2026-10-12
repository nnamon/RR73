#!/bin/sh
# Regenerates the rr73-ft8 test vectors in fixtures/ft8/ from ft8_lib. Runs inside the rust
# container from the repository root:
#
#   docker compose run --rm rust tools/ft8lib/generate.sh
#
# vectors.json   payload, 91-bit message, codeword and tones for every line of cases.txt
# waveforms.json ft8_lib GFSK waveforms: first and last samples plus every Nth sample
# onair.json     payloads decoded from ft8_lib's test recordings, with the text of the
#                reference decode lists shipped with them (WSJT-X output format)
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
out="$root/fixtures/ft8"
bin="$here/src/.rr73/vectors"
public="$here/src/ft4_ft8_public"

"$here/build.sh"
mkdir -p "$out"

"$bin" cases "$here/cases.txt" "$public/arrl_rac_sections.txt" "$public/states_provinces.txt" \
    > "$out/vectors.json"

{
    echo "["
    "$bin" waveform ft8 1000 12000 320 73 "CQ K1ABC FN42"
    echo ","
    "$bin" waveform ft8 2843.75 12000 320 97 "K1ABC W9XYZ R-15"
    echo ","
    "$bin" waveform ft8 1500 48000 1100 389 "W9XYZ K1ABC 73"
    echo ","
    "$bin" waveform ft4 1000 12000 640 31 "CQ K1ABC FN42"
    echo "]"
} > "$out/waveforms.json"

(cd "$here/src/test/wav" && "$bin" decode ./*.wav 20m_busy/*.wav) 2> /dev/null > "$out/onair.json"

ls -l "$out"
