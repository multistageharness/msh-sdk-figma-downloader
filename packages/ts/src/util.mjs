// util.mjs — small dependency-free helpers shared across the downloader.

import { createHash } from "node:crypto";

/** Sleep for `ms` milliseconds. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The two Unicode line terminators JSON.stringify emits *literally*: Line
// Separator (U+2028) and Paragraph Separator (U+2029). Built from char codes so
// this source file itself never contains a raw separator.
const LS = new RegExp(String.fromCharCode(0x2028), "g");
const PS = new RegExp(String.fromCharCode(0x2029), "g");

/**
 * JSON.stringify, but escape U+2028 / U+2029. Figma text nodes frequently
 * contain them; left raw they become real line breaks in the output file
 * (editors flag "unusual line terminators" and the file stops being valid
 * JavaScript). Escaping them yields semantically identical — and strictly
 * safer — JSON that still parses to the same value.
 */
export function stringify(obj, pretty = false) {
  const json = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  return escapeLineSeparators(json);
}

/** Escape U+2028 / U+2029 in an already-serialized JSON string. */
export function escapeLineSeparators(json) {
  return json.replace(LS, "\\u2028").replace(PS, "\\u2029");
}

/**
 * Run async tasks with bounded concurrency, preserving input order in the
 * result array. `tasks` is an array of thunks `() => Promise<T>`. An optional
 * `limiter` (token bucket) gates each task's *start* so a shared rate ceiling
 * holds across the whole pool, not just a parallelism cap.
 *
 * @param {Array<() => Promise<any>>} tasks
 * @param {number} concurrency
 * @param {{ limiter?: { acquire: () => Promise<void> } }} [opts]
 */
export async function pool(tasks, concurrency, opts = {}) {
  const limit = Math.max(1, concurrency | 0);
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      if (opts.limiter) await opts.limiter.acquire();
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  return results;
}

/**
 * A simple token-bucket rate limiter. `rate` tokens are added per second up to
 * `burst` capacity; `acquire()` resolves when a token is available. Used to hold
 * a global request ceiling (and to step down under sustained 429s) — a closer
 * fit to Figma's "60 req/min" than a fixed sleep. Pass `rate <= 0` to disable.
 */
export function tokenBucket({
  rate = 0,
  burst = 1,
  now = () => Date.now(),
} = {}) {
  let tokens = burst;
  let last = now();
  let cap = burst;
  const refill = () => {
    if (rate <= 0) return;
    const t = now();
    tokens = Math.min(cap, tokens + ((t - last) / 1000) * rate);
    last = t;
  };
  return {
    async acquire() {
      if (rate <= 0) return;
      refill();
      while (tokens < 1) {
        const waitMs = Math.max(10, Math.ceil(((1 - tokens) / rate) * 1000));
        await sleep(waitMs);
        refill();
      }
      tokens -= 1;
    },
    /** Step the effective ceiling down (sustained 429) or back up (recovery). */
    setCapacity(c) {
      cap = Math.max(1, c);
      tokens = Math.min(tokens, cap);
    },
    get capacity() {
      return cap;
    },
  };
}

/** Split `arr` into consecutive sub-arrays of at most `size` items. */
export function batch(arr, size) {
  const n = Math.max(1, size | 0);
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Zero-pad an integer to `width` (for stable, sortable indices). */
export function pad(num, width = 4) {
  return String(num).padStart(width, "0");
}

/**
 * Deterministic content hash of an id-batch: sort the ids, join, sha256, take a
 * short hex prefix. Two runs over the same logical batch produce the same part
 * filename, so an unchanged batch is reused on resume (TR-12, idempotency).
 */
export function sha256OfBatch(ids, len = 12) {
  const canon = [...ids].sort().join(",");
  return createHash("sha256").update(canon).digest("hex").slice(0, len);
}

/** Count every node in a Figma (sub)tree rooted at `node`. */
export function countNodes(node) {
  if (!node || typeof node !== "object") return 0;
  let n = 1;
  for (const child of node.children || []) n += countNodes(child);
  return n;
}

/** Byte length of `s` as UTF-8. */
export function byteLength(s) {
  return Buffer.byteLength(s, "utf8");
}
