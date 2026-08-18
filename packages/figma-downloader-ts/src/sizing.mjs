// sizing.mjs — make the downloader work for a file of ANY size: sm / md / large
// / xl / xxxxl. Two mechanisms that compose:
//
//   1. Tier PRESETS — each size maps to a download strategy (mode, depth,
//      batchSize, concurrency, streaming, re-chunk budgets). Fast + predictable.
//   2. AUTO classification — pick the tier from cheap skeleton signals (page
//      count, frontier width, serialized skeleton bytes) without ever fetching
//      the whole file to "measure" it.
//
// Correctness for any size does NOT depend on getting the tier right: the
// re-chunk loop in chunk.mjs splits any part that breaches its byte/time budget
// (TR-3). The tier is a performance hint, not a correctness dependency.

export const TIERS = ['sm', 'md', 'large', 'xl', 'xxxxl'];

/**
 * Strategy presets per tier. `maxPartBytes` / `maxPartMs` drive the re-chunk
 * loop; `mode: 'whole'` is the small-file fast path (single GET, no chunking).
 */
export const PRESETS = {
  sm:    { mode: 'whole',    depth: 2, batchSize: 10, concurrency: 1, stream: false, rechunk: false, maxPartBytes: 0,             maxPartMs: 0,     resume: false },
  md:    { mode: 'frontier', depth: 2, batchSize: 10, concurrency: 4, stream: false, rechunk: true,  maxPartBytes: 32 * 1024 * 1024, maxPartMs: 45000, resume: false },
  large: { mode: 'frontier', depth: 2, batchSize: 5,  concurrency: 6, stream: true,  rechunk: true,  maxPartBytes: 24 * 1024 * 1024, maxPartMs: 45000, resume: true },
  xl:    { mode: 'frontier', depth: 3, batchSize: 3,  concurrency: 8, stream: true,  rechunk: true,  maxPartBytes: 16 * 1024 * 1024, maxPartMs: 40000, resume: true },
  xxxxl: { mode: 'frontier', depth: 3, batchSize: 2,  concurrency: 8, stream: true,  rechunk: true,  maxPartBytes: 8  * 1024 * 1024, maxPartMs: 30000, resume: true },
};

/** Default classification thresholds (overridable in tests). */
export const DEFAULT_THRESHOLDS = {
  // upper bounds (inclusive) for each tier; anything above xl's bound is xxxxl
  sm:    { nodes: 3_000,     frontier: 0,     bytes: 2  * 1024 * 1024 },
  md:    { nodes: 30_000,    frontier: 50,    bytes: 8  * 1024 * 1024 },
  large: { nodes: 150_000,   frontier: 300,   bytes: 50 * 1024 * 1024 },
  xl:    { nodes: 1_000_000, frontier: 2_000, bytes: 50 * 1024 * 1024 },
};

/**
 * Classify a file into a tier from skeleton-derived signals. A signal that
 * pushes into a larger tier wins (we never under-provision).
 *
 * @param {{ nodeCount?: number, frontierWidth?: number, skeletonBytes?: number, hasFrontier?: boolean }} signals
 * @param {object} [thresholds]
 * @returns {'sm'|'md'|'large'|'xl'|'xxxxl'}
 */
export function classify(signals = {}, thresholds = DEFAULT_THRESHOLDS) {
  const nodes = signals.nodeCount ?? 0;
  const frontier = signals.frontierWidth ?? 0;
  const bytes = signals.skeletonBytes ?? 0;

  // A truncation-free tiny skeleton (the whole doc fit in the probe) is `sm`.
  if (signals.hasFrontier === false && nodes <= thresholds.sm.nodes) return 'sm';

  const tierByNodes = byBound(nodes, 'nodes', thresholds);
  const tierByFrontier = byBound(frontier, 'frontier', thresholds);
  const tierByBytes = byBound(bytes, 'bytes', thresholds);
  return maxTier(tierByNodes, tierByFrontier, tierByBytes);
}

function byBound(value, key, thresholds) {
  if (value <= thresholds.sm[key]) return 'sm';
  if (value <= thresholds.md[key]) return 'md';
  if (value <= thresholds.large[key]) return 'large';
  if (value <= thresholds.xl[key]) return 'xl';
  return 'xxxxl';
}

function maxTier(...tiers) {
  return tiers.reduce((a, b) => (TIERS.indexOf(b) > TIERS.indexOf(a) ? b : a), 'sm');
}

/**
 * Resolve the final strategy for a run. Explicit CLI options win over the tier
 * preset, which wins over `auto`.
 *
 * @param {{ size?: string, depth?: number, batchSize?: number, concurrency?: number,
 *          maxPartBytes?: number, maxPartMs?: number, signals?: object, thresholds?: object,
 *          explicit?: { depth?: boolean, batchSize?: boolean, concurrency?: boolean } }} opts
 * @returns {{ size: string, mode: string, depth: number, batchSize: number, concurrency: number,
 *            stream: boolean, rechunk: boolean, maxPartBytes: number, maxPartMs: number, resume: boolean }}
 */
export function resolveStrategy(opts = {}) {
  const explicit = opts.explicit || {};
  let size = opts.size && opts.size !== 'auto' ? opts.size : null;
  if (!size) size = classify(opts.signals || {}, opts.thresholds || DEFAULT_THRESHOLDS);
  if (!PRESETS[size]) throw new Error(`unknown size tier: ${size}`);

  const preset = { ...PRESETS[size] };
  // Explicit CLI values override the preset.
  if (explicit.depth && opts.depth !== undefined) preset.depth = opts.depth;
  if (explicit.batchSize && opts.batchSize !== undefined) preset.batchSize = opts.batchSize;
  if (explicit.concurrency && opts.concurrency !== undefined) preset.concurrency = opts.concurrency;
  if (opts.maxPartBytes !== undefined) {
    preset.maxPartBytes = opts.maxPartBytes;
    preset.rechunk = opts.maxPartBytes > 0;
  }
  if (opts.maxPartMs !== undefined) preset.maxPartMs = opts.maxPartMs;

  return { size, ...preset };
}
