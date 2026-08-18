#!/usr/bin/env bash
# 05 — Hand-tune the paging strategy.
#
# Explicit flags override the tier preset. Use them to trade throughput against the
# Figma rate limit, or to adapt to a flaky connection.
#
#   --depth <n>        frontier depth to split at (1=pages, 2=top frames, 3=deeper)
#   --batch-size <n>   node ids per /nodes request
#   --concurrency <n>  parallel /nodes requests in flight
#   --rate <n>         global request ceiling in requests/sec (0 = unlimited)
#   --retries <n>      retries per request on 429/5xx/network (default 3)
#   --timeout-ms <n>   per-request timeout (default 60000)
source "$(dirname "$0")/_lib.sh"

note "Override depth + batch-size + concurrency against the mock"
run "${CLI[@]}" --mock --depth 1 --batch-size 3 --concurrency 2 --stdout --quiet >/dev/null && echo "ok"

note "Throttle to a global ceiling of 2 requests/sec (TokenBucket limiter engages)"
run "${CLI[@]}" --mock --rate 2 --stdout --quiet >/dev/null && echo "ok (rate-limited)"

note "Patience knobs: more retries, longer timeout (for slow/large subtrees)"
run "${CLI[@]}" --mock --retries 5 --timeout-ms 120000 --stdout --quiet >/dev/null && echo "ok"

note "Live: gentle profile for a shared/CI token near the rate limit"
live "${CLI[@]}" --file-key ABC123fileKEY --concurrency 2 --rate 3 --batch-size 5 --retries 5 --timeout-ms 90000

note "Live: aggressive profile on a fast connection with a generous token"
live "${CLI[@]}" --file-key ABC123fileKEY --depth 3 --batch-size 2 --concurrency 8
