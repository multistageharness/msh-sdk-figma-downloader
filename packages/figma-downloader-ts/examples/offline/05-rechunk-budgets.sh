#!/usr/bin/env bash
# 05 — Force byte/time-aware re-chunking with a tiny part budget.
# Exercises: --max-part-bytes, --max-part-ms, --max-rechunk-depth, --keep-parts
#
# Any fetched batch larger than --max-part-bytes (or slower than --max-part-ms)
# is split in memory into a shallow parent part + one part per child, recursively
# up to --max-rechunk-depth. Setting an absurdly small byte budget forces the
# split so you can see extra parts and `rechunked` climb in the manifest.
source "$(dirname "$0")/../_common.sh"

WORK="$SCRATCH/05-work"
rm -rf "$WORK"

run node "$BIN" --mock \
  --size xl \
  --max-part-bytes 256 \
  --max-part-ms 1 \
  --max-rechunk-depth 4 \
  --keep-parts \
  --work-dir "$WORK" --out "$WORK/full.json" 2>&1 \
  | grep -E 'downloading|re-?chunk|wrote' || true

echo "--- parts produced (more, smaller, after re-chunk) ---"
ls -1 "$WORK/parts" | head
echo "--- manifest re-chunk counters ---"
node -e "const m=require('$WORK/manifest.json'); console.log({rechunked:m.rechunked, oversizedLeaves:m.oversizedLeaves.length, parts:m.parts.length})"
