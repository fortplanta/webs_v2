#!/bin/sh
# Bundle and run the library importer (the dump can be huge, so this runs outside the app).
set -eu
cd "$(dirname "$0")/.."
OUT="$(mktemp -d)/import-library.mjs"
npx esbuild scripts/import-library.ts --bundle --platform=node --format=esm --log-level=error --outfile="$OUT"
node --no-warnings "$OUT" "$@"
