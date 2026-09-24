import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { capabilities } from '../dist/adapters/reactive/index.js';
import { contractIds, fixturedCases, reactiveCases, unfixturedCases } from './contracts/reactive-cases.ts';
import { fixtureRoot, repoRoot } from './fixtures/harness.mjs';

const ledgerFile = path.join(repoRoot, 'test/contracts/reactive-cases.ts');

// P16-03
test('the ledger transcribes every contract with its package, export, version and expectation', () => {
  const cases = reactiveCases();
  assert(cases.length > 0);
  for (const id of contractIds) {
    assert(cases.some(item => item.contract === id), `${id} has no case in the ledger`);
  }
  const ids = cases.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, 'subcase ids are not unique');
  for (const item of cases) {
    assert(item.id.startsWith(`${item.contract}/`), `${item.id} is filed under ${item.contract}`);
    assert(item.package.length > 0, `${item.id} names no package`);
    assert(item.expectation.trim().length > 0, `${item.id} states no expectation`);
    assert(/^\d+\.\d+\.\d+$/.test(item.version), `${item.id} names no target version`);
    // A whole module, or a form that has no single export of its own, may leave `export` empty.
    if (item.form !== 'module' && item.form !== 'form') {
      assert(item.export !== null, `${item.id} names no export`);
    }
    if (item.member !== null) assert(item.export !== null, `${item.id} has a member without an export`);
    // A case is either covered by a fixture or carries the reason it is not; never silently neither.
    assert.equal(item.fixture === null, item.missingFixture !== null,
      `${item.id} must have either a fixture or a recorded reason, not both or neither`);
    if (item.fixture) assert(item.fixture.target.length > 0, `${item.id} names no fixture target`);
  }
});

// P16-03: rows with several APIs or forms each get their own subcase.
test('rows with several APIs or forms carry one subcase each', () => {
  const idsOf = (contract) => reactiveCases().filter(item => item.contract === contract).map(item => item.id);
  const expectations = {
    R01: ['R01/signal', 'R01/signal.read', 'R01/signal.set', 'R01/signal.update', 'R01/signal.asReadonly'],
    R02: ['R02/computed', 'R02/linkedSignal', 'R02/untracked'],
    R03: ['R03/effect', 'R03/afterRenderEffect'],
    R04: ['R04/input', 'R04/model', 'R04/toSignal', 'R04/toObservable', 'R04/Store.selectSignal'],
    R05: ['R05/signalStore', 'R05/signalStoreFeature', 'R05/withFeature'],
    R06: ['R06/withState', 'R06/withComputed', 'R06/withLinkedState', 'R06/withProps', 'R06/withMethods', 'R06/withHooks'],
    R07: ['R07/signalState', 'R07/getState', 'R07/watchState', 'R07/deepComputed'],
    R08: ['R08/rxMethod.value', 'R08/rxMethod.signal', 'R08/rxMethod.observable',
      'R08/signalMethod.value', 'R08/signalMethod.signal'],
    R10: ['R10/Store.dispatch.thunk', 'R10/Store.next'],
    R11: ['R11/createEffect', 'R11/ofType', 'R11/createEffect.dispatch-false'],
    R12: ['R12/event', 'R12/eventGroup', 'R12/injectDispatch', 'R12/Dispatcher.dispatch'],
    R13: ['R13/withReducer', 'R13/on', 'R13/Events.on', 'R13/ReducerEvents.on', 'R13/withEventHandlers'],
    R14: ['R14/provideDispatcher', 'R14/scope.self', 'R14/scope.parent', 'R14/scope.global',
      'R14/toScope', 'R14/mapToScope'],
  };
  for (const [contract, required] of Object.entries(expectations)) {
    const present = idsOf(contract);
    for (const id of required) assert(present.includes(id), `${id} is missing from the ledger`);
  }
});

// P16-04
test('the ledger also covers the reducer/selector APIs and the RxJS consumption APIs', () => {
  const ids = new Set(reactiveCases().map(item => item.id));
  // From the expected-value column of R09.
  for (const id of ['R09/createReducer', 'R09/on', 'R09/createSelector', 'R09/createFeature',
    'R09/createFeatureSelector', 'R09/Store.select']) {
    assert(ids.has(id), `${id} is missing; the expected-value column is part of the ledger`);
  }
  // Added in the body of §7.6 for the R08/R15 RxJS routes.
  for (const id of ['R15/rxjs.of', 'R15/rxjs.from', 'R15/rxjs.lastValueFrom', 'R15/rxjs.firstValueFrom',
    'R15/rxjs.forkJoin', 'R15/rxjs.distinctUntilChanged', 'R15/ngrx-operators.tapResponse',
    'R15/ngrx-operators.mapResponse']) {
    assert(ids.has(id), `${id} is missing; the RxJS consumption APIs are part of the ledger`);
  }
});

// P16-05
test('the ledger is written by hand and is not a projection of the implementation registry', async () => {
  const text = await readFile(ledgerFile, 'utf8');
  assert(!/from\s+['"].*capabilities/.test(text), 'the ledger imports the implementation registry');
  assert(!/from\s+['"].*\/dist\//.test(text), 'the ledger reads the built implementation');
  // If it were generated from the registry it could not name an API the registry does not hold.
  const registered = new Set(capabilities().map(item => `${item.module}|${item.export ?? ''}|${item.member ?? ''}`));
  const beyond = reactiveCases().filter(item =>
    !registered.has(`${item.package}|${item.export ?? ''}|${item.member ?? ''}`));
  assert(beyond.length > 0, 'every ledger case exists in the registry, so the two are not independent');
});

// P16-03: a fixture a case names has to exist.
test('every fixture the ledger names exists on disk', async () => {
  for (const item of fixturedCases()) {
    const directory = path.join(fixtureRoot, item.fixture.id);
    const found = await stat(directory).then(entry => entry.isDirectory(), () => false);
    assert(found, `${item.id} names the missing fixture ${item.fixture.id}`);
  }
  // The unfixtured cases are the recorded gap, not a silent omission.
  for (const item of unfixturedCases()) {
    assert(item.missingFixture.trim().length > 0, `${item.id} has no fixture and no reason`);
    // A case a fixture already demonstrates names that fixture, so the gap is a result and not a plan.
    if (item.demonstratedBy) {
      const directory = path.join(fixtureRoot, item.demonstratedBy.id);
      const found = await stat(directory).then(entry => entry.isDirectory(), () => false);
      assert(found, `${item.id} names the missing fixture ${item.demonstratedBy.id}`);
    }
  }
});

/** The second column of the §7.6 table, as the design writes it. */
async function designTableApis() {
  const text = await readFile(path.join(repoRoot, 'x-structure.md'), 'utf8');
  const section = text.slice(text.indexOf('#### API と fixture の対応表'));
  const rows = section.split('\n').filter(line => /^\| R\d\d \|/.test(line));
  const table = new Map();
  for (const row of rows) {
    const [, id, detected] = row.split('|').map(cell => cell.trim());
    const names = [];
    const modules = [];
    for (const match of detected.matchAll(/`([^`]+)`/g)) {
      const raw = match[1].trim();
      // `@ngrx/signals/entities` is one module specifier; `set/update/asReadonly` is three API names.
      if (raw.startsWith('@')) { modules.push(raw); continue; }
      for (const part of raw.split('/')) {
        // `Store.dispatch(action)` names the member `dispatch`; `dispatch:false` names an option.
        const name = part.replace(/\(.*$/, '').replace(/^.*\./, '').replace(/:/g, '-').trim();
        if (name) names.push(name);
      }
    }
    table.set(id, { names, modules });
  }
  return table;
}

// P16-13
test('every API the design table names is transcribed into the ledger under the same contract', async () => {
  const table = await designTableApis();
  assert.equal(table.size, contractIds.length, 'the §7.6 table does not hold one row per contract');
  const missing = [];
  for (const [contract, row] of table) {
    const cases = reactiveCases().filter(item => item.contract === contract);
    for (const name of row.names) {
      const found = cases.some(item => item.export === name || item.member === name ||
        item.id.endsWith(`/${name}`) || item.id.includes(`/${name}.`) || item.id.includes(`.${name}`));
      if (!found) missing.push(`${contract}: ${name}`);
    }
    for (const module of row.modules) {
      if (!cases.some(item => item.package === module)) missing.push(`${contract}: ${module}`);
    }
  }
  assert.deepEqual(missing, [], `the design table names APIs the ledger does not carry: ${missing.join(', ')}`);
});

/**
 * P16-12 the full inventory, transcribed a second time and independently of the ledger. Removing or
 * renaming a subcase to make a run green breaks this list, so the deletion is a deliberate edit that a
 * reviewer sees as a change to the design contract.
 */
const requiredSubcases = [
  'R01/signal', 'R01/signal.read', 'R01/signal.set', 'R01/signal.update', 'R01/signal.asReadonly',
  'R01/signal.via-service',
  'R02/computed', 'R02/computed.equal', 'R02/linkedSignal', 'R02/untracked', 'R02/conditional-read',
  'R03/effect', 'R03/afterRenderEffect', 'R03/effect.onCleanup', 'R03/EffectRef.destroy', 'R03/effect.await-read',
  'R04/input', 'R04/input.required', 'R04/model', 'R04/toSignal', 'R04/toObservable', 'R04/Store.selectSignal',
  'R05/signalStore', 'R05/signalStore.class-extends', 'R05/signalStoreFeature', 'R05/withFeature',
  'R05/signalStore.alias', 'R05/signalStore.provider-instance',
  'R06/withState', 'R06/withComputed', 'R06/withLinkedState', 'R06/withProps', 'R06/withMethods',
  'R06/withHooks', 'R06/withHooks.not-created',
  'R07/signalState', 'R07/patchState.object', 'R07/patchState.updater', 'R07/patchState.multiple',
  'R07/getState', 'R07/watchState', 'R07/deepComputed', 'R07/deep-mutation',
  'R08/rxMethod.value', 'R08/rxMethod.signal', 'R08/rxMethod.observable', 'R08/rxMethod.uncalled',
  'R08/signalMethod.value', 'R08/signalMethod.signal', 'R08/signalMethod.no-observable',
  'R09/Store.dispatch', 'R09/Store.dispatch.via-facade', 'R09/Store.dispatch.action-object', 'R09/createAction',
  'R09/createActionGroup', 'R09/createReducer', 'R09/on', 'R09/createSelector', 'R09/createFeature',
  'R09/createFeatureSelector', 'R09/Store.select', 'R09/provideStore', 'R09/provideState', 'R09/StoreModule',
  'R09/creator-call-only',
  'R10/Store.dispatch.thunk', 'R10/Store.dispatch.thunk-injector', 'R10/Store.next', 'R10/Subject.next',
  'R11/createEffect', 'R11/ofType', 'R11/createEffect.returned-action', 'R11/createEffect.dispatch-false',
  'R11/provideEffects', 'R11/EffectsModule',
  'R12/event', 'R12/eventGroup', 'R12/injectDispatch', 'R12/Dispatcher.dispatch',
  'R13/withReducer', 'R13/on', 'R13/Events.on', 'R13/ReducerEvents.on', 'R13/withEventHandlers',
  'R13/withEventHandlers.redelivery',
  'R14/provideDispatcher', 'R14/scope.self', 'R14/scope.parent', 'R14/scope.global', 'R14/toScope',
  'R14/mapToScope', 'R14/cross-bus',
  'R15/log-store', 'R15/settings-store', 'R15/rxjs.lastValueFrom', 'R15/rxjs.firstValueFrom',
  'R15/rxjs.forkJoin', 'R15/rxjs.of', 'R15/rxjs.from', 'R15/rxjs.distinctUntilChanged',
  'R15/ngrx-operators.tapResponse', 'R15/ngrx-operators.mapResponse',
  'R16/signals-entities', 'R16/signals-resource', 'R16/component-store', 'R16/angular-resource',
  'R16/angular-rxResource', 'R16/angular-httpResource', 'R16/signals-events-withEffects',
  'R16/unknown-custom-feature',
];

// P16-12
test('no subcase is dropped, and only R16 may be an unsupported range', () => {
  const present = new Set(reactiveCases().map(item => item.id));
  const dropped = requiredSubcases.filter(id => !present.has(id));
  assert.deepEqual(dropped, [], `the ledger no longer carries: ${dropped.join(', ')}`);
  // New subcases are welcome; the inventory above is the floor, not the ceiling.
  assert(present.size >= requiredSubcases.length);
  // Moving a required API to unsupported would hide it; only the R16 row may be unsupported.
  for (const item of reactiveCases()) {
    if (item.kind === 'unsupported') assert.equal(item.contract, 'R16', `${item.id} was moved to unsupported`);
    if (item.contract === 'R16') assert.equal(item.kind, 'unsupported', `${item.id} claims support`);
  }
});
