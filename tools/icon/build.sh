#!/bin/sh
# Builds web/public/icon.svg from tools/icon/build-icon.mjs, then regenerates the PNG icons with
# the app's icon generator. Downloads IBM Plex Mono SemiBold and opentype.js into a temporary
# directory; nothing is installed in the repository. Runs in the node container:
#   docker compose run --rm node sh tools/icon/build.sh
set -eu
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
node -e '
  fetch("https://github.com/google/fonts/raw/main/ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf")
    .then((r) => { if (!r.ok) throw new Error(`font download failed: ${r.status}`); return r.arrayBuffer(); })
    .then((b) => require("fs").writeFileSync(process.argv[1], Buffer.from(b)));
' "$tmp/IBMPlexMono-SemiBold.ttf"
npm install --silent --prefix "$tmp" opentype.js@1.3.4 >/dev/null
cp tools/icon/build-icon.mjs "$tmp/build-icon.mjs"
node "$tmp/build-icon.mjs" "$tmp/IBMPlexMono-SemiBold.ttf" web/public/icon.svg
npm --prefix web run icons
