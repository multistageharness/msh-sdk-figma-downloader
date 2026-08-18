# _common.sh — sourced by every example. Resolves the CLI path and shared helpers.
# Not executable on its own.

set -euo pipefail

# Package root = two levels up from any example script (examples/<group>/x.sh).
PKG_ROOT="$(cd "$(dirname "${BASH_SOURCE[1]}")/../.." && pwd)"
BIN="$PKG_ROOT/bin/figma-download.mjs"
SCRATCH="$PKG_ROOT/examples/.scratch"   # gitignored throwaway output

run() {  # echo the command, then run it
  printf '\n$ %s\n' "$*" >&2
  "$@"
}

need_token() {
  if [ -z "${FIGMA_TOKEN:-${FIGMA_API_TOKEN:-${FIGMA_ACCESS_TOKEN:-}}}" ]; then
    echo "→ SKIP: set FIGMA_TOKEN to run this live example. Showing the command only:" >&2
    return 1
  fi
  return 0
}

mkdir -p "$SCRATCH"
