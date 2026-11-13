#!/bin/sh
# Runs the desktop smoke tests against a built app under a virtual X server. In the desktop-e2e
# service, after the web build and `npx tauri build --no-bundle` (docs/testing.md, Desktop app):
#   docker compose run --rm desktop-e2e desktop/e2e/run.sh
# RR73_APP names another binary, such as /usr/bin/rr73 from the deb.
set -eu
cd "$(dirname "$0")"
# Xvfb directly: xvfb-run waits for a signal that never reaches it as a container's first process.
Xvfb :99 -screen 0 1280x900x24 -nolisten tcp > /dev/null 2>&1 &
xvfb=$!
trap 'kill $xvfb' EXIT
export DISPLAY=:99
for _ in $(seq 1 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.1; done
node --test --test-reporter=spec smoke.test.mjs
