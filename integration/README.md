# integration/

Repo-root **download use cases** for the actual Figma file keys in
[`../figma.json`](../figma.json) — the single source of truth. Unlike the
per-package `examples/` (which exercise individual flags), these scripts read
that key list and pull each file through the real
skeleton → chunk → reconstruct pipeline, once per language runtime.

```
integration/
├── py/                     # drives ../packages/figma-downloader-py
│   ├── download-all.sh     #   CLI: download every key → out/<key>/full.json
│   ├── download-one.sh     #   CLI: download one file by index or key
│   └── download_all.py     #   programmatic: same, via the in-process library run()
└── ts/                     # drives ../packages/figma-downloader-ts
    ├── download-all.sh     #   CLI: download every key → out/<key>/full.json
    ├── download-one.sh     #   CLI: download one file by index or key
    └── download-all.mjs    #   programmatic: same, via the in-process library run()
```

The two runtimes are twins: same keys, same pipeline, equivalent `full.json` —
byte-identical for the offline `--mock` fixture, and for live data deep-equal as
parsed JSON (the bytes can differ only in numeric formatting, e.g. Python `1.0`
vs Node `1`). Each runner writes to `integration/<runtime>/out/<key>/full.json` (gitignored via
the repo-root `out/` rule) and resolves the sibling package and `figma.json`
relative to this repo, so they run from anywhere.

## Run

```bash
# Live — needs a token (any of FIGMA_TOKEN | FIGMA_API_TOKEN | FIGMA_ACCESS_TOKEN):
FIGMA_TOKEN=figd_xxx bash integration/py/download-all.sh
FIGMA_TOKEN=figd_xxx bash integration/ts/download-all.sh

# A single file, by 1-based index into figma.json or by literal key:
FIGMA_TOKEN=figd_xxx bash integration/py/download-one.sh 1
FIGMA_TOKEN=figd_xxx bash integration/ts/download-one.sh TFTCSGbqpyxex6QRYqqbzb --pretty

# No token → the .sh scripts print the exact per-file commands and exit 0.
bash integration/py/download-all.sh

# Programmatic — live with a token, otherwise an offline --mock pass that still
# runs the full pipeline for every key (so it works with no token, no network):
python3 integration/py/download_all.py
node    integration/ts/download-all.mjs
```

Extra flags after the script/selector pass straight through to the CLI
(`--size large`, `--pretty`, `--geometry`, `--concurrency 4`, …). `--resume`
(already passed by the `.sh` runners) makes a re-run skip parts already on disk,
so an interrupted batch is cheap to finish.

See [`py/README.md`](py/README.md) and [`ts/README.md`](ts/README.md) for the
per-runtime detail.
