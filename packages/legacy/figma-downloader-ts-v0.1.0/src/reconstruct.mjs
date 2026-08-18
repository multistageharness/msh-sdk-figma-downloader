// reconstruct.mjs — graft the downloaded subtrees back onto the skeleton to
// produce a single full file JSON, shaped like a plain `GET /v1/files/:key`.
//
// The skeleton is the depth-truncated document; the part files each hold a
// `/nodes` response whose `nodes[id].document` is the *full* subtree for a
// frontier id. We walk the skeleton, and at every frontier node (depth === N)
// we replace it wholesale with its full subtree from the node map. Top-level
// `components`, `componentSets`, and `styles` maps (which `/nodes` returns
// per-batch) are unioned into the reconstructed file.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { stringify } from './util.mjs';

/**
 * Build a `{ id -> fullNode }` map plus merged component/style maps from a set
 * of `/nodes` responses.
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
 * Produce the full file object from a skeleton + indexed parts.
 * Pure: does not touch the filesystem.
 *
 * @param {object} skeleton  the `/files/:key?depth=N` response
 * @param {number} depth     the frontier depth used for the download
 * @param {object} indexed   output of indexParts()
 * @returns {{ file: object, stats: { grafted: number, missing: string[] } }}
 */
export function reconstruct(skeleton, depth, indexed) {
  const { nodeMap, components, componentSets, styles } = indexed;
  const missing = [];
  let grafted = 0;

  function graft(node, level) {
    if (!node || typeof node !== 'object') return node;
    if (level === depth) {
      const full = nodeMap.get(node.id);
      if (full) {
        grafted += 1;
        return full;
      }
      missing.push(node.id);
      return node; // keep the shallow node rather than dropping it
    }
    if (Array.isArray(node.children)) {
      return { ...node, children: node.children.map((c) => graft(c, level + 1)) };
    }
    return node;
  }

  const document = graft(skeleton.document, 0);
  const file = {
    ...skeleton,
    document,
    // Union the skeleton's own top-level maps with everything the parts carried.
    components: { ...(skeleton.components || {}), ...components },
    componentSets: { ...(skeleton.componentSets || {}), ...componentSets },
    styles: { ...(skeleton.styles || {}), ...styles },
  };
  return { file, stats: { grafted, missing } };
}

/** Read every `part-*.json` under `partsDir`, in sorted (download) order. */
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
 * `parts/` folder. Writes the merged file to `outPath` and returns stats.
 */
export async function reconstructFromDir(workDir, outPath, { depth } = {}) {
  const skeleton = JSON.parse(await fs.readFile(path.join(workDir, 'skeleton.json'), 'utf8'));
  let frontierDepth = depth;
  if (frontierDepth === undefined) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(workDir, 'manifest.json'), 'utf8'));
      frontierDepth = manifest.frontierDepth ?? manifest.depth;
    } catch {
      /* fall through */
    }
  }
  if (frontierDepth === undefined) frontierDepth = 2;

  const parts = await loadParts(path.join(workDir, 'parts'));
  const indexed = indexParts(parts);
  const { file, stats } = reconstruct(skeleton, frontierDepth, indexed);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, stringify(file), 'utf8');
  return { file, stats, outPath };
}
