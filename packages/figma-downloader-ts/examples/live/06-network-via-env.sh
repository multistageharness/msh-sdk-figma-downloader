#!/usr/bin/env bash
# LIVE 06 — Resolve proxy/TLS from environment variables (no flags, no config).
# Exercises: FIGMA_PROXY / HTTPS_PROXY / HTTP_PROXY / ALL_PROXY,
#            FIGMA_SSL_VERIFY / NODE_TLS_REJECT_UNAUTHORIZED, FIGMA_TOKEN
#
# Env is the lowest override above the built-in defaults. The tool logs which
# source each value came from (`from env`). A CLI flag or config file would win.
source "$(dirname "$0")/../_common.sh"

KEY="${1:-TFTCSGbqpyxex6QRYqqbzb}"

echo "Equivalent env-driven invocation:"
cat <<EOF
  export FIGMA_TOKEN=figd_xxx
  export FIGMA_PROXY=http://proxy.corp.example:8080   # or HTTPS_PROXY / ALL_PROXY
  export FIGMA_SSL_VERIFY=false                        # or NODE_TLS_REJECT_UNAUTHORIZED=0
  node \$BIN --file-key $KEY
EOF

CMD=(env FIGMA_PROXY="${FIGMA_PROXY:-http://proxy.corp.example:8080}" \
         FIGMA_SSL_VERIFY="${FIGMA_SSL_VERIFY:-false}" \
         node "$BIN" --file-key "$KEY")
if need_token; then run "${CMD[@]}"; else printf '(set FIGMA_TOKEN to run)\n'; fi
