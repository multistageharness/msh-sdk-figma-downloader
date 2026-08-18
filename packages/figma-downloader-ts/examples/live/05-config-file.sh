#!/usr/bin/env bash
# LIVE 05 — Resolve proxy/TLS from a JSON config file.
# Exercises: --config <path>  (precedence: flag > config file > env > default)
#
# A config file is the middle precedence layer. Point at it with --config, or
# drop a ./figma-download.config.json next to where you run the tool and it is
# picked up automatically. See ../config/figma-download.config.json.example.
source "$(dirname "$0")/../_common.sh"

KEY="${1:-TFTCSGbqpyxex6QRYqqbzb}"
CFG="$PKG_ROOT/examples/config/figma-download.config.json.example"
CMD=(node "$BIN" --file-key "$KEY" --config "$CFG")

echo "Using config: $CFG"
cat "$CFG"
if need_token; then run "${CMD[@]}"; else printf '$ %s\n' "${CMD[*]}"; fi
