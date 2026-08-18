#!/usr/bin/env bash
# LIVE 07 — Tune resilience + control output on a real download.
# Exercises: --retries, --timeout-ms, --rate, --out, --stdout, --quiet, --pretty,
#            --work-dir, --keep-parts
#
# A throttled, patient configuration: 6 retries, 90s per-request timeout, 3 req/s
# global ceiling. Output is pretty-printed to an explicit file, parts retained,
# progress logs hushed. Swap --out for --stdout to pipe into jq.
source "$(dirname "$0")/../_common.sh"

KEY="${1:-TFTCSGbqpyxex6QRYqqbzb}"
WORK="$SCRATCH/live07-work"
CMD=(node "$BIN" --file-key "$KEY"
     --retries 6 --timeout-ms 90000 --rate 3
     --work-dir "$WORK" --out "$WORK/full.json"
     --pretty --keep-parts --quiet)

echo "Streaming variant: … --stdout --quiet | jq '.document.children | length'"
if need_token; then run "${CMD[@]}"; else printf '$ %s\n' "${CMD[*]}"; fi
