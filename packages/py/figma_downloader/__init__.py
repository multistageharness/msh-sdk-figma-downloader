"""figma_downloader — download a Figma file of any size in chunks and rebuild it.

Stdlib-only Python twin of the Node ESM package in `packages/ts`. Public surface
mirrors the Node modules (snake_case names).
"""

from .client import fetch_nodes, fetch_skeleton, fetch_whole_file, figma_get, parse_file_key
from .chunk import collect_frontier_ids, download_chunks
from .reconstruct import index_parts, load_parts, reconstruct, reconstruct_from_dir
from .sizing import PRESETS, TIERS, classify, resolve_strategy
from .config import resolve_network_config
from .errors import (
    FigmaAuthError,
    FigmaError,
    FigmaNetworkError,
    FigmaNotFoundError,
    FigmaRateLimitError,
    FigmaServerError,
    FigmaTimeoutError,
)

__version__ = "1.0.0"

__all__ = [
    "parse_file_key", "figma_get", "fetch_skeleton", "fetch_nodes", "fetch_whole_file",
    "collect_frontier_ids", "download_chunks",
    "index_parts", "reconstruct", "load_parts", "reconstruct_from_dir",
    "classify", "resolve_strategy", "TIERS", "PRESETS",
    "resolve_network_config",
    "FigmaError", "FigmaAuthError", "FigmaNotFoundError", "FigmaRateLimitError",
    "FigmaServerError", "FigmaNetworkError", "FigmaTimeoutError",
]
