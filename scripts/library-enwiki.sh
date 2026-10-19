#!/bin/sh
# Download full English Wikipedia and build it into ~/Documents/Webs/Libraries/enwiki.db, in the background.
#   sh scripts/library-enwiki.sh            # start (or pick up again after an interruption: everything resumes)
#
# The dump (≈25.8 GB) comes in two halves over two connections, and the import reads each half as it arrives, so the
# library is ready soon after the download ends. The database ends up around 28 GB; the app only lists it once it is
# finished. Progress: tail -c 300 ~/Documents/Webs/Libraries/_downloads/enwiki-import.log
set -eu
cd "$(dirname "$0")/.."
D="$HOME/Documents/Webs/Libraries/_downloads"
URL_A="https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2"
URL_B="https://dumps.wikimedia.your.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2"
TOTAL="${ENWIKI_BYTES:-$(curl -sI -L "$URL_A" | tr -d '\r' | awk 'tolower($1)=="content-length:" {n=$2} END {print n}')}"
MID=$((TOTAL / 2))
mkdir -p "$D"
pgrep -f "fetch-range.sh .* enwiki.partA " >/dev/null || nohup caffeinate -i sh scripts/fetch-range.sh "$URL_A" "$D/enwiki.partA" 0 "$MID" >"$D/fetchA.out" 2>&1 &
pgrep -f "fetch-range.sh .* enwiki.partB " >/dev/null || nohup caffeinate -i sh scripts/fetch-range.sh "$URL_B" "$D/enwiki.partB" "$MID" "$TOTAL" >"$D/fetchB.out" 2>&1 &
pgrep -f "library-import\|import-library" >/dev/null || nohup caffeinate -i npm run library:import -- enwiki-latest-pages-articles.xml.bz2 --name enwiki --label "English Wikipedia" --url https://en.wikipedia.org/wiki/ --follow "$D/enwiki.partA:$MID" --follow "$D/enwiki.partB:$((TOTAL - MID))" --resume >>"$D/enwiki-import.log" 2>&1 &
echo "Started. Progress: tail -c 300 $D/enwiki-import.log"
