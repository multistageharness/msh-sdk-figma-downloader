// config.test.mjs — proxy + TLS resolution precedence: flag > config > env > default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveNetworkConfig } from '../src/config.mjs';

async function withConfig(obj, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'figdl-cfg-'));
  const file = path.join(dir, 'figma-download.config.json');
  await fs.writeFile(file, JSON.stringify(obj), 'utf8');
  try {
    return await fn(file, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('default: proxy null, sslVerify true', () => {
  const r = resolveNetworkConfig({}, {});
  assert.equal(r.proxy, null);
  assert.equal(r.sslVerify, true);
  assert.equal(r.sources.proxy, 'default');
  assert.equal(r.sources.sslVerify, 'default');
});

test('env: proxy from HTTPS_PROXY; FIGMA_PROXY wins', () => {
  const r1 = resolveNetworkConfig({}, { HTTPS_PROXY: 'http://envproxy:1' });
  assert.equal(r1.proxy, 'http://envproxy:1');
  assert.equal(r1.sources.proxy, 'env');

  const r2 = resolveNetworkConfig({}, { HTTPS_PROXY: 'http://envproxy:1', FIGMA_PROXY: 'http://figproxy:2' });
  assert.equal(r2.proxy, 'http://figproxy:2');
});

test('env: FIGMA_PROXY_URL is honored and is the preferred proxy var', () => {
  const r1 = resolveNetworkConfig({}, { FIGMA_PROXY_URL: 'http://urlproxy:5' });
  assert.equal(r1.proxy, 'http://urlproxy:5');
  assert.equal(r1.sources.proxy, 'env');

  // FIGMA_PROXY_URL wins over the other env aliases.
  const r2 = resolveNetworkConfig({}, {
    FIGMA_PROXY_URL: 'http://urlproxy:5',
    FIGMA_PROXY: 'http://figproxy:2',
    HTTPS_PROXY: 'http://envproxy:1',
  });
  assert.equal(r2.proxy, 'http://urlproxy:5');
});

test('env: sslVerify false via FIGMA_SSL_VERIFY and NODE_TLS_REJECT_UNAUTHORIZED=0', () => {
  assert.equal(resolveNetworkConfig({}, { FIGMA_SSL_VERIFY: 'false' }).sslVerify, false);
  assert.equal(resolveNetworkConfig({}, { FIGMA_SSL_VERIFY: '0' }).sslVerify, false);
  assert.equal(resolveNetworkConfig({}, { FIGMA_SSL_VERIFY: 'true' }).sslVerify, true);
  assert.equal(resolveNetworkConfig({}, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }).sslVerify, false);
});

test('config file overrides env', async () => {
  await withConfig({ proxy: 'http://cfgproxy:3', sslVerify: false }, (file) => {
    const r = resolveNetworkConfig({ config: file }, { HTTPS_PROXY: 'http://envproxy:1', FIGMA_SSL_VERIFY: 'true' });
    assert.equal(r.proxy, 'http://cfgproxy:3');
    assert.equal(r.sources.proxy, 'config');
    assert.equal(r.sslVerify, false);
    assert.equal(r.sources.sslVerify, 'config');
  });
});

test('CLI flag overrides config file', async () => {
  await withConfig({ proxy: 'http://cfgproxy:3', sslVerify: false }, (file) => {
    const r = resolveNetworkConfig({ config: file, proxy: 'http://cliproxy:4', 'ssl-verify': true }, {});
    assert.equal(r.proxy, 'http://cliproxy:4');
    assert.equal(r.sources.proxy, 'cli');
    assert.equal(r.sslVerify, true);
    assert.equal(r.sources.sslVerify, 'cli');
  });
});

test('--no-proxy forces a direct connection even with env/config', async () => {
  await withConfig({ proxy: 'http://cfgproxy:3' }, (file) => {
    const r = resolveNetworkConfig({ config: file, 'no-proxy': true }, { HTTPS_PROXY: 'http://envproxy:1' });
    assert.equal(r.proxy, null);
    assert.equal(r.sources.proxy, 'cli');
  });
});

test('--no-ssl-verify overrides a config that enabled it', async () => {
  await withConfig({ sslVerify: true }, (file) => {
    const r = resolveNetworkConfig({ config: file, 'no-ssl-verify': true }, {});
    assert.equal(r.sslVerify, false);
    assert.equal(r.sources.sslVerify, 'cli');
  });
});

test('explicit --config that cannot be read is a hard error', async () => {
  assert.throws(() => resolveNetworkConfig({ config: '/no/such/figma-config.json' }, {}), /config/);
});
