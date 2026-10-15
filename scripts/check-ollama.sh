#!/bin/sh
# Bundle and run the Ollama health check.
set -eu
cd "$(dirname "$0")/.."
OUT="$(mktemp -d)/check-ollama.mjs"
npx esbuild scripts/check-ollama.ts --bundle --platform=node --format=esm --log-level=error --outfile="$OUT"
node --no-warnings "$OUT" "$@"
