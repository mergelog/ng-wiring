import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFixture } from './fixtures/harness.mjs';
import { renderSimple } from '../dist/render/simple.js';

test('catalog Apply reaches the same-route queryParams effect and list requests', async () => {
  const { report, simple } = await analyzeFixture('catalog-route-bridge', {
    target: 'data-id=catalogApply', route: '/catalog',
    then: ({ report, root }) => ({ report, simple: renderSimple({ report, outputDir: root }).text }),
  });
  assert(report, 'fixture target was not found');
  const operators = report.edges.filter(edge => edge.kind === 'reactive-link')
    .map(edge => edge.details.operator?.value);
  assert(operators.some(value => value?.includes('Router.navigate with queryParams')));
  assert(operators.some(value => value?.includes('ActivatedRoute.queryParams feeds toSignal')));
  assert(operators.some(value => value?.includes('constructor effect reads the queryParams signal')));
  assert.match(simple, /Router.navigate[\s\S]*ActivatedRoute.queryParams → toSignal[\s\S]*constructor effect[\s\S]*openList/);
  assert.match(simple, /POST \/api\/tasks\.get_all_ex/);
  assert.match(simple, /POST \/api\/models\.get_all_ex/);
  assert.doesNotMatch(simple, /projects\.get_all_ex/);
  assert(!report.edges.some(edge => edge.kind === 'http-create' &&
    edge.details.urlExpression?.value === '/api/projects.get_all_ex'));
  assert.doesNotMatch(simple, /unrelated\.get_all_ex/);
});

test('a nonempty project argument keeps the conditional project request', async () => {
  const { report, simple } = await analyzeFixture('catalog-route-bridge', {
    target: 'data-id=projectLoad', route: '/catalog',
    then: ({ report, root }) => ({ report, simple: renderSimple({ report, outputDir: root }).text }),
  });
  assert(report, 'fixture target was not found');
  assert.match(simple, /POST \/api\/projects\.get_all_ex/);
  assert.match(simple, /条件: if project/);
  assert.doesNotMatch(simple, /unrelated\.get_all_ex/);
});
