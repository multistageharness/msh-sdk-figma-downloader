# integration/py/

Python download use cases for the keys in [`../../figma.json`](../../figma.json),
driving the sibling [`figma-downloader-py`](../../packages/figma-downloader-py)
package. Output lands at `integration/py/out/<key>/full.json` (gitignored).

```
download-all.sh     # CLI: download every key
download-one.sh     # CLI: download one file by 1-based index or literal key
download_all.py     # programmatic: same, via the in-process library run()
```

## Run

```bash
# Live (needs a token: FIGMA_TOKEN | FIGMA_API_TOKEN | FIGMA_ACCESS_TOKEN):
FIGMA_TOKEN=figd_xxx bash integration/py/download-all.sh
FIGMA_TOKEN=figd_xxx bash integration/py/download-all.sh --size large --pretty
FIGMA_TOKEN=figd_xxx bash integration/py/download-one.sh 1            # first key
FIGMA_TOKEN=figd_xxx bash integration/py/download-one.sh <KEY> --pretty

# No token → the .sh scripts print the exact per-file commands and exit 0.
bash integration/py/download-all.sh

# Programmatic — live with a token, else an offline --mock pass that still drives
# the full pipeline for every key (no token, no network required):
python3 integration/py/download_all.py
FIGMA_TOKEN=figd_xxx python3 integration/py/download_all.py
```

The `.sh` runners `cd` into the package root so `python3 -m figma_downloader`
resolves the in-tree package without an install; `download_all.py` adds the
package to `sys.path` and calls `run()` in-process. Extra flags after the
script/selector pass straight through to the CLI.

## Node twin

Identical use cases live in [`../ts/`](../ts/) — same keys, same pipeline,
equivalent `full.json` (byte-identical under `--mock`; deep-equal parsed JSON
for live data, differing only in numeric formatting like `1.0` vs `1`).
