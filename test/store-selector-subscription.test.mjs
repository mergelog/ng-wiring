import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFixture } from './fixtures/harness.mjs';
import { renderSimple } from '../dist/render/simple.js';

test('a subscribed Store selector can dispatch a follow-up action and reach HTTP', async () => {
  const { report, simple } = await analyzeFixture('store-selector-subscription', {
    target: 'data-id=changeTerm',
    then: ({ report, root }) => ({ report, simple:renderSimple({ report, outputDir:root }).text }),
  });
  assert(report, 'fixture target was not found');
  const edges = report.edges;
  assert(edges.some(edge => edge.kind === 'reactive-link' &&
    edge.details.source?.value?.endsWith('#selectTerm')));
  assert(edges.some(edge => edge.kind === 'action-dispatch' &&
    edge.details.action?.value?.endsWith('#loadResults')));
  assert(edges.some(edge => edge.kind === 'action-consume' &&
    edge.details.consumer?.value?.endsWith('#load')));
  assert(edges.some(edge => edge.kind === 'http-create' &&
    edge.details.urlExpression?.value === '/api/results'));
  assert.match(simple, /GET \/api\/results/);
  assert.doesNotMatch(simple, /GET \/api\/status/);
  assert.match(simple, /this\.store\.dispatch\(loadResults\(\)\)/);
  assert(report.conditions.some(condition => condition.expression ===
    'selected projection must change for a new emitted value'));
  assert(report.conditions.some(condition => condition.expression ===
    'all combineLatest sources must emit at least once'));
  assert(report.conditions.some(condition => condition.expression ===
    'each selector is one input; other inputs may change independently'));
  assert(report.conditions.some(condition => condition.expression ===
    'subscription may end on unsubscribe or component destruction'));
  assert.match(simple, /selected projection must change for a new emitted value/);
});

test('a status write keeps both selector subscriptions and their filter conditions', async () => {
  const { report, simple } = await analyzeFixture('store-selector-subscription', {
    target: 'data-id=changeStatus',
    then: ({ report, root }) => ({ report, simple:renderSimple({ report, outputDir:root }).text }),
  });
  assert(report, 'fixture target was not found');
  assert(report.edges.some(edge => edge.kind === 'action-dispatch' &&
    edge.details.action?.value?.endsWith('#loadResults')));
  assert(report.edges.some(edge => edge.kind === 'http-create' &&
    edge.details.urlExpression?.value === '/api/status'));
  assert.match(simple, /GET \/api\/results/);
  assert.match(simple, /GET \/api\/status/);
  assert(report.conditions.some(condition => condition.expression?.includes("status === 'ready'")));
  assert(report.conditions.some(condition => condition.expression ===
    'component ngOnInit subscription must be active'));
  assert(report.conditions.some(condition => condition.expression ===
    'distinctUntilChanged requires compared values to differ'));
});

test('a write to an unselected property reaches neither follow-up endpoint', async () => {
  const { report, simple } = await analyzeFixture('store-selector-subscription', {
    target: 'data-id=changeOther',
    then: ({ report, root }) => ({ report, simple: renderSimple({ report, outputDir: root }).text }),
  });
  assert(report, 'fixture target was not found');
  assert(!report.edges.some(edge => edge.kind === 'http-create'));
  assert.doesNotMatch(simple, /GET \/api\/(?:results|status)/);
});
