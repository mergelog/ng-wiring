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

test('P18-02 this use takes the default false branch and retains timer(0) as asynchronous', async () => {
  const {report} = await inputReport;
  const bindings = edgesOfKind(report, 'input-binding');
  const bound = name => bindings.find(edge => edge.toLabel === name && edge.fromLabel === 'SearchComponent');
  assert.equal(bound('enableSearchOnSubmit')?.details.expression.value, 'false');
  assert.equal(bound('minimumChars')?.details.expression.value, '1');
  assert.equal(bound('debounceTime')?.details.expression.value, '0');
  assert(!report.edges.some(edge => edge.details?.callee?.value === 'validateValue'));
  const debounce = edgesOfKind(report, 'reactive-link').find(edge => edge.toLabel === 'debounce');
  assert.equal(debounce?.details.scheduling.value, 'timer');
  const predicates = report.conditions.filter(condition => condition.kind === 'predicate')
    .map(condition => condition.expression);
  assert(predicates.some(text => text.includes('timer(0)')));
  assert(predicates.some(text => text.includes('timer must fire after its configured delay')));
});

test('P18-03 the search is projected into the section while the form declares its bindings', async () => {
  const {report} = await inputReport;
  const keys = edgeKeys(report);
  assert(keys.includes('projection|ng-content select="[search-button]"|SearchComponent'));
  assert(keys.includes('template-use|src/container.ts#ExperimentInfoHyperParametersFormContainerComponent|SearchComponent'));
  assert(!keys.includes('template-use|src/section.ts#EditableSectionComponent|SearchComponent'));
  const output = edgesOfKind(report, 'output-subscription').find(edge => edge.fromLabel === 'valueChanged');
  assert.equal(output?.toLabel, 'src/container.ts#ExperimentInfoHyperParametersFormContainerComponent.searchTable');
  const binding = edgesOfKind(report, 'input-binding').find(edge => edge.toLabel === 'minimumChars');
  assert.equal(binding?.details.owner.value, 'src/container.ts#ExperimentInfoHyperParametersFormContainerComponent');
});
