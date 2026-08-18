#!/usr/bin/env bash
# 04 — The any-size guarantee: re-chunking oversized parts.
#
# After a /nodes batch lands, any part exceeding a byte budget (--max-part-bytes) or
# whose fetch exceeded a time budget (--max-part-ms) is recursively split and re-fetched
# at greater depth, up to --max-rechunk-depth levels. This is what lets the tool finish
# a file of ANY size regardless of whether the tier guess was right.
#
#   --max-part-bytes <n>   split any part larger than n bytes (0 = disable re-chunk)
#   --max-part-ms <n>      split any batch whose fetch took longer than n ms
#   --max-rechunk-depth <n> how deep the split may recurse (default 4)
source "$(dirname "$0")/_lib.sh"

note "Force an absurdly small byte budget so the mock fixture re-chunks (watch the logs)"
run "${CLI[@]}" --mock --max-part-bytes 256 --stdout >/dev/null

note "Disable re-chunking entirely (accept whatever a single batch returns)"
run "${CLI[@]}" --mock --max-part-bytes 0 --stdout --quiet >/dev/null && echo "ok (rechunk off)"

note "Time-based budget: re-chunk any batch slower than 5s"
run "${CLI[@]}" --mock --max-part-ms 5000 --stdout --quiet >/dev/null && echo "ok (time budget)"

note "Cap recursion depth (default 4) — combine with a tiny byte budget"
run "${CLI[@]}" --mock --max-part-bytes 256 --max-rechunk-depth 2 --stdout --quiet >/dev/null && echo "ok (depth cap)"

note "Live: aggressive 8MB budget for a pathological xxxxl file"
live "${CLI[@]}" --file-key ABC123fileKEY --size xxxxl --max-part-bytes 8388608 --max-rechunk-depth 6 --resume
