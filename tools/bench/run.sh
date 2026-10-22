#!/bin/sh
# Runs rr73-bench in the rust container with the commit under test recorded: inside the container
# a worktree's git metadata is outside the mount, so the commit id comes from the host
# (docs/bench.md). Usage: tools/bench/run.sh run --preset baseline corpus/synthetic/smoke
set -eu
sha=$(git rev-parse --short=12 HEAD)
git diff --quiet HEAD -- || sha="$sha-dirty"
exec docker compose run --rm -e RR73_GIT_SHA="$sha" rust rr73-bench "$@"
