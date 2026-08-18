# Examples

Runnable use-case catalog for `figma-downloader-py`, organized so that **every CLI
flag, environment variable, config-file key, and library entry point** is exercised
at least once. Each numbered script is self-contained and self-documenting.

Run any script from inside this package (`packages/figma-downloader-py`):

```bash
cd ..                       # -> packages/figma-downloader-py
bash examples/01-offline-mock.sh
```

Every script runs **fully offline**: the working commands all use `--mock` (or the
mock transport), and the live-network commands are **printed only** — they use
placeholder keys (e.g. `ABC123fileKEY`) to show the command shape. Copy a printed
command, substitute your real `--file-key`/`--url`, and export a token to run it:

```bash
export FIGMA_TOKEN=figd_xxx
python3 -m figma_downloader --file-key <YOUR_KEY> --size large
```

## What each example covers

| Script | Use case | Input options exercised |
| --- | --- | --- |
| [`01-offline-mock.sh`](01-offline-mock.sh) | Offline smoke tests — no token, no network | `--mock`, `--pretty`, `--stdout`, `--quiet`, `--out`, `--work-dir` |
| [`02-input-sources.sh`](02-input-sources.sh) | Where the file key comes from | `--url`, `--file-key`, `--mock`, `FIGMA_TOKEN` / `FIGMA_API_TOKEN` / `FIGMA_ACCESS_TOKEN` |
| [`03-size-tiers.sh`](03-size-tiers.sh) | Any-size handling | `--size auto\|sm\|md\|large\|xl\|xxxxl` |
| [`04-rechunking.sh`](04-rechunking.sh) | The any-size guarantee (split oversized parts) | `--max-part-bytes`, `--max-part-ms`, `--max-rechunk-depth` |
| [`05-chunking-tuning.sh`](05-chunking-tuning.sh) | Hand-tune the paging strategy | `--depth`, `--batch-size`, `--concurrency`, `--rate`, `--retries`, `--timeout-ms` |
| [`06-output-control.sh`](06-output-control.sh) | Where + how output is written | `--out`, `--work-dir`, `--stdout`, `--pretty`, `--quiet`, `--keep-parts` |
| [`07-modes.sh`](07-modes.sh) | Operational modes | `--geometry`, `--resume`, `--skeleton-only`, `--reconstruct-only`, `--keep-parts` |
| [`08-network-proxy-tls.sh`](08-network-proxy-tls.sh) | Proxy + TLS resolution & precedence | `--proxy`, `--no-proxy`, `--ssl-verify`, `--no-ssl-verify`/`--insecure`, `--config`, `FIGMA_PROXY`/`HTTPS_PROXY`/…, `FIGMA_SSL_VERIFY`, `NODE_TLS_REJECT_UNAUTHORIZED` |
| [`09-exit-codes.sh`](09-exit-codes.sh) | Scripting against typed errors | exit codes `0/2/3/4/5/6/7`, `--help` |
| [`10-library-api.py`](10-library-api.py) | Programmatic use (no CLI) | every name in `figma_downloader.__all__` |

Sample config file: [`figma-download.config.json`](figma-download.config.json).

## Input-option reference

```
INPUT (choose one)      --url <figma-url> | --file-key <key> | --mock
SIZE                    --size {auto|sm|md|large|xl|xxxxl}
                        --max-part-bytes <n>  --max-part-ms <n>  --max-rechunk-depth <n>
OUTPUT                  --out <path>  --work-dir <dir>  --stdout  --pretty  --quiet
PAGING                  --depth <n>  --batch-size <n>  --concurrency <n>
                        --rate <n>  --retries <n>  --timeout-ms <n>
NETWORK                 --proxy <url>  --no-proxy  --ssl-verify  --no-ssl-verify (--insecure)
                        --config <path>
MODES                   --geometry  --resume  --skeleton-only  --reconstruct-only  --keep-parts
ENV (token)             FIGMA_TOKEN | FIGMA_API_TOKEN | FIGMA_ACCESS_TOKEN
ENV (proxy)             FIGMA_PROXY | HTTPS_PROXY | HTTP_PROXY | ALL_PROXY (lower-case too)
ENV (TLS)               FIGMA_SSL_VERIFY | NODE_TLS_REJECT_UNAUTHORIZED
EXIT CODES              0 ok · 2 usage · 3 auth · 4 not-found · 5 rate-limit · 6 server/net · 7 timeout
```
