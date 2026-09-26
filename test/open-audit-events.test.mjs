import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeFixture, edgeKeys} from './fixtures/harness.mjs';

const stopped = analyzeFixture('open-audit-events', {target: 'data-id=stopped', event: 'click'});
const bubbling = analyzeFixture('open-audit-events', {target: 'data-id=bubbles', event: 'click'});
const conditional = analyzeFixture('open-audit-events', {target: 'data-id=conditional', event: 'click'});

test('a chained click handler traces its local method and emitted component output', async () => {
  const {report} = await stopped;
  const keys = edgeKeys(report);
  assert(keys.includes('output-emit|src/action-box.ts#ActionBox|this.selected'), keys.join('\n'));
  assert(keys.includes('output-subscription|selected|src/root.ts#AppRoot.handleSelection'), keys.join('\n'));
  assert(!keys.some(edge => edge.includes('rowClick')), keys.join('\n'));
});

test('an un-stopped click can reach its ancestor listener', async () => {
  const {report} = await bubbling;
  const keys = edgeKeys(report);
  assert(keys.some(edge => edge.includes('rowClick')), keys.join('\n'));
  assert(keys.includes('event-propagation|<button>|<div>'), keys.join('\n'));
});

test('a conditional stop keeps ancestor delivery conditional', async () => {
  const {report} = await conditional;
  const keys = edgeKeys(report);
  assert(keys.some(edge => edge.includes('rowClick')), keys.join('\n'));
  assert(report.conditions.some(condition => condition.expression === 'an inner listener may stop propagation'));
});
