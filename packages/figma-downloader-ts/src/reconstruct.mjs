// reconstruct.mjs — graft the downloaded subtrees back onto the skeleton to
// produce a single full file JSON, shaped like a plain `GET /v1/files/:key`.
//
// The skeleton is the depth-truncated document; the part files each hold a
// `/nodes`-shaped response whose `nodes[id].document` is the subtree for some id.
// We index every part into a `{ id -> node }` map and then walk the skeleton:
// whenever a node's id is in the map we replace it with the mapped node, then
// keep walking *into* the replacement so deeper grafts apply too. That recursive,
// id-keyed graft handles both shapes uniformly:
//
//   • normal frontier node  → map holds its FULL subtree (one graft, done).
//   • re-chunked node (TR-3) → map holds a SHALLOW form (one-level children),
//     and each of those children has its own full subtree in the map; walking
//     into the shallow form grafts the children in turn.
//
// Top-level `components`, `componentSets`, and `styles` maps (which `/nodes`
// returns per-batch) are unioned into the reconstructed file.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { stringify } from './util.mjs';

/**
 * Build a `{ id -> node }` map plus merged component/style maps from a set of
 * `/nodes`-shaped responses.
 */
export function indexParts(parts) {
  const nodeMap = new Map();
  const components = {};
  const componentSets = {};
  const styles = {};
  for (const part of parts) {
    for (const [id, entry] of Object.entries(part?.nodes || {})) {
      if (entry?.document) nodeMap.set(id, entry.document);
      Object.assign(components, entry?.components || {});
      Object.assign(componentSets, entry?.componentSets || {});
      Object.assign(styles, entry?.styles || {});
    }
  }
  return { nodeMap, components, componentSets, styles };
}

/**
 * Produce the full file object from a skeleton + indexed parts. Pure: does not
 * touch the filesystem.
 *
 * @param {object} skeleton  the `/files/:key?depth=N` response
 * @param {object} indexed   output of indexParts()
 * @param {{ frontierIds?: string[] }} [opts]  planned frontier ids, to report which are missing
 * @returns {{ file: object, stats: { grafted: number, missing: string[] } }}
 */
export function reconstruct(skeleton, indexed, opts = {}) {
  const { nodeMap, components, componentSets, styles } = indexed;
  const frontierIds = opts.frontierIds || [];
  let grafted = 0;

  function graft(node) {
    if (!node || typeof node !== 'object') return node;
    let cur = node;
    if (node.id && nodeMap.has(node.id)) {
      cur = nodeMap.get(node.id);
      grafted += 1;
    }
    if (Array.isArray(cur.children)) {
      return { ...cur, children: cur.children.map(graft) };
    }
    return cur;
  }

  const document = graft(skeleton.document);
  const missing = frontierIds.filter((id) => !nodeMap.has(id));
  const file = {
    ...skeleton,
    document,
    components: { ...(skeleton.components || {}), ...components },
    componentSets: { ...(skeleton.componentSets || {}), ...componentSets },
    styles: { ...(skeleton.styles || {}), ...styles },
  };
  return { file, stats: { grafted, missing } };
}

/** Read every `part-*.json` under `partsDir`, in sorted (stable) order. */
export async function loadParts(partsDir) {
  let entries;
  try {
    entries = await fs.readdir(partsDir);
  } catch (err) {
    throw new Error(`cannot read parts dir ${partsDir}: ${err.message || err}`);
  }
  const files = entries.filter((f) => /^part-.*\.json$/.test(f)).sort();
  const parts = [];
  for (const f of files) {
    const raw = await fs.readFile(path.join(partsDir, f), 'utf8');
    parts.push(JSON.parse(raw));
  }
  return parts;
}

/**
 * End-to-end reconstruct from a work directory containing `skeleton.json` and a
 * `parts/` folder. Reads the planned `frontierIds` from `manifest.json` when
 * present (for missing-node reporting). Writes the merged file to `outPath`.
 */
export async function reconstructFromDir(workDir, outPath, opts = {}) {
  const skeleton = JSON.parse(await fs.readFile(path.join(workDir, 'skeleton.json'), 'utf8'));
  let frontierIds = opts.frontierIds;
  if (!frontierIds) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(workDir, 'manifest.json'), 'utf8'));
      frontierIds = manifest.frontierIds || [];
    } catch {
      frontierIds = [];
    }
  }
  const parts = await loadParts(path.join(workDir, 'parts'));
  const indexed = indexParts(parts);
  const { file, stats } = reconstruct(skeleton, indexed, { frontierIds });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, stringify(file), 'utf8');
  return { file, stats, outPath };
}
