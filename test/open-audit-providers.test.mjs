import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeFixture} from './fixtures/harness.mjs';

const active = analyzeFixture('open-audit-providers', {target: 'data-id=activeTarget', event: 'click'});
const inactive = analyzeFixture('open-audit-providers', {target: 'data-id=inactiveTarget', event: 'click'});

test('makeEnvironmentProviders, array spread, object spread and shorthand register the leaf reducer on the selected route', async () => {
  const {report} = await active;
  const consumers = report.edges.filter(edge => edge.kind === 'action-consume');
  assert(consumers.some(edge => edge.details.consumer?.value?.includes('countReducer')),
    JSON.stringify(consumers.map(edge => edge.details)));
  assert(!report.edges.some(edge => edge.kind === 'boundary' &&
    edge.details.reason?.value?.includes('countReducer has no active provideState')));
});

test('a reducer map from a sibling route is not active for the selected route', async () => {
  const {report} = await inactive;
  assert(!report.edges.some(edge => edge.kind === 'action-consume' &&
    edge.details.consumer?.value?.includes('countReducer')));
  assert(report.edges.some(edge => edge.kind === 'boundary' &&
    edge.details.reason?.value?.includes('countReducer has no active provideState')));
});
