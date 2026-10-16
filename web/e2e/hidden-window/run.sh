#!/bin/sh
# Serves the e2e build (built first with --build) and runs measure.mjs with the other arguments:
#   docker compose run --rm e2e sh web/e2e/hidden-window/run.sh --build --scenario silent
set -e
cd /work/web
if [ "$1" = "--build" ]; then shift; VITE_E2E=1 npm run build > /tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }; fi
npx vite preview --host 127.0.0.1 --port 4173 --strictPort > /tmp/preview.log 2>&1 &
sleep 3
mkdir -p test-results
node e2e/hidden-window/measure.mjs "$@"
