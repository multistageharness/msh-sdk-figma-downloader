// errors.test.mjs — typed error taxonomy (TR-16) + CLI exit-code mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { figmaGet, _http } from '../src/figmaClient.mjs';
import {
  FigmaAuthError, FigmaNotFoundError, FigmaRateLimitError,
  FigmaServerError, FigmaNetworkError, FigmaError, exitCodeFor,
} from '../src/errors.mjs';
import { run } from '../src/cli.mjs';

function statusFetch(status, body = '{}') {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body || '{}'),
    headers: new Map(),
  });
}

async function expectThrow(fetchImpl, opts = {}) {
  const original = _http.fetch;
  _http.fetch = fetchImpl;
  try {
    await figmaGet('/files/X?depth=2', 'tok', { retries: 0, ...opts });
    throw new Error('expected figmaGet to throw');
  } finally {
    _http.fetch = original;
  }
}

test('401/403 → FigmaAuthError (exit 3), non-retryable', async () => {
  await assert.rejects(expectThrow(statusFetch(401)), (e) => e instanceof FigmaAuthError && e.exitCode === 3 && !e.retryable);
  await assert.rejects(expectThrow(statusFetch(403)), (e) => e instanceof FigmaAuthError);
});

test('404 → FigmaNotFoundError (exit 4)', async () => {
  await assert.rejects(expectThrow(statusFetch(404)), (e) => e instanceof FigmaNotFoundError && e.exitCode === 4);
});

test('429 → FigmaRateLimitError (exit 5), retryable flag set', async () => {
  await assert.rejects(expectThrow(statusFetch(429)), (e) => e instanceof FigmaRateLimitError && e.exitCode === 5 && e.retryable);
});

test('500 → FigmaServerError (exit 6)', async () => {
  await assert.rejects(expectThrow(statusFetch(500)), (e) => e instanceof FigmaServerError && e.exitCode === 6);
});

test('network error → FigmaNetworkError (exit 6)', async () => {
  const netFetch = async () => { const e = new Error('reset'); e.code = 'ECONNRESET'; throw e; };
  await assert.rejects(expectThrow(netFetch), (e) => e instanceof FigmaNetworkError && e.exitCode === 6);
});

test('missing token → FigmaError (exit 3)', async () => {
  await assert.rejects(figmaGet('/files/X', '', {}), (e) => e instanceof FigmaError && e.exitCode === 3);
});

test('exitCodeFor: typed errors carry their code; unknown → 1', () => {
  assert.equal(exitCodeFor(new FigmaNotFoundError('x')), 4);
  assert.equal(exitCodeFor(new Error('x')), 1);
});

test('cli: missing token returns exit code 3 (auth)', async () => {
  const code = await run(['--file-key', 'SOMEKEY1234567890ABCD', '--quiet'], { env: {} });
  assert.equal(code, 3);
});
