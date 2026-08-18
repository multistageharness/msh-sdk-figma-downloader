// cli.mjs — orchestrate the chunked download + local reconstruction.
//
//   resolve key → resolve net config (proxy/TLS) → classify SIZE
//     → fetch skeleton → collect frontier ids
//     → stream node batches to parts/ (re-chunking over-budget subtrees)
//     → graft parts onto skeleton → write full.json
//
// Small files take the whole-file fast path (one GET, no chunking). Planning
// (chunk.mjs), sizing (sizing.mjs), config (config.mjs), the client
// (figmaClient.mjs), and grafting (reconstruct.mjs) hold the logic so each stays
// unit-testable.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fetchSkeleton, fetchWholeFile, parseFileKey, _http, FIGMA_API_BASE } from './figmaClient.mjs';
import { collectFrontierIds, downloadChunks } from './chunk.mjs';
import { reconstruct, indexParts, loadParts } from './reconstruct.mjs';
import { countNodes, stringify, byteLength, tokenBucket } from './util.mjs';
import { classify, resolveStrategy, TIERS } from './sizing.mjs';
import { resolveNetworkConfig } from './config.mjs';
import { makeMockFetch } from './mock.mjs';
import { makeNodeFetch, redactProxy } from './httpFetch.mjs';
import { FigmaError, exitCodeFor } from './errors.mjs';

const HELP = `figma-download — fetch a Figma file of any size in chunks and rebuild it locally

USAGE
  figma-download (--url <figma-url> | --file-key <key> | --mock) [options]

INPUT (choose one)
  --url <figma-url>     Figma file URL (the key is parsed out of it).
  --file-key <key>      Figma file key. Needs FIGMA_TOKEN in the environment.
  --mock                Use a built-in offline fixture (no network, no token).
  --version <id>        Download a specific historical version (the version id
                        from GET /v1/files/:key/versions); omit for the current file.

SIZE (any size: sm / md / large / xl / xxxxl)
  --size <tier>         auto (default) | sm | md | large | xl | xxxxl.
                        auto probes the skeleton and picks a strategy. A tier
                        preset sets depth/batch-size/concurrency unless you also
                        pass those flags explicitly (explicit > tier > auto).
  --max-part-bytes <n>  Re-chunk any part larger than this (0 = off). Tier-derived.
  --max-part-ms <n>     Re-chunk any batch whose fetch took longer than this.
  --max-rechunk-depth   How deep re-chunking may recurse. Default 4.

OPTIONS
  --out <path>          Final full-file JSON path. Default out/<key>/full.json.
  --work-dir <dir>      Scratch dir for skeleton + parts. Default out/<key>.
  --depth <n>           Frontier depth to split at (1=pages, 2=top frames).
  --batch-size <n>      Node ids per /nodes request.
  --concurrency <n>     Parallel /nodes requests.
  --rate <n>            Global request ceiling (requests/sec, 0 = unlimited).
  --retries <n>         Retries per request on 429/5xx/network. Default 3.
  --timeout-ms <n>      Per-request timeout. Default 60000.
                        Env: FIGMA_HTTP_TIMEOUT_MS (flag overrides env).

NETWORK (proxy + TLS — override via flag, config file, or environment)
  --proxy <url>         Route requests through an HTTP/HTTPS proxy.
  --no-proxy            Force a direct connection (ignore config/env proxy).
  --no-ssl-verify       Disable TLS certificate verification (alias --insecure).
  --ssl-verify          Force TLS verification ON (override config/env).
  --config <path>       Config file (default ./figma-download.config.json):
                        { "proxy": "http://host:8080", "sslVerify": false }
                        Precedence: flag > config file > env > default
                        (proxy=null, sslVerify=true). Env: FIGMA_PROXY_URL /
                        FIGMA_PROXY / HTTPS_PROXY / HTTP_PROXY / ALL_PROXY ;
                        FIGMA_SSL_VERIFY / NODE_TLS_REJECT_UNAUTHORIZED.

MODES
  --geometry            Include vector geometry (geometry=paths) — much larger.
  --resume              Skip groups already downloaded (manifest-aware).
  --skeleton-only       Fetch + write the skeleton, then stop.
  --reconstruct-only    Rebuild full.json from an existing work dir (no network).
  --keep-parts          Keep the parts/ dir after a successful reconstruct.
  --pretty              Pretty-print full.json (default: compact).
  --stdout              Write full.json to stdout instead of a file.
  --quiet               Suppress progress logs (errors still go to stderr).
  -h, --help            Show this help.

EXIT CODES
  0 ok · 2 usage · 3 auth(401/403) · 4 not-found(404) · 5 rate-limited(429)
  6 server/network · 7 timeout

EXAMPLES
  figma-download --mock --pretty
  FIGMA_TOKEN=figd_xxx figma-download --url https://www.figma.com/design/TFTCS.../About
  figma-download --file-key TFTCS... --size xxxxl --resume
  figma-download --file-key TFTCS... --proxy http://proxy:8080 --no-ssl-verify
  figma-download --reconstruct-only --work-dir out/TFTCSGbqpyxex6QRYqqbzb
`;

/** Minimal flag parser: --flag value / --flag=value / boolean flags. */
export function parseArgs(argv) {
  const out = { _: [] };
  const booleans = new Set([
    'mock', 'geometry', 'resume', 'skeleton-only', 'reconstruct-only',
    'keep-parts', 'pretty', 'stdout', 'quiet', 'help', 'h',
    'no-ssl-verify', 'ssl-verify', 'insecure', 'no-proxy',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') && arg !== '-h') {
      out._.push(arg);
      continue;
    }
    let key = arg.replace(/^--?/, '');
    let value;
    const eq = key.indexOf('=');
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

function mkLog(quiet) {
  return (...args) => {
    if (!quiet) process.stderr.write(`[figma-download] ${args.join(' ')}\n`);
  };
}

function intOpt(args, name, def) {
  const v = args[name];
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number (got ${v})`);
  return n;
}

/** Inner run: throws typed errors. `run` wraps it and maps them to exit codes. */
async function runInner(argv, { env }) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    console.log(HELP);
    return 0;
  }
  const quiet = !!args.quiet;
  const log = mkLog(quiet);

  // --- Resolve the file key (not needed for --reconstruct-only). ---
  let fileKey = args['file-key'] || '';
  if (!fileKey && args.url) fileKey = parseFileKey(args.url);
  if (!fileKey && args.mock) fileKey = 'MOCKFILEKEY0000000000';

  const workDir = args['work-dir']
    ? path.resolve(args['work-dir'])
    : fileKey
      ? path.resolve('out', fileKey)
      : null;

  const sizeArg = (args.size || 'auto').toLowerCase();
  if (sizeArg !== 'auto' && !TIERS.includes(sizeArg)) {
    process.stderr.write(`error: --size must be one of auto|${TIERS.join('|')}\n`);
    return 2;
  }
  const explicit = {
    depth: args.depth !== undefined,
    batchSize: args['batch-size'] !== undefined,
    concurrency: args.concurrency !== undefined,
  };

  const writeFull = async (file, stats, sizeLabel) => {
    const json = stringify(file, !!args.pretty);
    if (args.stdout) {
      process.stdout.write(json + '\n');
    } else {
      const outPath = args.out ? path.resolve(args.out) : path.join(workDir, 'full.json');
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, json, 'utf8');
      log(`wrote ${outPath} — ${countNodes(file.document)} node(s)${stats ? `, ${stats.grafted} subtree(s) grafted` : ''} [${sizeLabel}]`);
    }
    if (stats && stats.missing.length) {
      process.stderr.write(`[figma-download] warning: ${stats.missing.length} frontier node(s) not returned: ${stats.missing.slice(0, 5).join(', ')}${stats.missing.length > 5 ? '…' : ''}\n`);
    }
  };

  // --- Mode: reconstruct only (no network). ---
  if (args['reconstruct-only']) {
    if (!workDir) {
      process.stderr.write('error: --reconstruct-only needs --work-dir (or --file-key/--url to derive it).\n');
      return 2;
    }
    log(`reconstruct-only from ${workDir}`);
    const skeleton = JSON.parse(await fs.readFile(path.join(workDir, 'skeleton.json'), 'utf8'));
    let frontierIds = [];
    try {
      const m = JSON.parse(await fs.readFile(path.join(workDir, 'manifest.json'), 'utf8'));
      frontierIds = m.frontierIds || [];
    } catch { /* none */ }
    const parts = await loadParts(path.join(workDir, 'parts'));
    const { file, stats } = reconstruct(skeleton, indexParts(parts), { frontierIds });
    await writeFull(file, stats, 'reconstruct-only');
    return 0;
  }

  // --- Acquire mode: live network or mock. ---
  if (!args.mock && !args['file-key'] && !args.url) {
    process.stderr.write('error: no input. Pass --url, --file-key, --mock, or --reconstruct-only. See --help.\n');
    return 2;
  }
  if (!fileKey) {
    process.stderr.write('error: could not determine the Figma file key. Pass --file-key explicitly.\n');
    return 2;
  }

  const token = args.mock ? 'mock-token' : (env.FIGMA_TOKEN || env.FIGMA_API_TOKEN || env.FIGMA_ACCESS_TOKEN || '');

  // --- Network config: flag > config file > env > default. ---
  const net = resolveNetworkConfig(args, env);

  // Pick the transport. Default (no proxy, TLS verified) keeps global fetch.
  // --mock always wins (fully offline).
  let restore = null;
  const original = _http.fetch;
  let transport = 'direct (global fetch)';
  if (args.mock) {
    _http.fetch = makeMockFetch();
    restore = () => { _http.fetch = original; };
    transport = 'mock (offline fixture, no network)';
  } else if (net.proxy || !net.sslVerify) {
    _http.fetch = makeNodeFetch({ proxy: net.proxy || null, sslVerify: net.sslVerify });
    restore = () => { _http.fetch = original; };
    transport = net.proxy ? `proxy ${redactProxy(net.proxy)}` : 'direct (node transport)';
  }

  const retries = intOpt(args, 'retries', 3);
  // timeout: --timeout-ms flag > FIGMA_HTTP_TIMEOUT_MS env > 60000 default.
  let timeoutMs = 60_000;
  let timeoutSource = 'default';
  if (env.FIGMA_HTTP_TIMEOUT_MS !== undefined && String(env.FIGMA_HTTP_TIMEOUT_MS).trim() !== '') {
    const n = Number(env.FIGMA_HTTP_TIMEOUT_MS);
    if (!Number.isFinite(n)) throw new Error(`FIGMA_HTTP_TIMEOUT_MS must be a number (got ${env.FIGMA_HTTP_TIMEOUT_MS})`);
    timeoutMs = n;
    timeoutSource = 'env';
  }
  if (args['timeout-ms'] !== undefined) {
    timeoutMs = intOpt(args, 'timeout-ms', timeoutMs);
    timeoutSource = 'flag';
  }

  // Print the HTTP config in effect before the first request. The token VALUE is
  // never printed — only whether one is present — so the line is safe to log/share.
  log(
    `http config — endpoint=${FIGMA_API_BASE} | transport=${transport}` +
    ` | proxy=${net.proxy ? redactProxy(net.proxy) : 'none'} (from ${net.sources.proxy})` +
    ` | tls-verify=${net.sslVerify} (from ${net.sources.sslVerify})` +
    ` | timeout=${timeoutMs}ms (from ${timeoutSource}) | retries=${retries}` +
    ` | token=${args.mock ? 'n/a (mock)' : token ? 'present' : 'MISSING'}`
  );
  // Surface connection-relevant misconfig up front (always — even under --quiet).
  if (!args.mock && !net.sslVerify) {
    process.stderr.write(`[figma-download] WARNING: TLS certificate verification is DISABLED (from ${net.sources.sslVerify}).\n`);
  }
  if (!args.mock && !token) {
    process.stderr.write(`[figma-download] WARNING: no Figma token found (FIGMA_TOKEN / FIGMA_API_TOKEN / FIGMA_ACCESS_TOKEN); live requests will fail with 403.\n`);
  }

  try {
    const reqOpts = {
      retries,
      timeoutMs,
      geometry: !!args.geometry,
      // Pin every /files request to a specific historical version when asked
      // (`GET /v1/files/:key?version=<id>`); omitted ⇒ the current file.
      version: args.version || undefined,
      // Log every retry; for a connection failure surface the underlying error
      // (DNS / refused / proxy CONNECT / TLS / timeout) instead of a bare label.
      onRetry: ({ status, attempt, waitMs, error }) =>
        log(`  retry #${attempt} (${status === 'network' ? `connection issue: ${error}` : `status ${status}`}) in ${waitMs}ms`),
    };

    // --- Classify size: probe a skeleton, then resolve the strategy. ---
    const probeDepth = explicit.depth ? intOpt(args, 'depth', 2) : (sizeArg !== 'auto' ? undefined : 2);
    // For an explicit tier we know its preset depth without probing.
    let strategy;
    let skeleton;
    let depth;

    if (sizeArg === 'auto') {
      log(`probing skeleton to classify size…`);
      skeleton = await fetchSkeleton(fileKey, token, { ...reqOpts, depth: probeDepth ?? 2 });
      const probedDepth = probeDepth ?? 2;
      const frontier = collectFrontierIds(skeleton, probedDepth);
      const skeletonBytes = byteLength(stringify(skeleton));
      const nodeCount = countNodes(skeleton.document);
      const hasFrontier = frontier.length > 0;
      const tier = classify({ nodeCount, frontierWidth: frontier.length, skeletonBytes, hasFrontier });
      strategy = resolveStrategy({
        size: tier,
        depth: intOpt(args, 'depth', undefined),
        batchSize: intOpt(args, 'batch-size', undefined),
        concurrency: intOpt(args, 'concurrency', undefined),
        maxPartBytes: args['max-part-bytes'] !== undefined ? intOpt(args, 'max-part-bytes', 0) : undefined,
        maxPartMs: args['max-part-ms'] !== undefined ? intOpt(args, 'max-part-ms', 0) : undefined,
        explicit,
      });
      log(`classified ${tier} (nodes≈${nodeCount}, frontier=${frontier.length}, skeleton=${skeletonBytes}B)`);
      depth = strategy.depth;
      // Re-fetch the skeleton if the resolved depth differs from the probe.
      if (depth !== probedDepth && strategy.mode !== 'whole') {
        skeleton = await fetchSkeleton(fileKey, token, { ...reqOpts, depth });
      }
    } else {
      strategy = resolveStrategy({
        size: sizeArg,
        depth: intOpt(args, 'depth', undefined),
        batchSize: intOpt(args, 'batch-size', undefined),
        concurrency: intOpt(args, 'concurrency', undefined),
        maxPartBytes: args['max-part-bytes'] !== undefined ? intOpt(args, 'max-part-bytes', 0) : undefined,
        maxPartMs: args['max-part-ms'] !== undefined ? intOpt(args, 'max-part-ms', 0) : undefined,
        explicit,
      });
      depth = strategy.depth;
    }

    // --- Whole-file fast path (sm). ---
    if (strategy.mode === 'whole') {
      log(`size ${strategy.size}: whole-file fast path`);
      const file = await fetchWholeFile(fileKey, token, reqOpts);
      await fs.mkdir(workDir, { recursive: true });
      const manifest = {
        fileKey, size: strategy.size, frontierDepth: 0, batchSize: 1, concurrency: 1,
        idCount: 0, batchCount: 0, downloaded: 0, resumedSkipped: 0, rechunked: 0,
        oversizedLeaves: [], frontierIds: [], parts: [], groups: [], mode: 'whole',
      };
      await fs.writeFile(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      await writeFull(file, null, strategy.size);
      return 0;
    }

    // --- Frontier chunked path. ---
    if (!skeleton) {
      log(`fetching skeleton: ${fileKey} (depth=${depth})`);
      skeleton = await fetchSkeleton(fileKey, token, { ...reqOpts, depth });
    }
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(path.join(workDir, 'skeleton.json'), stringify(skeleton, true), 'utf8');
    log(`skeleton: "${skeleton.name}" v${skeleton.version} (size=${strategy.size}, depth=${depth})`);

    const frontierIds = collectFrontierIds(skeleton, depth);
    log(`frontier: ${frontierIds.length} node(s) at depth ${depth}`);

    if (args['skeleton-only']) {
      log('skeleton-only — stopping before chunk download.');
      return 0;
    }
    if (!frontierIds.length) {
      process.stderr.write(`[figma-download] warning: no frontier nodes at depth ${depth}. Try a smaller --depth.\n`);
    }

    const resume = args.resume !== undefined ? !!args.resume : strategy.resume;
    const rate = intOpt(args, 'rate', 0);
    const limiter = rate > 0 ? tokenBucket({ rate, burst: Math.max(1, strategy.concurrency) }) : null;

    log(`downloading ${Math.ceil(frontierIds.length / strategy.batchSize)} batch(es), ${strategy.batchSize} id(s) each, concurrency ${strategy.concurrency}${rate ? `, ${rate} req/s` : ''}`);
    await downloadChunks({
      fileKey,
      token,
      frontierIds,
      depth,
      workDir,
      size: strategy.size,
      batchSize: strategy.batchSize,
      concurrency: strategy.concurrency,
      resume,
      retries: reqOpts.retries,
      timeoutMs: reqOpts.timeoutMs,
      geometry: reqOpts.geometry,
      version: reqOpts.version,
      stream: strategy.stream,
      rechunk: strategy.rechunk,
      maxPartBytes: strategy.maxPartBytes,
      maxPartMs: strategy.maxPartMs,
      maxRechunkDepth: intOpt(args, 'max-rechunk-depth', 4),
      limiter,
      log,
    });

    log('reconstructing full file from parts…');
    const parts = await loadParts(path.join(workDir, 'parts'));
    const { file, stats } = reconstruct(skeleton, indexParts(parts), { frontierIds });
    await writeFull(file, stats, strategy.size);

    if (!args['keep-parts'] && !args.stdout) {
      await fs.rm(path.join(workDir, 'parts'), { recursive: true, force: true });
      log('removed parts/ (pass --keep-parts to retain)');
    }
    return 0;
  } finally {
    restore?.();
  }
}

/** Public entrypoint. Maps typed Figma errors to distinct exit codes. */
export async function run(argv, { env = process.env } = {}) {
  try {
    return await runInner(argv, { env });
  } catch (err) {
    const code = exitCodeFor(err);
    if (err instanceof FigmaError) {
      process.stderr.write(`[figma-download] ${err.name}: ${err.message}\n`);
      return code;
    }
    throw err;
  }
}
