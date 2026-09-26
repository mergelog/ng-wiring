import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFixture, edgeKeys } from './fixtures/harness.mjs';

test('SignalState writes notify watchState and recompute deepComputed with distinct conditions', async () => {
  const { report } = await analyzeFixture('signal-store-apis', { target: 'data-id=pageButton' });
  const keys = edgeKeys(report);
  assert(keys.includes('state-write|click → nextPage()|filters'));
  assert(keys.includes('reactive-link|filters|signals/watchState'));
  assert(keys.includes('reactive-link|filters|deep'));

  const conditions = new Map(report.conditions.map(item => [item.id, item]));
  const conditionText = edge => {
    const visit = id => {
      const item = conditions.get(id);
      if (!item) return '';
      if (item.kind === 'predicate') return item.expression;
      if (item.kind === 'all' || item.kind === 'any') return item.operandIds.map(visit).join(' && ');
      return item.kind;
    };
    return visit(edge.conditionId);
  };
  const watcher = report.edges.find(edge => edge.kind === 'reactive-link' &&
    edge.details.consumer?.value === 'signals/watchState');
  assert(conditionText(watcher).includes('watchState emits an initial snapshot after registration'));
  assert(conditionText(watcher).includes('subsequent notifications follow SignalState changes'));
  assert.equal(watcher.details.scheduling.value, 'state-watcher');

  const deep = report.edges.find(edge => edge.kind === 'reactive-link' && edge.details.consumer?.value === 'deep');
  assert.equal(deep.details.operator.value, 'signals/deepComputed');
  assert(conditionText(deep).includes('a tracked dependency must change its compared value'));
});

test('a direct deep mutation does not notify SignalState consumers', async () => {
  const { report } = await analyzeFixture('signal-store-apis', { target: 'data-id=mutateButton' });
  assert.deepEqual(edgeKeys(report).filter(key => key.startsWith('state-write|')), []);
  assert.deepEqual(edgeKeys(report).filter(key => key.startsWith('reactive-link|')), []);
});
