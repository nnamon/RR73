#!/bin/sh
# jt9 that keeps its working files (decoded.txt, timer.out, jt9_wisdom.dat) out of the current
# directory. Unless -a or -t is given, they go to a temporary directory removed afterwards.
real=/usr/local/libexec/wsjtx/jt9
for arg in "$@"; do
  case "$arg" in
    -a | -t | --data-path | --temp-path | --data-path=* | --temp-path=*) exec "$real" "$@" ;;
  esac
done
work=$(mktemp -d "${TMPDIR:-/tmp}/jt9.XXXXXX") || exit 1
trap 'rm -rf "$work"; exit 130' INT TERM
status=0
"$real" -a "$work" -t "$work" "$@" || status=$?
rm -rf "$work"
exit "$status"
