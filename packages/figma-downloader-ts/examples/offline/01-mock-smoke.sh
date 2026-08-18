#!/usr/bin/env bash
# 01 — Offline smoke test: the simplest possible invocation.
# Exercises: --mock, --pretty, --stdout, --quiet
#
# --mock serves the shared fixture (no network, no token) but still drives the
# REAL skeleton→chunk→reconstruct path. --stdout writes full.json to stdout
# instead of a file; --pretty indents it; --quiet hushes the progress log.
source "$(dirname "$0")/../_common.sh"

run node "$BIN" --mock --pretty --stdout --quiet | head -8
echo "… (truncated) — that JSON is a faithful GET /v1/files/:key shape."
