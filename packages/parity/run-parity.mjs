#!/usr/bin/env node

// run-parity.mjs — cross-language parity gate for the figma-downloader twins.
//
// For every case in shared/parity/cases.json it runs BOTH CLIs (Node + Python)
// offline (--mock) and asserts:
//   1. the two full.json outputs are byte-identical (compact serialization),
//   2. each manifest validates against shared/golden/manifest.schema.json,
//   3. the manifests agree on every key in `comparedManifestKeys`,
//   4. any per-case `expect` values hold for both.
//
// Zero-dependency Node ESM. Exits non-zero on the first divergence.

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKGS = path.resolve(__dirname, "..");
const SHARED = path.join(PKGS, "shared");
const NODE_BIN = path.join(
  PKGS,
  "ts",
  "bin",
  "figma-download.mjs",
);
const PY_DIR = path.join(PKGS, "py");

const RED = "\x1b[31m",
  GREEN = "\x1b[32m",
  DIM = "\x1b[2m",
  RESET = "\x1b[0m";

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

/** Minimal JSON-Schema (draft-07 subset) validator for the manifest. */
function validate(schema, obj, where = "") {
  const errs = [];
  if (schema.type === "object") {
    if (typeof obj !== "object" || obj === null || Array.isArray(obj))
      return [`${where || "root"}: expected object`];
    for (const req of schema.required || []) {
      if (!(req in obj)) errs.push(`${where}${req}: required`);
    }
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in obj) errs.push(...validate(sub, obj[k], `${where}${k}.`));
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(obj)) return [`${where}: expected array`];
    for (let i = 0; i < obj.length; i++)
      errs.push(...validate(schema.items || {}, obj[i], `${where}${i}.`));
  } else if (schema.type === "integer") {
    if (!Number.isInteger(obj))
      errs.push(
        `${where.slice(0, -1)}: expected integer (got ${JSON.stringify(obj)})`,
      );
    else if (schema.minimum !== undefined && obj < schema.minimum)
      errs.push(`${where.slice(0, -1)}: < minimum`);
  } else if (schema.type === "number") {
    if (typeof obj !== "number")
      errs.push(`${where.slice(0, -1)}: expected number`);
  } else if (schema.type === "string") {
    if (typeof obj !== "string")
      errs.push(`${where.slice(0, -1)}: expected string`);
    else if (schema.enum && !schema.enum.includes(obj))
      errs.push(`${where.slice(0, -1)}: not in enum`);
  }
  return errs;
}

function runNode(args, workDir, outPath) {
  const a = [
    NODE_BIN,
    ...args,
    "--work-dir",
    workDir,
    "--out",
    outPath,
    "--keep-parts",
    "--quiet",
  ];
  const r = spawnSync("node", a, { encoding: "utf8" });
  return r;
}

function runPy(args, workDir, outPath) {
  const a = [
    "-m",
    "figma_downloader",
    ...args,
    "--work-dir",
    workDir,
    "--out",
    outPath,
    "--keep-parts",
    "--quiet",
  ];
  const r = spawnSync("python3", a, { encoding: "utf8", cwd: PY_DIR });
  return r;
}

async function main() {
  const cases = await readJson(path.join(SHARED, "parity", "cases.json"));
  const schema = await readJson(
    path.join(SHARED, "golden", "manifest.schema.json"),
  );
  const comparedKeys = cases.comparedManifestKeys || [];
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "figdl-parity-"));

  let failures = 0;
  for (const c of cases.cases) {
    const nWork = path.join(tmp, `${c.name}-node`);
    const pWork = path.join(tmp, `${c.name}-py`);
    const nOut = path.join(nWork, "full.json");
    const pOut = path.join(pWork, "full.json");
    await fs.mkdir(nWork, { recursive: true });
    await fs.mkdir(pWork, { recursive: true });

    const problems = [];
    const rn = runNode(c.args, nWork, nOut);
    const rp = runPy(c.args, pWork, pOut);
    if (rn.status !== 0)
      problems.push(
        `node exited ${rn.status}: ${(rn.stderr || "").trim().split("\n").pop()}`,
      );
    if (rp.status !== 0)
      problems.push(
        `python exited ${rp.status}: ${(rp.stderr || "").trim().split("\n").pop()}`,
      );

    if (!problems.length) {
      const [nFull, pFull] = [
        await fs.readFile(nOut, "utf8"),
        await fs.readFile(pOut, "utf8"),
      ];
      if (nFull !== pFull)
        problems.push("full.json BYTES DIFFER between Node and Python");

      const nMan = await readJson(path.join(nWork, "manifest.json"));
      const pMan = await readJson(path.join(pWork, "manifest.json"));
      for (const [lang, man] of [
        ["node", nMan],
        ["python", pMan],
      ]) {
        const verrs = validate(schema, man);
        if (verrs.length)
          problems.push(
            `${lang} manifest schema: ${verrs.slice(0, 3).join("; ")}`,
          );
      }
      for (const k of comparedKeys) {
        if (JSON.stringify(nMan[k]) !== JSON.stringify(pMan[k])) {
          problems.push(
            `manifest.${k} differs: node=${JSON.stringify(nMan[k])} py=${JSON.stringify(pMan[k])}`,
          );
        }
      }
      for (const [k, v] of Object.entries(c.expect || {})) {
        if (JSON.stringify(nMan[k]) !== JSON.stringify(v))
          problems.push(
            `expect node.${k}=${JSON.stringify(v)} got ${JSON.stringify(nMan[k])}`,
          );
        if (JSON.stringify(pMan[k]) !== JSON.stringify(v))
          problems.push(
            `expect py.${k}=${JSON.stringify(v)} got ${JSON.stringify(pMan[k])}`,
          );
      }
    }

    if (problems.length) {
      failures += 1;
      console.log(
        `${RED}✗ FAIL${RESET} ${c.name} ${DIM}[${c.args.join(" ")}]${RESET}`,
      );
      for (const p of problems) console.log(`    ${RED}${p}${RESET}`);
    } else {
      console.log(
        `${GREEN}✓ PASS${RESET} ${c.name} ${DIM}[${c.args.join(" ")}]${RESET}`,
      );
    }
  }

  await fs.rm(tmp, { recursive: true, force: true });
  console.log("");
  if (failures) {
    console.log(
      `${RED}parity: ${failures}/${cases.cases.length} case(s) FAILED${RESET}`,
    );
    process.exit(1);
  }
  console.log(
    `${GREEN}parity: all ${cases.cases.length} case(s) passed${RESET}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
