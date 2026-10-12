#!/bin/sh
# Fetches the FT8 test recordings shipped with ft8_lib (MIT) at a pinned commit and writes
# them as corpus slots: corpus/public/ft8_lib/<stem>.wav plus an rr73-slot/1 sidecar whose
# reference "wsjtx" holds the WSJT-X decode list stored next to each WAV in ft8_lib.
#
# Only WAVs with a decode list are copied (60 at the pinned commit). Files in
# test/wav/20m_busy/ get the stem prefix 20m_busy_. Recordings without a list, and the
# 6400 Hz copies, are skipped and named in the output.
#
# Usage: sh tools/corpus/fetch-ft8lib.sh [output directory]
# Needs git and awk. Runs in the rust container or on any POSIX system.
set -eu

REPO=https://github.com/kgoba/ft8_lib
COMMIT=9fec6ca39886edbf96f4f5e71edc76da5074e871
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${1:-"$ROOT/corpus/public/ft8_lib"}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

echo "Fetching $REPO at $COMMIT (test/wav only)"
git -C "$TMP" init -q
git -C "$TMP" config gc.auto 0
git -C "$TMP" config maintenance.auto false
git -C "$TMP" remote add origin "$REPO"
git -C "$TMP" fetch -q --depth 1 --filter=blob:none origin "$COMMIT"
got=$(git -C "$TMP" rev-parse FETCH_HEAD)
if [ "$got" != "$COMMIT" ]; then
    echo "fetched $got, expected $COMMIT" >&2
    exit 1
fi
git -C "$TMP" checkout -q FETCH_HEAD -- test/wav

mkdir -p "$OUT"
copied=0
decodes=0
skipped=""

# Writes the sidecar for $1 (WAV path in the checkout), stem $2, relative path $3.
write_sidecar() {
    wav=$1
    stem=$2
    rel=$3
    txt=${wav%.wav}.txt
    start=null
    case "$stem" in
    [0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9])
        start=$(printf '%s' "$stem" | awk '{
            printf "\"20%s-%s-%sT%s:%s:%sZ\"", substr($0,1,2), substr($0,3,2), substr($0,5,2),
                substr($0,8,2), substr($0,10,2), substr($0,12,2) }')
        ;;
    esac
    {
        printf '{\n'
        printf '  "format": "rr73-slot/1",\n'
        printf '  "mode": "FT8",\n'
        printf '  "start_utc": %s,\n' "$start"
        printf '  "sample_rate": 12000,\n'
        printf '  "dial_hz": null,\n'
        printf '  "source": {\n'
        printf '    "kind": "public",\n'
        printf '    "origin": "ft8_lib",\n'
        printf '    "repository": "%s",\n' "$REPO"
        printf '    "commit": "%s",\n' "$COMMIT"
        printf '    "path": "%s"\n' "$rel"
        printf '  },\n'
        printf '  "timing": null,\n'
        printf '  "noise_only": false,\n'
        printf '  "truth": null,\n'
        printf '  "reference": {\n'
        printf '    "wsjtx": {\n'
        printf '      "tool": "WSJT-X decode list shipped with ft8_lib (version and depth not recorded)",\n'
        printf '      "decodes": [\n'
        # Lines read "HHMMSS SNR DT FREQ ~  MESSAGE[  COUNTRY]". WSJT-X pads the message and
        # appends the country after two or more spaces; message words are single-spaced.
        awk '
            {
                i = index($0, "~")
                if (i == 0 || NF < 5) next
                msg = substr($0, i + 1)
                sub(/^ +/, "", msg)
                j = match(msg, /  +/)
                if (j > 0) msg = substr(msg, 1, j - 1)
                sub(/ +$/, "", msg)
                gsub(/\\/, "\\\\", msg)
                gsub(/"/, "\\\"", msg)
                if (n++) printf ",\n"
                printf "        { \"text\": \"%s\", \"freq_hz\": %s, \"dt_s\": %s, \"snr_db\": %s }", msg, $4, $3, $2
            }
            END { if (n) printf "\n" }
        ' "$txt"
        printf '      ]\n'
        printf '    }\n'
        printf '  }\n'
        printf '}\n'
    } >"$OUT/$stem.json"
    count=$(awk 'index($0, "~") > 0 && NF >= 5' "$txt" | wc -l)
    decodes=$((decodes + count))
}

for wav in "$TMP"/test/wav/*.wav "$TMP"/test/wav/20m_busy/*.wav; do
    [ -f "$wav" ] || continue
    rel=${wav#"$TMP"/}
    base=$(basename "$wav" .wav)
    case "$rel" in
    test/wav/20m_busy/*) stem="20m_busy_$base" ;;
    *) stem=$base ;;
    esac
    if [ ! -f "${wav%.wav}.txt" ]; then
        skipped="$skipped $rel"
        continue
    fi
    cp "$wav" "$OUT/$stem.wav"
    write_sidecar "$wav" "$stem" "$rel"
    copied=$((copied + 1))
done

echo "Wrote $copied slots with $decodes reference decodes to $OUT"
if [ -n "$skipped" ]; then
    echo "Skipped (no decode list):$skipped"
fi
