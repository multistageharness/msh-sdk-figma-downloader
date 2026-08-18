# figma-downloader-py

Stdlib-only **Python ≥ 3.11** downloader for a Figma file of **any size**
(`sm`/`md`/`large`/`xl`/`xxxxl`). Twin of the zero-dependency Node ESM
[`figma-downloader-ts`](../figma-downloader-ts); the two produce **byte-identical**
output (enforced by [`../parity`](../parity)). No `pip install` — Python standard
library only.

## How it works

Instead of one monolithic `GET /v1/files/:key` (hundreds of MB, frequent timeouts),
it pages through the two endpoints Figma offers — a shallow `?depth=N` **skeleton**,
then the **full subtree** for each frontier node via `/nodes?ids=` — downloads the
batches with bounded concurrency to content-hashed part files, and **grafts** them back
onto the skeleton into a single `full.json` shaped like a plain `GET /v1/files/:key`.
See the [polyglot README](../README.md) for the full picture and the size-tier table.

## Usage

```bash
# Offline smoke test (no token, no network):
python3 -m figma_downloader --mock --pretty --stdout

# Live, any size — auto-classify and resume on interrupt:
FIGMA_TOKEN=figd_xxx python3 -m figma_downloader \
  --url https://www.figma.com/design/<KEY>/Name --resume

# Force a tier for a known-huge file:
FIGMA_TOKEN=figd_xxx python3 -m figma_downloader --file-key <KEY> --size xxxxl

# Rebuild from an already-downloaded work dir (no network):
python3 -m figma_downloader --reconstruct-only --work-dir out/<KEY>
```

Installed as a console script via `pyproject.toml`: `figma-download …` (after
`pip install -e .`). Run with `--help` for the full flag list — identical to the Node
twin.

## Library API

```python
from figma_downloader import (
    fetch_skeleton, fetch_nodes, collect_frontier_ids,
    download_chunks, reconstruct, index_parts, classify, resolve_strategy,
)
```

Public names mirror the Node modules in snake_case.

## Size, network config, errors

Identical semantics to the Node twin:

- **`--size {auto|sm|md|large|xl|xxxxl}`** with byte/time-aware re-chunking
  (`--max-part-bytes` / `--max-part-ms` / `--max-rechunk-depth`) as the any-size
  guarantee.
- **proxy & TLS** resolved (highest wins) from CLI flag → `figma-download.config.json`
  (or `--config`) → env (`FIGMA_PROXY_URL` / `FIGMA_PROXY` / `HTTPS_PROXY` / … ;
  `FIGMA_SSL_VERIFY` / `NODE_TLS_REJECT_UNAUTHORIZED`) → default (`proxy=None`,
  `ssl_verify=True`).
- **timeout** (default `60000`ms) resolves `--timeout-ms <n>` flag >
  `FIGMA_HTTP_TIMEOUT_MS` env > default.
- **typed errors / exit codes**: `FigmaAuthError` 401/403 → **3**, `FigmaNotFoundError`
  404 → **4**, `FigmaRateLimitError` 429 → **5**, server/network → **6**, timeout → **7**.

## Develop

```bash
make test        # python -m unittest (no deps, no network — shared mock fixture)
make typecheck   # py_compile every source file
make mock        # chunked download of the shared fixture -> stdout
```

## Layout

```
figma-downloader-py/
├── figma_downloader/
│   ├── __main__.py          # python -m figma_downloader
│   ├── cli.py               # arg parse + orchestration
│   ├── config.py            # proxy/TLS resolution (flag > config > env > default)
│   ├── sizing.py            # tier presets + auto classification + budgets
│   ├── client.py            # skeleton/nodes/whole fetch, timeout, retry, typed errors
│   ├── errors.py            # typed Figma error taxonomy
│   ├── chunk.py             # frontier planning, threaded download, content-hash parts, re-chunk
│   ├── reconstruct.py       # recursive id-keyed graft -> full file
│   ├── http_fetch.py        # stdlib proxy + TLS transport (urllib)
│   ├── mock.py              # offline fake serving the shared fixture
│   └── util.py              # stringify / pool / TokenBucket / sha256 / batch / count
├── tests/                   # test_download · test_sizing · test_rechunk · test_errors · test_config
├── pyproject.toml · Makefile · README.md
```
