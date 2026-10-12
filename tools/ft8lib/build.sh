#!/bin/sh
# Fetches ft8_lib at a pinned commit into tools/ft8lib/src/ and builds it together with the
# vector generator. Runs inside the rust container:
#
#   docker compose run --rm rust tools/ft8lib/build.sh
#
# ft8_lib is MIT licensed (Kārlis Goba). The checkout is git-ignored.
set -eu

FT8LIB_REPO=https://github.com/kgoba/ft8_lib
FT8LIB_COMMIT=9fec6ca

here=$(cd "$(dirname "$0")" && pwd)
src="$here/src"

if [ ! -d "$src/.git" ]; then
    git clone --quiet "$FT8LIB_REPO" "$src"
fi
git -C "$src" -c advice.detachedHead=false checkout --quiet "$FT8LIB_COMMIT"

make -C "$src" --quiet libft8.a gen_ft8 decode_ft8
make -C "$here" --quiet
