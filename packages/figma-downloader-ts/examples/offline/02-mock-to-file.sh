#!/usr/bin/env bash
# 02 — Write to a chosen file and scratch dir instead of stdout.
# Exercises: --out, --work-dir
#
# --work-dir is the scratch area (skeleton.json, parts/, manifest.json).
# --out is the final full.json location (defaults to <work-dir>/full.json).
source "$(dirname "$0")/../_common.sh"

WORK="$SCRATCH/02-work"
OUT="$SCRATCH/02-full.json"
rm -rf "$WORK" "$OUT"

run node "$BIN" --mock --pretty --work-dir "$WORK" --out "$OUT"

echo "--- work dir ---"; ls -1 "$WORK"
echo "--- out file ---"; ls -la "$OUT"
echo "--- manifest (mode/size) ---"
node -e "const m=require('$WORK/manifest.json'); console.log({mode:m.mode,size:m.size,parts:m.parts.length,frontier:m.frontierIds.length})"
