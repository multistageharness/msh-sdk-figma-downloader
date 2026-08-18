#!/usr/bin/env bash
# 01 — Offline smoke tests with the built-in fixture.
#
# `--mock` serves the shared fixture through an in-process fake of the Figma REST
# API. No token, no network — ideal for CI smoke tests and trying flags safely.
source "$(dirname "$0")/_lib.sh"

note "Pretty-print the rebuilt file to stdout (the canonical smoke test)"
run "${CLI[@]}" --mock --pretty --stdout

note "Compact (default) output, quiet — just the JSON, no progress logs"
run "${CLI[@]}" --mock --stdout --quiet

note "Write to an explicit file instead of stdout, into a throwaway work dir"
run "${CLI[@]}" --mock --out examples/.out/mock-full.json --work-dir examples/.out/mock --quiet
run ls -la examples/.out/mock

note "Cleanup"
run rm -rf examples/.out
