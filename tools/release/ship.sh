#!/bin/zsh
# ship.sh <worktree> <version> <previous version> <full commit SHA>
# Waits for CI on the SHA (gh needs the full SHA), then for the previous version's tag so releases
# go out in order (pass "" to skip), fast-forwards main to the SHA, publishes from the main checkout
# and reports the tag's deploy.
set -u
wt=$1; ver=$2; prev=${3:-}; sha=$4
cd "$wt"
# The main checkout is the first worktree; publish runs there, on main.
main=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
id=""
for i in {1..90}; do
  id=$(gh run list --commit "$sha" --workflow CI --json databaseId --jq '.[0].databaseId' 2>/dev/null)
  [ -n "$id" ] && break; sleep 10
done
[ -n "$id" ] || { echo "no CI run for $sha"; exit 1; }
while :; do
  st=$(gh run view "$id" --json status,conclusion --jq '"\(.status) \(.conclusion)"' 2>/dev/null)
  case "$st" in completed\ *) break ;; esac
  sleep 30
done
if [ "$st" = "completed success" ]; then rc=0; else rc=1; fi
echo "ci exit $rc ($id: $st)"
if [ $rc -ne 0 ]; then gh run view "$id" --json jobs --jq '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped") | "\(.name): \(.conclusion)"'; exit 1; fi
if [ -n "$prev" ]; then
  for i in {1..360}; do
    git ls-remote --tags origin "refs/tags/v$prev" | grep -q . && break; sleep 20
  done
  git ls-remote --tags origin "refs/tags/v$prev" | grep -q . || { echo "v$prev never appeared"; exit 1; }
  sleep 30
fi
git fetch -q origin main
git merge-base --is-ancestor origin/main "$sha" || { echo "main is not an ancestor of $sha"; exit 1; }
git push -q origin "${sha}:refs/heads/main" || { echo "ff push failed"; exit 1; }
cd "$main" && git fetch -q origin main && git merge -q --ff-only origin/main || { echo "local main ff failed"; exit 1; }
tools/release/release.sh publish 2>&1 | tail -2
sleep 15
tid=""
for i in {1..60}; do
  tid=$(gh run list --workflow CI --branch "v$ver" --json databaseId --jq '.[0].databaseId' 2>/dev/null)
  [ -n "$tid" ] && break; sleep 10
done
while :; do
  st=$(gh run view "$tid" --json status --jq .status 2>/dev/null)
  [ "$st" = completed ] && break
  sleep 30
done
gh run view "$tid" --json jobs --jq '.jobs[] | select(.name == "Deploy to GitHub Pages") | "Deploy to GitHub Pages: \(.conclusion)"'
gh run view "$tid" --json jobs --jq '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped") | "not green: \(.name) \(.conclusion)"'
sleep 60
for f in data/manifest.json data/cty.json; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://nnamon.github.io/RR73/$f")
  echo "live $f: HTTP $code"
done
