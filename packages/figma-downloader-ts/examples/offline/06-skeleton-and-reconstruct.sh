#!/usr/bin/env bash
# 06 — The two-phase workflow: fetch once, rebuild offline as many times as you like.
# Exercises: --skeleton-only, --keep-parts, --reconstruct-only
#
# Phase A: --skeleton-only stops after writing skeleton.json (cheap, one GET).
# Phase B: a normal --keep-parts run downloads parts/ and keeps them.
# Phase C: --reconstruct-only rebuilds full.json from the work dir with NO network.
source "$(dirname "$0")/../_common.sh"

WORK="$SCRATCH/06-work"
rm -rf "$WORK"

echo "### Phase A — skeleton only"
run node "$BIN" --mock --skeleton-only --work-dir "$WORK" 2>&1 | grep -E 'skeleton|stopping'
ls -1 "$WORK"

echo "### Phase B — download parts, keep them"
run node "$BIN" --mock --keep-parts --work-dir "$WORK" --out "$WORK/full.json" 2>&1 | grep -E 'downloading|wrote'

echo "### Phase C — reconstruct-only (offline rebuild from the work dir)"
run node "$BIN" --reconstruct-only --work-dir "$WORK" --out "$WORK/full-rebuilt.json" 2>&1 | grep -E 'reconstruct|wrote'

echo "--- the two full.json files are identical ---"
diff -q "$WORK/full.json" "$WORK/full-rebuilt.json" && echo "OK: byte-identical"
