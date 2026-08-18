// figmaClient.mjs — Figma REST API access for the chunked downloader.
//
// A whole `GET /v1/files/:key` response is a single, monolithic JSON document.
// For large files that payload is huge and the request can time out. This client
// instead exposes the endpoints needed to fetch a file *in chunks*:
//
//   1. fetchSkeleton  — GET /v1/files/:key?depth=N    (shallow tree: the frame
//                       at which to split, with no deep children)
//   2. fetchNodes     — GET /v1/files/:key/nodes?ids=  (full subtree for a
//                       batch of node ids)
//   3. fetchWholeFile — GET /v1/files/:key             (the `sm` fast path)
//
// All go through `figmaGet`, which adds an abort-timeout and bounded retry with
// backoff that honours Figma's `Retry-After` on 429 / 5xx, and raises a *typed*
// error (errors.mjs) on a non-retryable failure so the caller can fail fast on
// 401/403/404 and the CLI can map each class to a distinct exit code.
//
// Network access is routed through the mutable `_http.fetch` holder so tests can
// swap it without a real network call (the repo's standard test-injection idiom).

import { sleep } from './util.mjs';
import {
  errorForStatus,
  FigmaTimeoutError,
  FigmaNetworkError,
  FigmaError,
} from './errors.mjs';

export const FIGMA_API_BASE = 'https://api.figma.com/v1';

/** Injectable network holder — reassign `_http.fetch` in tests. */
export const _http = { fetch: (...args) => fetch(...args) };

/**
 * Parse a Figma file key from a URL or a path/string. Accepts:
 *   https://www.figma.com/design/TFTCSGbqpyxex6QRYqqbzb/Name
 *   https://www.figma.com/file/TFTCSGbqpyxex6QRYqqbzb/Name
 *   out/TFTCSGbqpyxex6QRYqqbzb/full.json   (path segment)
 *   TFTCSGbqpyxex6QRYqqbzb                 (bare key)
 * Returns '' when no plausible key is found.
 */
export function parseFileKey(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  const url = s.match(/figma\.com\/(?:file|design)\/([0-9A-Za-z]{10,})/i);
  if (url) return url[1];
  const segs = s.split(/[\\/]/).filter(Boolean);
  const keyish = segs.filter((seg) => /^[0-9A-Za-z]{20,}$/.test(seg));
  if (keyish.length) return keyish.sort((a, b) => b.length - a.length)[0];
  if (/^[0-9A-Za-z]{20,}$/.test(s)) return s;
  return '';
}

/**
 * Core authenticated GET. Adds an abort-timeout and retries `retries` times on
 * transient failures (429 / 5xx / network error) with exponential backoff,
 * honouring a numeric `Retry-After` header when present. On a non-retryable
 * failure (or once retries are exhausted) it throws a typed FigmaError.
 *
 * @param {string} pathAndQuery  e.g. `/files/KEY?depth=2`
 * @param {string} token         Figma personal access token
 * @param {{ timeoutMs?: number, retries?: number, onRetry?: (info:object)=>void }} [opts]
 */
export async function figmaGet(pathAndQuery, token, opts = {}) {
  if (!token) throw new FigmaError('FIGMA_TOKEN is required (or use --mock).', { exitCode: 3 });
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const retries = opts.retries ?? 3;
  const url = `${FIGMA_API_BASE}${pathAndQuery}`;

  let attempt = 0;
  // total tries = retries + 1
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await _http.fetch(url, {
        headers: { 'X-Figma-Token': token },
        signal: controller.signal,
      });
      if (res.ok) return await res.json();

      const body = await res.text().catch(() => '');
      const err = errorForStatus(res.status, pathAndQuery, body);
      const canRetry = err.retryable && attempt < retries;
      if (!canRetry) throw err;

      const retryAfter = Number(headerGet(res, 'retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
      opts.onRetry?.({ status: res.status, attempt: attempt + 1, waitMs, pathAndQuery });
      await sleep(waitMs);
      attempt += 1;
    } catch (err) {
      // Re-throw typed non-retryable errors untouched.
      if (err instanceof FigmaError && !err.retryable) throw err;

      const aborted = err && err.name === 'AbortError';
      const isNetwork = err?.code === 'ECONNRESET' || err?.code === 'UND_ERR_SOCKET';
      const transient = aborted || isNetwork || (err instanceof FigmaError && err.retryable);
      if (!transient || attempt >= retries) {
        if (aborted) throw new FigmaTimeoutError(`Figma API timed out after ${timeoutMs / 1000}s for ${pathAndQuery}`);
        if (err instanceof FigmaError) throw err;
        throw new FigmaNetworkError(`Figma API network error for ${pathAndQuery}: ${String(err).slice(0, 120)}`);
      }
      const waitMs = backoff(attempt);
      opts.onRetry?.({ status: 'network', attempt: attempt + 1, waitMs, pathAndQuery, error: String(err).slice(0, 120) });
      await sleep(waitMs);
      attempt += 1;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Read a header from either a Headers object or a Map (mock returns a Map). */
function headerGet(res, name) {
  const h = res.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name);
  return null;
}

function backoff(attempt) {
  // 0.5s, 1s, 2s, 4s ... capped at 15s. Deterministic (no jitter) for testability.
  return Math.min(500 * 2 ** attempt, 15_000);
}

/**
 * Fetch the shallow file "skeleton": the document tree truncated at `depth`.
 * depth=1 → pages only; depth=2 → pages + their top-level frames (no children).
 * The truncation frontier (nodes at `depth`) is what we then fetch in full.
 * @returns the parsed `/v1/files/:key?depth=N` response.
 */
export async function fetchSkeleton(fileKey, token, opts = {}) {
  if (!fileKey) throw new Error('fetchSkeleton: fileKey is required.');
  const depth = opts.depth ?? 2;
  const geometry = opts.geometry ? `&geometry=paths` : '';
  const version = opts.version ? `&version=${encodeURIComponent(opts.version)}` : '';
  return figmaGet(`/files/${encodeURIComponent(fileKey)}?depth=${depth}${geometry}${version}`, token, opts);
}

/**
 * Fetch the entire file in one request (the `sm` fast path; no chunking).
 * @returns the parsed `/v1/files/:key` response.
 */
export async function fetchWholeFile(fileKey, token, opts = {}) {
  if (!fileKey) throw new Error('fetchWholeFile: fileKey is required.');
  const params = [];
  if (opts.geometry) params.push('geometry=paths');
  if (opts.version) params.push(`version=${encodeURIComponent(opts.version)}`);
  const query = params.length ? `?${params.join('&')}` : '';
  return figmaGet(`/files/${encodeURIComponent(fileKey)}${query}`, token, opts);
}

/**
 * Fetch the full subtree for a batch of node ids.
 * @param {string} fileKey
 * @param {string[]} ids   Figma node ids (e.g. ["1:100","1:268"]).
 * @returns the parsed `/v1/files/:key/nodes?ids=...` response
 *          ({ name, lastModified, version, nodes: { [id]: { document, components, styles, ... } } }).
 */
export async function fetchNodes(fileKey, ids, token, opts = {}) {
  if (!fileKey) throw new Error('fetchNodes: fileKey is required.');
  if (!ids || !ids.length) return { nodes: {} };
  const idsParam = ids.map(encodeURIComponent).join(',');
  const geometry = opts.geometry ? `&geometry=paths` : '';
  const depthQ = opts.nodeDepth ? `&depth=${opts.nodeDepth}` : '';
  const version = opts.version ? `&version=${encodeURIComponent(opts.version)}` : '';
  return figmaGet(`/files/${encodeURIComponent(fileKey)}/nodes?ids=${idsParam}${depthQ}${geometry}${version}`, token, opts);
}
