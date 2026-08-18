# tools-figma-downloader

Download a **large** Figma file in chunks and reconstruct a single full-file
JSON locally — instead of one monolithic `GET /v1/files/:key` that balloons in
memory and times out on big documents.

This is the **stream / batch / chunk** complement to the script-heavy Figma
tooling next door (the `figma-config-generator`'s
`fetchFile` does a single whole-file GET; this tool splits that same fetch into
bounded pieces). It is **zero-dependency** — Node ≥ 20 built-ins only.

## Why chunk it

`GET /v1/files/:key` returns the entire document in one response. For large
files that payload is hundreds of MB and the request routinely times out. The
Figma REST API offers the two endpoints needed to page through it instead:

- `GET /v1/files/:key?depth=N` — the document tree **truncated** at depth `N`
  (the cheap "skeleton").
- `GET /v1/files/:key/nodes?ids=a,b,c` — the **full subtree** for a batch of
  node ids.

The strategy:

```
            depth=2 skeleton                       reconstructed full.json
        ┌───────────────────────┐                ┌───────────────────────┐
DOCUMENT│ 0:0                    │                │ 0:0                    │
 └ CANVAS│ 0:1                   │   graft        │ 0:1                    │
    ├ FRAME 1:100  (truncated) ──┼── parts ──────▶│  ├ FRAME 1:100 …deep   │
    ├ FRAME 1:200  (truncated) ──┤                │  ├ FRAME 1:200 …deep   │
    └ FRAME 1:300  (truncated) ──┘                │  └ FRAME 1:300 …deep   │
        └───────────────────────┘                └───────────────────────┘
                   ▲                                          ▲
        1 small request                    /nodes?ids=… in batches, streamed
                                            to out/<key>/parts/, then merged
```

1. **Skeleton** — one shallow `?depth=N` fetch. Its nodes at depth `N` (the
   _frontier_) had their children omitted.
2. **Chunks** — re-fetch every frontier node's full subtree via `/nodes`, a
   **batch** of ids per request, run with bounded **concurrency**, each
   response **streamed** straight to `out/<key>/parts/part-NNNN.json`.
3. **Reconstruct** — graft each subtree back onto the skeleton → a single
   `out/<key>/full.json`, shaped exactly like a plain `GET /v1/files/:key`.

Because every chunk is an independent file on disk, an interrupted download
**resumes** (`--resume` skips parts already present), and reconstruction can be
re-run offline (`--reconstruct-only`).

## Usage

```bash
# Offline smoke test — drives the real chunk/reconstruct path against a fixture:
node bin/figma-download.mjs --mock --pretty --stdout

# Live: fetch a file in chunks and write out/<key>/full.json (needs FIGMA_TOKEN):
FIGMA_TOKEN=figd_xxx node bin/figma-download.mjs \
  --url https://www.figma.com/design/TFTCSGbqpyxex6QRYqqbzb/About

# A very large file — split deeper (smaller chunks) and resume on interrupt:
FIGMA_TOKEN=figd_xxx node bin/figma-download.mjs \
  --file-key TFTCSGbqpyxex6QRYqqbzb --depth 3 --batch-size 5 --concurrency 6 --resume

# Rebuild full.json from an already-downloaded work dir (no network):
node bin/figma-download.mjs --reconstruct-only --work-dir out/TFTCSGbqpyxex6QRYqqbzb

Just regenerate it — the bad chars are only in the already-written output:

# if you still have the parts/ dir (ran with --keep-parts):
node bin/figma-download.mjs --reconstruct-only --work-dir out/TFTCSGbqpyxex6QRYqqbzb

# otherwise re-download (parts are deleted by default after reconstruct):
FIGMA_TOKEN=figd_xxx node bin/figma-download.mjs --file-key TFTCSGbqpyxex6QRYqqbzb

```

Run `node bin/figma-download.mjs --help` for the full flag list.

### Input modes (choose one)

- `--url <figma-url>` — fetch live; the key is parsed out of the URL.
- `--file-key <key>` — fetch live by key. Needs `FIGMA_TOKEN` (or
  `FIGMA_API_TOKEN` / `FIGMA_ACCESS_TOKEN`) in the environment.
- `--mock` — built-in offline fixture; no token, no network.
- `--reconstruct-only` — skip the network entirely and rebuild from an existing
  `--work-dir`.

### Key options

| Flag                                | Default               | Meaning                                                                                      |
| ----------------------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `--depth <n>`                       | `2`                   | Frontier depth to split at (1 = pages, 2 = top-level frames). Deeper = more, smaller chunks. |
| `--batch-size <n>`                  | `10`                  | Node ids per `/nodes` request.                                                               |
| `--concurrency <n>`                 | `4`                   | Parallel `/nodes` requests.                                                                  |
| `--retries <n>`                     | `3`                   | Retries per request on 429 / 5xx / network error (honours `Retry-After`).                    |
| `--timeout-ms <n>`                  | `60000`               | Per-request abort timeout.                                                                   |
| `--proxy <url>`                     | none                  | Route requests through an HTTP/HTTPS proxy (see [Network](#network-proxy--tls)).             |
| `--no-ssl-verify`                   | off (verify **on**)   | Disable TLS certificate verification. Alias `--insecure`.                                    |
| `--resume`                          | off                   | Skip part files already on disk.                                                             |
| `--geometry`                        | off                   | Include vector geometry (`geometry=paths`) — much larger payloads.                           |
| `--out <path>`                      | `out/<key>/full.json` | Final merged file path.                                                                      |
| `--work-dir <dir>`                  | `out/<key>`           | Scratch dir for `skeleton.json` + `parts/`.                                                  |
| `--skeleton-only`                   | off                   | Fetch + write the skeleton, then stop.                                                       |
| `--keep-parts`                      | off                   | Keep `parts/` after a successful reconstruct.                                                |
| `--pretty` / `--stdout` / `--quiet` | off                   | Pretty-print / emit to stdout / suppress progress.                                           |

### Tuning the split

The right `--depth` depends on where the file's weight sits. If a single
top-level frame is itself enormous, `--depth 2` still produces one giant chunk —
push to `--depth 3` so the split happens one level deeper. Smaller
`--batch-size` means more, smaller requests (gentler on memory and the API's
per-request limit); higher `--concurrency` trades rate-limit headroom for speed.

## Network: proxy & TLS

By default the tool makes direct, TLS-verified HTTPS requests to
`api.figma.com` using Node's built-in `fetch`. Two knobs cover locked-down /
corporate networks:

- **Proxy** — `--proxy <url>` routes every request through an HTTP/HTTPS proxy,
  including the `CONNECT` tunnel needed for the HTTPS Figma endpoints.
  Credentials in the URL are sent as `Proxy-Authorization` (and redacted in
  logs). If `--proxy` is omitted, the conventional `HTTPS_PROXY` / `HTTP_PROXY`
  / `ALL_PROXY` environment variables are honoured; with none set, **no proxy**
  is used.

  ```bash
  figma-download --file-key TFTCS... --proxy http://****:*****@ProxyDomain:8080
  # or, from the environment:
  HTTPS_PROXY=http://ProxyDomain:8080 figma-download --file-key TFTCS...
  ```

- **TLS verification** — on by default. `--no-ssl-verify` (alias `--insecure`)
  disables certificate checking, for TLS-intercepting proxies or self-signed
  endpoints. It is genuinely insecure — the tool prints a warning — so use it
  only on networks you trust.

  ```bash
  figma-download --file-key TFTCS... --proxy http://proxy:8080 --no-ssl-verify
  ```

Both knobs are implemented with a small, **zero-dependency** transport over
`node:http` / `https` / `tls`, installed only when a proxy or `--no-ssl-verify`
is requested; the default path stays on the global `fetch`. (`--mock` is fully
offline and ignores both.)

## Output encoding

Figma text nodes often contain Unicode **Line Separator** (U+2028) and
**Paragraph Separator** (U+2029) characters. `JSON.stringify` emits those
_literally_, so a naive dump produces a `full.json` with raw line terminators
mid-string — editors flag _"unusual line terminators"_ and the file stops being
valid JavaScript. Every JSON this tool writes (`full.json`, `skeleton.json`, the
parts) escapes them to `\u2028` / `\u2029`, which is semantically identical JSON
that still `JSON.parse`s to the same values. If you have an older `full.json`
written before this fix, regenerate it with
`--reconstruct-only` (or re-download).

## Work-dir layout

```
out/<fileKey>/
├── skeleton.json     # the shallow ?depth=N document
├── parts/
│   ├── part-0000.json   # a /nodes response (one batch of full subtrees)
│   ├── part-0001.json
│   └── …
├── manifest.json     # plan + progress (frontierDepth, batchCount, downloaded…)
└── full.json         # the reconstructed single file
```

## Develop

```bash
make test        # node --test (no deps, no network — uses the mock API)
make typecheck   # node --check every source file
make mock        # chunked download of the built-in fixture -> stdout
make run FILE_KEY=<key>   # live download (needs FIGMA_TOKEN)
```

The reconstructed document is grafted node-for-node from the original subtrees;
the test suite asserts the rebuilt tree is **deep-equal** to the source file, so
a chunked download is verified to be lossless against a whole-file fetch.

## Layout

```
tools-figma-downloader/
├── bin/figma-download.mjs   # CLI entrypoint (thin shebang wrapper)
├── src/
│   ├── cli.mjs              # arg parse + orchestration (acquire → chunk → reconstruct)
│   ├── figmaClient.mjs      # REST client: skeleton/nodes fetch, timeout + retry, key parsing
│   ├── chunk.mjs            # frontier-id planning + streamed batch download to parts/
│   ├── reconstruct.mjs      # graft subtrees onto the skeleton → full file
│   ├── httpFetch.mjs        # zero-dep fetch over node:http/https/tls (proxy + TLS toggle)
│   ├── mock.mjs             # offline fake of the two endpoints (drives the real path)
│   └── util.mjs             # sleep / safe stringify / bounded pool / batch / node count
├── tests/download.test.mjs  # unit + end-to-end (all offline)
├── Makefile · package.json · README.md · .gitignore
```
