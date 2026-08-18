# examples/

Runnable use cases covering **every input option** of `figma-download` — each
flag, every input mode, all three network sources (flag · config · env), and the
typed exit codes.

```
examples/
├── offline/     # run NOW: drive the real path against the built-in --mock fixture
├── live/        # need a real FIGMA_TOKEN (print the command + run if a token is set)
├── config/      # sample figma-download.config.json
└── run-all-offline.sh   # runs every offline example — a token-free smoke test
```

## Run the offline set (no token, no network)

```bash
bash examples/run-all-offline.sh          # all of them
bash examples/offline/03-size-tiers.sh    # just one
```

The `live/` scripts print the exact command and only execute it when
`FIGMA_TOKEN` (or `FIGMA_API_TOKEN` / `FIGMA_ACCESS_TOKEN`) is set:

```bash
FIGMA_TOKEN=figd_xxx bash examples/live/01-input-url.sh https://www.figma.com/design/<KEY>/Name
```

## Which example exercises which option

### Input mode — choose exactly one
| Option | Example |
|---|---|
| `--mock` | every `offline/*` |
| `--url <figma-url>` | `live/01-input-url.sh` |
| `--file-key <key>` | `live/02-input-file-key.sh` |

### Size & re-chunking (any file: `sm` … `xxxxl`)
| Option | Example |
|---|---|
| `--size auto\|sm\|md\|large\|xl\|xxxxl` | `offline/03-size-tiers.sh` |
| `--max-part-bytes <n>` | `offline/05-rechunk-budgets.sh` |
| `--max-part-ms <n>` | `offline/05-rechunk-budgets.sh` |
| `--max-rechunk-depth <n>` | `offline/05-rechunk-budgets.sh` |

### Per-request tuning
| Option | Example |
|---|---|
| `--depth <n>` | `offline/04-tuning-knobs.sh` |
| `--batch-size <n>` | `offline/04-tuning-knobs.sh` |
| `--concurrency <n>` | `offline/04-tuning-knobs.sh` |
| `--rate <n>` | `offline/04-tuning-knobs.sh`, `live/07-resilience-and-output.sh` |
| `--retries <n>` | `offline/04-tuning-knobs.sh`, `live/07-resilience-and-output.sh` |
| `--timeout-ms <n>` | `offline/04-tuning-knobs.sh`, `live/07-resilience-and-output.sh` |

### Output & work dir
| Option | Example |
|---|---|
| `--out <path>` | `offline/02-mock-to-file.sh` |
| `--work-dir <dir>` | `offline/02-mock-to-file.sh` |
| `--stdout` | `offline/01-mock-smoke.sh` |
| `--pretty` | `offline/01-mock-smoke.sh` |
| `--quiet` | `offline/01-mock-smoke.sh`, `live/07-resilience-and-output.sh` |
| `--keep-parts` | `offline/05`, `offline/06`, `live/07` |

### Modes / workflow
| Option | Example |
|---|---|
| `--skeleton-only` | `offline/06-skeleton-and-reconstruct.sh` |
| `--reconstruct-only` | `offline/06-skeleton-and-reconstruct.sh` |
| `--resume` | `live/02-input-file-key.sh` |
| `--geometry` | `live/03-geometry.sh` |
| `-h` / `--help` | `offline/07-help-and-usage-errors.sh` |

### Network — proxy & TLS (precedence: flag > config > env > default)
| Option / source | Example |
|---|---|
| `--proxy <url>` / `--no-proxy` | `live/04-proxy-and-tls-flags.sh` |
| `--no-ssl-verify` (alias `--insecure`) / `--ssl-verify` | `live/04-proxy-and-tls-flags.sh` |
| `--config <path>` | `live/05-config-file.sh` |
| `FIGMA_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` | `live/06-network-via-env.sh` |
| `FIGMA_SSL_VERIFY` / `NODE_TLS_REJECT_UNAUTHORIZED` | `live/06-network-via-env.sh` |

### Auth & exit codes
| Item | Example |
|---|---|
| `FIGMA_TOKEN` / `FIGMA_API_TOKEN` / `FIGMA_ACCESS_TOKEN` | any `live/*` |
| exit `0` ok · `2` usage | `offline/07-help-and-usage-errors.sh` |
| exit `3` auth · `4` not-found · `5` rate-limit · `6` server/net · `7` timeout | documented in `offline/07` (require live failures to observe) |

## Python twin

Every command maps 1:1 onto the stdlib-only twin — swap the entrypoint:

```bash
node bin/figma-download.mjs --mock --pretty --stdout
( cd ../figma-downloader-py && python3 -m figma_downloader --mock --pretty --stdout )
```

Output is byte-identical (enforced by `../../parity`).
