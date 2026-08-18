"""client.py — Figma REST API access for the chunked downloader.

Twin of figma-downloader-ts/src/figmaClient.mjs. Exposes fetch_skeleton,
fetch_nodes, fetch_whole_file, all through `figma_get` (abort-timeout + bounded
retry with Retry-After honouring + typed errors). Network access goes through the
mutable `_http['fetch']` holder so tests can swap it offline.
"""

from __future__ import annotations

import re
from typing import Any, Callable
from urllib.parse import quote

from .errors import FigmaError, FigmaNetworkError, FigmaTimeoutError, error_for_status
from .http_fetch import make_fetch
from .util import sleep

FIGMA_API_BASE = "https://api.figma.com/v1"

# Injectable network holder — reassign _http["fetch"] in tests.
_http: dict[str, Callable] = {"fetch": make_fetch()}

RETRYABLE = {429, 500, 502, 503, 504}


def parse_file_key(input_: Any) -> str:
    """Parse a Figma file key from a URL or a path/string. '' when none found."""
    s = str(input_ or "").strip()
    if not s:
        return ""
    m = re.search(r"figma\.com/(?:file|design)/([0-9A-Za-z]{10,})", s, re.IGNORECASE)
    if m:
        return m.group(1)
    segs = [seg for seg in re.split(r"[\\/]", s) if seg]
    keyish = [seg for seg in segs if re.fullmatch(r"[0-9A-Za-z]{20,}", seg)]
    if keyish:
        return sorted(keyish, key=len, reverse=True)[0]
    if re.fullmatch(r"[0-9A-Za-z]{20,}", s):
        return s
    return ""


def _backoff(attempt: int) -> float:
    """0.5s, 1s, 2s, 4s ... capped at 15s. Deterministic for testability (ms)."""
    return min(500 * 2 ** attempt, 15_000)


def figma_get(path_and_query: str, token: str, *, timeout_ms: int = 60_000, retries: int = 3, on_retry=None) -> Any:
    """Core authenticated GET with timeout, retry/backoff, and typed errors."""
    if not token:
        raise FigmaError("FIGMA_TOKEN is required (or use --mock).", exit_code=3)
    url = f"{FIGMA_API_BASE}{path_and_query}"
    attempt = 0
    while True:
        try:
            res = _http["fetch"](url, headers={"X-Figma-Token": token}, timeout_ms=timeout_ms)
        except TimeoutError:
            if attempt >= retries:
                raise FigmaTimeoutError(f"Figma API timed out after {timeout_ms / 1000}s for {path_and_query}")
            sleep(_backoff(attempt))
            attempt += 1
            continue
        except (ConnectionError, OSError) as e:
            if attempt >= retries:
                raise FigmaNetworkError(f"Figma API network error for {path_and_query}: {str(e)[:120]}")
            sleep(_backoff(attempt))
            attempt += 1
            continue

        if res.ok:
            return res.json()

        body = res.text()
        err = error_for_status(res.status, path_and_query, body)
        if not (err.retryable and attempt < retries):
            raise err
        retry_after = res.header("retry-after")
        wait_ms = _backoff(attempt)
        try:
            if retry_after is not None and float(retry_after) > 0:
                wait_ms = float(retry_after) * 1000
        except (TypeError, ValueError):
            pass
        if on_retry:
            on_retry({"status": res.status, "attempt": attempt + 1, "waitMs": wait_ms, "pathAndQuery": path_and_query})
        sleep(wait_ms)
        attempt += 1


def fetch_skeleton(file_key: str, token: str, *, depth: int = 2, geometry: bool = False, **opts) -> Any:
    """Fetch the shallow file skeleton truncated at `depth`."""
    if not file_key:
        raise ValueError("fetch_skeleton: file_key is required.")
    geo = "&geometry=paths" if geometry else ""
    return figma_get(f"/files/{quote(file_key, safe='')}?depth={depth}{geo}", token, **opts)


def fetch_whole_file(file_key: str, token: str, *, geometry: bool = False, **opts) -> Any:
    """Fetch the entire file in one request (the `sm` fast path)."""
    if not file_key:
        raise ValueError("fetch_whole_file: file_key is required.")
    geo = "?geometry=paths" if geometry else ""
    return figma_get(f"/files/{quote(file_key, safe='')}{geo}", token, **opts)


def fetch_nodes(file_key: str, ids: list[str], token: str, *, geometry: bool = False, node_depth: int | None = None, **opts) -> Any:
    """Fetch the full subtree for a batch of node ids."""
    if not file_key:
        raise ValueError("fetch_nodes: file_key is required.")
    if not ids:
        return {"nodes": {}}
    ids_param = ",".join(quote(i, safe="") for i in ids)
    geo = "&geometry=paths" if geometry else ""
    depth_q = f"&depth={node_depth}" if node_depth else ""
    return figma_get(f"/files/{quote(file_key, safe='')}/nodes?ids={ids_param}{depth_q}{geo}", token, **opts)
