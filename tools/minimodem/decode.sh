#!/usr/bin/env bash
# Decodes every RTTY bench file under a directory with minimodem, the reference decoder.
# Runs in the minimodem container:
#
#   docker compose run --rm minimodem decode.sh corpus/rtty/synthetic results/rtty/minimodem [options]
#
# For each <set>/<stem>.wav it writes <out>/<set>/<stem>.txt (the text minimodem printed) and
# <out>/<set>/<stem>.time (CPU seconds as user+system). The tones come from the sidecar.
# Options after the two directories go to minimodem before the rtty mode, such as
# "--confidence 1.0". RR73_JOBS sets the number of files decoded at once (default: all CPUs).
set -euo pipefail
src=${1:?usage: decode.sh <corpus dir> <out dir> [minimodem options]}
out=${2:?usage: decode.sh <corpus dir> <out dir> [minimodem options]}
shift 2
jobs=${RR73_JOBS:-$(nproc)}
export src out

one() {
  local wav=$1
  shift
  local meta=${wav%.wav}.json
  local set stem mark space
  set=$(jq -r .set "$meta")
  stem=$(basename "$wav" .wav)
  mark=$(jq -r .mark_hz "$meta")
  space=$(jq -r .space_hz "$meta")
  mkdir -p "$out/$set"
  local TIMEFORMAT=%3U+%3S
  { time minimodem --rx --quiet --file "$wav" --mark "$mark" --space "$space" "$@" rtty \
      > "$out/$set/$stem.txt" 2> /dev/null; } 2> "$out/$set/$stem.time"
}
export -f one

find "$src" -name '*.wav' -print0 | sort -z \
  | xargs -0 -P "$jobs" -I{} bash -c 'one "$@"' _ {} "$@"
echo "minimodem: $(find "$src" -name '*.wav' | wc -l) files decoded into $out"
