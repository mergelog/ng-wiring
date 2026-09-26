import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFixture, edgeKeys } from './fixtures/harness.mjs';

test('SignalStore derived members connect their exact dependencies to the display', async () => {
  const { report } = await analyzeFixture('signal-store-apis', { target: 'data-id=setTermButton' });
  const keys = edgeKeys(report);
  assert(keys.includes('reactive-link|term|label'));
  assert(keys.includes('reactive-link|term|draft'));
  assert(keys.includes('state-read|label|<span>'));
  assert(keys.includes('state-read|draft|<span>'));
  assert(keys.includes('state-write|click → setTerm()|term'));

  const links = report.edges.filter(edge => edge.kind === 'reactive-link' &&
    ['label', 'draft'].includes(edge.details.consumer?.value));
  assert.equal(links.find(edge => edge.details.consumer.value === 'label').details.operator.value,
    'signals/withComputed');
  const linked = links.find(edge => edge.details.consumer.value === 'draft');
  assert.equal(linked.details.operator.value, 'signals/withLinkedState');
  assert.equal(linked.details.scheduling.value, 'source change or explicit write');
});

test('SignalStore writes retain hook lifetime and linked-state override conditions', async () => {
  const { report } = await analyzeFixture('signal-store-apis', { target: 'data-id=setTermButton' });
  const conditions = new Map(report.conditions.map(item => [item.id, item]));
  const text = (id) => {
    const condition = conditions.get(id);
    if (!condition) return '';
    if (condition.kind === 'predicate') return condition.expression;
    if (condition.kind === 'all' || condition.kind === 'any') return condition.operandIds.map(text).join(' && ');
    return condition.kind;
  };
  const termWrite = report.edges.find(edge => edge.kind === 'state-write' &&
    edge.details.state?.value === 'term');
  const draftWrite = report.edges.find(edge => edge.kind === 'state-write' &&
    edge.details.state?.value === 'draft');
  assert(text(termWrite.conditionId).includes('Store starts at onInit at'));
  assert(text(termWrite.conditionId).includes('Store ends at onDestroy at'));
  assert(text(draftWrite.conditionId).includes('an explicit write replaces the linked-state value'));
});
