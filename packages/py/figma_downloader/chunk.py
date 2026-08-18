"""chunk.py — plan and execute the chunked download.

Twin of ts/src/chunk.mjs. Content-hash part files (TR-12),
byte/time-aware re-chunking (TR-3), manifest-aware resume, and a single-pass
manifest write. The pool runs batches concurrently; each batch task returns its
local results which are aggregated in batch order (deterministic, lock-free).
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, Callable

from .client import fetch_nodes
from .util import batch, byte_length, pool, sha256_of_batch, stringify


def collect_frontier_ids(skeleton: dict, depth: int) -> list[str]:
    """Collect ids of every node at exactly `depth` (the chunk roots)."""
    doc = (skeleton or {}).get("document")
    if not doc:
        raise ValueError("skeleton has no `document` — cannot plan chunks.")
    ids: list[str] = []

    def walk(node: Any, level: int) -> None:
        if not isinstance(node, dict):
            return
        if level == depth:
            if node.get("id"):
                ids.append(node["id"])
            return
        for child in node.get("children") or []:
            walk(child, level + 1)

    walk(doc, 0)
    seen = set()
    out = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def _strip_children(node: dict) -> dict:
    return {k: v for k, v in node.items() if k != "children"}


def download_chunks(
    *,
    file_key: str,
    token: str,
    frontier_ids: list[str],
    depth: int,
    work_dir: str,
    size: str | None = None,
    batch_size: int = 10,
    concurrency: int = 4,
    resume: bool = False,
    retries: int = 3,
    timeout_ms: int = 60_000,
    geometry: bool = False,
    node_depth: int | None = None,
    stream: bool = False,
    rechunk: bool = False,
    max_part_bytes: int = 0,
    max_part_ms: int = 0,
    max_rechunk_depth: int = 4,
    limiter=None,
    log: Callable[..., None] = lambda *a: None,
) -> dict:
    parts_dir = os.path.join(work_dir, "parts")
    os.makedirs(parts_dir, exist_ok=True)
    batches = batch(frontier_ids, batch_size)

    prior_groups: dict[str, dict] = {}
    if resume:
        try:
            with open(os.path.join(work_dir, "manifest.json"), encoding="utf-8") as fh:
                prior = json.load(fh)
            for g in prior.get("groups", []):
                prior_groups[g["sha"]] = g
        except (OSError, ValueError, KeyError):
            pass

    def maps_of(entry: dict) -> dict:
        return {
            "components": entry.get("components") or {},
            "componentSets": entry.get("componentSets") or {},
            "styles": entry.get("styles") or {},
        }

    def node_part(node: dict, maps: dict) -> dict:
        return {"nodes": {node["id"]: {"document": node, **maps}}}

    def write_json(part_path: str, json_str: str) -> None:
        with open(part_path, "w", encoding="utf-8") as f:
            if not stream:
                f.write(json_str)
            else:
                ch = 1 << 16
                for i in range(0, len(json_str), ch):
                    f.write(json_str[i : i + ch])

    def process(args):
        ids, bi = args
        gsha = sha256_of_batch(ids)
        group_files: list[str] = []
        local_parts: list[dict] = []
        oversized: list[str] = []
        counters = {"rechunked": 0}
        written_local: set[str] = set()

        def emit(file: str, payload, ids2, elapsed=0.0, from_disk=False, disk_bytes=0):
            if file in written_local:
                return
            written_local.add(file)
            sha = file[5:-5]
            if from_disk:
                local_parts.append({"file": file, "ids": list(ids2), "sha": sha, "bytes": disk_bytes, "elapsedMs": 0, "fresh": False})
            else:
                json_str = stringify(payload)
                b = byte_length(json_str)
                write_json(os.path.join(parts_dir, file), json_str)
                local_parts.append({"file": file, "ids": list(ids2), "sha": sha, "bytes": b, "elapsedMs": elapsed, "fresh": True})

        # --- Resume: reuse a prior group's parts if all present. ---
        if resume and gsha in prior_groups:
            g = prior_groups[gsha]
            parts = g.get("parts", [])
            if parts and all(os.path.exists(os.path.join(parts_dir, f)) for f in parts):
                for f in parts:
                    st = os.stat(os.path.join(parts_dir, f))
                    emit(f, None, g.get("ids", ids), from_disk=True, disk_bytes=st.st_size)
                    group_files.append(f)
                log(f"  [{bi + 1}/{len(batches)}] resume: skip group {gsha} ({len(group_files)} part(s))")
                return {"sha": gsha, "ids": ids, "parts": group_files, "rechunked": bool(g.get("rechunked")),
                        "resumed": True, "localParts": local_parts, "localRechunked": 0, "oversized": []}

        # --- Fetch the batch. ---
        if limiter:
            limiter.acquire()
        t0 = time.monotonic()
        data = fetch_nodes(
            file_key, ids, token,
            retries=retries, timeout_ms=timeout_ms, geometry=geometry, node_depth=node_depth,
            on_retry=lambda info: log(f"  [{bi + 1}/{len(batches)}] retry #{info['attempt']} (status {info['status']}) in {info['waitMs']}ms"),
        )
        elapsed = (time.monotonic() - t0) * 1000
        batch_bytes = byte_length(stringify(data))
        over = rechunk and ((max_part_bytes > 0 and batch_bytes > max_part_bytes) or (max_part_ms > 0 and elapsed > max_part_ms))

        if not over:
            file = f"part-{gsha}.json"
            emit(file, data, ids, elapsed)
            group_files.append(file)
            got = len((data.get("nodes") or {}))
            log(f"  [{bi + 1}/{len(batches)}] wrote {file} — {got}/{len(ids)} node(s), {batch_bytes}B")
            return {"sha": gsha, "ids": ids, "parts": group_files, "rechunked": False,
                    "resumed": False, "localParts": local_parts, "localRechunked": 0, "oversized": []}

        # --- Over budget: re-chunk each subtree in memory. ---
        log(f"  [{bi + 1}/{len(batches)}] over budget ({batch_bytes}B / {elapsed:.0f}ms) — re-chunking")

        def split_node(node: dict, level: int, maps: dict) -> None:
            b = byte_length(stringify(node))
            kids = node.get("children") or []
            o = max_part_bytes > 0 and b > max_part_bytes
            can = rechunk and level < max_rechunk_depth and len(kids) > 0
            if (not o) or (not can):
                if o and not kids and node["id"] not in oversized:
                    oversized.append(node["id"])
                file = f"part-{sha256_of_batch([node['id']])}.json"
                emit(file, node_part(node, maps), [node["id"]])
                group_files.append(file)
                return
            counters["rechunked"] += 1
            shallow = dict(node)
            shallow["children"] = [_strip_children(c) for c in kids]
            file = f"part-{sha256_of_batch([node['id']])}.json"
            emit(file, node_part(shallow, maps), [node["id"]])
            group_files.append(file)
            for child in kids:
                split_node(child, level + 1, maps)

        for id_ in ids:
            entry = (data.get("nodes") or {}).get(id_)
            if not entry or entry.get("document") is None:
                continue
            split_node(entry["document"], depth, maps_of(entry))
        return {"sha": gsha, "ids": ids, "parts": group_files, "rechunked": True,
                "resumed": False, "localParts": local_parts, "localRechunked": counters["rechunked"], "oversized": oversized}

    results = pool([(ids, bi) for bi, ids in enumerate(batches)], concurrency, process)

    parts_meta: list[dict] = []
    groups_meta: list[dict] = []
    written = 0
    skipped = 0
    rechunked = 0
    oversized_all: list[str] = []
    seen: set[str] = set()
    for r in results:
        g = {"sha": r["sha"], "ids": r["ids"], "parts": r["parts"], "rechunked": r["rechunked"]}
        if r["resumed"]:
            g["resumed"] = True
            skipped += 1
        groups_meta.append(g)
        rechunked += r["localRechunked"]
        for m in r["localParts"]:
            if m["file"] in seen:
                continue
            seen.add(m["file"])
            if m["fresh"]:
                written += 1
            parts_meta.append({"file": m["file"], "ids": m["ids"], "sha": m["sha"], "bytes": m["bytes"], "elapsedMs": m["elapsedMs"]})
        for o in r["oversized"]:
            if o not in oversized_all:
                oversized_all.append(o)

    parts_meta.sort(key=lambda p: p["file"])
    part_files = [os.path.join(parts_dir, p["file"]) for p in parts_meta]

    manifest = {
        "fileKey": file_key,
        "size": size,
        "frontierDepth": depth,
        "batchSize": batch_size,
        "concurrency": concurrency,
        "idCount": len(frontier_ids),
        "batchCount": len(batches),
        "downloaded": written,
        "resumedSkipped": skipped,
        "rechunked": rechunked,
        "oversizedLeaves": oversized_all,
        "frontierIds": list(frontier_ids),
        "parts": parts_meta,
        "groups": groups_meta,
    }
    with open(os.path.join(work_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    return {"manifest": manifest, "partFiles": part_files}
