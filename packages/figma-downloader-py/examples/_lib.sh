#!/usr/bin/env bash
# _lib.sh — shared helpers sourced by the example scripts.
#
# `cd` to the package root so `python3 -m figma_downloader` resolves, and provide:
#   run  <cmd...>  — print the command, then execute it (offline / mock-safe)
#   live <cmd...>  — print the command only (illustrative — uses placeholder keys
#                    that would 404; copy it and substitute your real --file-key/--url)
#   note <text>    — print a section/explanation line
set -euo pipefail

# Resolve the package root (parent of examples/) regardless of caller's cwd.
PKG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PKG_ROOT"

CLI=(python3 -m figma_downloader)

note() { printf '\n\033[1;36m# %s\033[0m\n' "$*"; }

run() {
  printf '\033[0;32m$ %s\033[0m\n' "$*"
  "$@"
}

live() {
  printf '\033[0;33m$ %s\033[0m\n' "$*"
  printf '\033[0;90m  (illustrative — substitute a real --file-key/--url + your FIGMA_TOKEN)\033[0m\n'
}
