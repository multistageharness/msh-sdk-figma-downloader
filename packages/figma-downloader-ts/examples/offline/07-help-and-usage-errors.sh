#!/usr/bin/env bash
# 07 — Help text and the typed exit codes for usage mistakes.
# Exercises: --help / -h, and exit code 2 (usage) paths.
#
# The tool maps failures to distinct exit codes: 0 ok · 2 usage · 3 auth ·
# 4 not-found · 5 rate-limited · 6 server/network · 7 timeout. This script only
# triggers the offline ones (0 and 2); the network codes are shown in live/09.
source "$(dirname "$0")/../_common.sh"

echo "### --help (exit 0)"
node "$BIN" --help | head -6
echo "  exit=$?"

echo "### no input at all → usage error (exit 2)"
set +e
node "$BIN" 2>&1 | tail -1
echo "  exit=$?"

echo "### bad --size value → usage error (exit 2)"
node "$BIN" --mock --size ginormous 2>&1 | tail -1
echo "  exit=$?"

echo "### --reconstruct-only with no work dir → usage error (exit 2)"
node "$BIN" --reconstruct-only 2>&1 | tail -1
echo "  exit=$?"
set -e
