#!/usr/bin/env bash
# 03 — Size tiers: --size {auto|sm|md|large|xl|xxxxl}.
#
# `auto` (default) probes a shallow skeleton and classifies the file by node count,
# frontier width, and skeleton bytes. Force a tier when you already know the file is
# huge (skip the probe) or want to pin the paging strategy. Correctness for ANY size
# does not depend on the guess — the re-chunk loop (example 04) is the real guarantee.
#
#   sm     whole-file fast path (one GET, no chunking)
#   md     frontier depth 2, batch 10,  concurrency 4
#   large  frontier depth 2, batch 5,   concurrency 6, streaming, resume
#   xl     frontier depth 3, batch 3,   concurrency 8, streaming, resume
#   xxxxl  frontier depth 3, batch 2,   concurrency 8, streaming, resume
source "$(dirname "$0")/_lib.sh"

note "auto (default) — classify from a probe; works offline against the mock"
run "${CLI[@]}" --mock --stdout --quiet >/dev/null && echo "ok (auto)"

note "Each forced tier, exercised against the mock fixture"
for tier in sm md large xl xxxxl; do
  run "${CLI[@]}" --mock --size "$tier" --stdout --quiet >/dev/null && echo "ok ($tier)"
done

note "Live: force xxxxl for a known-huge file to skip the classification probe"
live "${CLI[@]}" --file-key ABC123fileKEY --size xxxxl --resume

note "An invalid tier is a usage error (exit 2)"
run bash -c '"$@"; echo "exit=$?"' _ "${CLI[@]}" --mock --size jumbo || true
