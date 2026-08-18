// sizing.test.mjs — tier classification + strategy resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, resolveStrategy, TIERS, PRESETS } from '../src/sizing.mjs';

test('classify: small truncation-free skeleton is sm', () => {
  assert.equal(classify({ nodeCount: 100, frontierWidth: 0, skeletonBytes: 1000, hasFrontier: false }), 'sm');
});

test('classify: scales by node count', () => {
  assert.equal(classify({ nodeCount: 10_000, frontierWidth: 10, skeletonBytes: 1000 }), 'md');
  assert.equal(classify({ nodeCount: 100_000, frontierWidth: 10, skeletonBytes: 1000 }), 'large');
  assert.equal(classify({ nodeCount: 500_000, frontierWidth: 10, skeletonBytes: 1000 }), 'xl');
  assert.equal(classify({ nodeCount: 5_000_000, frontierWidth: 10, skeletonBytes: 1000 }), 'xxxxl');
});

test('classify: the largest signal wins (never under-provision)', () => {
  // small node count but a huge frontier => xl/xxxxl
  assert.equal(classify({ nodeCount: 100, frontierWidth: 5_000, skeletonBytes: 1000 }), 'xxxxl');
  // small everything but a huge skeleton => large+
  const t = classify({ nodeCount: 100, frontierWidth: 1, skeletonBytes: 40 * 1024 * 1024 });
  assert.ok(['large', 'xl', 'xxxxl'].includes(t));
});

test('resolveStrategy: explicit size preset', () => {
  const s = resolveStrategy({ size: 'xl' });
  assert.equal(s.size, 'xl');
  assert.equal(s.depth, PRESETS.xl.depth);
  assert.equal(s.batchSize, PRESETS.xl.batchSize);
  assert.equal(s.stream, true);
  assert.equal(s.rechunk, true);
});

test('resolveStrategy: explicit CLI values override the preset', () => {
  const s = resolveStrategy({ size: 'md', depth: 4, batchSize: 1, concurrency: 16, explicit: { depth: true, batchSize: true, concurrency: true } });
  assert.equal(s.depth, 4);
  assert.equal(s.batchSize, 1);
  assert.equal(s.concurrency, 16);
});

test('resolveStrategy: non-explicit values do not override the preset', () => {
  const s = resolveStrategy({ size: 'md', depth: 4, explicit: { depth: false } });
  assert.equal(s.depth, PRESETS.md.depth); // preset wins because not explicit
});

test('resolveStrategy: maxPartBytes=0 disables rechunk', () => {
  const s = resolveStrategy({ size: 'xl', maxPartBytes: 0 });
  assert.equal(s.maxPartBytes, 0);
  assert.equal(s.rechunk, false);
});

test('resolveStrategy: auto classification when size omitted', () => {
  const s = resolveStrategy({ signals: { nodeCount: 5_000_000, frontierWidth: 10, skeletonBytes: 1000 } });
  assert.equal(s.size, 'xxxxl');
});

test('TIERS / PRESETS are aligned', () => {
  for (const t of TIERS) assert.ok(PRESETS[t], `preset for ${t}`);
});
