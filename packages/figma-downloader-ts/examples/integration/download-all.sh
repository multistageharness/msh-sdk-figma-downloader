#!/usr/bin/env bash
# INTEGRATION — download every Figma file listed in the repo-root figma.json.
#
# Reads the file keys from <repo>/figma.json and runs the real
# skeleton -> chunk -> reconstruct pipeline against the live Figma API for each,
# writing out/<key>/full.json under the package root. Idempotent: --resume reuses
# parts already on disk, so re-running after an interruption is cheap.
#
# Requires a token (FIGMA_TOKEN | FIGMA_API_TOKEN | FIGMA_ACCESS_TOKEN). Without
# one, the exact per-file commands are printed and nothing runs.
#
#   FIGMA_TOKEN=figd_xxx bash examples/integration/download-all.sh
#   FIGMA_TOKEN=figd_xxx bash examples/integration/download-all.sh --size large --pretty
#                                              # any extra flags pass straight through
source "$(dirname "$0")/../_common.sh"

FILES_JSON="$(cd "$PKG_ROOT/../.." && pwd)/figma.json"
[ -f "$FILES_JSON" ] || { echo "error: $FILES_JSON not found" >&2; exit 1; }

# Parse the JSON array of keys with the runtime that ships with this package.
KEYS=()
while IFS= read -r k; do KEYS+=("$k"); done < <(
  node -e 'for (const k of JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))) console.log(k)' "$FILES_JSON"
)
echo "→ ${#KEYS[@]} file key(s) from $FILES_JSON" >&2

cd "$PKG_ROOT"   # default out/<key>/ lands at the package root (gitignored)

if ! need_token; then
  for key in "${KEYS[@]}"; do
    printf '$ node bin/figma-download.mjs --file-key %s --resume %s\n' "$key" "$*"
  done
  exit 0
fi

ok=0; fail=0; failed=()
for key in "${KEYS[@]}"; do
  if run node "$BIN" --file-key "$key" --resume "$@"; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1)); failed+=("$key")
  fi
done

echo "" >&2
echo "→ done: $ok ok, $fail failed of ${#KEYS[@]} → out/<key>/full.json" >&2
if [ "$fail" -gt 0 ]; then
  printf '  failed: %s\n' "${failed[*]}" >&2
  exit 1
fi
