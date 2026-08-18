// mock.mjs — an offline fake of the Figma REST API so `--mock` (and the tests)
// drive the *real* chunked-download code path without a network call.
//
// It owns one deep in-memory file and serves it through the same two endpoints
// the client uses: `/files/:key?depth=N` (truncated) and `/files/:key/nodes?ids=`
// (full subtrees). Install it by assigning the returned fetch to `_http.fetch`.

/** A deep document: 1 page → 3 frames → each with nested children. */
export const MOCK_FILE = buildMockFile();

function buildMockFile() {
  const frame = (id, name, kids) => ({
    id,
    name,
    type: 'FRAME',
    absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 3000 },
    children: kids,
  });
  const leaf = (id, name) => ({ id, name, type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 } });
  const group = (id, name, kids) => ({ id, name, type: 'GROUP', children: kids });

  return {
    name: 'Mock Large File',
    role: 'owner',
    lastModified: '2020-01-01T00:00:00Z',
    editorType: 'figma',
    version: '1234567890',
    schemaVersion: 0,
    document: {
      id: '0:0',
      name: 'Document',
      type: 'DOCUMENT',
      children: [
        {
          id: '0:1',
          name: 'Page 1',
          type: 'CANVAS',
          children: [
            frame('1:100', 'Desktop', [
              group('1:101', 'Header', [leaf('1:102', 'Logo'), leaf('1:103', 'Nav')]),
              group('1:104', 'Body', [leaf('1:105', 'Hero'), leaf('1:106', 'Card')]),
            ]),
            frame('1:200', 'Tablet', [group('1:201', 'Header', [leaf('1:202', 'Logo')])]),
            frame('1:300', 'Mobile', [
              group('1:301', 'Header', [leaf('1:302', 'Logo')]),
              group('1:303', 'Footer', [leaf('1:304', 'Links')]),
            ]),
          ],
        },
      ],
    },
    components: {},
    componentSets: {},
    styles: {},
  };
}

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
 * Build a fetch(url) that serves MOCK_FILE (or a supplied file) through the two
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
        const found = findNode(file.document, id);
        if (found) nodes[id] = { document: found, components: {}, componentSets: {}, styles: {} };
      }
      return ok({ name: file.name, lastModified: file.lastModified, version: file.version, nodes });
    }

    // /files/:key — honour the depth param.
    const depth = Number(u.searchParams.get('depth')) || Infinity;
    return ok({ ...file, document: truncate(file.document, 0, depth) });
  };
}
