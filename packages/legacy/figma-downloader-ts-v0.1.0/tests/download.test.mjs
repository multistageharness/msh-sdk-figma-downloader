// download.test.mjs — unit + end-to-end coverage, all offline (mock fetch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseFileKey,
  fetchSkeleton,
  fetchNodes,
  _http,
} from "../src/figmaClient.mjs";
import { collectFrontierIds } from "../src/chunk.mjs";
import { reconstruct, indexParts } from "../src/reconstruct.mjs";
import { batch, pool, countNodes, stringify } from "../src/util.mjs";
import { MOCK_FILE, makeMockFetch } from "../src/mock.mjs";
import { makeNodeFetch, redactProxy } from "../src/httpFetch.mjs";
import { run } from "../src/cli.mjs";
import http from "node:http";

test("parseFileKey: url, path, bare key", () => {
  assert.equal(
    parseFileKey("https://www.figma.com/design/TFTCSGbqpyxex6QRYqqbzb/About"),
    "TFTCSGbqpyxex6QRYqqbzb",
  );
  assert.equal(
    parseFileKey("https://www.figma.com/file/ABCDEFGHIJ/Name"),
    "ABCDEFGHIJ",
  );
  assert.equal(
    parseFileKey("out/TFTCSGbqpyxex6QRYqqbzb/full.json"),
    "TFTCSGbqpyxex6QRYqqbzb",
  );
  assert.equal(parseFileKey(""), "");
});

test("util: batch / pool / countNodes", async () => {
  assert.deepEqual(batch([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  const order = await pool(
    [() => Promise.resolve("a"), () => Promise.resolve("b")],
    1,
  );
  assert.deepEqual(order, ["a", "b"]);
  assert.equal(countNodes(MOCK_FILE.document), 17);
});

test("stringify: escapes U+2028 / U+2029 so output has no raw line terminators", () => {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const obj = { text: `a${LS}b${PS}c` };
  const out = stringify(obj);
  assert.ok(
    !out.includes(LS) && !out.includes(PS),
    "no raw separators in output",
  );
  assert.ok(
    out.includes("\\u2028") && out.includes("\\u2029"),
    "separators are escaped",
  );
  assert.deepEqual(JSON.parse(out), obj, "still round-trips to the same value");
});

test("collectFrontierIds: depth 1 = pages, depth 2 = top frames", () => {
  // Use the truncated skeleton the mock would return (children present to depth).
  assert.deepEqual(collectFrontierIds(MOCK_FILE, 1), ["0:1"]);
  assert.deepEqual(collectFrontierIds(MOCK_FILE, 2), [
    "1:100",
    "1:200",
    "1:300",
  ]);
});

test("client: fetchSkeleton truncates, fetchNodes returns subtrees", async () => {
  const original = _http.fetch;
  _http.fetch = makeMockFetch();
  try {
    const skel = await fetchSkeleton("KEY", "tok", { depth: 2 });
    const frame = skel.document.children[0].children[0];
    assert.equal(frame.id, "1:100");
    assert.ok(
      !("children" in frame),
      "depth-2 frame should be truncated (no children)",
    );

    const res = await fetchNodes("KEY", ["1:100", "1:300"], "tok", {});
    assert.ok(
      res.nodes["1:100"].document.children,
      "full node carries children",
    );
    assert.equal(res.nodes["1:100"].document.children.length, 2);
  } finally {
    _http.fetch = original;
  }
});

test("reconstruct: grafted file matches the original full tree", async () => {
  const original = _http.fetch;
  _http.fetch = makeMockFetch();
  try {
    const depth = 2;
    const skel = await fetchSkeleton("KEY", "tok", { depth });
    const ids = collectFrontierIds(skel, depth);
    // simulate a batched download
    const parts = [];
    for (const group of batch(ids, 2))
      parts.push(await fetchNodes("KEY", group, "tok", {}));
    const { file, stats } = reconstruct(skel, depth, indexParts(parts));

    assert.equal(stats.grafted, 3);
    assert.deepEqual(stats.missing, []);
    // Reconstructed tree must equal the original deep document node-for-node.
    assert.equal(countNodes(file.document), countNodes(MOCK_FILE.document));
    assert.deepEqual(file.document, MOCK_FILE.document);
  } finally {
    _http.fetch = original;
  }
});

test("reconstruct: records missing frontier nodes without dropping them", () => {
  const skel = {
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        { id: "0:1", type: "CANVAS", children: [{ id: "1:1", type: "FRAME" }] },
      ],
    },
  };
  const { file, stats } = reconstruct(skel, 2, indexParts([])); // no parts -> nothing to graft
  assert.deepEqual(stats.missing, ["1:1"]);
  assert.equal(stats.grafted, 0);
  assert.equal(file.document.children[0].children[0].id, "1:1"); // kept
});

test("cli end-to-end: --mock writes a full.json equal to the source", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "figdl-"));
  const out = path.join(dir, "full.json");
  const code = await run([
    "--mock",
    "--work-dir",
    dir,
    "--out",
    out,
    "--keep-parts",
    "--quiet",
  ]);
  assert.equal(code, 0);

  const full = JSON.parse(await fs.readFile(out, "utf8"));
  assert.deepEqual(full.document, MOCK_FILE.document);

  // skeleton + parts were persisted
  const skel = JSON.parse(
    await fs.readFile(path.join(dir, "skeleton.json"), "utf8"),
  );
  assert.ok(skel.document);
  const partFiles = (await fs.readdir(path.join(dir, "parts"))).filter((f) =>
    f.startsWith("part-"),
  );
  assert.ok(partFiles.length >= 1);

  // manifest reflects the plan
  const manifest = JSON.parse(
    await fs.readFile(path.join(dir, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.frontierDepth, 2);
  assert.equal(manifest.idCount, 3);

  await fs.rm(dir, { recursive: true, force: true });
});

test("cli: --reconstruct-only rebuilds from an existing work dir", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "figdl-"));
  // First do a normal mock run keeping parts.
  await run(["--mock", "--work-dir", dir, "--keep-parts", "--quiet"]);
  await fs.rm(path.join(dir, "full.json"), { force: true });

  const code = await run(["--reconstruct-only", "--work-dir", dir, "--quiet"]);
  assert.equal(code, 0);
  const full = JSON.parse(
    await fs.readFile(path.join(dir, "full.json"), "utf8"),
  );
  assert.deepEqual(full.document, MOCK_FILE.document);
  await fs.rm(dir, { recursive: true, force: true });
});

test("cli: --resume skips already-present parts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "figdl-"));
  await run(["--mock", "--work-dir", dir, "--keep-parts", "--quiet"]);
  // Second run with --resume should not re-write parts; result still correct.
  const code = await run([
    "--mock",
    "--work-dir",
    dir,
    "--keep-parts",
    "--resume",
    "--quiet",
  ]);
  assert.equal(code, 0);
  const manifest = JSON.parse(
    await fs.readFile(path.join(dir, "manifest.json"), "utf8"),
  );
  assert.ok(
    manifest.resumedSkipped >= 1,
    "resume should skip at least one part",
  );
  await fs.rm(dir, { recursive: true, force: true });
});

// --- Proxy / TLS transport (makeNodeFetch) — exercised against local servers. ---

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
}

test("makeNodeFetch: direct GET returns ok/status/json/text/header.get", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("x-echo-path", req.url);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ hello: "world", url: req.url }));
  });
  const port = await listen(server);
  try {
    const f = makeNodeFetch();
    const res = await f(`http://127.0.0.1:${port}/files/KEY?depth=2`, {
      headers: { "X-Figma-Token": "t" },
    });
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-echo-path"), "/files/KEY?depth=2");
    assert.deepEqual(await res.json(), {
      hello: "world",
      url: "/files/KEY?depth=2",
    });
  } finally {
    server.close();
  }
});

test("makeNodeFetch: routes an http target through a proxy (absolute-form URI)", async () => {
  // A minimal forward proxy: it receives the absolute URL as the request path.
  let sawAbsoluteUrl = null;
  let sawProxyAuth = null;
  const proxy = http.createServer((req, res) => {
    sawAbsoluteUrl = req.url;
    sawProxyAuth = req.headers["proxy-authorization"] || null;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ proxied: true }));
  });
  const port = await listen(proxy);
  try {
    const f = makeNodeFetch({ proxy: `http://****:*****@127.0.0.1:${port}` });
    const res = await f("http://api.example.test/files/KEY", { headers: {} });
    assert.equal(res.ok, true);
    assert.deepEqual(await res.json(), { proxied: true });
    assert.equal(
      sawAbsoluteUrl,
      "http://api.example.test/files/KEY",
      "proxy gets the absolute URL",
    );
    assert.equal(
      sawProxyAuth,
      "Basic " + Buffer.from("****:*****").toString("base64"),
      "proxy auth header sent",
    );
  } finally {
    proxy.close();
  }
});

test("makeNodeFetch: honours an AbortSignal (rejects AbortError)", async () => {
  const server = http.createServer(() => {
    /* never responds */
  });
  const port = await listen(server);
  try {
    const ac = new AbortController();
    const f = makeNodeFetch();
    const p = f(`http://127.0.0.1:${port}/hang`, { signal: ac.signal });
    ac.abort();
    await assert.rejects(p, (err) => err.name === "AbortError");
  } finally {
    server.close();
  }
});

test("redactProxy: strips credentials from the logged proxy URL", () => {
  assert.equal(
    redactProxy("http://****:*****@host:8080"),
    "http://***@host:8080/",
  );
  assert.equal(redactProxy("http://host:8080"), "http://host:8080/");
  assert.equal(redactProxy(""), "");
});
