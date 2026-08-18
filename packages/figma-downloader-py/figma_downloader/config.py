"""config.py — resolve network configuration (proxy + TLS verification).

Twin of figma-downloader-ts/src/config.mjs. A user can override the defaults via
EITHER a config file OR environment variables (or a CLI flag).

Precedence, highest wins:
  1. CLI flag        --proxy <url> / --no-proxy ; --ssl-verify / --no-ssl-verify
  2. Config file     figma-download.config.json (or --config <path>): {proxy, sslVerify}
  3. Environment     FIGMA_PROXY_URL | FIGMA_PROXY | HTTPS_PROXY | HTTP_PROXY |
                     ALL_PROXY ; FIGMA_SSL_VERIFY ; NODE_TLS_REJECT_UNAUTHORIZED
  4. Default         proxy = None (none) ; sslVerify = True
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_CONFIG_FILENAME = "figma-download.config.json"


def _as_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    return s not in ("false", "0", "no", "off", "")


@dataclass
class NetworkConfig:
    proxy: str | None
    ssl_verify: bool
    sources: dict = field(default_factory=lambda: {"proxy": "default", "sslVerify": "default"})
    config_file: str | None = None


def load_config_file(args: dict, cwd: str | None = None) -> tuple[str | None, dict]:
    """Load + parse the JSON config file if present. Returns (path, data)."""
    cwd = cwd or os.getcwd()
    explicit = args.get("config")
    file = Path(cwd, explicit) if explicit else Path(cwd, DEFAULT_CONFIG_FILENAME)
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
        return str(file), (data if isinstance(data, dict) else {})
    except Exception as err:  # noqa: BLE001
        if explicit:
            raise ValueError(f"--config {explicit}: {err}") from err
        return None, {}


def resolve_network_config(args: dict, env: dict | None = None, cwd: str | None = None) -> NetworkConfig:
    """Resolve {proxy, ssl_verify} across CLI > file > env > default."""
    env = os.environ if env is None else env
    config_file, file_cfg = load_config_file(args, cwd)
    sources = {"proxy": "default", "sslVerify": "default"}

    # ---- proxy: default None ----
    proxy: str | None = None
    env_proxy = (
        env.get("FIGMA_PROXY_URL")
        or env.get("FIGMA_PROXY")
        or env.get("HTTPS_PROXY") or env.get("https_proxy")
        or env.get("HTTP_PROXY") or env.get("http_proxy")
        or env.get("ALL_PROXY") or env.get("all_proxy")
        or ""
    )
    if env_proxy:
        proxy = env_proxy
        sources["proxy"] = "env"
    if "proxy" in file_cfg:
        proxy = None if file_cfg["proxy"] in (None, "") else str(file_cfg["proxy"])
        sources["proxy"] = "config"
    if args.get("no-proxy"):
        proxy = None
        sources["proxy"] = "cli"
    elif args.get("proxy"):
        proxy = str(args["proxy"])
        sources["proxy"] = "cli"

    # ---- ssl_verify: default True ----
    ssl_verify = True
    if env.get("FIGMA_SSL_VERIFY") is not None:
        ssl_verify = _as_bool(env.get("FIGMA_SSL_VERIFY"))
        sources["sslVerify"] = "env"
    elif env.get("NODE_TLS_REJECT_UNAUTHORIZED") is not None:
        ssl_verify = str(env.get("NODE_TLS_REJECT_UNAUTHORIZED")).strip() != "0"
        sources["sslVerify"] = "env"
    if "sslVerify" in file_cfg:
        ssl_verify = _as_bool(file_cfg["sslVerify"])
        sources["sslVerify"] = "config"
    if args.get("no-ssl-verify") or args.get("insecure"):
        ssl_verify = False
        sources["sslVerify"] = "cli"
    elif args.get("ssl-verify"):
        ssl_verify = True
        sources["sslVerify"] = "cli"

    return NetworkConfig(proxy=proxy, ssl_verify=ssl_verify, sources=sources, config_file=config_file)
