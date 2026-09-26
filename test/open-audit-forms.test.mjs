import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeFixture, edgeKeys} from './fixtures/harness.mjs';

const modelChange = analyzeFixture('open-audit-forms', {target: 'data-id=form-bound', event: 'ngModelChange'});
const input = analyzeFixture('open-audit-forms', {target: 'data-id=form-bound', event: 'input'});
const plainInput = analyzeFixture('open-audit-forms', {target: 'data-id=plain-input', event: 'input'});

test('ngModelChange is a Forms view-to-model output, separate from the DOM input event', async () => {
  const {report} = await modelChange;
  const keys = edgeKeys(report);
  const subscriptions = report.edges.filter(edge => edge.kind === 'output-subscription');
  assert(subscriptions.some(edge => edge.details.output.value.includes('#NgModel.update')));
  assert.equal(subscriptions.length, 1);
  assert(!keys.some(key => key.startsWith('dom-listener|')), keys.join('\n'));
  assert(report.conditions.some(condition => condition.expression?.includes('view-to-model update')));
  assert(report.conditions.some(condition => condition.expression?.includes('ControlValueAccessor')));
  assert(!report.conditions.some(condition => condition.expression?.includes('DOM event does not trigger it')));
});

test('DOM input remains a separate event and has no NgModel output on a plain input', async () => {
  const formBound = await input;
  const plain = await plainInput;
  assert(edgeKeys(formBound.report).some(key => key.startsWith('dom-listener|')));
  assert(!edgeKeys(plain.report).some(key => key.startsWith('output-subscription|')));
  assert(edgeKeys(plain.report).some(key => key.startsWith('dom-listener|')));
});
