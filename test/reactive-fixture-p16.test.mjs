import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { analyzeFixture, edgeKeys, fixtureRoot } from './fixtures/harness.mjs';

/**
 * §10 the four cases where no effect and no API stands between the UI operation and the display. Each
 * one is its own fixture and its own required edge set, so passing one of them never covers another.
 */
const noEffectCases = [
  {
    id: 'signal-write',
    title: 'UI → signal.update → 表示',
    target: 'data-id=incrementButton',
    sources: ['src/counter.ts'],
    edges: [
      'bootstrap|bootstrapApplication(src/main.ts)|src/app.ts#AppComponent',
      'display-parent|CounterComponent|<button>',
      'display-parent|bootstrapApplication(src/main.ts)|CounterComponent',
      'dom-listener|<button>|click → increment()',
      'reactive-link|count|doubled',
      'state-read|count|<span>',
      'state-read|doubled|<span>',
      'state-write|click → increment()|count',
      'template-use|src/app.ts#AppComponent|CounterComponent',
    ],
  },
  {
    id: 'signal-store-patch',
    title: 'UI → SignalStore method → patchState → 表示',
    target: 'data-id=filterField',
    sources: ['src/store.ts', 'src/filter.ts'],
    edges: [
      'bootstrap|bootstrapApplication(src/main.ts)|src/app.ts#AppComponent',
      'call|src/filter.ts#FilterComponent|store.setTerm',
      'display-parent|FilterComponent|<input>',
      'display-parent|bootstrapApplication(src/main.ts)|FilterComponent',
      'dom-listener|<input>|input → onInput($event)',
      'state-read|term|<span>',
      'state-write|input → onInput($event)|term',
      'template-use|src/app.ts#AppComponent|FilterComponent',
    ],
  },
  {
    id: 'store-dispatch',
    title: 'UI → Store.dispatch → reducer → selectSignal → 表示',
    target: 'data-id=termField',
    sources: ['src/reducer.ts', 'src/filter.ts'],
    edges: [
      'action-consume|src/actions.ts#termChanged|src/reducer.ts#searchReducer',
      'action-dispatch|src/filter.ts#FilterComponent|src/actions.ts#termChanged',
      'bootstrap|bootstrapApplication(src/main.ts)|src/app.ts#AppComponent',
      'display-parent|FilterComponent|<input>',
      'display-parent|bootstrapApplication(src/main.ts)|FilterComponent',
      'dom-listener|<input>|input → onInput($event)',
      'reactive-link|src/reducer.ts#selectTerm|src/filter.ts:15:19',
      'state-read|search|src/reducer.ts#selectSearch',
      'state-read|search|src/reducer.ts#selectTerm',
      'state-read|term|<span>',
      'state-write|src/reducer.ts#searchReducer|search',
      'template-use|src/app.ts#AppComponent|FilterComponent',
    ],
  },
  {
    id: 'events-reducer',
    title: 'UI → injectDispatch → withReducer → 表示',
    target: 'data-id=termField',
    sources: ['src/store.ts', 'src/filter.ts'],
    edges: [
      'bootstrap|bootstrapApplication(src/main.ts)|src/app.ts#AppComponent',
      'display-parent|FilterComponent|<input>',
      'display-parent|bootstrapApplication(src/main.ts)|FilterComponent',
      'dom-listener|<input>|input → onInput($event)',
      'event-consume|[Search] termChanged|src/store.ts:9:15',
      'event-dispatch|src/filter.ts#FilterComponent|[Search] termChanged',
      'state-read|term|<span>',
      'state-write|src/store.ts:9:15|term',
      'template-use|src/app.ts#AppComponent|FilterComponent',
    ],
  },
];

// P16-09
for (const item of noEffectCases) {
  test(`${item.id}: ${item.title} without an effect or an API`, async () => {
    // The fixture itself must contain no effect API, or the case would not be the one it claims to be.
    for (const file of item.sources) {
      const text = await readFile(path.join(fixtureRoot, item.id, file), 'utf8');
      for (const api of ['effect(', 'afterRenderEffect(', 'watchState(', 'createEffect(', 'withEventHandlers(',
        'rxMethod(', 'HttpClient']) {
        assert(!text.includes(api), `${item.id}/${file} uses ${api}; this case must reach the display without it`);
      }
    }
    const { report } = await analyzeFixture(item.id, { target: item.target });
    assert.deepEqual(edgeKeys(report).sort(), [...item.edges].sort());
    // Nothing in the report may claim an effect or a request took part.
    assert.deepEqual(report.nodes.filter(node => node.kind === 'effect' || node.kind === 'http'), []);
    assert.deepEqual(report.edges.filter(edge => edge.kind.startsWith('http-')), []);
    // The write still reaches the screen: some state is read by an element of a template.
    const displayed = report.edges.filter(edge => edge.kind === 'state-read' &&
      report.nodes.find(node => node.id === edge.to)?.kind === 'element');
    assert(displayed.length > 0, 'no state reaches an element of a template');
  });
}

// P16-10
test('effect-api: a request feeding a state update leaves the direct write in place as well', async () => {
  const { report } = await analyzeFixture('effect-api', { target: 'data-id=queryField' });
  const keys = edgeKeys(report).sort();
  assert.deepEqual(keys, [
    'bootstrap|bootstrapApplication(src/main.ts)|src/app.ts#AppComponent',
    'boundary|src/api.ts#SearchApi|boundary',
    'boundary|src/search.ts#SearchComponent|boundary',
    'call|src/search.ts#SearchComponent|api.search',
    'display-parent|SearchComponent|<input>',
    'display-parent|bootstrapApplication(src/main.ts)|SearchComponent',
    'dom-listener|<input>|input → onInput($event)',
    'http-consume|GET /api/search|subscribe',
    'http-create|src/api.ts#SearchApi|GET /api/search',
    'state-read|results|<span>',
    'state-read|term|<span>',
    'state-write|input → onInput($event)|results',
    'state-write|input → onInput($event)|term',
    'template-use|src/app.ts#AppComponent|SearchComponent',
  ]);
  // Both routes survive: the direct write, and the one the request feeds.
  assert(keys.includes('state-write|input → onInput($event)|term'), 'the direct state write was dropped');
  assert(keys.includes('state-write|input → onInput($event)|results'), 'the request-fed state write was dropped');
  assert(keys.some(key => key.startsWith('http-create|')), 'the request itself was dropped');
  // The request stops where the analysis stops, and the report says so instead of claiming completeness.
  assert.equal(report.status, 'partial');
  assert(report.edges.some(edge => edge.kind === 'boundary' && edge.confidence === 'unresolved'));
});

// P16-08: an unsupported range passes on the boundary, the partial status and the diagnostic — and on
// nothing else. A word being present in the source, a count matching or a refreshed snapshot is not a pass.
const unsupportedTargets = [
  { target: 'data-id=entitiesButton', code: 'unsupported-reactive-api', mentions: '@ngrx/signals/entities' },
  { target: 'data-id=resourceExtensionButton', code: 'unsupported-reactive-api', mentions: '@ngrx/signals/resource' },
  { target: 'data-id=componentStoreButton', code: 'unsupported-reactive-api', mentions: '@ngrx/component-store' },
  { target: 'data-id=angularResourceButton', code: 'unsupported-reactive-api', mentions: 'resource' },
  { target: 'data-id=rxResourceButton', code: 'unsupported-reactive-api', mentions: 'rxResource' },
  { target: 'data-id=httpResourceButton', code: 'unsupported-reactive-api', mentions: 'httpResource' },
  { target: 'data-id=withEffectsButton', code: 'unsupported-reactive-api', mentions: 'withEffects' },
  { target: 'data-id=unknownFeatureButton', code: 'unsupported-store-feature', mentions: 'ToolkitStore' },
];

for (const item of unsupportedTargets) {
  test(`unsupported-apis ${item.target}: boundary, partial and a diagnostic with a stop reason`, async () => {
    const { report } = await analyzeFixture('unsupported-apis', { target: item.target });
    const diagnosed = report.diagnostics.filter(entry => entry.code === item.code);
    assert(diagnosed.length > 0, `no ${item.code} diagnostic`);
    assert(diagnosed.some(entry => entry.message.includes(item.mentions)),
      `the diagnostic does not name ${item.mentions}: ${diagnosed.map(entry => entry.message).join(' | ')}`);
    // The range has to say where the trace stopped; a message alone is not a pass.
    assert(diagnosed.every(entry => (entry.stopReason ?? '').trim().length > 0),
      'a diagnostic for an unsupported range records no stop reason');
    assert.equal(report.status, 'partial');
    assert(report.nodes.some(node => node.kind === 'boundary'), 'the trace does not end at a boundary node');
    assert(report.edges.some(edge => edge.kind === 'boundary' && edge.confidence === 'unresolved'),
      'no unresolved boundary edge marks where the trace stopped');
    // The unsupported API is never read as a supported one: no state or delivery relation is invented.
    assert.deepEqual(report.edges.filter(edge => ['state-write', 'action-consume', 'event-consume']
      .includes(edge.kind)), [], 'an unsupported range produced a state or delivery relation');
  });
}

// R02/R03: the tracking rules decide what re-runs, and a write is never dropped because of them.
test('signal-apis: untracked reads are no dependency while the writes they guard remain', async () => {
  const { report } = await analyzeFixture('signal-apis', { target: 'data-id=silentButton' });
  const keys = edgeKeys(report);
  assert(keys.includes('state-write|click → countSilently()|hits'));
  assert(keys.includes('state-read|hits|<span>'));
  // Reading `term` inside untracked must not make this operation a cause of anything that tracks it.
  assert.deepEqual(keys.filter(key => key.startsWith('reactive-link|term|')), [], keys.join('\n'));
});

test('signal-apis: a derived value, a read-only alias and an effect each keep their own conditions', async () => {
  const { report } = await analyzeFixture('signal-apis', { target: 'data-id=termField' });
  const conditions = new Map(report.conditions.map(item => [item.id, item]));
  const text = (id) => {
    const condition = conditions.get(id);
    if (!condition) return '';
    if (condition.kind === 'predicate') return condition.expression;
    if (condition.kind === 'all' || condition.kind === 'any') return condition.operandIds.map(text).join(' && ');
    return condition.kind;
  };
  const linkTo = (name) => report.edges.find(edge => edge.kind === 'reactive-link' &&
    edge.details.consumer?.value === name);
  // A custom equal decides whether consumers re-run at all, and it is written out as it was read.
  assert(text(linkTo('upper').conditionId).includes('equal:'), text(linkTo('upper').conditionId));
  // A linked value is recomputed and can also be replaced by an explicit write.
  assert(text(linkTo('draft').conditionId).includes('explicit write'), text(linkTo('draft').conditionId));
  // A read-only alias is the same state, not a second one.
  assert(text(linkTo('currentTerm').conditionId).includes('same state'));
  // The effect keeps its lifetime and its registered cleanup.
  const effect = linkTo('angular/effect');
  assert.equal(report.nodes.find(node => node.id === effect.to).kind, 'effect');
  assert(text(effect.conditionId).includes('cleanup registered at'), text(effect.conditionId));
  assert.equal(effect.details.scheduling.value, 'change-detection');
});
