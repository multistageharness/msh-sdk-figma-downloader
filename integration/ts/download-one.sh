#!/usr/bin/env bash
# INTEGRATION (repo-root, Node) — download a single file from figma.json by
# 1-based index or by literal key, via the sibling Node package.
#
#   FIGMA_TOKEN=figd_xxx bash integration/ts/download-one.sh 1
#   FIGMA_TOKEN=figd_xxx bash integration/ts/download-one.sh TFTCSGbqpyxex6QRYqqbzb --pretty
#
# Writes integration/ts/out/<key>/full.json. Extra flags after the selector pass
# straight through to the CLI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PKG_ROOT="$REPO_ROOT/packages/figma-downloader-ts"
BIN="$PKG_ROOT/bin/figma-download.mjs"
FILES_JSON="$REPO_ROOT/figma.json"
OUT_DIR="$SCRIPT_DIR/out"
[ -f "$FILES_JSON" ] || { echo "error: $FILES_JSON not found" >&2; exit 1; }

sel="${1:-1}"; [ $# -gt 0 ] && shift

KEYS=()
while IFS= read -r k; do KEYS+=("$k"); done < <(
  node -e 'for (const k of JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))) console.log(k)' "$FILES_JSON"
)

if [[ "$sel" =~ ^[0-9]+$ ]]; then
  idx=$((sel - 1))
  if [ "$idx" -lt 0 ] || [ "$idx" -ge "${#KEYS[@]}" ]; then
    echo "error: index $sel out of range 1..${#KEYS[@]}" >&2; exit 2
  fi
  key="${KEYS[$idx]}"
else
  key="$sel"   # treat a non-numeric selector as a literal file key
fi

have_token() { [ -n "${FIGMA_TOKEN:-${FIGMA_API_TOKEN:-${FIGMA_ACCESS_TOKEN:-}}}" ]; }

CMD=(node "$BIN" --file-key "$key" --work-dir "$OUT_DIR/$key" --resume "$@")
if have_token; then
  printf '\n$ %s\n' "${CMD[*]}" >&2
  "${CMD[@]}"
else
  printf '$ %s\n' "${CMD[*]}"
fi
