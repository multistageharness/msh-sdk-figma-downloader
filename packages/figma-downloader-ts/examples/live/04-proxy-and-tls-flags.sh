#!/usr/bin/env bash
# LIVE 04 — Route through a corporate proxy and (optionally) relax TLS.
# Exercises: --proxy, --no-ssl-verify (alias --insecure), --ssl-verify, --no-proxy
#
# Highest-precedence network source is the CLI flag. --proxy installs a zero-dep
# CONNECT-tunnel transport; --no-ssl-verify disables certificate checks (loud
# warning on stderr — use only against a trusted intercepting proxy). --no-proxy
# and --ssl-verify force the safe defaults back on, overriding config/env.
source "$(dirname "$0")/../_common.sh"

KEY="${1:-TFTCSGbqpyxex6QRYqqbzb}"
PROXY="${PROXY_URL:-http://****:*****@proxy.corp.example:8080}"
CMD=(node "$BIN" --file-key "$KEY" --proxy "$PROXY" --no-ssl-verify)

echo "Tip: --proxy credentials are redacted in logs. To undo env/config instead:"
echo "     node \$BIN --file-key $KEY --no-proxy --ssl-verify"
if need_token; then run "${CMD[@]}"; else printf '$ %s\n' "${CMD[*]}"; fi
