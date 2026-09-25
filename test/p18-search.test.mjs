import assert from 'node:assert/strict';
import {test} from 'node:test';
import {analyzeFixture, edgeKeys, edgesOfKind} from './fixtures/harness.mjs';

const inputReport = analyzeFixture('search-scenario', {target: 'data-id=searchInputField', event: 'input'});

test('P18-01 input follows Subject.next through debounce and both filters to the output', async () => {
  const {report} = await inputReport;
  const keys = edgeKeys(report);
  for (const edge of [
    'dom-listener|<input>|input → enableSearchOnSubmit()? validateValue() :onValueChange()',
    'state-write|src/search.ts#SearchComponent|this.value$',
    'reactive-link|value$|ngOnInit',
    'reactive-link|ngOnInit|tap',
    'reactive-link|tap|debounce',
    'reactive-link|debounce|filter',
    'reactive-link|filter|filter',
    'output-emit|onValueChange|valueChanged',
  ]) assert(keys.includes(edge), `${edge}\n${keys.join('\n')}`);
  const predicates = report.conditions.filter(condition => condition.kind === 'predicate')
    .map(condition => condition.expression);
  assert(predicates.some(text => text.includes('val.length === 0 || val !== this.value()')));
  assert(predicates.some(text => text.includes('val.length >= this.minimumChars() || val.length === 0')));
  const values = edgesOfKind(report, 'output-emit').map(edge => edge.details.valueExpression.value);
  assert(values.includes('value') && values.includes("''"), values.join(', '));
  assert.deepEqual(keys.filter(key => key.startsWith('http-')), []);
});
