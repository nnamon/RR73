#!/bin/sh
# Cuts a release from main: bumps versions, dates the changelog, commits, tags, pushes and
# publishes the GitHub release with the changelog entries as notes.
#
#   tools/release/release.sh patch|minor|major|x.y.z
#
# Run it only after CI is green on main. Node and cargo run in containers; git and gh run on
# the host.
set -eu

level="${1:?usage: tools/release/release.sh patch|minor|major|x.y.z}"
cd "$(git rev-parse --show-toplevel)"

[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "Releases are cut from main." >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "The working tree has uncommitted changes." >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "Local main differs from origin/main." >&2; exit 1; }

node_run() { docker compose run --rm -T node node "$@"; }

version="$(node_run tools/release/version.mjs bump "$level" | tail -n 1)"
docker compose run --rm -T rust cargo update --workspace --quiet
node_run tools/release/version.mjs check
notes="$(node_run tools/release/version.mjs notes "$version")"

git add CHANGELOG.md Cargo.toml Cargo.lock web/package.json web/package-lock.json
git commit -q -m "Release $version" -m "$notes"
git tag -a "v$version" -m "RR73 $version" -m "$notes"
git push -q origin main "v$version"
printf '%s\n' "$notes" | gh release create "v$version" --title "RR73 $version" --notes-file -
echo "Released $version"
