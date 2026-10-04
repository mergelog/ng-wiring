import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFixture } from './fixtures/harness.mjs';
import { renderSimple } from '../dist/render/simple.js';

test('a local operation stays without HTTP when another event has an analysis boundary', async () => {
  const { report, simple } = await analyzeFixture('no-http-boundary', {
    target: 'data-id=localToggle',
    then: ({ report, root }) => ({ report, simple: renderSimple({ report, outputDir: root }).text }),
  });
  assert(report, 'fixture target was not found');
  assert(report.edges.some(edge => edge.kind === 'boundary'));
  assert(!report.edges.some(edge => edge.kind === 'http-create'));
  assert.match(simple, /通信: この探索範囲では未検出/);
  assert.doesNotMatch(simple, /通信有無は未確定/);
});
