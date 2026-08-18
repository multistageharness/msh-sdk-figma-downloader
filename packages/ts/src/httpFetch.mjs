// httpFetch.mjs — a tiny, zero-dependency fetch-compatible transport built on
// Node's http/https/tls modules. It exists for the two things the global
// (undici) `fetch` can't do without pulling in the `undici` package:
//
//   • route requests through an HTTP/HTTPS proxy (CONNECT tunnel for https), and
//   • toggle TLS certificate verification (rejectUnauthorized).
//
// It implements only the slice of the Response that figmaGet uses:
//   { ok, status, headers: { get(name) }, async json(), async text() }
// and honours an AbortSignal (so the client's timeout still works). The default
// (no proxy, TLS verified) path is left on the global fetch — this transport is
// installed only when a proxy or --no-ssl-verify is actually requested.

import http from "node:http";
import https from "node:https";
import tls from "node:tls";

/** Build a `fetch(url, { headers, signal })`-compatible function. */
export function makeNodeFetch({ proxy = null, sslVerify = true } = {}) {
  const proxyUrl = proxy ? new URL(proxy) : null;

  return function nodeFetch(urlStr, opts = {}) {
    return new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(urlStr);
      } catch (err) {
        reject(err);
        return;
      }
      const isHttps = url.protocol === "https:";
      const headers = { ...(opts.headers || {}) };
      const signal = opts.signal;

      let settled = false;
      let req = null;
      const cleanup = () => {
        if (signal) signal.removeEventListener("abort", onAbort);
      };
      const fail = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      const succeed = (val) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(val);
      };
      function onAbort() {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        try {
          req?.destroy(err);
        } catch {
          /* ignore */
        }
        fail(err);
      }
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const collect = (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          succeed({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: {
              get: (n) => res.headers[String(n).toLowerCase()] ?? null,
            },
            text: async () => body,
            json: async () => JSON.parse(body),
          });
        });
        res.on("error", fail);
      };

      // --- Direct (no proxy). ---
      if (!proxyUrl) {
        const mod = isHttps ? https : http;
        const reqOpts = {
          method: "GET",
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          headers,
        };
        if (isHttps) reqOpts.rejectUnauthorized = sslVerify;
        req = mod.request(reqOpts, collect);
        req.on("error", fail);
        req.end();
        return;
      }

      // --- Through a proxy. ---
      const proxyIsHttps = proxyUrl.protocol === "https:";
      const proxyAuth = proxyUrl.username
        ? "Basic " +
          Buffer.from(
            `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`,
          ).toString("base64")
        : null;

      if (!isHttps) {
        // HTTP target through the proxy: absolute-form request URI.
        const mod = proxyIsHttps ? https : http;
        const h = { ...headers, Host: url.host };
        if (proxyAuth) h["Proxy-Authorization"] = proxyAuth;
        const reqOpts = {
          method: "GET",
          hostname: proxyUrl.hostname,
          port: proxyUrl.port || (proxyIsHttps ? 443 : 80),
          path: url.href,
          headers: h,
        };
        if (proxyIsHttps) reqOpts.rejectUnauthorized = sslVerify;
        req = mod.request(reqOpts, collect);
        req.on("error", fail);
        req.end();
        return;
      }

      // HTTPS target through the proxy: CONNECT tunnel, then TLS over the socket.
      const connMod = proxyIsHttps ? https : http;
      const targetPort = url.port || 443;
      const connHeaders = {};
      if (proxyAuth) connHeaders["Proxy-Authorization"] = proxyAuth;
      const connectReq = connMod.request({
        method: "CONNECT",
        hostname: proxyUrl.hostname,
        port: proxyUrl.port || (proxyIsHttps ? 443 : 80),
        path: `${url.hostname}:${targetPort}`,
        headers: connHeaders,
        ...(proxyIsHttps ? { rejectUnauthorized: sslVerify } : {}),
      });
      req = connectReq;
      connectReq.on("error", fail);
      connectReq.on("connect", (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          fail(
            new Error(
              `proxy CONNECT to ${url.hostname}:${targetPort} failed: HTTP ${res.statusCode}`,
            ),
          );
          return;
        }
        const tlsSocket = tls.connect({
          socket,
          servername: url.hostname,
          rejectUnauthorized: sslVerify,
        });
        tlsSocket.on("error", fail);
        const innerReq = https.request(
          {
            method: "GET",
            hostname: url.hostname,
            port: targetPort,
            path: url.pathname + url.search,
            headers,
            createConnection: () => tlsSocket,
          },
          collect,
        );
        req = innerReq;
        innerReq.on("error", fail);
        innerReq.end();
      });
      connectReq.end();
    });
  };
}

/** Redact credentials from a proxy URL for safe logging. */
export function redactProxy(proxy) {
  if (!proxy) return "";
  try {
    const u = new URL(proxy);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "";
    }
    return u.toString();
  } catch {
    return proxy;
  }
}
