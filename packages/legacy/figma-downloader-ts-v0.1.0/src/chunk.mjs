// chunk.mjs — plan and execute the chunked download.
//
// The skeleton (a depth-truncated `/files/:key`) carries the document tree down
// to the truncation frontier. The frontier nodes — those at exactly `depth`,
// whose own children were omitted — are the roots we re-fetch in full via the
// `/nodes` endpoint, a batch of ids per request, each response streamed straight
// to a part file on disk. Reconstruction (reconstruct.mjs) grafts those subtrees
// back onto the skeleton.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fetchNodes } from './figmaClient.mjs';
import { batch, pool, pad, stringify } from './util.mjs';

/**
 * Walk the skeleton document and collect the ids of every node at exactly
 * `depth`, where the document node is depth 0, pages (CANVAS) are depth 1, and
 * their top-level frames are depth 2. These are the chunk roots.
 *
 * @param {object} skeleton  a `/files/:key?depth=N` response
 * @param {number} depth     the same depth the skeleton was fetched with
 * @returns {string[]} frontier node ids, in document order, de-duplicated
 */
export function collectFrontierIds(skeleton, depth) {
  const doc = skeleton?.document;
  if (!doc) throw new Error('skeleton has no `document` — cannot plan chunks.');
  const ids = [];
  (function walk(node, level) {
    if (!node || typeof node !== 'object') return;
    if (level === depth) {
      if (node.id) ids.push(node.id);
      return; // do not descend past the frontier
    }
    for (const child of node.children || []) walk(child, level + 1);
  })(doc, 0);
  return [...new Set(ids)];
}

/**
 * Stream-download the full subtree for every frontier id into part files under
 * `<workDir>/parts/`. Batches ids per request, runs batches with bounded
 * concurrency, retries transient failures (in the client), and — with
 * `resume` — skips part files already present on disk.
 *
 * @returns {Promise<{ manifest: object, partFiles: string[] }>}
 */
export async function downloadChunks({
  fileKey,
  token,
  frontierIds,
  workDir,
  batchSize = 10,
  concurrency = 4,
  resume = false,
  retries = 3,
  timeoutMs = 60_000,
  geometry = false,
  nodeDepth,
  log = () => {},
}) {
  const partsDir = path.join(workDir, 'parts');
  await fs.mkdir(partsDir, { recursive: true });

  const batches = batch(frontierIds, batchSize);
  const partFiles = batches.map((_, i) => path.join(partsDir, `part-${pad(i)}.json`));
  let done = 0;
  let skipped = 0;

  const tasks = batches.map((ids, i) => async () => {
    const partPath = partFiles[i];
    if (resume && (await exists(partPath))) {
      skipped += 1;
      log(`  [${i + 1}/${batches.length}] resume: skip ${path.basename(partPath)} (${ids.length} ids)`);
      return;
    }
    const data = await fetchNodes(fileKey, ids, token, {
      retries,
      timeoutMs,
      geometry,
      nodeDepth,
      onRetry: ({ status, attempt, waitMs }) =>
        log(`  [${i + 1}/${batches.length}] retry #${attempt} (status ${status}) in ${waitMs}ms`),
    });
    await fs.writeFile(partPath, stringify(data), 'utf8');
    done += 1;
    const got = Object.keys(data.nodes || {}).length;
    log(`  [${i + 1}/${batches.length}] wrote ${path.basename(partPath)} — ${got}/${ids.length} node(s)`);
  });

  await pool(tasks, concurrency);

  const manifest = {
    fileKey,
    frontierDepth: undefined, // filled in by the caller (it owns `depth`)
    batchSize,
    idCount: frontierIds.length,
    batchCount: batches.length,
    downloaded: done,
    resumedSkipped: skipped,
    parts: partFiles.map((p) => path.basename(p)),
  };
  await fs.writeFile(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { manifest, partFiles };
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
