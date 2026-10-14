#!/bin/sh
# wsprd that keeps its working files (ALL_WSPR.TXT, wspr_spots.txt, hashtable.txt,
# wspr_timer.out, wspr_wisdom.dat) out of the current directory. Unless -a is given, they go
# to a temporary directory removed afterwards, so no hash table carries over between runs.
real=/usr/local/libexec/wsjtx/wsprd
for arg in "$@"; do
  case "$arg" in
    -a) exec "$real" "$@" ;;
  esac
done
work=$(mktemp -d "${TMPDIR:-/tmp}/wsprd.XXXXXX") || exit 1
trap 'rm -rf "$work"; exit 130' INT TERM
status=0
"$real" -a "$work" "$@" || status=$?
rm -rf "$work"
exit "$status"
