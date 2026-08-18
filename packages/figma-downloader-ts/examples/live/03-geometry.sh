#!/usr/bin/env bash
# LIVE 03 — Include vector geometry (paths) in the download.
# Exercises: --geometry
#
# By default Figma omits vector path data. --geometry requests geometry=paths on
# every /nodes call — much larger payloads, so it pairs well with a higher tier
# and re-chunking. Use it only when you actually need editable vector outlines.
source "$(dirname "$0")/../_common.sh"

KEY="${1:-TFTCSGbqpyxex6QRYqqbzb}"
CMD=(node "$BIN" --file-key "$KEY" --geometry --size large)

if need_token; then run "${CMD[@]}"; else printf '$ %s\n' "${CMD[*]}"; fi
