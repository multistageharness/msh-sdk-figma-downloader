#!/usr/bin/env bash
# INTEGRATION (repo-root, Python) — download a single file from figma.json by
# 1-based index or by literal key, via the sibling Python package.
#
#   FIGMA_TOKEN=figd_xxx bash integration/py/download-one.sh 1
#   FIGMA_TOKEN=figd_xxx bash integration/py/download-one.sh TFTCSGbqpyxex6QRYqqbzb --pretty
#
# Writes integration/py/out/<key>/full.json. Extra flags after the selector pass
# straight through to the CLI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PKG_ROOT="$REPO_ROOT/packages/figma-downloader-py"
FILES_JSON="$REPO_ROOT/figma.json"
OUT_DIR="$SCRIPT_DIR/out"
[ -f "$FILES_JSON" ] || { echo "error: $FILES_JSON not found" >&2; exit 1; }

sel="${1:-1}"; [ $# -gt 0 ] && shift

KEYS=()
while IFS= read -r k; do KEYS+=("$k"); done < <(
  python3 -c 'import json,sys
[print(k) for k in json.load(open(sys.argv[1]))]' "$FILES_JSON"
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

cd "$PKG_ROOT"   # so `python3 -m figma_downloader` resolves the in-tree package

have_token() { [ -n "${FIGMA_TOKEN:-${FIGMA_API_TOKEN:-${FIGMA_ACCESS_TOKEN:-}}}" ]; }

if have_token; then
  printf '\n$ python3 -m figma_downloader --file-key %s --work-dir %s --resume %s\n' "$key" "$OUT_DIR/$key" "$*" >&2
  python3 -m figma_downloader --file-key "$key" --work-dir "$OUT_DIR/$key" --resume "$@"
else
  printf '$ (cd %s && python3 -m figma_downloader --file-key %s --work-dir %s --resume %s)\n' \
    "$PKG_ROOT" "$key" "$OUT_DIR/$key" "$*"
fi
