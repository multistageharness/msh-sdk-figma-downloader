#!/usr/bin/env bash
# 06 — Output: where it goes, how it's formatted, what's kept.
#
#   --out <path>     final full-file JSON path (default out/<key>/full.json)
#   --work-dir <dir> scratch dir for skeleton + parts (default out/<key>)
#   --stdout         write the rebuilt file to stdout instead of a file
#   --pretty         pretty-print (default: compact, byte-minimal)
#   --quiet          suppress progress logs (errors still go to stderr)
#   --keep-parts     keep the parts/ dir after a successful reconstruct
source "$(dirname "$0")/_lib.sh"

note "Default file layout — explicit work dir, full.json written inside it"
run "${CLI[@]}" --mock --work-dir examples/.out/run1 --quiet
run ls examples/.out/run1

note "Custom --out path (separate from the scratch work dir)"
run "${CLI[@]}" --mock --work-dir examples/.out/run2 --out examples/.out/result.json --quiet
run ls -la examples/.out/result.json

note "Compact vs pretty to stdout — compare byte counts"
printf '  compact: %s bytes\n' "$("${CLI[@]}" --mock --stdout --quiet | wc -c | tr -d ' ')"
printf '  pretty:  %s bytes\n' "$("${CLI[@]}" --mock --pretty --stdout --quiet | wc -c | tr -d ' ')"

note "--keep-parts retains the per-batch part files for inspection/debugging"
run "${CLI[@]}" --mock --work-dir examples/.out/run3 --keep-parts --quiet
run ls examples/.out/run3/parts

note "Cleanup"
run rm -rf examples/.out
