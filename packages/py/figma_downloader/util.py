"""util.py — small dependency-free helpers shared across the downloader.

Twin of ts/src/util.mjs. Serialization is tuned to produce
byte-identical output to Node's JSON.stringify (compact: no spaces; non-ASCII
left as UTF-8; U+2028/U+2029 escaped) so the cross-language parity harness can
diff full.json byte-for-byte.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Iterable, Sequence

# The two Unicode line terminators json.dumps emits literally. Built from code
# points so this source file never contains a raw separator.
_LS = chr(0x2028)
_PS = chr(0x2029)


def sleep(ms: float) -> None:
    """Sleep for `ms` milliseconds."""
    time.sleep(ms / 1000.0)


def stringify(obj: Any, pretty: bool = False) -> str:
    """JSON-serialize `obj`, escaping U+2028 / U+2029.

    Compact form matches Node's `JSON.stringify(obj)` byte-for-byte:
    separators `,`/`:` with no spaces and `ensure_ascii=False`.
    """
    if pretty:
        s = json.dumps(obj, indent=2, ensure_ascii=False)
    else:
        s = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    return escape_line_separators(s)


def escape_line_separators(s: str) -> str:
    """Escape U+2028 / U+2029 in an already-serialized JSON string."""
    return s.replace(_LS, "\\u2028").replace(_PS, "\\u2029")


def pool(items: Sequence[Any], concurrency: int, fn: Callable[[Any], Any]) -> list:
    """Run `fn` over `items` with bounded concurrency, preserving input order.

    Mirrors the Node order-preserving worker pool. A per-task rate limiter, when
    needed, is acquired *inside* `fn` (so one token == one request), matching the
    Node behaviour where the limiter gates each task start.
    """
    limit = max(1, int(concurrency))
    items = list(items)
    if not items:
        return []
    with ThreadPoolExecutor(max_workers=min(limit, len(items))) as ex:
        return list(ex.map(fn, items))


class TokenBucket:
    """A simple thread-safe token-bucket rate limiter.

    `rate` tokens are added per second up to `burst` capacity; `acquire()` blocks
    until a token is available. `rate <= 0` disables limiting.
    """

    def __init__(self, rate: float = 0, burst: int = 1, now: Callable[[], float] | None = None):
        self.rate = rate
        self._cap = burst
        self._tokens = float(burst)
        self._now = now or (lambda: time.monotonic() * 1000.0)
        self._last = self._now()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        if self.rate <= 0:
            return
        t = self._now()
        self._tokens = min(self._cap, self._tokens + ((t - self._last) / 1000.0) * self.rate)
        self._last = t

    def acquire(self) -> None:
        if self.rate <= 0:
            return
        while True:
            with self._lock:
                self._refill()
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
                wait_ms = max(10, ((1 - self._tokens) / self.rate) * 1000.0)
            sleep(wait_ms)

    def set_capacity(self, c: int) -> None:
        with self._lock:
            self._cap = max(1, c)
            self._tokens = min(self._tokens, self._cap)

    @property
    def capacity(self) -> int:
        return self._cap


def batch(arr: Sequence[Any], size: int) -> list[list]:
    """Split `arr` into consecutive sub-lists of at most `size` items."""
    n = max(1, int(size))
    return [list(arr[i : i + n]) for i in range(0, len(arr), n)]


def pad(num: int, width: int = 4) -> str:
    """Zero-pad an integer to `width` (for stable, sortable indices)."""
    return str(num).rjust(width, "0")


def sha256_of_batch(ids: Iterable[str], length: int = 12) -> str:
    """Deterministic content hash of an id-batch (sorted, joined, sha256 prefix).

    Matches the Node `sha256OfBatch`: ASCII ids sort identically under JS string
    sort and Python's, so the same batch yields the same part filename in both.
    """
    canon = ",".join(sorted(ids))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()[:length]


def count_nodes(node: Any) -> int:
    """Count every node in a Figma (sub)tree rooted at `node`."""
    if not isinstance(node, dict):
        return 0
    n = 1
    for child in node.get("children") or []:
        n += count_nodes(child)
    return n


def byte_length(s: str) -> int:
    """Byte length of `s` as UTF-8."""
    return len(s.encode("utf-8"))
