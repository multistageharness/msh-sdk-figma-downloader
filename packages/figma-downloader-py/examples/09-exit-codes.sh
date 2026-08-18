#!/usr/bin/env bash
# 09 — Exit codes: scripting against typed Figma errors.
#
# The CLI maps each failure class to a distinct exit code so a wrapper script can
# branch (retry on 5, alert on 3, give up on 4, …):
#
#   0  ok
#   2  usage error (bad/missing flags)
#   3  auth        (HTTP 401/403 — bad or missing token)
#   4  not-found   (HTTP 404 — wrong file key / no access)
#   5  rate-limit  (HTTP 429 — back off and retry)
#   6  server/network (HTTP 5xx or connection failure)
#   7  timeout     (per-request timeout exceeded)
#
# NOTE: this script does NOT use `set -e`, so it can observe non-zero exits.
set -uo pipefail
PKG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$PKG_ROOT"
CLI=(python3 -m figma_downloader)

probe() { "$@" >/dev/null 2>&1; printf '  exit=%s  <-  %s\n' "$?" "$*"; }

echo "# --help exits 0"
probe "${CLI[@]}" --help

echo "# success exits 0 (mock)"
probe "${CLI[@]}" --mock --stdout --quiet

echo "# usage error exits 2 (no input)"
probe "${CLI[@]}"

echo "# usage error exits 2 (bad --size)"
probe "${CLI[@]}" --mock --size jumbo

echo "# usage error exits 2 (--reconstruct-only with no work dir)"
probe "${CLI[@]}" --reconstruct-only

cat <<'EOF'

# Live failures (need a real call) map as follows — wire them into a retry loop:
#
#   python3 -m figma_downloader --file-key <KEY>; code=$?
#   case $code in
#     0) echo "done" ;;
#     5|6|7) echo "transient ($code) — backing off and retrying"; sleep 30 ;;
#     3) echo "check FIGMA_TOKEN" ; exit 1 ;;
#     4) echo "wrong file key or no access" ; exit 1 ;;
#     *) echo "usage/other ($code)" ; exit 1 ;;
#   esac
EOF
