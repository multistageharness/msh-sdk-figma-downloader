#!/usr/bin/env bash
# INTEGRATION — download a single file from figma.json by 1-based index or by key.
#
#   FIGMA_TOKEN=figd_xxx bash examples/integration/download-one.sh 1
#   FIGMA_TOKEN=figd_xxx bash examples/integration/download-one.sh TFTCSGbqpyxex6QRYqqbzb --pretty
#
# Writes out/<key>/full.json. Extra flags after the selector pass through to the CLI.
source "$(dirname "$0")/../_common.sh"

FILES_JSON="$(cd "$PKG_ROOT/../.." && pwd)/figma.json"
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

cd "$PKG_ROOT"
CMD=(node "$BIN" --file-key "$key" --resume "$@")
if need_token; then run "${CMD[@]}"; else printf '$ %s\n' "${CMD[*]}"; fi
