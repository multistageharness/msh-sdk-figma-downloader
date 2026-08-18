#!/usr/bin/env bash
# 02 — Choosing the input: --url vs --file-key vs --mock, and the token env vars.
#
# Exactly one input source is required. The file key is either parsed from a URL,
# given directly, or faked by --mock. Live sources need a Personal Access Token in
# the environment (any of three names is accepted).
source "$(dirname "$0")/_lib.sh"

note "--mock needs no token at all"
run "${CLI[@]}" --mock --stdout --quiet >/dev/null && echo "ok (mock)"

note "--url — the key is parsed out of any Figma file/design URL"
live "${CLI[@]}" --url "https://www.figma.com/design/ABC123fileKEY/My-Design" --stdout --quiet

note "--file-key — pass the key directly"
live "${CLI[@]}" --file-key ABC123fileKEY --stdout --quiet

note "Token env var: FIGMA_TOKEN is checked first…"
live env FIGMA_TOKEN=figd_xxx "${CLI[@]}" --file-key ABC123fileKEY --skeleton-only

note "…then FIGMA_API_TOKEN, then FIGMA_ACCESS_TOKEN (aliases for the same PAT)"
echo '  FIGMA_API_TOKEN=figd_xxx    python3 -m figma_downloader --file-key <KEY> ...'
echo '  FIGMA_ACCESS_TOKEN=figd_xxx python3 -m figma_downloader --file-key <KEY> ...'

note "No input at all is a usage error (exit 2)"
run bash -c '"$@"; echo "exit=$?"' _ "${CLI[@]}" || true
