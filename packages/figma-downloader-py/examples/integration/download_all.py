#!/usr/bin/env python3
"""INTEGRATION (programmatic) — download every file in figma.json via the library.

Twin of ../../figma-downloader-ts/examples/integration/download-all.mjs.

Calls the same ``run()`` the CLI wraps, once per key, fully in-process — no
subprocess. With a token in the environment it hits the live Figma API; without
one it does an offline ``--mock`` pass so the example always runs and the
skeleton -> chunk -> reconstruct pipeline is exercised end-to-end.

Run from the package root:

    FIGMA_TOKEN=figd_xxx python3 examples/integration/download_all.py   # live
    python3 examples/integration/download_all.py                        # offline (--mock)
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parent.parent.parent
# Make the package importable when run directly (without `pip install -e .`).
sys.path.insert(0, str(PKG_ROOT))

from figma_downloader.cli import run  # noqa: E402

FILES_JSON = PKG_ROOT.parent.parent / "figma.json"


def main() -> int:
    keys = json.loads(FILES_JSON.read_text(encoding="utf-8"))
    live = bool(os.environ.get("FIGMA_TOKEN") or os.environ.get("FIGMA_API_TOKEN")
                or os.environ.get("FIGMA_ACCESS_TOKEN"))
    print(f"-> {len(keys)} key(s) from {FILES_JSON} — "
          f"{'LIVE' if live else 'OFFLINE (--mock)'} mode", file=sys.stderr)

    os.chdir(PKG_ROOT)  # default out/<key>/ lands at the package root (gitignored)

    ok, failed = 0, []
    for key in keys:
        # Live: fetch the real file. Offline: --mock ignores the key but drives the
        # same pipeline; a per-key work dir keeps each run's output separate.
        argv = (["--file-key", key, "--resume", "--quiet"] if live
                else ["--mock", "--work-dir", str(Path("out", key)), "--quiet"])
        try:
            code = run(argv)
        except Exception as err:  # noqa: BLE001 — keep the batch going past one failure
            code = 1
            print(f"  FAIL {key} ({err})", file=sys.stderr)
        else:
            print(f"  {'ok  ' if code == 0 else 'FAIL'} {key}"
                  f"{'' if code == 0 else f' (exit {code})'}", file=sys.stderr)
        if code == 0:
            ok += 1
        else:
            failed.append(key)

    print(f"\n-> done: {ok} ok, {len(failed)} failed of {len(keys)} "
          f"→ out/<key>/full.json", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
