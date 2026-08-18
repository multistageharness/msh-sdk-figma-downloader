# integration/ts/

Node download use cases for the keys in [`../../figma.json`](../../figma.json),
driving the sibling [`figma-downloader-ts`](../../packages/figma-downloader-ts)
package. Output lands at `integration/ts/out/<key>/full.json` (gitignored).

```
download-all.sh     # CLI: download every key
download-one.sh     # CLI: download one file by 1-based index or literal key
download-all.mjs    # programmatic: same, via the in-process library run()
```

## Run

```bash
# Live (needs a token: FIGMA_TOKEN | FIGMA_API_TOKEN | FIGMA_ACCESS_TOKEN):
FIGMA_TOKEN=figd_xxx bash integration/ts/download-all.sh
FIGMA_TOKEN=figd_xxx bash integration/ts/download-all.sh --size large --pretty
FIGMA_TOKEN=figd_xxx bash integration/ts/download-one.sh 1            # first key
FIGMA_TOKEN=figd_xxx bash integration/ts/download-one.sh <KEY> --pretty

# No token → the .sh scripts print the exact per-file commands and exit 0.
bash integration/ts/download-all.sh

# Programmatic — live with a token, else an offline --mock pass that still drives
# the full pipeline for every key (no token, no network required):
node integration/ts/download-all.mjs
FIGMA_TOKEN=figd_xxx node integration/ts/download-all.mjs
```

The `.sh` runners call `node <pkg>/bin/figma-download.mjs`; `download-all.mjs`
imports `run()` from the package's `src/cli.mjs` and calls it in-process. Extra
flags after the script/selector pass straight through to the CLI.

## Python twin

Identical use cases live in [`../py/`](../py/) — same keys, same pipeline,
equivalent `full.json` (byte-identical under `--mock`; deep-equal parsed JSON
for live data, differing only in numeric formatting like `1.0` vs `1`).
