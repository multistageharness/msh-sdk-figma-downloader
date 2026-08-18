"""mock.py — an offline fake of the Figma REST API.

Twin of ts/src/mock.mjs. Serves the canonical shared fixture
(packages/shared/fixtures/mock-file.json) through /files/:key?depth=N (truncated),
/files/:key/nodes?ids= (full subtrees), and /files/:key (whole file). Byte-
identical fixture data to the Node mock — the bedrock of the parity harness.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .http_fetch import Response

_FIXTURE = Path(__file__).resolve().parent.parent.parent / "shared" / "fixtures" / "mock-file.json"

MOCK_FILE = json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _truncate(node: dict, level: int, depth: int) -> dict:
    copy_ = dict(node)
    if isinstance(node.get("children"), list):
        if level >= depth:
            copy_.pop("children", None)
        else:
            copy_["children"] = [_truncate(c, level + 1, depth) for c in node["children"]]
    return copy_


def _find_node(node: dict, node_id: str):
    if node.get("id") == node_id:
        return node
    for c in node.get("children") or []:
        hit = _find_node(c, node_id)
        if hit:
            return hit
    return None


def make_mock_fetch(file: dict | None = None):
    """Build a fetch(url, ...) serving MOCK_FILE through the endpoints."""
    file = file if file is not None else MOCK_FILE

    def mock_fetch(url: str, headers=None, timeout_ms: int = 60_000) -> Response:
        u = urlparse(url)
        qs = parse_qs(u.query, keep_blank_values=True)

        if "/nodes" in u.path:
            ids_raw = qs.get("ids", [""])[0]
            ids = [i for i in ids_raw.split(",") if i]
            nodes = {}
            for raw_id in ids:
                found = _find_node(file["document"], unquote(raw_id))
                if found:
                    nodes[raw_id] = {"document": found, "components": {}, "componentSets": {}, "styles": {}}
            obj = {"name": file["name"], "lastModified": file["lastModified"], "version": file["version"], "nodes": nodes}
            return Response(True, 200, json.dumps(obj), {})

        # /files/:key — honour depth (absent => whole file).
        if "depth" not in qs:
            return Response(True, 200, json.dumps(file), {})
        try:
            depth = int(qs["depth"][0])
        except (ValueError, KeyError):
            depth = 10**9
        out = dict(file)
        out["document"] = _truncate(file["document"], 0, depth)
        return Response(True, 200, json.dumps(out), {})

    return mock_fetch
