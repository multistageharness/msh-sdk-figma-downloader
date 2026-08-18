#!/usr/bin/env bash
# 07 — Operational modes.
#
#   --geometry         include vector geometry (geometry=paths) — much larger payloads
#   --resume           skip groups already downloaded (manifest-aware, for retries)
#   --skeleton-only    fetch + write the skeleton, then stop (no chunk download)
#   --reconstruct-only rebuild full.json from an existing work dir (no network at all)
#   --keep-parts       keep parts/ so a later --reconstruct-only can re-run
source "$(dirname "$0")/_lib.sh"

WD=examples/.out/proj

note "Skeleton-only against the mock — writes skeleton.json, stops before chunks"
run "${CLI[@]}" --mock --skeleton-only --work-dir "$WD" --quiet
run ls "$WD"

note "Full download, keeping parts so we can reconstruct again offline"
run "${CLI[@]}" --mock --work-dir "$WD" --keep-parts --quiet
run ls "$WD" "$WD/parts"

note "--reconstruct-only — rebuild from the work dir with NO network/token"
run "${CLI[@]}" --reconstruct-only --work-dir "$WD" --pretty --stdout >/dev/null && echo "ok (reconstructed offline)"

note "Live: --geometry includes vector paths (significantly larger output)"
live "${CLI[@]}" --file-key ABC123fileKEY --geometry --size large

note "Live: --resume re-runs a crashed download, skipping completed groups"
live "${CLI[@]}" --file-key ABC123fileKEY --size xxxxl --resume --keep-parts

note "Cleanup"
run rm -rf examples/.out
