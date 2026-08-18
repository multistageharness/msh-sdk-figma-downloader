#!/usr/bin/env node
// INTEGRATION (repo-root, programmatic) — download every file in figma.json via
// the sibling Node library.
//
// Twin of ../py/download_all.py. Calls the same run() the CLI wraps, once per key,
// fully in-process — no shelling out. With a token in the environment it hits the
// live Figma API; without one it does an offline --mock pass so the example always
// runs and the skeleton -> chunk -> reconstruct pipeline is exercised end-to-end.
// Output lands at integration/ts/out/<key>/full.json either way.
//
//   FIGMA_TOKEN=figd_xxx node integration/ts/download-all.mjs   # live
//   node integration/ts/download-all.mjs                        # offline (--mock)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run } from '../../packages/figma-downloader-ts/src/cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const filesJson = path.resolve(repoRoot, 'figma.json');
const outDir = path.join(here, 'out');
const keys = JSON.parse(readFileSync(filesJson, 'utf8'));

const token = process.env.FIGMA_TOKEN || process.env.FIGMA_API_TOKEN || process.env.FIGMA_ACCESS_TOKEN;
const live = Boolean(token);
console.error(`→ ${keys.length} key(s) from ${filesJson} — ${live ? 'LIVE' : 'OFFLINE (--mock)'} mode`);

let ok = 0;
const failed = [];
for (const key of keys) {
  const workDir = path.join(outDir, key);
  // Live: fetch the real file. Offline: --mock ignores the key but drives the same
  // pipeline; a per-key work dir keeps each run's output separate.
  const argv = live
    ? ['--file-key', key, '--work-dir', workDir, '--resume', '--quiet']
    : ['--mock', '--work-dir', workDir, '--quiet'];
  try {
    const code = await run(argv);
    if (code === 0) { ok++; console.error(`  ok   ${key}`); }
    else { failed.push(key); console.error(`  FAIL ${key} (exit ${code})`); }
  } catch (err) {
    failed.push(key);
    console.error(`  FAIL ${key} (${err?.message || err})`);
  }
}

console.error(`\n→ done: ${ok} ok, ${failed.length} failed of ${keys.length} → integration/ts/out/<key>/full.json`);
if (failed.length) process.exit(1);
