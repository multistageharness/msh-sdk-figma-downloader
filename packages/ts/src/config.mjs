// config.mjs — resolve network configuration (proxy + TLS verification) from a
// layered set of sources, so a user can override the defaults via EITHER a config
// file OR environment variables (or a CLI flag).
//
// Precedence, highest wins:
//   1. CLI flag        --proxy <url> / --no-proxy ; --ssl-verify / --no-ssl-verify
//   2. Config file     figma-download.config.json (or --config <path>): { proxy, sslVerify }
//   3. Environment     FIGMA_PROXY_URL | FIGMA_PROXY | HTTPS_PROXY | HTTP_PROXY |
//                      ALL_PROXY ; FIGMA_SSL_VERIFY ; NODE_TLS_REJECT_UNAUTHORIZED
//   4. Default         proxy = null (none) ; sslVerify = true
//
// Each resolved value reports its `source` so the CLI can log where it came from.

import { readFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_CONFIG_FILENAME = "figma-download.config.json";

/** Parse a loose boolean: "false"/"0"/"no"/"off" → false, else true. */
function asBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["false", "0", "no", "off", ""].includes(s)) return false;
  return true;
}

/** Load + parse the JSON config file if present. Returns {} when absent. */
export function loadConfigFile(args = {}, { cwd = process.cwd() } = {}) {
  const explicit = args.config;
  const file = explicit
    ? path.resolve(cwd, explicit)
    : path.resolve(cwd, DEFAULT_CONFIG_FILENAME);
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return { file, data: parsed && typeof parsed === "object" ? parsed : {} };
  } catch (err) {
    if (explicit) {
      // An explicitly named config that can't be read is a hard error.
      throw new Error(`--config ${explicit}: ${err.message || err}`);
    }
    return { file: null, data: {} };
  }
}

/**
 * Resolve { proxy, sslVerify } across CLI > file > env > default.
 *
 * @param {object} args   parsed CLI args (parseArgs output)
 * @param {object} [env]  environment (defaults to process.env)
 * @param {{ cwd?: string }} [opts]
 * @returns {{ proxy: string|null, sslVerify: boolean, sources: {proxy:string, sslVerify:string}, configFile: string|null }}
 */
export function resolveNetworkConfig(args = {}, env = process.env, opts = {}) {
  const { file: configFile, data: fileCfg } = loadConfigFile(args, opts);
  const sources = { proxy: "default", sslVerify: "default" };

  // ---- proxy: default null ----
  let proxy = null;
  // env (lowest override over default)
  const envProxy =
    env.FIGMA_PROXY_URL ||
    env.FIGMA_PROXY ||
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.HTTP_PROXY ||
    env.http_proxy ||
    env.ALL_PROXY ||
    env.all_proxy ||
    "";
  if (envProxy) {
    proxy = envProxy;
    sources.proxy = "env";
  }
  // config file
  if (fileCfg.proxy !== undefined) {
    proxy =
      fileCfg.proxy === null || fileCfg.proxy === ""
        ? null
        : String(fileCfg.proxy);
    sources.proxy = "config";
  }
  // CLI (highest)
  if (args["no-proxy"]) {
    proxy = null;
    sources.proxy = "cli";
  } else if (args.proxy !== undefined && args.proxy !== "") {
    proxy = String(args.proxy);
    sources.proxy = "cli";
  }

  // ---- sslVerify: default true ----
  let sslVerify = true;
  // env
  if (env.FIGMA_SSL_VERIFY !== undefined) {
    sslVerify = asBool(env.FIGMA_SSL_VERIFY);
    sources.sslVerify = "env";
  } else if (env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined) {
    // Node's own knob: "0" disables verification.
    sslVerify = !(String(env.NODE_TLS_REJECT_UNAUTHORIZED).trim() === "0");
    sources.sslVerify = "env";
  }
  // config file
  if (fileCfg.sslVerify !== undefined) {
    sslVerify = asBool(fileCfg.sslVerify);
    sources.sslVerify = "config";
  }
  // CLI
  if (args["no-ssl-verify"] || args.insecure) {
    sslVerify = false;
    sources.sslVerify = "cli";
  } else if (args["ssl-verify"]) {
    sslVerify = true;
    sources.sslVerify = "cli";
  }

  return { proxy, sslVerify, sources, configFile };
}
