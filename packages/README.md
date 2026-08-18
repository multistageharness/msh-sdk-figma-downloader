# tools-figma-downloader — polyglot Figma downloader

Download a Figma file of **any size** (`sm` · `md` · `large` · `xl` · `xxxxl`) in
chunks and reconstruct a single full-file JSON locally — instead of one monolithic
`GET /v1/files/:key` that balloons in memory and times out on large documents.

This is a **consolidated polyglot pattern** distilled from four reference demos
(`.out/analysis/_synthesis.md`): skeleton-first fetch → frontier chunking →
bounded-concurrency batched `/nodes` streamed to disk → byte/time-aware
re-chunking → faithful graft-reconstruction. It ships as **two zero-dependency
twin packages** with identical behavior:

| Package                                        | Runtime                      | Deps                      |
| ---------------------------------------------- | ---------------------------- | ------------------------- |
| [`figma-downloader-ts`](./figma-downloader-ts) | Node ESM (`.mjs`), Node ≥ 20 | **none** (built-ins only) |
| [`figma-downloader-py`](./figma-downloader-py) | Python ≥ 3.11                | **none** (stdlib only)    |

Shared, language-neutral assets keep the twins honest:

```
packages/
├── figma-downloader-ts/     # Node twin
├── figma-downloader-py/     # Python twin
├── shared/
│   ├── fixtures/mock-file.json   # the document both --mock paths serve (byte-identical)
│   ├── golden/manifest.schema.json
│   └── parity/cases.json         # cross-language parity cases
├── parity/run-parity.mjs    # runs BOTH CLIs and diffs full.json + manifest
└── legacy/                   # frozen v0.1.0 reference (do not edit)
```

## Quick start

```bash
# Offline smoke test — drives the real chunk/reconstruct path against a fixture:
node figma-downloader-ts/bin/figma-download.mjs --mock --pretty --stdout
( cd figma-downloader-py && python3 -m figma_downloader --mock --pretty --stdout )

# Live: fetch a large file in chunks (needs FIGMA_TOKEN):
FIGMA_TOKEN=figd_xxx node figma-downloader-ts/bin/figma-download.mjs \
  --url https://www.figma.com/design/<KEY>/Name --size xl --resume
```

## The "any size" model

Size is handled two ways that **compose** — a tier _preset_ (fast, predictable)
and a runtime _re-chunk loop_ (a hard guarantee):

| Tier    | auto trigger (skeleton signals) | mode             | depth | batch | concurrency | stream | re-chunk  |
| ------- | ------------------------------- | ---------------- | ----- | ----- | ----------- | ------ | --------- |
| `sm`    | tiny, truncation-free           | whole-file `GET` | —     | —     | 1           | no     | no        |
| `md`    | ≤ ~30k nodes                    | frontier         | 2     | 10    | 4           | no     | on-breach |
| `large` | ≤ ~150k nodes                   | frontier         | 2–3   | 5     | 6           | yes    | on-breach |
| `xl`    | ≤ ~1M nodes                     | frontier         | 3     | 3     | 8           | yes    | always    |
| `xxxxl` | > ~1M nodes / huge frontier     | frontier         | 3     | 2     | 8           | yes    | always    |

`--size auto` (default) probes the skeleton (two cheap shallow GETs) and classifies;
`--size <tier>` skips probing. **Correctness never depends on the guess:** any part
that exceeds its byte/time budget is split in memory into a shallow parent + per-child
parts, recursively (TR-3), so no single part file is oversized regardless of tier.

## Network config — proxy & TLS (flag · config file · env)

Proxy and TLS verification are resolved from a layered set of sources so you can
override the defaults via **a flag, a config file, OR environment variables**.
Precedence, highest wins:

1. **CLI flag** — `--proxy <url>` / `--no-proxy` ; `--ssl-verify` / `--no-ssl-verify`
2. **Config file** — `./figma-download.config.json` (or `--config <path>`):
   ```json
   { "proxy": "http://****:****@host:8080", "sslVerify": false }
   ```
3. **Environment** — `FIGMA_PROXY` / `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` ;
   `FIGMA_SSL_VERIFY` / `NODE_TLS_REJECT_UNAUTHORIZED`
4. **Default** — `proxy = null` (direct) · `sslVerify = true`

The resolved source is logged (`from config` / `from env` / `from cli`). `--mock` is
fully offline and ignores both knobs.

## Typed errors & exit codes

`401/403 → 3` (auth) · `404 → 4` (not found) · `429 → 5` (rate limited after retries)
· `5xx/network → 6` · `timeout → 7`. Auth/not-found fail fast (non-retryable);
429/5xx/network retry with backoff honoring `Retry-After`.

## Develop

```bash
make test       # run BOTH suites (Node + Python, offline)
make parity     # cross-language gate: both CLIs over shared cases, diff outputs
make audit      # typecheck + test + parity (the full gate)
```

The reconstructed document is grafted node-for-node; both suites assert it is
deep-equal to the source file, and the parity gate asserts the Node and Python
`full.json` are **byte-identical**.
