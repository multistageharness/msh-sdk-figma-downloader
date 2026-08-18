#!/usr/bin/env bash
# Run every offline example in order. Needs no token and no network — it is a
# living smoke test for the whole input surface. CI-friendly: non-zero on failure.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

for s in "$HERE"/offline/*.sh; do
  echo
  echo "########################################################################"
  echo "# $(basename "$s")"
  echo "########################################################################"
  bash "$s"
done

echo
echo "All offline examples passed."
