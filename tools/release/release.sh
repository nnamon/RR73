#!/bin/sh
# Releases in two steps, so CI always tests the exact release commit.
#
#   tools/release/release.sh prepare patch|minor|major|x.y.z
#       On a branch: dates "## Unreleased" in CHANGELOG.md, bumps Cargo.toml and
#       web/package.json, and commits "Release x.y.z". Merge it to main once CI is green.
#   tools/release/release.sh publish
#       On main, after the merge: checks that CI passed on HEAD, tags v<version>, pushes the
#       tag (which deploys the app) and publishes the GitHub release with the changelog notes.
#
# Node and cargo run in containers; git and gh run on the host.
set -eu

cd "$(git rev-parse --show-toplevel)"
node_run() { docker compose run --rm -T node node "$@" 2>/dev/null; }
die() { echo "$1" >&2; exit 1; }

clean_tree() { [ -z "$(git status --porcelain)" ] || die "The working tree has uncommitted changes."; }

prepare() {
  level="${1:?usage: release.sh prepare patch|minor|major|x.y.z}"
  clean_tree
  [ "$(git rev-parse --abbrev-ref HEAD)" != main ] || die "Prepare a release on a branch, then merge it to main."
  version="$(node_run tools/release/version.mjs bump "$level" | tail -n 1)"
  docker compose run --rm -T rust cargo update --workspace --quiet 2>/dev/null
  node_run tools/release/version.mjs check
  notes="$(node_run tools/release/version.mjs notes "$version")"
  git add CHANGELOG.md Cargo.toml Cargo.lock web/package.json web/package-lock.json
  git commit -q -m "Release $version" -m "$notes"
  echo "Prepared $version. Merge to main once CI is green, then run: tools/release/release.sh publish"
}

publish() {
  clean_tree
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "Publish from main."
  git fetch -q origin main --tags
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "Local main differs from origin/main."
  version="$(node_run tools/release/version.mjs current | tail -n 1)"
  ! git rev-parse -q --verify "refs/tags/v$version" >/dev/null || die "v$version is already tagged."
  sha="$(git rev-parse HEAD)"
  conclusion="$(gh run list --commit "$sha" --workflow CI --json conclusion --jq '.[0].conclusion' 2>/dev/null || true)"
  [ "$conclusion" = success ] || die "CI on $sha is '${conclusion:-not found}'; publish only after it passes."
  notes="$(node_run tools/release/version.mjs notes "$version")"
  git tag -a "v$version" -m "RR73 $version" -m "$notes"
  git push -q origin "v$version"
  printf '%s\n' "$notes" | gh release create "v$version" --title "RR73 $version" --notes-file -
  echo "Published $version"
}

case "${1:-}" in
  prepare) shift; prepare "$@" ;;
  publish) publish ;;
  *) die "usage: tools/release/release.sh prepare <level> | publish" ;;
esac
