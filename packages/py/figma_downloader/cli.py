"""cli.py — orchestrate the chunked download + local reconstruction.

Twin of ts/src/cli.mjs. Same flags, same modes, same exit codes.
"""

from __future__ import annotations

import os
import sys
from typing import Any

from . import client as client_mod
from .chunk import collect_frontier_ids, download_chunks
from .client import fetch_skeleton, fetch_whole_file, parse_file_key
from .config import resolve_network_config
from .errors import FigmaError, exit_code_for
from .http_fetch import make_fetch, redact_proxy
from .mock import make_mock_fetch
from .reconstruct import index_parts, load_parts, reconstruct
from .sizing import TIERS, classify, resolve_strategy
from .util import byte_length, count_nodes, stringify, TokenBucket

HELP = """figma-download — fetch a Figma file of any size in chunks and rebuild it locally

USAGE
  figma-download (--url <figma-url> | --file-key <key> | --mock) [options]

INPUT (choose one)
  --url <figma-url>     Figma file URL (the key is parsed out of it).
  --file-key <key>      Figma file key. Needs FIGMA_TOKEN in the environment.
  --mock                Use a built-in offline fixture (no network, no token).

SIZE (any size: sm / md / large / xl / xxxxl)
  --size <tier>         auto (default) | sm | md | large | xl | xxxxl.
  --max-part-bytes <n>  Re-chunk any part larger than this (0 = off).
  --max-part-ms <n>     Re-chunk any batch whose fetch took longer than this.
  --max-rechunk-depth   How deep re-chunking may recurse. Default 4.

OPTIONS
  --out <path>          Final full-file JSON path. Default out/<key>/full.json.
  --work-dir <dir>      Scratch dir for skeleton + parts. Default out/<key>.
  --depth <n>           Frontier depth to split at (1=pages, 2=top frames).
  --batch-size <n>      Node ids per /nodes request.
  --concurrency <n>     Parallel /nodes requests.
  --rate <n>            Global request ceiling (requests/sec, 0 = unlimited).
  --retries <n>         Retries per request on 429/5xx/network. Default 3.
  --timeout-ms <n>      Per-request timeout. Default 60000.
                        Env: FIGMA_HTTP_TIMEOUT_MS (flag overrides env).

NETWORK (proxy + TLS — override via flag, config file, or environment)
  --proxy <url>         Route requests through an HTTP/HTTPS proxy.
  --no-proxy            Force a direct connection (ignore config/env proxy).
  --no-ssl-verify       Disable TLS certificate verification (alias --insecure).
  --ssl-verify          Force TLS verification ON (override config/env).
  --config <path>       Config file (default ./figma-download.config.json):
                        { "proxy": "http://host:8080", "sslVerify": false }
                        Precedence: flag > config file > env > default
                        (proxy=null, sslVerify=true). Env: FIGMA_PROXY_URL /
                        FIGMA_PROXY / HTTPS_PROXY / HTTP_PROXY / ALL_PROXY ;
                        FIGMA_SSL_VERIFY / NODE_TLS_REJECT_UNAUTHORIZED.

MODES
  --geometry            Include vector geometry (geometry=paths) — much larger.
  --resume              Skip groups already downloaded (manifest-aware).
  --skeleton-only       Fetch + write the skeleton, then stop.
  --reconstruct-only    Rebuild full.json from an existing work dir (no network).
  --keep-parts          Keep the parts/ dir after a successful reconstruct.
  --pretty              Pretty-print full.json (default: compact).
  --stdout              Write full.json to stdout instead of a file.
  --quiet               Suppress progress logs (errors still go to stderr).
  -h, --help            Show this help.

EXIT CODES
  0 ok · 2 usage · 3 auth(401/403) · 4 not-found(404) · 5 rate-limited(429)
  6 server/network · 7 timeout
"""

_BOOLEANS = {
    "mock", "geometry", "resume", "skeleton-only", "reconstruct-only",
    "keep-parts", "pretty", "stdout", "quiet", "help", "h",
    "no-ssl-verify", "ssl-verify", "insecure", "no-proxy",
}


def parse_args(argv: list[str]) -> dict:
    """Minimal flag parser: --flag value / --flag=value / boolean flags."""
    out: dict[str, Any] = {"_": []}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if not arg.startswith("--") and arg != "-h":
            out["_"].append(arg)
            i += 1
            continue
        key = arg.lstrip("-")
        value = None
        if "=" in key:
            key, value = key.split("=", 1)
        if key in _BOOLEANS:
            out[key] = True
            i += 1
            continue
        if value is None:
            value = argv[i + 1] if i + 1 < len(argv) else None
            i += 1
        out[key] = value
        i += 1
    return out


def _mk_log(quiet: bool):
    def log(*args):
        if not quiet:
            sys.stderr.write("[figma-download] " + " ".join(str(a) for a in args) + "\n")
    return log


def _int_opt(args: dict, name: str, default):
    v = args.get(name)
    if v is None:
        return default
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"--{name} must be a number (got {v})")
    return int(n) if n == int(n) else n


def _resolve_timeout_ms(args: dict, env: dict):
    """timeout: --timeout-ms flag > FIGMA_HTTP_TIMEOUT_MS env > 60000 default."""
    timeout_ms = 60_000
    raw = env.get("FIGMA_HTTP_TIMEOUT_MS")
    if raw is not None and str(raw).strip() != "":
        try:
            n = float(raw)
        except (TypeError, ValueError):
            raise ValueError(f"FIGMA_HTTP_TIMEOUT_MS must be a number (got {raw})")
        timeout_ms = int(n) if n == int(n) else n
    if args.get("timeout-ms") is not None:
        timeout_ms = _int_opt(args, "timeout-ms", timeout_ms)
    return timeout_ms


def _run_inner(argv: list[str], env: dict) -> int:
    args = parse_args(argv)
    if args.get("help") or args.get("h"):
        print(HELP)
        return 0
    quiet = bool(args.get("quiet"))
    log = _mk_log(quiet)

    file_key = args.get("file-key") or ""
    if not file_key and args.get("url"):
        file_key = parse_file_key(args["url"])
    if not file_key and args.get("mock"):
        file_key = "MOCKFILEKEY0000000000"

    work_dir = None
    if args.get("work-dir"):
        work_dir = os.path.abspath(args["work-dir"])
    elif file_key:
        work_dir = os.path.abspath(os.path.join("out", file_key))

    size_arg = (args.get("size") or "auto").lower()
    if size_arg != "auto" and size_arg not in TIERS:
        sys.stderr.write(f"error: --size must be one of auto|{'|'.join(TIERS)}\n")
        return 2
    explicit = {
        "depth": args.get("depth") is not None,
        "batchSize": args.get("batch-size") is not None,
        "concurrency": args.get("concurrency") is not None,
    }

    def write_full(file: dict, stats, size_label: str) -> None:
        out_json = stringify(file, bool(args.get("pretty")))
        if args.get("stdout"):
            sys.stdout.write(out_json + "\n")
        else:
            out_path = os.path.abspath(args["out"]) if args.get("out") else os.path.join(work_dir, "full.json")
            os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(out_json)
            grafted = f", {stats['grafted']} subtree(s) grafted" if stats else ""
            log(f"wrote {out_path} — {count_nodes(file['document'])} node(s){grafted} [{size_label}]")
        if stats and stats["missing"]:
            preview = ", ".join(stats["missing"][:5]) + ("…" if len(stats["missing"]) > 5 else "")
            sys.stderr.write(f"[figma-download] warning: {len(stats['missing'])} frontier node(s) not returned: {preview}\n")

    # --- Mode: reconstruct only (no network). ---
    if args.get("reconstruct-only"):
        if not work_dir:
            sys.stderr.write("error: --reconstruct-only needs --work-dir (or --file-key/--url to derive it).\n")
            return 2
        log(f"reconstruct-only from {work_dir}")
        import json as _json
        with open(os.path.join(work_dir, "skeleton.json"), encoding="utf-8") as fh:
            skeleton = _json.load(fh)
        frontier_ids = []
        try:
            with open(os.path.join(work_dir, "manifest.json"), encoding="utf-8") as fh:
                frontier_ids = _json.load(fh).get("frontierIds") or []
        except OSError:
            pass
        parts = load_parts(os.path.join(work_dir, "parts"))
        result = reconstruct(skeleton, index_parts(parts), frontier_ids)
        write_full(result["file"], result["stats"], "reconstruct-only")
        return 0

    # --- Acquire mode: live network or mock. ---
    if not args.get("mock") and not args.get("file-key") and not args.get("url"):
        sys.stderr.write("error: no input. Pass --url, --file-key, --mock, or --reconstruct-only. See --help.\n")
        return 2
    if not file_key:
        sys.stderr.write("error: could not determine the Figma file key. Pass --file-key explicitly.\n")
        return 2

    token = (
        "mock-token"
        if args.get("mock")
        else (env.get("FIGMA_TOKEN") or env.get("FIGMA_API_TOKEN") or env.get("FIGMA_ACCESS_TOKEN") or "")
    )

    net = resolve_network_config(args, env)

    original = client_mod._http["fetch"]
    restore = None
    if args.get("mock"):
        client_mod._http["fetch"] = make_mock_fetch()
        restore = lambda: client_mod._http.__setitem__("fetch", original)
    elif net.proxy or not net.ssl_verify:
        client_mod._http["fetch"] = make_fetch(proxy=net.proxy or None, ssl_verify=net.ssl_verify)
        restore = lambda: client_mod._http.__setitem__("fetch", original)
        if net.proxy:
            log(f"using proxy {redact_proxy(net.proxy)} (from {net.sources['proxy']})")
        if not net.ssl_verify:
            sys.stderr.write(f"[figma-download] WARNING: TLS certificate verification is DISABLED (from {net.sources['sslVerify']}).\n")

    try:
        req = {
            "retries": _int_opt(args, "retries", 3),
            "timeout_ms": _resolve_timeout_ms(args, env),
            "geometry": bool(args.get("geometry")),
            "on_retry": lambda info: log(f"  retry #{info['attempt']} (status {info['status']}) in {info['waitMs']}ms"),
        }

        max_part_bytes = _int_opt(args, "max-part-bytes", None) if args.get("max-part-bytes") is not None else None
        max_part_ms = _int_opt(args, "max-part-ms", None) if args.get("max-part-ms") is not None else None
        strategy_kwargs = dict(
            depth=_int_opt(args, "depth", None),
            batch_size=_int_opt(args, "batch-size", None),
            concurrency=_int_opt(args, "concurrency", None),
            max_part_bytes=max_part_bytes,
            max_part_ms=max_part_ms,
            explicit=explicit,
        )

        skeleton = None
        if size_arg == "auto":
            probed_depth = _int_opt(args, "depth", 2) if explicit["depth"] else 2
            log("probing skeleton to classify size…")
            skeleton = fetch_skeleton(file_key, token, depth=probed_depth, **req)
            frontier = collect_frontier_ids(skeleton, probed_depth)
            skeleton_bytes = byte_length(stringify(skeleton))
            node_count = count_nodes(skeleton["document"])
            tier = classify({"nodeCount": node_count, "frontierWidth": len(frontier), "skeletonBytes": skeleton_bytes, "hasFrontier": len(frontier) > 0})
            strategy = resolve_strategy(size=tier, **strategy_kwargs)
            log(f"classified {tier} (nodes≈{node_count}, frontier={len(frontier)}, skeleton={skeleton_bytes}B)")
            depth = strategy["depth"]
            if depth != probed_depth and strategy["mode"] != "whole":
                skeleton = fetch_skeleton(file_key, token, depth=depth, **req)
        else:
            strategy = resolve_strategy(size=size_arg, **strategy_kwargs)
            depth = strategy["depth"]

        # --- Whole-file fast path (sm). ---
        if strategy["mode"] == "whole":
            log(f"size {strategy['size']}: whole-file fast path")
            file = fetch_whole_file(file_key, token, **req)
            os.makedirs(work_dir, exist_ok=True)
            import json as _json
            manifest = {
                "fileKey": file_key, "size": strategy["size"], "frontierDepth": 0, "batchSize": 1, "concurrency": 1,
                "idCount": 0, "batchCount": 0, "downloaded": 0, "resumedSkipped": 0, "rechunked": 0,
                "oversizedLeaves": [], "frontierIds": [], "parts": [], "groups": [], "mode": "whole",
            }
            with open(os.path.join(work_dir, "manifest.json"), "w", encoding="utf-8") as f:
                _json.dump(manifest, f, indent=2)
            write_full(file, None, strategy["size"])
            return 0

        # --- Frontier chunked path. ---
        if skeleton is None:
            log(f"fetching skeleton: {file_key} (depth={depth})")
            skeleton = fetch_skeleton(file_key, token, depth=depth, **req)
        os.makedirs(work_dir, exist_ok=True)
        with open(os.path.join(work_dir, "skeleton.json"), "w", encoding="utf-8") as f:
            f.write(stringify(skeleton, True))
        log(f'skeleton: "{skeleton.get("name")}" v{skeleton.get("version")} (size={strategy["size"]}, depth={depth})')

        frontier_ids = collect_frontier_ids(skeleton, depth)
        log(f"frontier: {len(frontier_ids)} node(s) at depth {depth}")

        if args.get("skeleton-only"):
            log("skeleton-only — stopping before chunk download.")
            return 0
        if not frontier_ids:
            sys.stderr.write(f"[figma-download] warning: no frontier nodes at depth {depth}. Try a smaller --depth.\n")

        resume = bool(args.get("resume")) if args.get("resume") is not None else strategy["resume"]
        rate = _int_opt(args, "rate", 0)
        limiter = TokenBucket(rate=rate, burst=max(1, strategy["concurrency"])) if rate > 0 else None

        import math
        log(f"downloading {math.ceil(len(frontier_ids) / strategy['batchSize'])} batch(es), {strategy['batchSize']} id(s) each, concurrency {strategy['concurrency']}" + (f", {rate} req/s" if rate else ""))
        download_chunks(
            file_key=file_key, token=token, frontier_ids=frontier_ids, depth=depth, work_dir=work_dir,
            size=strategy["size"], batch_size=strategy["batchSize"], concurrency=strategy["concurrency"],
            resume=resume, retries=req["retries"], timeout_ms=req["timeout_ms"], geometry=req["geometry"],
            stream=strategy["stream"], rechunk=strategy["rechunk"], max_part_bytes=strategy["maxPartBytes"],
            max_part_ms=strategy["maxPartMs"], max_rechunk_depth=_int_opt(args, "max-rechunk-depth", 4),
            limiter=limiter, log=log,
        )

        log("reconstructing full file from parts…")
        parts = load_parts(os.path.join(work_dir, "parts"))
        result = reconstruct(skeleton, index_parts(parts), frontier_ids)
        write_full(result["file"], result["stats"], strategy["size"])

        if not args.get("keep-parts") and not args.get("stdout"):
            import shutil
            shutil.rmtree(os.path.join(work_dir, "parts"), ignore_errors=True)
            log("removed parts/ (pass --keep-parts to retain)")
        return 0
    finally:
        if restore:
            restore()


def run(argv: list[str], env: dict | None = None) -> int:
    """Public entrypoint. Maps typed Figma errors to distinct exit codes."""
    env = os.environ if env is None else env
    try:
        return _run_inner(argv, env)
    except FigmaError as err:
        sys.stderr.write(f"[figma-download] {type(err).__name__}: {err}\n")
        return exit_code_for(err)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    try:
        return run(argv)
    except Exception as err:  # noqa: BLE001
        sys.stderr.write(f"[figma-download] error: {err}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
