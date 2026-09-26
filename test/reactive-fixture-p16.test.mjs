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

// R09-R11: the action bus, with the forms that must stay apart.
test('ngrx-apis: an effect, its returned action and a dispatch:false callback stay separate', async () => {
  const { report } = await analyzeFixture('ngrx-apis', { target: 'data-id=effectButton' });
  const keys = edgeKeys(report);
  // dispatch -> effect -> returned action -> reducer -> selector -> selectSignal -> display.
  assert(keys.includes('action-dispatch|src/panel.component.ts#SearchPanelComponent|src/actions.ts#searchRequested'));
  assert(keys.includes('action-consume|src/actions.ts#searchRequested|src/effects.ts#runSearch$'));
  assert(keys.includes('action-dispatch|src/effects.ts#runSearch$|src/actions.ts#searchSucceeded'));
  assert(keys.includes('action-consume|src/actions.ts#searchSucceeded|src/reducer.ts#searchReducer'));
  assert(keys.includes('state-write|src/reducer.ts#searchReducer|search'));
  assert(keys.includes('state-read|hits|<span>'));
  // dispatch:false: the callback's own dispatch is kept, the stream's value is not dispatched.
  assert(keys.includes('action-dispatch|src/effects.ts#auditSearch$|src/actions.ts#panelOpened'));
  assert(!keys.includes('action-dispatch|src/effects.ts#auditSearch$|src/actions.ts#searchSucceeded'));
  // An effect that was never registered is not running.
  assert.deepEqual(keys.filter(key => key.includes('ignored$')), [], keys.join('\n'));
  // ofType decides what each effect receives.
  assert(!keys.includes('action-consume|src/actions.ts#searchRequested|src/effects.ts#auditSearch$'));
});

test('ngrx-apis: a facade dispatch is still the dispatch, and a plain Subject.next is not one', async () => {
  const viaFacade = await analyzeFixture('ngrx-apis', { target: 'data-id=facadeButton' });
  const facadeKeys = edgeKeys(viaFacade.report);
  assert(facadeKeys.includes('call|src/panel.component.ts#SearchPanelComponent|facade.changeTerm'));
  assert(facadeKeys.includes('action-dispatch|src/facade.ts#SearchFacade|src/actions.ts#termChanged'));
  assert(facadeKeys.includes('action-consume|src/actions.ts#termChanged|src/reducer.ts#searchReducer'));

  const viaSubject = await analyzeFixture('ngrx-apis', { target: 'data-id=subjectButton' });
  const subjectKeys = edgeKeys(viaSubject.report);
  assert(subjectKeys.includes('state-write|src/panel.component.ts#SearchPanelComponent|this.local'));
  assert.deepEqual(subjectKeys.filter(key => key.startsWith('action-')), [],
    'a plain Subject.next was read as a Store dispatch');
});

// A13: a selector nobody's change reached is a background read, not a consequence of this operation.
test('ngrx-apis: a display fed by another slice is not attributed to this operation', async () => {
  const { report } = await analyzeFixture('ngrx-apis', { target: 'data-id=subjectButton' });
  assert.deepEqual(edgeKeys(report).filter(key => key.startsWith('state-read|')), [],
    'a selector display was attributed to an operation that writes no state');
});

// R05-R07: a Store built from a reusable feature, and the state APIs beside it.
test('signal-store-apis: a composed feature, an alias and the updater forms of patchState', async () => {
  const viaAlias = await analyzeFixture('signal-store-apis', { target: 'data-id=setTermButton' });
  const aliasKeys = edgeKeys(viaAlias.report);
  // The state comes from the reusable feature, and the alias import is the same Store.
  assert(aliasKeys.includes('call|src/catalog.component.ts#CatalogComponent|store.setTerm'));
  assert(aliasKeys.includes('state-write|click → setTerm()|term'));
  assert(aliasKeys.includes('state-read|term|<span>'));
  // A `withProps` value is a value, not state.
  assert.deepEqual(aliasKeys.filter(key => key.includes('pageSize')), [], aliasKeys.join('\n'));

  const viaUpdaters = await analyzeFixture('signal-store-apis', { target: 'data-id=clearButton' });
  const updaterKeys = edgeKeys(viaUpdaters.report);
  // Two updaters in argument order, each naming the key it replaces and nothing else.
  assert(updaterKeys.includes('state-write|click → clear()|term'));
  assert(updaterKeys.includes('state-write|click → clear()|hits'));
  assert.deepEqual(updaterKeys.filter(key => key.endsWith('|draft') && key.startsWith('state-write|')), [],
    'a key no updater touches was reported as written');
});

test('signal-store-apis: a snapshot read is no dependency and a deep mutation is no write', async () => {
  const snapshot = await analyzeFixture('signal-store-apis', { target: 'data-id=snapshotButton' });
  const snapshotKeys = edgeKeys(snapshot.report);
  assert(snapshotKeys.includes('state-write|click → snapshot()|seen'));
  assert.deepEqual(snapshotKeys.filter(key => key.startsWith('reactive-link|filters|')), [],
    'getState created a re-execution dependency');

  const mutate = await analyzeFixture('signal-store-apis', { target: 'data-id=mutateButton' });
  assert.deepEqual(edgeKeys(mutate.report).filter(key => key.startsWith('state-write|')), [],
    'a deep mutation was read as a notification');
});

// R08: what is defined but never entered must not be reported as having run.
test('signal-store-apis: an rxMethod that was never called writes nothing', async () => {
  const { report } = await analyzeFixture('signal-store-apis', { target: 'data-id=loadValueButton' });
  assert.deepEqual(edgeKeys(report).filter(key => key.endsWith('|hits')), [],
    'an uncalled rxMethod was treated as running');
  // The call this version cannot enter is a boundary, not a silent success.
  assert(report.edges.some(edge => edge.kind === 'boundary' && edge.confidence === 'unresolved'));
  assert.equal(report.status, 'partial');
});

// R12-R14: the bus instance a scope names decides who receives, and same-named types do not cross.
test('events-apis: self, parent and global scopes resolve to different bus instances', async () => {
  const busOf = async (target) => {
    const { report } = await analyzeFixture('events-apis', { target });
    const dispatch = report.edges.find(edge => edge.kind === 'event-dispatch');
    return {
      bus: dispatch.details.busId.value, scope: dispatch.details.scope.value,
      mode: dispatch.details.dispatchMode.value,
      consumers: edgeKeys(report).filter(key => key.startsWith('event-consume|')),
    };
  };
  // The panel provides the dispatcher, so a self-scoped dispatch is delivered on the panel's own bus.
  const self = await busOf('data-id=pageButton');
  assert.equal(self.scope, 'self');
  assert.equal(self.bus, 'src/panel.component.ts#PanelComponent');
  assert.deepEqual(self.consumers, ['event-consume|[Grid] pageChanged|src/grid.store.ts:10:5']);
  assert.equal(self.mode, 'named-dispatcher');

  // The same event type on the bus above it reaches no consumer of the local Store.
  const parent = await busOf('data-id=parentButton');
  assert.equal(parent.scope, 'parent');
  assert.notEqual(parent.bus, self.bus);
  assert.deepEqual(parent.consumers, [], 'a parent-scoped dispatch reached the local bus');

  // Neither does the global one, and `toScope` configures the same thing at the direct entry point.
  assert.deepEqual((await busOf('data-id=globalButton')).consumers, []);
  const scoped = await busOf('data-id=scopedButton');
  assert.equal(scoped.scope, 'parent');
  assert.equal(scoped.mode, 'explicit');
  assert.deepEqual(scoped.consumers, []);
});

test('events-apis: a single event creator reaches both reducers, ReducerEvents first', async () => {
  const { report } = await analyzeFixture('events-apis', { target: 'data-id=directButton' });
  const keys = edgeKeys(report);
  assert(keys.includes('event-dispatch|src/grid.component.ts#GridComponent|[Grid] row selected'));
  assert(keys.includes('event-consume|[Grid] row selected|src/grid.store.ts:11:5'));
  assert(keys.includes('event-consume|[Grid] row selected|src/grid.store.ts:17:5'));
  assert(keys.includes('state-write|src/grid.store.ts:11:5|selected'));
  assert(keys.includes('state-write|src/grid.store.ts:17:5|noted'));
  assert(keys.includes('state-read|noted|<span>'));
  // The direct entry point is not the named one; both forms stay distinguishable.
  assert.equal(report.edges.find(edge => edge.kind === 'event-dispatch').details.dispatchMode.value, 'explicit');
  // An event this dispatch does not carry is never delivered.
  assert(!keys.includes('event-consume|[Grid] pageChanged|src/grid.store.ts:10:5'));
});

// R15: the RxJS consumption APIs, and what each of them does and does not start.
test('rxjs-consume: a Promise-consumed join starts both requests and a subscribe starts one', async () => {
  const join = await analyzeFixture('rxjs-consume', { target: 'data-id=joinButton' });
  const joinKeys = edgeKeys(join.report);
  assert(joinKeys.includes('http-create|src/api.ts#MetricsApi|GET /api/metrics/sets'));
  assert(joinKeys.includes('http-create|src/api.ts#MetricsApi|GET /api/metrics/types'));
  assert(joinKeys.includes('http-consume|GET /api/metrics/sets|promise-consume'));
  assert(joinKeys.includes('state-write|click → loadBoth()|total'));
  assert(joinKeys.includes('state-read|total|<span>'));

  // Only the request this starting point reaches is reported.
  const first = await analyzeFixture('rxjs-consume', { target: 'data-id=firstButton' });
  const firstKeys = edgeKeys(first.report);
  assert(firstKeys.includes('http-consume|GET /api/metrics/sets|promise-consume'));
  assert.deepEqual(firstKeys.filter(key => key.includes('/api/metrics/types')), [],
    'a request this operation never reaches was attributed to it');
});

test('rxjs-consume: the success and the failure handler each keep their own notification', async () => {
  const { report } = await analyzeFixture('rxjs-consume', { target: 'data-id=tapButton' });
  const keys = edgeKeys(report);
  assert(keys.includes('http-consume|GET /api/metrics/tapped|subscribe'));
  // tapResponse writes one state on success and another on failure; both branches survive.
  assert(keys.includes('state-write|click → tapBoth()|total'));
  assert(keys.includes('state-write|click → tapBoth()|failed'));

  const mapped = await analyzeFixture('rxjs-consume', { target: 'data-id=mapButton' });
  const mappedKeys = edgeKeys(mapped.report);
  assert(mappedKeys.includes('state-write|click → mapBoth()|total'));
  assert.deepEqual(mappedKeys.filter(key => key.endsWith('|failed')), [],
    'the error branch of another operator was attributed to mapResponse');
});

// R02-R04: the interop boundary, the inputs the parent binds, and the write that goes back.
test('interop-apis: each bound input is its own relation and a model writes back to the parent', async () => {
  const { report } = await analyzeFixture('interop-apis', { target: 'data-id=commitButton' });
  const keys = edgeKeys(report);
  // Three inputs of one component stay three relations, named by the member each one reaches.
  assert(keys.includes('input-binding|FieldComponent|label'));
  assert(keys.includes('input-binding|FieldComponent|name'));
  assert(keys.includes('input-binding|FieldComponent|value'));
  // A model write is an implicit output back to the parent binding, and it needs an explicit emit.
  const emit = report.edges.find(edge => edge.kind === 'output-subscription');
  assert(emit, keys.join('\n'));
  assert.equal(emit.confidence, 'conditional');
  // The conditional read is a dependency only while the branch is taken.
  assert(keys.includes('reactive-link|value|summary'));
  assert(keys.includes('state-read|summary|<span>'));
  // These bindings are background inputs: they belong to neither the display path nor the operation.
  const inPathOrOperation = new Set([...report.paths.flatMap(item => item.edgeIds),
    ...report.operations.flatMap(item => item.edgeIds)]);
  for (const edge of report.edges.filter(item => item.kind === 'input-binding')) {
    assert(!inPathOrOperation.has(edge.id), 'an input binding was reported as a step of the operation');
  }
});

test('interop-apis: toSignal is a background subscription with its own lifetime and display read', async () => {
  const { report } = await analyzeFixture('interop-apis', { target: 'data-id=commitButton' });
  const keys = edgeKeys(report);
  assert(keys.includes('reactive-link|clock.stream|tick'));
  assert(keys.includes('state-read|tick|<span>'));
  assert(!keys.includes('reactive-link|value|tick'),
    'the selected model write was treated as an emission from an unrelated Observable');

  const subscription = report.edges.find(edge => edge.kind === 'reactive-link' &&
    edge.details.operator?.value === 'angular/toSignal');
  assert(subscription, keys.join('\n'));
  assert.equal(subscription.details.scheduling.value, 'subscription');
  const operationEdges = new Set(report.operations.flatMap(item => item.edgeIds));
  assert(!operationEdges.has(subscription.id),
    'a creation-time subscription was attributed to the selected click operation');

  const conditions = new Map(report.conditions.map(item => [item.id, item]));
  const text = (id) => {
    const condition = conditions.get(id);
    if (!condition) return '';
    if (condition.kind === 'predicate') return condition.expression;
    if (condition.kind === 'all' || condition.kind === 'any') return condition.operandIds.map(text).join(' && ');
    return condition.kind;
  };
  assert.match(text(subscription.conditionId), /starts when the toSignal call runs/);
  assert.match(text(subscription.conditionId), /ends when the owning injection context is destroyed/);
});

test('interop-apis: toObservable connects the selected Signal write at a change-detection boundary', async () => {
  const { report } = await analyzeFixture('interop-apis', { target: 'data-id=commitButton' });
  const edge = report.edges.find(item => item.kind === 'reactive-link' &&
    item.details.operator?.value === 'angular/toObservable');
  assert(edge, edgeKeys(report).join('\n'));
  assert.equal(edgeKeys(report).includes('reactive-link|value|value$'), true);
  assert.equal(edge.details.scheduling.value, 'change-detection boundary');
  const condition = report.conditions.find(item => item.id === edge.conditionId);
  assert(condition);
  assert.match(condition.expression, /each notification follows a change-detection boundary, not every set/);
  assert.equal(report.nodes.find(item => item.id === edge.to)?.kind, 'operation',
    'the adapter output is an Observable operation, not another Signal state');
});

test('interop-apis: the after-render phase and the explicit destroy stay on their own effect', async () => {
  const bump = await analyzeFixture('interop-apis', { target: 'data-id=bumpButton' });
  const afterRender = bump.report.edges.find(edge => edge.kind === 'reactive-link' &&
    edge.details.consumer?.value === 'angular/afterRenderEffect');
  assert(afterRender, edgeKeys(bump.report).join('\n'));
  assert.equal(afterRender.details.scheduling.value, 'after-render');

  const commit = await analyzeFixture('interop-apis', { target: 'data-id=commitButton' });
  const changeDetection = commit.report.edges.find(edge => edge.kind === 'reactive-link' &&
    edge.details.consumer?.value === 'angular/effect');
  assert.equal(changeDetection.details.scheduling.value, 'change-detection');
  // The explicitly destroyed effect records where its lifetime ends.
  const conditions = new Map(commit.report.conditions.map(item => [item.id, item]));
  const text = (id) => {
    const condition = conditions.get(id);
    if (!condition) return '';
    if (condition.kind === 'predicate') return condition.expression;
    if (condition.kind === 'all' || condition.kind === 'any') return condition.operandIds.map(text).join(' && ');
    return condition.kind;
  };
  assert(text(changeDetection.conditionId).includes('explicitly destroyed at'),
    text(changeDetection.conditionId));
});

// R05/R06: a Store that is provided and never injected does not exist, so nothing of it may appear.
test('signal-store-apis: a Store that was only provided is not running', async () => {
  const { report } = await analyzeFixture('signal-store-apis', { target: 'data-id=shoutButton' });
  const keys = edgeKeys(report);
  assert.deepEqual(keys.filter(key => key.includes('idle') || key.includes('touch')), [],
    'a Store that is only provided was treated as created');
  // The class-extends form is catalogued, but its method call is where this version stops.
  assert(report.edges.some(edge => edge.kind === 'boundary' && edge.confidence === 'unresolved'));
  assert.equal(report.status, 'partial');
});
