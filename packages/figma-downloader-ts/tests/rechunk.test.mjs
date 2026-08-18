// rechunk.test.mjs — byte-aware re-chunking (TR-3) stays lossless and idempotent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MOCK_FILE } from '../src/mock.mjs';
import { run } from '../src/cli.mjs';

async function partNames(dir) {
  return (await fs.readdir(path.join(dir, 'parts'))).filter((f) => f.startsWith('part-')).sort();
}

test('re-chunk: a tiny byte budget splits subtrees yet reconstructs losslessly', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'figdl-rc-'));
  const code = await run(['--mock', '--depth', '2', '--max-part-bytes', '200', '--keep-parts', '--work-dir', dir, '--quiet']);
  assert.equal(code, 0);

  const full = JSON.parse(await fs.readFile(path.join(dir, 'full.json'), 'utf8'));
  assert.deepEqual(full.document, MOCK_FILE.document, 're-chunked download is lossless');

  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  assert.ok(manifest.rechunked >= 1, 'at least one subtree was re-chunked');
  // re-chunking produces more parts than the 3 frontier frames alone.
  assert.ok(manifest.parts.length > 3, `expected many parts, got ${manifest.parts.length}`);

  await fs.rm(dir, { recursive: true, force: true });
});

test('re-chunk: deterministic — same budget yields the same part files', async () => {
  const a = await fs.mkdtemp(path.join(os.tmpdir(), 'figdl-rc-a-'));
  const b = await fs.mkdtemp(path.join(os.tmpdir(), 'figdl-rc-b-'));
  await run(['--mock', '--depth', '2', '--max-part-bytes', '200', '--keep-parts', '--work-dir', a, '--quiet']);
  await run(['--mock', '--depth', '2', '--max-part-bytes', '200', '--keep-parts', '--work-dir', b, '--quiet']);
  assert.deepEqual(await partNames(a), await partNames(b), 'content-hash part names are stable across runs');
  await fs.rm(a, { recursive: true, force: true });
  await fs.rm(b, { recursive: true, force: true });
});

test('re-chunk: no re-chunk when budget is generous (parts == frontier batches)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'figdl-rc-'));
  await run(['--mock', '--depth', '2', '--batch-size', '1', '--max-part-bytes', '10000000', '--keep-parts', '--work-dir', dir, '--quiet']);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.rechunked, 0, 'generous budget => no re-chunk');
  assert.equal(manifest.parts.length, 3, 'one part per frontier id');
  await fs.rm(dir, { recursive: true, force: true });
});
