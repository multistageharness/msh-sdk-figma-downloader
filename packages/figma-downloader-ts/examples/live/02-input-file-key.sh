#!/usr/bin/env bash
# LIVE 02 — Download by raw file key, forcing a tier for a known-huge file.
# Exercises: --file-key, --size xxxxl, --resume
#
# When you already know the file is enormous, skip the auto probe and force the
# top tier. --resume makes a re-run skip groups already on disk (manifest-aware),
# so an interrupted download picks up where it left off.
source "$(dirname "$0")/../_common.sh"

KEY="${1:-TFTCSGbqpyxex6QRYqqbzb}"
CMD=(node "$BIN" --file-key "$KEY" --size xxxxl --resume)

if need_token; then run "${CMD[@]}"; else printf '$ %s\n' "${CMD[*]}"; fi
