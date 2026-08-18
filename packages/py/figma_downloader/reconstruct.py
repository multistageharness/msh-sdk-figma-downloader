"""reconstruct.py — graft downloaded subtrees onto the skeleton -> full file.

Twin of ts/src/reconstruct.mjs. Recursive, id-keyed graft that
handles both normal frontier parts (full subtree) and re-chunked parts (a shallow
parent plus per-child full parts). Key insertion order mirrors the Node spread so
the compact full.json is byte-identical across the twins.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from .util import stringify


def index_parts(parts: list[dict]) -> dict:
    """Build {id -> node} plus merged component/style maps from /nodes responses."""
    node_map: dict[str, Any] = {}
    components: dict = {}
    component_sets: dict = {}
    styles: dict = {}
    for part in parts:
        for id_, entry in (part.get("nodes") or {}).items():
            if entry and entry.get("document") is not None:
                node_map[id_] = entry["document"]
            components.update(entry.get("components") or {})
            component_sets.update(entry.get("componentSets") or {})
            styles.update(entry.get("styles") or {})
    return {"nodeMap": node_map, "components": components, "componentSets": component_sets, "styles": styles}


def reconstruct(skeleton: dict, indexed: dict, frontier_ids: list[str] | None = None) -> dict:
    """Produce the full file object from a skeleton + indexed parts. Pure."""
    frontier_ids = frontier_ids or []
    node_map = indexed["nodeMap"]
    counter = {"grafted": 0}

    def graft(node: Any) -> Any:
        if not isinstance(node, dict):
            return node
        cur = node
        nid = node.get("id")
        if nid is not None and nid in node_map:
            cur = node_map[nid]
            counter["grafted"] += 1
        if isinstance(cur.get("children"), list):
            new = dict(cur)
            new["children"] = [graft(c) for c in cur["children"]]
            return new
        return cur

    document = graft(skeleton["document"])
    missing = [i for i in frontier_ids if i not in node_map]

    file = dict(skeleton)
    file["document"] = document
    file["components"] = {**(skeleton.get("components") or {}), **indexed["components"]}
    file["componentSets"] = {**(skeleton.get("componentSets") or {}), **indexed["componentSets"]}
    file["styles"] = {**(skeleton.get("styles") or {}), **indexed["styles"]}
    return {"file": file, "stats": {"grafted": counter["grafted"], "missing": missing}}


def load_parts(parts_dir: str) -> list[dict]:
    """Read every part-*.json under parts_dir, in sorted (stable) order."""
    try:
        entries = os.listdir(parts_dir)
    except OSError as err:
        raise RuntimeError(f"cannot read parts dir {parts_dir}: {err}") from err
    files = sorted(f for f in entries if re.fullmatch(r"part-.*\.json", f))
    parts = []
    for f in files:
        with open(os.path.join(parts_dir, f), encoding="utf-8") as fh:
            parts.append(json.load(fh))
    return parts


def reconstruct_from_dir(work_dir: str, out_path: str, frontier_ids: list[str] | None = None) -> dict:
    """End-to-end reconstruct from a work dir (skeleton.json + parts/)."""
    with open(os.path.join(work_dir, "skeleton.json"), encoding="utf-8") as fh:
        skeleton = json.load(fh)
    if frontier_ids is None:
        try:
            with open(os.path.join(work_dir, "manifest.json"), encoding="utf-8") as fh:
                manifest = json.load(fh)
            frontier_ids = manifest.get("frontierIds") or []
        except OSError:
            frontier_ids = []
    parts = load_parts(os.path.join(work_dir, "parts"))
    indexed = index_parts(parts)
    result = reconstruct(skeleton, indexed, frontier_ids)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(stringify(result["file"]))
    result["outPath"] = out_path
    return result
