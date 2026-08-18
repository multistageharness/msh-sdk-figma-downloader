#!/usr/bin/env bash
# 03 — Force each size tier and watch depth/batch/concurrency change.
# Exercises: --size {auto|sm|md|large|xl|xxxxl}
#
# `auto` probes the skeleton and classifies. Forcing a tier skips the probe and
# applies that tier's preset (depth/batch-size/concurrency/streaming/re-chunk).
# Correctness is identical across tiers — only the fetch strategy differs.
source "$(dirname "$0")/../_common.sh"

for tier in auto sm md large xl xxxxl; do
  echo "================ --size $tier ================"
  WORK="$SCRATCH/03-$tier"
  rm -rf "$WORK"
  # Progress log goes to stderr; grep the lines that show the chosen strategy.
  node "$BIN" --mock --size "$tier" --work-dir "$WORK" --out "$WORK/full.json" 2>&1 \
    | grep -E 'classified|whole-file|skeleton:|downloading|wrote' || true
done
