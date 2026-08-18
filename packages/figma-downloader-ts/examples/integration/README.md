# examples/integration/

End-to-end **download use cases** for the actual file keys in the repo-root
[`figma.json`](../../../../figma.json) — as opposed to the `offline/` and `live/`
examples, which exist to exercise individual flags. These scripts read that key
list (the single source of truth) and pull each file through the real
skeleton → chunk → reconstruct pipeline.

```
integration/
├── download-all.sh     # CLI: download every key → out/<key>/full.json
├── download-one.sh     # CLI: download one file by index or key
└── download-all.mjs    # programmatic: same, via the in-process library run()
```

## Run

All three resolve the key list from `figma.json` automatically and write to
`out/<key>/full.json` under the package root (`out/` is gitignored). `--resume`
makes a re-run skip parts already on disk, so an interrupted batch is cheap to finish.

```bash
# from packages/figma-downloader-ts

# Live — needs a token (any of the three accepted names):
FIGMA_TOKEN=figd_xxx bash examples/integration/download-all.sh
FIGMA_TOKEN=figd_xxx bash examples/integration/download-one.sh 1          # first key
FIGMA_TOKEN=figd_xxx bash examples/integration/download-one.sh <KEY> --pretty

# No token → the scripts print the exact per-file commands and exit 0.
bash examples/integration/download-all.sh

# Programmatic — live with a token, otherwise an offline --mock pass that still
# runs the full pipeline for every key (so it works with no token, no network):
node examples/integration/download-all.mjs
FIGMA_TOKEN=figd_xxx node examples/integration/download-all.mjs
```

Extra flags after the script/selector pass straight through to the CLI
(`--size large`, `--pretty`, `--geometry`, `--concurrency 4`, …).

## Python twin

Identical use cases live in
[`../../figma-downloader-py/examples/integration/`](../../figma-downloader-py/examples/integration/)
(`download-all.sh`, `download-one.sh`, `download_all.py`) — same keys, same output,
byte-identical `full.json`.
