// mock.mjs — an offline fake of the Figma REST API so `--mock` (and the tests)
// drive the *real* chunked-download code path without a network call.
//
// It serves one deep file through the three endpoints the client uses:
//   • GET /files/:key?depth=N   (truncated skeleton)
//   • GET /files/:key/nodes?ids (full subtrees)
//   • GET /files/:key           (whole file — the `sm` fast path)
//
// The canonical document lives in the language-neutral shared fixture
// (`packages/shared/fixtures/mock-file.json`) so the Node and Python twins serve
// byte-identical data — the bedrock of the cross-language parity harness. Install
// it by assigning the returned fetch to `_http.fetch`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../shared/fixtures/mock-file.json');

/** A deep document: 1 page → 3 frames → each with nested children. */
export const MOCK_FILE = JSON.parse(readFileSync(FIXTURE, 'utf8'));

/** Deep-clone + truncate a tree so nodes below `depth` lose their children. */
function truncate(node, level, depth) {
  const copy = { ...node };
  if (Array.isArray(node.children)) {
    if (level >= depth) delete copy.children;
    else copy.children = node.children.map((c) => truncate(c, level + 1, depth));
  }
  return copy;
}

function findNode(node, id) {
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Build a fetch(url) that serves MOCK_FILE (or a supplied file) through the
 * endpoints. Ignores headers/token; returns Response-like objects.
 */
export function makeMockFetch(file = MOCK_FILE) {
  return async function mockFetch(url) {
    const u = new URL(url);
    const ok = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj), headers: new Map() });

    if (u.pathname.includes('/nodes')) {
      const ids = (u.searchParams.get('ids') || '').split(',').filter(Boolean);
      const nodes = {};
      for (const id of ids) {
        const found = findNode(file.document, decodeURIComponent(id));
        if (found) nodes[id] = { document: found, components: {}, componentSets: {}, styles: {} };
      }
      return ok({ name: file.name, lastModified: file.lastModified, version: file.version, nodes });
    }

    // /files/:key — honour the depth param (absent → whole file).
    const depthParam = u.searchParams.get('depth');
    if (depthParam === null) return ok(file); // whole-file fast path
    const depth = Number(depthParam) || Infinity;
    return ok({ ...file, document: truncate(file.document, 0, depth) });
  };
}
