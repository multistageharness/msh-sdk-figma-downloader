// util.mjs — small dependency-free helpers shared across the downloader.

/** Sleep for `ms` milliseconds. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * JSON.stringify, but escape the two Unicode line terminators that
 * JSON.stringify otherwise emits *literally*: Line Separator (U+2028) and
 * Paragraph Separator (U+2029). Figma text nodes frequently contain them; left
 * raw they become real line breaks in the output file (editors flag "unusual
 * line terminators" and the file is no longer valid JavaScript). Escaping them
 * yields semantically identical — and strictly safer — JSON.
 */
export function stringify(obj, pretty = false) {
  const json = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  return json.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Run async tasks with bounded concurrency, preserving input order in the
 * result array. `tasks` is an array of thunks `() => Promise<T>`.
 */
export async function pool(tasks, concurrency) {
  const limit = Math.max(1, concurrency | 0);
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** Split `arr` into consecutive sub-arrays of at most `size` items. */
export function batch(arr, size) {
  const n = Math.max(1, size | 0);
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Zero-pad an integer to `width` (for stable, sortable part filenames). */
export function pad(num, width = 4) {
  return String(num).padStart(width, '0');
}

/** Count every node in a Figma (sub)tree rooted at `node`. */
export function countNodes(node) {
  if (!node || typeof node !== 'object') return 0;
  let n = 1;
  for (const child of node.children || []) n += countNodes(child);
  return n;
}
