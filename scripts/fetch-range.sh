#!/bin/sh
# Download bytes [start, end) of a URL into a file, resuming from whatever is already there, until complete.
# usage: fetch-range.sh URL OUT START END
URL="$1"; OUT="$2"; START="$3"; END="$4"
UA="Webs/0.3 (https://github.com/fortplanta/webs_v2; local research canvas)"
LEN=$((END - START))
while :; do
  HAVE=$( [ -f "$OUT" ] && stat -f%z "$OUT" || echo 0 )
  [ "$HAVE" -ge "$LEN" ] && { echo "done $OUT $HAVE"; exit 0; }
  curl -sS -L --retry 5 --retry-delay 5 -A "$UA" -r "$((START + HAVE))-$((END - 1))" "$URL" >> "$OUT" 2>> "$OUT.log" || sleep 10
done
