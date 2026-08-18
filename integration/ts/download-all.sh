#!/usr/bin/env bash
# INTEGRATION (repo-root, Node) — download every Figma file listed in figma.json.
#
# Mirrors packages/figma-downloader-ts/examples/integration/download-all.sh, but
# lives at the repo root and drives the *sibling* Node package. Reads the file
# keys from <repo>/figma.json (the single source of truth) and runs the real
# skeleton -> chunk -> reconstruct pipeline against the live Figma API for each,
# writing integration/ts/out/<key>/full.json. Idempotent: --resume reuses parts
# already on disk, so re-running after an interruption is cheap.
#
# Requires a token (FIGMA_TOKEN | FIGMA_API_TOKEN | FIGMA_ACCESS_TOKEN). Without
# one, the exact per-file commands are printed and nothing runs.
#
#   FIGMA_TOKEN=figd_xxx bash integration/ts/download-all.sh
#   FIGMA_TOKEN=figd_xxx bash integration/ts/download-all.sh --size large --pretty
#                                              # any extra flags pass straight through
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PKG_ROOT="$REPO_ROOT/packages/figma-downloader-ts"
BIN="$PKG_ROOT/bin/figma-download.mjs"
FILES_JSON="$REPO_ROOT/figma.json"
OUT_DIR="$SCRIPT_DIR/out"
[ -f "$FILES_JSON" ] || { echo "error: $FILES_JSON not found" >&2; exit 1; }

# Parse the JSON array of keys with the runtime that ships with the package.
KEYS=()
while IFS= read -r k; do KEYS+=("$k"); done < <(
  node -e 'for (const k of JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))) console.log(k)' "$FILES_JSON"
)
echo "→ ${#KEYS[@]} file key(s) from $FILES_JSON" >&2

have_token() { [ -n "${FIGMA_TOKEN:-${FIGMA_API_TOKEN:-${FIGMA_ACCESS_TOKEN:-}}}" ]; }

if ! have_token; then
  echo "→ SKIP: set FIGMA_TOKEN to run live. Commands that would run:" >&2
  for key in "${KEYS[@]}"; do
    printf '$ node %s --file-key %s --work-dir %s --resume %s\n' "$BIN" "$key" "$OUT_DIR/$key" "$*"
  done
  exit 0
fi

ok=0; fail=0; failed=()
for key in "${KEYS[@]}"; do
  printf '\n$ node %s --file-key %s --work-dir %s --resume %s\n' "$BIN" "$key" "$OUT_DIR/$key" "$*" >&2
  if node "$BIN" --file-key "$key" --work-dir "$OUT_DIR/$key" --resume "$@"; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1)); failed+=("$key")
  fi
done

echo "" >&2
echo "→ done: $ok ok, $fail failed of ${#KEYS[@]} → integration/ts/out/<key>/full.json" >&2
if [ "$fail" -gt 0 ]; then
  printf '  failed: %s\n' "${failed[*]}" >&2
  exit 1
fi
