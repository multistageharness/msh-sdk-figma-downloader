#!/usr/bin/env node
// INTEGRATION (programmatic) — download every file in figma.json via the library.
//
// Calls the same run() the CLI wraps, once per key, fully in-process — no shelling
// out. With a token in the environment it hits the live Figma API; without one it
// does an offline --mock pass so the example always runs and the
// skeleton -> chunk -> reconstruct pipeline is exercised end-to-end.
//
//   FIGMA_TOKEN=figd_xxx node examples/integration/download-all.mjs   # live
//   node examples/integration/download-all.mjs                        # offline (--mock)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run } from '../../src/cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..', '..');
const filesJson = path.resolve(pkgRoot, '..', '..', 'figma.json');
const keys = JSON.parse(readFileSync(filesJson, 'utf8'));

const token = process.env.FIGMA_TOKEN || process.env.FIGMA_API_TOKEN || process.env.FIGMA_ACCESS_TOKEN;
const live = Boolean(token);
console.error(`→ ${keys.length} key(s) from ${filesJson} — ${live ? 'LIVE' : 'OFFLINE (--mock)'} mode`);

process.chdir(pkgRoot); // default out/<key>/ lands at the package root (gitignored)

let ok = 0;
const failed = [];
for (const key of keys) {
  // Live: fetch the real file. Offline: --mock ignores the key but drives the same
  // pipeline; a per-key work dir keeps each run's output separate.
  const argv = live
    ? ['--file-key', key, '--resume', '--quiet']
    : ['--mock', '--work-dir', path.join('out', key), '--quiet'];
  try {
    const code = await run(argv);
    if (code === 0) { ok++; console.error(`  ok   ${key}`); }
    else { failed.push(key); console.error(`  FAIL ${key} (exit ${code})`); }
  } catch (err) {
    failed.push(key);
    console.error(`  FAIL ${key} (${err?.message || err})`);
  }
}

console.error(`\n→ done: ${ok} ok, ${failed.length} failed of ${keys.length} → out/<key>/full.json`);
if (failed.length) process.exit(1);
