#!/bin/sh
# Builds FT8 and FT4 slots with rr73-ft8 from tools/wsjtx/decode_cases.txt, decodes them with
# WSJT-X's jt9 and writes fixtures/ft8/wsjtx_decodes.json. Runs from the repository root on
# the host; each step runs in its container. The slots live in results/ (git-ignored) and are
# removed afterwards.
set -eu

cases=tools/wsjtx/decode_cases.txt
work=results/wsjtx-decodes
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT

for mode in ft8 ft4; do
    docker compose run --rm -T rust cargo run --quiet -p rr73-ft8 --example slot_wav -- "$mode" "$work" \
        < "$cases" > "$work/manifest-$mode.json"
done
docker compose run --rm -T wsjtx python3 tools/wsjtx/decodes.py fixtures/ft8/wsjtx_decodes.json \
    "$work/manifest-ft8.json" "$work/manifest-ft4.json"
