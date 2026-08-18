// chunk.mjs — plan and execute the chunked download.
//
// The skeleton (a depth-truncated `/files/:key`) carries the document tree down
// to the truncation frontier. The frontier nodes — those at exactly `depth` —
// are the roots we re-fetch in full via `/nodes`, a batch of ids per request,
// each response streamed to its own part file on disk. Reconstruction grafts
// those subtrees back onto the skeleton.
//
// Two scaling mechanisms beyond plain frontier chunking:
//   • Content-hash part files (TR-12): a part is named by the sha256 of its
//     sorted id-batch, so an unchanged batch yields the same filename and a
//     resume reuses it. The manifest records, per planned group, which part
//     files it produced — so resume is correct even when a group was re-chunked.
//   • Byte/time-aware re-chunking (TR-3): if a fetched batch exceeds its byte or
//     time budget, its oversized subtrees are split in memory into a SHALLOW
//     parent part (one-level children) plus a full part per child, recursively.
//     No single part file then exceeds the budget — the guarantee that makes the
//     downloader work for a file of ANY size, regardless of the initial tier.

import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fetchNodes } from './figmaClient.mjs';
import { batch, pool, sha256OfBatch, stringify, byteLength } from './util.mjs';

/**
 * Walk the skeleton document and collect the ids of every node at exactly
 * `depth` (document = 0, pages/CANVAS = 1, top frames = 2). These are the chunk
 * roots.
 *
 * @param {object} skeleton  a `/files/:key?depth=N` response
 * @param {number} depth
 * @returns {string[]} frontier node ids, document order, de-duplicated
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

/** Drop a node's `children` array, keeping everything else (a graft stub). */
function stripChildren(node) {
  const { children, ...rest } = node;
  return rest;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Write a JSON string to disk — buffered, or streamed with backpressure. */
async function writeJson(partPath, json, stream) {
  if (!stream) {
    await fs.writeFile(partPath, json, 'utf8');
    return;
  }
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(partPath, { encoding: 'utf8' });
    ws.on('error', reject);
    ws.on('finish', resolve);
    const CH = 1 << 16;
    let i = 0;
    (function pump() {
      let ok = true;
      while (i < json.length && ok) {
        const slice = json.slice(i, i + CH);
        i += CH;
        if (i >= json.length) {
          ws.end(slice);
          return;
        }
        ok = ws.write(slice);
      }
      if (i < json.length && !ok) ws.once('drain', pump);
    })();
  });
}

/**
 * Stream-download the full subtree for every frontier id into content-hashed
 * part files under `<workDir>/parts/`, re-chunking any over-budget subtree, and
 * write a complete `manifest.json` in a single pass.
 *
 * @returns {Promise<{ manifest: object, partFiles: string[] }>}
 */
export async function downloadChunks({
  fileKey,
  token,
  frontierIds,
  depth,
  workDir,
  size,
  batchSize = 10,
  concurrency = 4,
  resume = false,
  retries = 3,
  timeoutMs = 60_000,
  geometry = false,
  version,
  nodeDepth,
  stream = false,
  rechunk = false,
  maxPartBytes = 0,
  maxPartMs = 0,
  maxRechunkDepth = 4,
  limiter = null,
  log = () => {},
}) {
  const partsDir = path.join(workDir, 'parts');
  await fs.mkdir(partsDir, { recursive: true });

  const batches = batch(frontierIds, batchSize);

  // Prior manifest enables correct resume even for re-chunked groups.
  const priorGroups = new Map();
  if (resume) {
    try {
      const prior = JSON.parse(await fs.readFile(path.join(workDir, 'manifest.json'), 'utf8'));
      for (const g of prior.groups || []) priorGroups.set(g.sha, g);
    } catch {
      /* no prior manifest — nothing to resume */
    }
  }

  const partsMeta = [];
  const groupsMeta = new Array(batches.length);
  const writtenFiles = new Set();
  let written = 0;
  let skipped = 0;
  let rechunked = 0;
  const oversizedLeaves = [];

  const mapsOf = (entry) => ({
    components: entry?.components || {},
    componentSets: entry?.componentSets || {},
    styles: entry?.styles || {},
  });
  const nodePart = (node, maps) => ({ nodes: { [node.id]: { document: node, ...maps } } });

  const writePart = async (file, payload, ids, elapsedMs = 0) => {
    const partPath = path.join(partsDir, file);
    const json = stringify(payload);
    const bytes = byteLength(json);
    await writeJson(partPath, json, stream);
    if (!writtenFiles.has(file)) {
      writtenFiles.add(file);
      partsMeta.push({ file, ids: [...ids], sha: file.slice(5, -5), bytes, elapsedMs });
      written += 1;
    }
    return bytes;
  };

  // Split one over-budget node into a shallow parent part + full child parts.
  const splitNode = async (node, level, maps, groupFiles) => {
    const bytes = byteLength(stringify(node));
    const kids = Array.isArray(node.children) ? node.children : [];
    const over = maxPartBytes > 0 && bytes > maxPartBytes;
    const canSplit = rechunk && level < maxRechunkDepth && kids.length > 0;
    if (!over || !canSplit) {
      if (over && kids.length === 0 && !oversizedLeaves.includes(node.id)) oversizedLeaves.push(node.id);
      const file = `part-${sha256OfBatch([node.id])}.json`;
      await writePart(file, nodePart(node, maps), [node.id]);
      groupFiles.push(file);
      return;
    }
    rechunked += 1;
    const shallow = { ...node, children: kids.map(stripChildren) };
    const file = `part-${sha256OfBatch([node.id])}.json`;
    await writePart(file, nodePart(shallow, maps), [node.id]);
    groupFiles.push(file);
    for (const child of kids) await splitNode(child, level + 1, maps, groupFiles);
  };

  const tasks = batches.map((ids, bi) => async () => {
    const gsha = sha256OfBatch(ids);
    const groupFiles = [];

    // --- Resume: reuse a prior group's parts if all are present. ---
    if (resume && priorGroups.has(gsha)) {
      const g = priorGroups.get(gsha);
      const parts = g.parts || [];
      const present = parts.length && (await Promise.all(parts.map((f) => exists(path.join(partsDir, f))))).every(Boolean);
      if (present) {
        skipped += 1;
        for (const f of parts) {
          if (!writtenFiles.has(f)) {
            writtenFiles.add(f);
            const st = await fs.stat(path.join(partsDir, f));
            partsMeta.push({ file: f, ids: g.ids || ids, sha: f.slice(5, -5), bytes: st.size, elapsedMs: 0 });
          }
          groupFiles.push(f);
        }
        groupsMeta[bi] = { sha: gsha, ids, parts: groupFiles, rechunked: !!g.rechunked, resumed: true };
        log(`  [${bi + 1}/${batches.length}] resume: skip group ${gsha} (${groupFiles.length} part(s))`);
        return;
      }
    }

    // --- Fetch the batch. ---
    const t0 = Date.now();
    const data = await fetchNodes(fileKey, ids, token, {
      retries,
      timeoutMs,
      geometry,
      version,
      nodeDepth,
      onRetry: ({ status, attempt, waitMs }) =>
        log(`  [${bi + 1}/${batches.length}] retry #${attempt} (status ${status}) in ${waitMs}ms`),
    });
    const elapsedMs = Date.now() - t0;
    const batchBytes = byteLength(stringify(data));
    const overBudget =
      rechunk && ((maxPartBytes > 0 && batchBytes > maxPartBytes) || (maxPartMs > 0 && elapsedMs > maxPartMs));

    if (!overBudget) {
      const file = `part-${gsha}.json`;
      await writePart(file, data, ids, elapsedMs);
      groupFiles.push(file);
      groupsMeta[bi] = { sha: gsha, ids, parts: groupFiles, rechunked: false };
      const got = Object.keys(data.nodes || {}).length;
      log(`  [${bi + 1}/${batches.length}] wrote ${file} — ${got}/${ids.length} node(s), ${batchBytes}B`);
      return;
    }

    // --- Over budget: re-chunk each subtree in memory. ---
    log(`  [${bi + 1}/${batches.length}] over budget (${batchBytes}B / ${elapsedMs}ms) — re-chunking`);
    for (const id of ids) {
      const entry = data.nodes?.[id];
      if (!entry?.document) continue;
      await splitNode(entry.document, depth, mapsOf(entry), groupFiles);
    }
    groupsMeta[bi] = { sha: gsha, ids, parts: groupFiles, rechunked: true };
  });

  await pool(tasks, concurrency, { limiter });

  partsMeta.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const partFiles = partsMeta.map((p) => path.join(partsDir, p.file));

  const manifest = {
    fileKey,
    size: size ?? null,
    frontierDepth: depth,
    batchSize,
    concurrency,
    idCount: frontierIds.length,
    batchCount: batches.length,
    downloaded: written,
    resumedSkipped: skipped,
    rechunked,
    oversizedLeaves,
    frontierIds: [...frontierIds],
    parts: partsMeta,
    groups: groupsMeta.filter(Boolean),
  };
  await fs.writeFile(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { manifest, partFiles };
}
