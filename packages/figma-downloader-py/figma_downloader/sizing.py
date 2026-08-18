"""sizing.py — make the downloader work for a file of ANY size.

Twin of figma-downloader-ts/src/sizing.mjs. Tier presets + auto classification.
Correctness for any size does not depend on the tier guess: the re-chunk loop in
chunk.py splits any over-budget part (TR-3). The tier is a performance hint.
"""

from __future__ import annotations

from typing import Any

TIERS = ["sm", "md", "large", "xl", "xxxxl"]

MB = 1024 * 1024

PRESETS: dict[str, dict] = {
    "sm":    {"mode": "whole",    "depth": 2, "batchSize": 10, "concurrency": 1, "stream": False, "rechunk": False, "maxPartBytes": 0,        "maxPartMs": 0,     "resume": False},
    "md":    {"mode": "frontier", "depth": 2, "batchSize": 10, "concurrency": 4, "stream": False, "rechunk": True,  "maxPartBytes": 32 * MB,  "maxPartMs": 45000, "resume": False},
    "large": {"mode": "frontier", "depth": 2, "batchSize": 5,  "concurrency": 6, "stream": True,  "rechunk": True,  "maxPartBytes": 24 * MB,  "maxPartMs": 45000, "resume": True},
    "xl":    {"mode": "frontier", "depth": 3, "batchSize": 3,  "concurrency": 8, "stream": True,  "rechunk": True,  "maxPartBytes": 16 * MB,  "maxPartMs": 40000, "resume": True},
    "xxxxl": {"mode": "frontier", "depth": 3, "batchSize": 2,  "concurrency": 8, "stream": True,  "rechunk": True,  "maxPartBytes": 8 * MB,   "maxPartMs": 30000, "resume": True},
}

DEFAULT_THRESHOLDS = {
    "sm":    {"nodes": 3_000,     "frontier": 0,     "bytes": 2 * MB},
    "md":    {"nodes": 30_000,    "frontier": 50,    "bytes": 8 * MB},
    "large": {"nodes": 150_000,   "frontier": 300,   "bytes": 50 * MB},
    "xl":    {"nodes": 1_000_000, "frontier": 2_000, "bytes": 50 * MB},
}


def _by_bound(value: float, key: str, thresholds: dict) -> str:
    if value <= thresholds["sm"][key]:
        return "sm"
    if value <= thresholds["md"][key]:
        return "md"
    if value <= thresholds["large"][key]:
        return "large"
    if value <= thresholds["xl"][key]:
        return "xl"
    return "xxxxl"


def _max_tier(*tiers: str) -> str:
    best = "sm"
    for t in tiers:
        if TIERS.index(t) > TIERS.index(best):
            best = t
    return best


def classify(signals: dict | None = None, thresholds: dict | None = None) -> str:
    """Classify a file into a tier from skeleton-derived signals."""
    signals = signals or {}
    thresholds = thresholds or DEFAULT_THRESHOLDS
    nodes = signals.get("nodeCount", 0)
    frontier = signals.get("frontierWidth", 0)
    bytes_ = signals.get("skeletonBytes", 0)

    if signals.get("hasFrontier") is False and nodes <= thresholds["sm"]["nodes"]:
        return "sm"

    return _max_tier(
        _by_bound(nodes, "nodes", thresholds),
        _by_bound(frontier, "frontier", thresholds),
        _by_bound(bytes_, "bytes", thresholds),
    )


def resolve_strategy(
    *,
    size: str | None = None,
    depth: int | None = None,
    batch_size: int | None = None,
    concurrency: int | None = None,
    max_part_bytes: int | None = None,
    max_part_ms: int | None = None,
    signals: dict | None = None,
    thresholds: dict | None = None,
    explicit: dict | None = None,
) -> dict:
    """Resolve the final strategy. Explicit CLI > tier preset > auto."""
    explicit = explicit or {}
    resolved_size = size if size and size != "auto" else None
    if not resolved_size:
        resolved_size = classify(signals or {}, thresholds or DEFAULT_THRESHOLDS)
    if resolved_size not in PRESETS:
        raise ValueError(f"unknown size tier: {resolved_size}")

    preset = dict(PRESETS[resolved_size])
    if explicit.get("depth") and depth is not None:
        preset["depth"] = depth
    if explicit.get("batchSize") and batch_size is not None:
        preset["batchSize"] = batch_size
    if explicit.get("concurrency") and concurrency is not None:
        preset["concurrency"] = concurrency
    if max_part_bytes is not None:
        preset["maxPartBytes"] = max_part_bytes
        preset["rechunk"] = max_part_bytes > 0
    if max_part_ms is not None:
        preset["maxPartMs"] = max_part_ms

    return {"size": resolved_size, **preset}
