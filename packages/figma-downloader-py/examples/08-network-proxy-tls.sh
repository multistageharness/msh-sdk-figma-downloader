#!/usr/bin/env bash
# 08 — Proxy + TLS verification, and the resolution precedence.
#
# Precedence, highest wins:
#   1. CLI flag    --proxy <url> / --no-proxy ; --ssl-verify / --no-ssl-verify
#   2. Config file figma-download.config.json (or --config <path>): {proxy, sslVerify}
#   3. Environment FIGMA_PROXY | HTTPS_PROXY | HTTP_PROXY | ALL_PROXY (+ lower-case)
#                  FIGMA_SSL_VERIFY ; NODE_TLS_REJECT_UNAUTHORIZED
#   4. Default     proxy = none ; sslVerify = true
#
# The mock path bypasses the real transport, so these live examples are gated on a
# token. The precedence itself is unit-tested in tests/test_config.py.
source "$(dirname "$0")/_lib.sh"

note "Route through a corporate proxy via CLI flag (wins over config + env)"
live "${CLI[@]}" --file-key ABC123fileKEY --proxy http://proxy.corp.example:8080 --skeleton-only

note "Proxy from the environment (no flag needed)"
echo '  FIGMA_PROXY=http://proxy.corp.example:8080 python3 -m figma_downloader --file-key <KEY> ...'
echo '  HTTPS_PROXY=http://proxy.corp.example:8080 python3 -m figma_downloader --file-key <KEY> ...'

note "Force a DIRECT connection even if config/env set a proxy"
live "${CLI[@]}" --file-key ABC123fileKEY --no-proxy --skeleton-only

note "Disable TLS verification (e.g. behind a TLS-intercepting proxy) — prints a WARNING"
live "${CLI[@]}" --file-key ABC123fileKEY --no-ssl-verify --skeleton-only
echo '  # --insecure is an alias for --no-ssl-verify'
echo '  # env equivalents: FIGMA_SSL_VERIFY=0   or   NODE_TLS_REJECT_UNAUTHORIZED=0'

note "Force TLS verification ON, overriding a config/env that disabled it"
live "${CLI[@]}" --file-key ABC123fileKEY --ssl-verify --skeleton-only

note "Read settings from a config file (see examples/figma-download.config.json)"
live "${CLI[@]}" --file-key ABC123fileKEY --config examples/figma-download.config.json --skeleton-only
