// cli.mjs — orchestrate the chunked download + local reconstruction.
//
//   resolve key → fetch skeleton → write skeleton.json
//                → collect frontier ids → stream node batches to parts/
//                → graft parts onto skeleton → write full.json
//
// Kept thin: planning (chunk.mjs), I/O client (figmaClient.mjs), and grafting
// (reconstruct.mjs) hold the logic so each stays unit-testable.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchSkeleton, parseFileKey, _http } from "./figmaClient.mjs";
import { collectFrontierIds, downloadChunks } from "./chunk.mjs";
import { reconstruct, indexParts, loadParts } from "./reconstruct.mjs";
import { countNodes, stringify } from "./util.mjs";
import { makeMockFetch } from "./mock.mjs";
import { makeNodeFetch, redactProxy } from "./httpFetch.mjs";

const HELP = `figma-download — fetch a large Figma file in chunks and rebuild it locally

USAGE
  figma-download (--url <figma-url> | --file-key <key> | --mock) [options]

INPUT (choose one)
  --url <figma-url>     Figma file URL (the key is parsed out of it).
  --file-key <key>      Figma file key. Needs FIGMA_TOKEN in the environment.
  --mock                Use a built-in offline fixture (no network, no token).

WHAT IT DOES
  1. Fetches a shallow "skeleton" (GET /v1/files/:key?depth=N) — the tree
     truncated at the chunk frontier.
  2. Re-fetches every frontier node's full subtree via GET /v1/files/:key/nodes,
     a batch of ids per request, streaming each response to out/<key>/parts/.
  3. Grafts the subtrees back onto the skeleton -> a single out/<key>/full.json
     shaped exactly like a plain GET /v1/files/:key.

OPTIONS
  --out <path>          Final full-file JSON path. Default out/<key>/full.json.
  --work-dir <dir>      Scratch dir for skeleton + parts. Default out/<key>.
  --depth <n>           Frontier depth to split at (1=pages, 2=top frames).
                        Default 2. Bigger files -> deeper split = smaller chunks.
  --batch-size <n>      Node ids per /nodes request. Default 10.
  --concurrency <n>     Parallel /nodes requests. Default 4.
  --retries <n>         Retries per request on 429/5xx/network. Default 3.
  --timeout-ms <n>      Per-request timeout. Default 60000.
  --proxy <url>         Route requests through an HTTP/HTTPS proxy, e.g.
                        http://*****:*****@host:8080. Default: none (falls back to
                        HTTPS_PROXY / HTTP_PROXY / ALL_PROXY env vars if set).
  --no-ssl-verify       Disable TLS certificate verification (insecure; for
                        proxies that re-sign TLS or self-signed endpoints).
                        Alias: --insecure. Default: verification ON.
  --geometry            Include vector geometry (geometry=paths) — much larger.
  --resume              Skip part files already on disk (continue an interrupt).
  --skeleton-only       Fetch + write the skeleton, then stop.
  --reconstruct-only    Skip the network; rebuild full.json from an existing
                        work dir (skeleton.json + parts/).
  --keep-parts          Keep the parts/ dir after a successful reconstruct.
  --pretty              Pretty-print full.json (default: compact).
  --stdout              Write full.json to stdout instead of a file.
  --quiet               Suppress progress logs (errors still go to stderr).
  -h, --help            Show this help.

EXAMPLES
  figma-download --mock --pretty
  FIGMA_TOKEN=figd_xxx figma-download --url https://www.figma.com/design/TFTCS.../About
  figma-download --file-key TFTCSGbqpyxex6QRYqqbzb --depth 3 --batch-size 5 --resume
  figma-download --file-key TFTCS... --proxy http://ProxyDomain:8080
  figma-download --file-key TFTCS... --proxy http://proxy:8080 --no-ssl-verify
  figma-download --reconstruct-only --work-dir out/TFTCSGbqpyxex6QRYqqbzb
`;

/** Minimal flag parser: --flag value / --flag=value / boolean flags. */
export function parseArgs(argv) {
  const out = { _: [] };
  const booleans = new Set([
    "mock",
    "geometry",
    "resume",
    "skeleton-only",
    "reconstruct-only",
    "keep-parts",
    "pretty",
    "stdout",
    "quiet",
    "help",
    "h",
    "no-ssl-verify",
    "insecure",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--") && arg !== "-h") {
      out._.push(arg);
      continue;
    }
    let key = arg.replace(/^--?/, "");
    let value;
    const eq = key.indexOf("=");
    if (eq !== -1) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    if (booleans.has(key)) {
      out[key] = true;
      continue;
    }
    if (value === undefined) {
      value = argv[i + 1];
      i++;
    }
    out[key] = value;
  }
  return out;
}

// Progress logs go to stderr so stdout stays clean JSON (--stdout / pipes).
function mkLog(quiet) {
  return (...args) => {
    if (!quiet) process.stderr.write(`[figma-download] ${args.join(" ")}\n`);
  };
}

function intOpt(args, name, def) {
  const v = args[name];
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n))
    throw new Error(`--${name} must be a number (got ${v})`);
  return n;
}

export async function run(argv, { env = process.env } = {}) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    console.log(HELP);
    return 0;
  }
  const quiet = !!args.quiet;
  const log = mkLog(quiet);

  const depth = intOpt(args, "depth", 2);

  // --- Resolve the file key (not needed for --reconstruct-only). ---
  let fileKey = args["file-key"] || "";
  if (!fileKey && args.url) fileKey = parseFileKey(args.url);
  if (!fileKey && args.mock) fileKey = "MOCKFILEKEY0000000000";

  const workDir = args["work-dir"]
    ? path.resolve(args["work-dir"])
    : fileKey
      ? path.resolve("out", fileKey)
      : null;

  const writeFull = async (file, stats) => {
    const json = stringify(file, !!args.pretty);
    if (args.stdout) {
      process.stdout.write(json + "\n");
    } else {
      const outPath = args.out
        ? path.resolve(args.out)
        : path.join(workDir, "full.json");
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, json, "utf8");
      log(
        `wrote ${outPath} — ${countNodes(file.document)} node(s), ${stats.grafted} subtree(s) grafted`,
      );
    }
    if (stats.missing.length) {
      process.stderr.write(
        `[figma-download] warning: ${stats.missing.length} frontier node(s) not returned: ${stats.missing.slice(0, 5).join(", ")}${stats.missing.length > 5 ? "…" : ""}\n`,
      );
    }
  };

  // --- Mode: reconstruct only (no network). ---
  if (args["reconstruct-only"]) {
    if (!workDir) {
      process.stderr.write(
        "error: --reconstruct-only needs --work-dir (or --file-key/--url to derive it).\n",
      );
      return 2;
    }
    log(`reconstruct-only from ${workDir}`);
    const skeleton = JSON.parse(
      await fs.readFile(path.join(workDir, "skeleton.json"), "utf8"),
    );
    const parts = await loadParts(path.join(workDir, "parts"));
    const { file, stats } = reconstruct(skeleton, depth, indexParts(parts));
    await writeFull(file, stats);
    return 0;
  }

  // --- Acquire mode: live network or mock. ---
  if (!args.mock && !args["file-key"] && !args.url) {
    process.stderr.write(
      "error: no input. Pass --url, --file-key, --mock, or --reconstruct-only. See --help.\n",
    );
    return 2;
  }
  if (!fileKey) {
    process.stderr.write(
      "error: could not determine the Figma file key. Pass --file-key explicitly.\n",
    );
    return 2;
  }

  const token = args.mock
    ? *********
    : env.FIGMA_TOKEN || env.FIGMA_API_TOKEN || env.FIGMA_ACCESS_TOKEN || "";

  // Proxy: explicit flag wins, else the conventional proxy env vars; none by default.
  const proxy =
    args.proxy ||
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.HTTP_PROXY ||
    env.http_proxy ||
    env.ALL_PROXY ||
    env.all_proxy ||
    "";
  // TLS certificate verification on by default; --no-ssl-verify / --insecure turns it off.
  const sslVerify = !(args["no-ssl-verify"] || args.insecure);

  // Pick the transport. The default (no proxy, TLS verified) path keeps using
  // the global fetch; a proxy or disabled TLS verification swaps in the
  // zero-dep node transport. --mock always wins (fully offline).
  let restore = null;
  const original = _http.fetch;
  if (args.mock) {
    _http.fetch = makeMockFetch();
    restore = () => {
      _http.fetch = original;
    };
  } else if (proxy || !sslVerify) {
    _http.fetch = makeNodeFetch({ proxy: proxy || null, sslVerify });
    restore = () => {
      _http.fetch = original;
    };
    if (proxy) log(`using proxy ${redactProxy(proxy)}`);
    if (!sslVerify)
      process.stderr.write(
        "[figma-download] WARNING: TLS certificate verification is DISABLED (--no-ssl-verify).\n",
      );
  }

  try {
    const reqOpts = {
      depth,
      retries: intOpt(args, "retries", 3),
      timeoutMs: intOpt(args, "timeout-ms", 60_000),
      geometry: !!args.geometry,
      onRetry: ({ status, attempt, waitMs }) =>
        log(`  skeleton retry #${attempt} (status ${status}) in ${waitMs}ms`),
    };

    // 1. Skeleton.
    log(`fetching skeleton: ${fileKey} (depth=${depth})`);
    const skeleton = await fetchSkeleton(fileKey, token, reqOpts);
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(
      path.join(workDir, "skeleton.json"),
      stringify(skeleton, true),
      "utf8",
    );
    log(`skeleton: "${skeleton.name}" v${skeleton.version}`);

    const frontierIds = collectFrontierIds(skeleton, depth);
    log(`frontier: ${frontierIds.length} node(s) at depth ${depth}`);

    if (args["skeleton-only"]) {
      log("skeleton-only — stopping before chunk download.");
      return 0;
    }
    if (!frontierIds.length) {
      process.stderr.write(
        `[figma-download] warning: no frontier nodes at depth ${depth}. Try a smaller --depth.\n`,
      );
    }

    // 2. Stream chunk download.
    const batchSize = intOpt(args, "batch-size", 10);
    const concurrency = intOpt(args, "concurrency", 4);
    log(
      `downloading ${Math.ceil(frontierIds.length / batchSize)} batch(es), ${batchSize} id(s) each, concurrency ${concurrency}`,
    );
    const { manifest } = await downloadChunks({
      fileKey,
      token,
      frontierIds,
      workDir,
      batchSize,
      concurrency,
      resume: !!args.resume,
      retries: reqOpts.retries,
      timeoutMs: reqOpts.timeoutMs,
      geometry: reqOpts.geometry,
      log,
    });
    manifest.frontierDepth = depth;
    await fs.writeFile(
      path.join(workDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    // 3. Reconstruct.
    log("reconstructing full file from parts…");
    const parts = await loadParts(path.join(workDir, "parts"));
    const { file, stats } = reconstruct(skeleton, depth, indexParts(parts));
    await writeFull(file, stats);

    if (!args["keep-parts"] && !args.stdout) {
      await fs.rm(path.join(workDir, "parts"), {
        recursive: true,
        force: true,
      });
      log("removed parts/ (pass --keep-parts to retain)");
    }
    return 0;
  } finally {
    restore?.();
  }
}
