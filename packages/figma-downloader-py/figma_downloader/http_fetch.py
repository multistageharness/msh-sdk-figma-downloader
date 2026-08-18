"""http_fetch.py — stdlib HTTP transport with proxy + TLS-toggle support.

Twin of figma-downloader-ts/src/httpFetch.mjs. Built on urllib so it can route
through an HTTP/HTTPS proxy (including HTTPS CONNECT tunnelling, which urllib does
automatically) and toggle TLS certificate verification — with no dependencies.

Exposes a `fetch(url, headers, timeout_ms)` callable returning a `Response`, and
translates transport failures into TimeoutError / ConnectionError so the client's
retry loop can classify them.
"""

from __future__ import annotations

import json
import socket
import ssl
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse, urlunparse


class Response:
    """The slice of an HTTP response the client uses (duck-typed everywhere)."""

    def __init__(self, ok: bool, status: int, body: str, headers: dict | None = None):
        self.ok = ok
        self.status = status
        self._body = body
        self._headers = {str(k).lower(): v for k, v in (headers or {}).items()}

    def text(self) -> str:
        return self._body

    def json(self) -> Any:
        return json.loads(self._body)

    def header(self, name: str):
        return self._headers.get(str(name).lower())


def make_fetch(proxy: str | None = None, ssl_verify: bool = True):
    """Build a `fetch(url, headers, timeout_ms)` callable."""
    handlers: list[urllib.request.BaseHandler] = []
    # Explicit proxy, or none (ignore ambient env — config.py already resolved it).
    handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy} if proxy else {}))
    ctx = ssl.create_default_context()
    if not ssl_verify:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    handlers.append(urllib.request.HTTPSHandler(context=ctx))
    opener = urllib.request.build_opener(*handlers)

    def fetch(url: str, headers: dict | None = None, timeout_ms: int = 60_000) -> Response:
        req = urllib.request.Request(url, headers=headers or {}, method="GET")
        try:
            with opener.open(req, timeout=timeout_ms / 1000.0) as resp:
                body = resp.read().decode("utf-8")
                return Response(True, getattr(resp, "status", 200), body, dict(resp.headers.items()))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace") if hasattr(e, "read") else ""
            hdrs = dict(e.headers.items()) if e.headers else {}
            return Response(False, e.code, body, hdrs)
        except socket.timeout as e:
            raise TimeoutError(str(e)) from e
        except urllib.error.URLError as e:
            if isinstance(e.reason, socket.timeout):
                raise TimeoutError(str(e.reason)) from e
            raise ConnectionError(str(e.reason)) from e

    return fetch


def redact_proxy(proxy: str | None) -> str:
    """Redact credentials from a proxy URL for safe logging."""
    if not proxy:
        return ""
    try:
        p = urlparse(proxy)
        if p.username or p.password:
            netloc = f"***@{p.hostname}"
            if p.port:
                netloc += f":{p.port}"
            return urlunparse((p.scheme, netloc, p.path, p.params, p.query, p.fragment))
        return proxy
    except Exception:  # noqa: BLE001
        return proxy
