#!/usr/bin/env python3
"""10 — Programmatic use of the public library API (no CLI).

Runs fully offline: it swaps the HTTP transport for the in-process mock fixture, the
same trick the CLI uses for `--mock`. Every name exported from
``figma_downloader.__all__`` is touched here. For a LIVE run, delete the
``_use_mock_transport()`` call and pass a real ``token`` (see the comments).

Run from the package root:

    python3 examples/10-library-api.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

# Make the package importable when run directly (without `pip install -e .`).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from figma_downloader import (
    # input / fetch
    parse_file_key, figma_get, fetch_skeleton, fetch_nodes, fetch_whole_file,
    # planning + download
    collect_frontier_ids, download_chunks,
    # reconstruction
    index_parts, load_parts, reconstruct, reconstruct_from_dir,
    # sizing
    classify, resolve_strategy, TIERS, PRESETS,
    # network config
    resolve_network_config,
    # typed errors
    FigmaError, FigmaAuthError, FigmaNotFoundError, FigmaRateLimitError,
    FigmaServerError, FigmaNetworkError, FigmaTimeoutError,
)


def _use_mock_transport() -> None:
    """Point the client at the offline fixture (delete for a live run)."""
    from figma_downloader import client as client_mod
    from figma_downloader.mock import make_mock_fetch
    client_mod._http["fetch"] = make_mock_fetch()


def main() -> int:
    # --- 1. Parse a file key out of a URL (no network) -------------------------
    key = parse_file_key("https://www.figma.com/design/ABC123fileKEY/My-Design")
    print("parse_file_key ->", key)
    # ...or just use a bare key directly. --mock uses this sentinel key:
    key = "MOCKFILEKEY0000000000"

    # --- 2. Inspect the size tiers & their presets -----------------------------
    print("TIERS ->", TIERS)
    print("md preset ->", PRESETS["md"])

    # For a LIVE run set: token = os.environ["FIGMA_TOKEN"]
    token = *********
    _use_mock_transport()  # <-- remove this line to hit the real Figma API

    # --- 3. Fetch a shallow skeleton, then classify the file -------------------
    skeleton = fetch_skeleton(key, token, depth=2)
    frontier = collect_frontier_ids(skeleton, depth=2)
    from figma_downloader.util import byte_length, count_nodes, stringify
    tier = classify({
        "nodeCount": count_nodes(skeleton["document"]),
        "frontierWidth": len(frontier),
        "skeletonBytes": byte_length(stringify(skeleton)),
        "hasFrontier": bool(frontier),
    })
    print(f"classified -> {tier}  (frontier={len(frontier)} nodes)")

    # --- 4. Resolve the paging strategy (preset, optionally overridden) --------
    strategy = resolve_strategy(size=tier, concurrency=2, explicit={"concurrency": True})
    print("strategy ->", {k: strategy[k] for k in ("size", "depth", "batchSize", "concurrency")})

    # --- 5. Download chunks to a work dir, then reconstruct full.json -----------
    with tempfile.TemporaryDirectory() as work_dir:
        download_chunks(
            file_key=key, token=token, frontier_ids=frontier, depth=strategy["depth"],
            work_dir=work_dir, size=strategy["size"], batch_size=strategy["batchSize"],
            concurrency=strategy["concurrency"], resume=False, retries=3, timeout_ms=60_000,
            geometry=False, stream=strategy["stream"], rechunk=strategy["rechunk"],
            max_part_bytes=strategy["maxPartBytes"], max_part_ms=strategy["maxPartMs"],
            max_rechunk_depth=4, limiter=None, log=lambda *a: None,
        )
        # Reconstruct in two equivalent ways:
        parts = load_parts(Path(work_dir, "parts"))
        result = reconstruct(skeleton, index_parts(parts), frontier)
        print("reconstruct -> nodes:", count_nodes(result["file"]["document"]),
              "grafted:", result["stats"]["grafted"])

        # reconstruct_from_dir reads skeleton.json from the work dir (the CLI writes
        # it during a run); persist it first, then rebuild end-to-end from disk.
        Path(work_dir, "skeleton.json").write_text(stringify(skeleton, True), encoding="utf-8")
        out_path = Path(work_dir, "full.json")
        reconstruct_from_dir(work_dir, str(out_path), frontier)
        print("reconstruct_from_dir wrote", out_path.name, f"({out_path.stat().st_size} bytes)")

    # --- 6. Other fetch primitives (shown; covered above via the mock) ---------
    # whole = fetch_whole_file(key, token)                  # one GET, small files
    # nodes = fetch_nodes(key, frontier, token)             # full subtrees by id
    # raw   = figma_get(f"/files/{key}", token)             # low-level GET helper
    _ = (fetch_whole_file, fetch_nodes, figma_get)

    # --- 7. Network config resolution (flag > config file > env > default) -----
    net = resolve_network_config({"proxy": "http://proxy.example:8080"}, env={})
    print("net ->", {"proxy": net.proxy, "ssl_verify": net.ssl_verify, "src": net.sources["proxy"]})

    # --- 8. The typed error taxonomy (catch by class -> exit-code mapping) ------
    for exc in (FigmaAuthError, FigmaNotFoundError, FigmaRateLimitError,
                FigmaServerError, FigmaNetworkError, FigmaTimeoutError):
        assert issubclass(exc, FigmaError)
    print("error taxonomy ->", [e.__name__ for e in (
        FigmaAuthError, FigmaNotFoundError, FigmaRateLimitError,
        FigmaServerError, FigmaNetworkError, FigmaTimeoutError)])

    print("\nOK — every public API touched.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
