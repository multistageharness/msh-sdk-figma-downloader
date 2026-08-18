#!/usr/bin/env bash
# LIVE 01 — Download by Figma URL (the key is parsed out of it).
# Exercises: --url, FIGMA_TOKEN, --size auto (default)
#
# Pass any figma.com/design/<KEY>/... or figma.com/file/<KEY>/... URL. The file
# key is extracted automatically. `--size auto` probes and classifies the file.
source "$(dirname "$0")/../_common.sh"

URL="${1:-https://www.figma.com/design/TFTCSGbqpyxex6QRYqqbzb/About}"
CMD=(node "$BIN" --url "$URL" --pretty)

if need_token; then run "${CMD[@]}"; else printf '$ %s\n' "${CMD[*]}"; fi
