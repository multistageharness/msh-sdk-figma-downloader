#!/usr/bin/env bash
# 04 — Override the per-request tuning knobs explicitly.
# Exercises: --depth, --batch-size, --concurrency, --rate, --retries, --timeout-ms
#
# Explicit flags beat the tier preset beat auto (explicit > tier > auto). Here we
# pin a shallow frontier (depth 1 = pages), 2 ids per /nodes request, 2 parallel
# requests, a 5 req/s global ceiling, 5 retries, and a 30s per-request timeout.
source "$(dirname "$0")/../_common.sh"

WORK="$SCRATCH/04-work"
rm -rf "$WORK"

run node "$BIN" --mock \
  --depth 1 \
  --batch-size 2 \
  --concurrency 2 \
  --rate 5 \
  --retries 5 \
  --timeout-ms 30000 \
  --work-dir "$WORK" --out "$WORK/full.json" 2>&1 \
  | grep -E 'frontier:|downloading|wrote'
