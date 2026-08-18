# figma-downloader-ts

Zero-dependency **Node ESM** (Node ≥ 20) downloader for a Figma file of **any size**
(`sm`/`md`/`large`/`xl`/`xxxxl`). Twin of the stdlib-only
[`figma-downloader-py`](../figma-downloader-py); the two produce **byte-identical**
output (enforced by [`../parity`](../parity)).

## Why chunk it

`GET /v1/files/:key` returns the entire document in one response — hundreds of MB for
large files, and the request routinely times out. Instead this tool pages through the
two endpoints Figma offers:

- `GET /v1/files/:key?depth=N` — the document **truncated** at depth `N` (the skeleton).
- `GET /v1/files/:key/nodes?ids=a,b,c` — the **full subtree** for a batch of node ids.

```
            depth=2 skeleton                       reconstructed full.json
        ┌───────────────────────┐                ┌───────────────────────┐
DOCUMENT│ 0:0                    │                │ 0:0                    │
 └ CANVAS│ 0:1                   │   graft        │ 0:1                    │
    ├ FRAME 1:100  (truncated) ──┼── parts ──────▶│  ├ FRAME 1:100 …deep   │
    ├ FRAME 1:200  (truncated) ──┤                │  ├ FRAME 1:200 …deep   │
    └ FRAME 1:300  (truncated) ──┘                │  └ FRAME 1:300 …deep   │
        └───────────────────────┘                └───────────────────────┘
        1 small request          /nodes?ids=… in batches → parts/ → merged
```

1. **Skeleton** — one shallow `?depth=N` fetch. Its nodes at depth `N` (the *frontier*)
   had their children omitted.
2. **Chunks** — re-fetch every frontier node's full subtree via `/nodes`, a **batch**
   of ids per request, bounded **concurrency**, each response written to a
   content-hashed `parts/part-<sha>.json`. Any over-budget subtree is **re-chunked**.
3. **Reconstruct** — graft the subtrees back onto the skeleton → a single `full.json`
   shaped exactly like a plain `GET /v1/files/:key`.

## Usage

```bash
# Offline smoke test (no token, no network):
node bin/figma-download.mjs --mock --pretty --stdout

# Live, any size — auto-classify and resume on interrupt:
FIGMA_TOKEN=figd_xxx node bin/figma-download.mjs \
  --url https://www.figma.com/design/<KEY>/Name --resume

# Force a tier for a known-huge file:
FIGMA_TOKEN=figd_xxx node bin/figma-download.mjs --file-key <KEY> --size xxxxl

# Rebuild from an already-downloaded work dir (no network):
node bin/figma-download.mjs --reconstruct-only --work-dir out/<KEY>
```

Run `node bin/figma-download.mjs --help` for the full flag list.

## Size: any file (`sm` … `xxxxl`)

`--size {auto|sm|md|large|xl|xxxxl}` (default `auto`). `auto` probes the skeleton and
picks a strategy; a tier sets depth/batch-size/concurrency unless you pass those flags
explicitly (**explicit > tier > auto**). See the [polyglot README](../README.md#the-any-size-model)
for the tier table.

**Byte/time-aware re-chunking** is the guarantee that makes any size work: a fetched
batch over `--max-part-bytes` or `--max-part-ms` is split in memory into a shallow
parent part plus a full part per child, recursively (bounded by `--max-rechunk-depth`,
default 4). A single unsplittable oversized leaf is kept and flagged
`oversizedLeaves` in the manifest. *(A node with enormous fan-out at one level yields a
large shallow parent part — re-chunk shrinks max part size dramatically but does not
paginate one node's direct-children list; that residual case is reported, never lost.)*

## Network: proxy & TLS (flag · config · env)

Defaults: **no proxy**, **TLS verification on**. Override via any of (highest wins):

1. CLI: `--proxy <url>` / `--no-proxy` ; `--ssl-verify` / `--no-ssl-verify` (alias `--insecure`)
2. Config file `./figma-download.config.json` (or `--config <path>`):
   `{ "proxy": "http://host:8080", "sslVerify": false }`
3. Env: `FIGMA_PROXY_URL` / `FIGMA_PROXY` / `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` ; `FIGMA_SSL_VERIFY` / `NODE_TLS_REJECT_UNAUTHORIZED`
4. Default: `proxy=null`, `sslVerify=true`

Per-request timeout (default `60000`ms) resolves `--timeout-ms <n>` flag > `FIGMA_HTTP_TIMEOUT_MS` env > default.

The proxy/TLS transport is a small zero-dependency layer over `node:http`/`https`/`tls`
(CONNECT tunnel for HTTPS, credential redaction in logs), installed only when a proxy
or `--no-ssl-verify` is in effect. `--mock` is offline and ignores both.

## Errors & exit codes

Typed: `FigmaAuthError` (401/403 → exit **3**), `FigmaNotFoundError` (404 → **4**),
`FigmaRateLimitError` (429 → **5**), `FigmaServerError`/`FigmaNetworkError` (**6**),
`FigmaTimeoutError` (**7**). Auth/not-found fail fast; 429/5xx/network retry with
exponential backoff honoring `Retry-After`.

## Output encoding

Every JSON written escapes U+2028 / U+2029 (which Figma text nodes contain and
`JSON.stringify` emits literally) to ``\u2028`` / ``\u2029`` — semantically identical, but
valid everywhere. Compact `full.json` is byte-identical to the Python twin's.

## Work-dir layout

```
out/<fileKey>/
├── skeleton.json            # the shallow ?depth=N document
├── parts/part-<sha>.json    # /nodes responses, content-hash addressed (TR-12)
├── manifest.json            # size, frontierDepth, parts[], groups[], rechunked, oversizedLeaves
└── full.json                # the reconstructed single file
```

## Develop

```bash
make test        # node --test (no deps, no network — uses the shared mock fixture)
make typecheck   # node --check every source file
make mock        # chunked download of the shared fixture -> stdout
```

## Layout

```
figma-downloader-ts/
├── bin/figma-download.mjs   # CLI entrypoint
├── src/
│   ├── cli.mjs              # arg parse + orchestration
│   ├── config.mjs           # proxy/TLS resolution (flag > config > env > default)
│   ├── sizing.mjs           # tier presets + auto classification + budgets
│   ├── figmaClient.mjs      # skeleton/nodes/whole fetch, timeout, retry, typed errors
│   ├── errors.mjs           # typed Figma error taxonomy
│   ├── chunk.mjs            # frontier planning, streamed download, content-hash parts, re-chunk
│   ├── reconstruct.mjs      # recursive id-keyed graft -> full file
│   ├── httpFetch.mjs        # zero-dep proxy + TLS transport
│   ├── mock.mjs             # offline fake serving the shared fixture
│   └── util.mjs             # stringify / pool / token-bucket / sha256 / batch / count
└── tests/                   # download · sizing · rechunk · errors · config (all offline)
```
