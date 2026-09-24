import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, symlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveToolchain } from '../dist/workspace/toolchain.js';
import { createContext, selectProjects } from '../dist/workspace/context.js';
import { capabilities, capabilityById, capabilitiesForContract, CONTRACT_IDS, SUPPORTED_PACKAGE_VERSIONS,
  auditCapabilities, moduleIdForFile, unsupportedImports, matchIdentifier } from '../dist/adapters/reactive/index.js';
import { modelAudit, stepKindFor, storeMemberStepKind } from '../dist/adapters/reactive/index.js';
import { analyzeSignals, analyzeReactiveMethods } from '../dist/adapters/reactive/index.js';
import { catalogSignalStores, resolveStoreReference, storeLifetime } from '../dist/adapters/reactive/index.js';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(source, check) {
  const root = await mkdtemp(path.join(tmpdir(), 'ngwi-p11-'));
  try {
    await mkdir(path.join(root, 'src'));
    await symlink(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await writeFile(path.join(root, 'angular.json'), JSON.stringify({ projects: { app: { projectType: 'application', root: '',
      targets: { build: { options: { tsConfig: 'tsconfig.app.json', browser: 'src/main.ts' } } } } } }));
    await writeFile(path.join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: true, strict: true,
      experimentalDecorators: false,
    }, files: ['src/main.ts'] }));
    const files = typeof source === 'string' ? { 'main.ts': source } : source;
    for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, 'src', name), text);
    const toolchain = await resolveToolchain(root);
    const context = await createContext({ workspaceRoot: root, project: (await selectProjects(root, toolchain))[0], toolchain });
    const t = context.toolchain.typescript;
    const file = context.program.getSourceFiles().find(f => f.fileName.endsWith('/src/main.ts'));
    await check({ context, file, t });
  } finally { await rm(root, { recursive: true, force: true }); }
}

// P11-01 / P11-02 / P11-14
test('every contract has registered matchers, semantic models, and a framework split', () => {
  for (const id of CONTRACT_IDS) assert(capabilitiesForContract(id).length > 0, `${id} has no registered matcher`);
  assert.equal(modelAudit().length, 0, modelAudit().join('; '));
  const supported = capabilities().filter(item => item.support === 'supported');
  // Every reactive-system API names its framework; the shared RxJS consumption APIs belong to none.
  // `@ngrx/operators` ships RxJS operators usable with any of the reactive systems, so it names none either.
  const frameworkFree = ['rxjs', '@ngrx/operators'];
  assert(supported.every(item => item.framework || frameworkFree.includes(item.module)),
    `a supported matcher has no framework: ${supported.filter(item => !item.framework &&
      !frameworkFree.includes(item.module)).map(item => item.matcherId).join(', ')}`);
  const frameworks = new Set(supported.map(item => item.framework));
  for (const name of ['angular-signal', 'signal-state', 'signal-store', 'ngrx-store'])
    assert(frameworks.has(name), `${name} has no registered API`);
  // Angular Signal, NgRx Store and SignalStore stay separate frameworks.
  assert.equal(capabilityById('angular/signal').framework, 'angular-signal');
  assert.equal(capabilityById('signals/signalState').framework, 'signal-state');
  assert.equal(capabilityById('signals/signalStore').framework, 'signal-store');
  assert.equal(capabilityById('ngrx-store/Store.dispatch').framework, 'ngrx-store');
  // P11-14: withEffects is not a public API of this version.
  const withEffects = capabilityById('unsupported/signals-events-withEffects');
  assert.equal(withEffects.support, 'unsupported');
  assert.equal(withEffects.semanticId, null);
  assert(!capabilities().some(item => item.support === 'supported' && item.export === 'withEffects'));
  // P11-05: the kind of a step comes from the registered semantic model.
  assert.equal(stepKindFor(capabilityById('signals/withMethods').semanticId), null);
  assert.equal(stepKindFor(capabilityById('signals/patchState').semanticId), 'state-write');
  assert.equal(stepKindFor(capabilityById('angular/computed').semanticId), 'reactive-link');
  assert.equal(storeMemberStepKind('method'), 'call');
  assert.equal(storeMemberStepKind('computed'), 'reactive-link');
  assert.equal(storeMemberStepKind('hook'), null);
  assert(!capabilities().some(item => item.semanticId?.startsWith('effect:') &&
    ['signals/withMethods', 'signals/withHooks', 'signals/patchState'].includes(item.matcherId)));
});

test('the registry agrees with the installed package exports and subpaths stay distinct', async () => fixture(`
import {signal} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import {signalStore, patchState} from '@ngrx/signals';
import {rxMethod} from '@ngrx/signals/rxjs-interop';
import {event, withReducer} from '@ngrx/signals/events';
import {Store, createAction} from '@ngrx/store';
import {createEffect} from '@ngrx/effects';
export const used=[signal,toSignal,signalStore,patchState,rxMethod,event,withReducer,Store,createAction,createEffect];
`, ({ context }) => {
  assert.deepEqual(auditCapabilities(context), []);
  assert.equal(SUPPORTED_PACKAGE_VERSIONS['@ngrx/signals'], '22.0.0');
  const file = f => moduleIdForFile(context, `${context.workspaceRoot}/node_modules/${f}`);
  assert.equal(file('@ngrx/signals/types/ngrx-signals.d.ts'), '@ngrx/signals');
  assert.equal(file('@ngrx/signals/types/ngrx-signals-events.d.ts'), '@ngrx/signals/events');
  assert.equal(file('@angular/core/types/rxjs-interop.d.ts'), '@angular/core/rxjs-interop');
}));

// P11-16 range: unsupported imports are reported instead of being read as a known feature.
test('unsupported ranges are reported with their reason', async () => fixture(`
import {signalStore, withState} from '@ngrx/signals';
import {withEntities} from '@ngrx/signals/entities';
import {resource} from '@angular/core';
export const Store1=signalStore(withState({a:1}),withEntities<{id:number}>());
export const loaded=resource({loader:()=>Promise.resolve(1)});
`, ({ context, file }) => {
  const found = unsupportedImports(context, file);
  assert(found.some(item => item.capability.matcherId === 'unsupported/signals-entities'));
  assert(found.some(item => item.capability.matcherId === 'unsupported/angular-resource'));
  assert(found.every(item => item.capability.note));
  const stores = catalogSignalStores(context);
  const record = [...stores.declarations.values()][0];
  assert.equal(record.status, 'partial');
  assert(record.features.some(item => item.status === 'boundary'));
  assert(record.gaps.some(gap => gap.includes('withEntities')));
}));

// P11-03
test('signal reads carry their tracking and effects carry their framework and phase', async () => fixture(`
import {Component, signal, computed, effect, afterRenderEffect, untracked} from '@angular/core';
import {signalState, getState, patchState} from '@ngrx/signals';
export function count(){return 1}
@Component({selector:'app-root',template:'{{total()}}'}) export class Root {
  value=signal(0);
  state=signalState({left:1,right:2});
  total=computed(()=>this.value()+1);
  constructor(){
    effect(()=>{const a=this.value();untracked(()=>this.value());});
    afterRenderEffect(()=>this.value());
  }
  bump(){this.value.set(this.value()+1);count();}
  patch(){patchState(this.state,{left:5});getState(this.state);}
  quiet(){untracked(()=>{this.value.set(2);});}
}
`, ({ context }) => {
  const graph = analyzeSignals(context);
  const signalSource = graph.sources.find(item => item.state.key === 'value');
  assert.equal(signalSource.state.framework, 'angular-signal');
  assert.equal(signalSource.state.instance.endsWith('#Root'), true);
  const stateSource = graph.sources.find(item => item.capability === 'signals/signalState');
  assert.equal(stateSource.state.framework, 'signal-state');
  assert.deepEqual(stateSource.keys, ['left', 'right']);
  const tracked = graph.reads.filter(item => item.tracking === 'tracked');
  const untrackedReads = graph.reads.filter(item => item.tracking === 'untracked');
  assert(tracked.length >= 3, 'computed, effect and afterRenderEffect reads are tracked');
  assert.equal(untrackedReads.length, 1);
  assert(graph.reads.some(item => item.tracking === 'snapshot' && item.expression === 'this.value'));
  // A plain function with a signal-like name is not a signal read.
  assert(!graph.reads.some(item => item.expression === 'count'));
  const phases = graph.effects.map(item => item.phase);
  assert(phases.includes('change-detection') && phases.includes('after-render'));
  assert(graph.effects.every(item => item.framework === 'angular-signal' && item.lifetime.length > 0));
  assert(graph.effects.find(item => item.phase === 'change-detection').reads.length >= 1);
  const patch = graph.writes.find(item => item.capability === 'signals/patchState');
  assert.deepEqual(patch.keys, ['left']);
  assert(graph.reads.some(item => item.tracking === 'snapshot' && item.reason?.includes('getState')));
  // A write inside untracked is kept; only the dependency edge is suppressed.
  assert(graph.writes.some(item => item.capability === 'angular/signal.set' &&
    item.conditions.some(condition => condition.includes('inside untracked'))));
}));

test('a read after await inside an effect is not a tracked dependency', async () => fixture(`
import {Component, signal, effect} from '@angular/core';
@Component({selector:'app-root',template:''}) export class Root {
  value=signal(0);
  constructor(){effect(async()=>{const first=this.value();await Promise.resolve();const second=this.value();});}
}
`, ({ context }) => {
  const graph = analyzeSignals(context);
  assert.equal(graph.reads.filter(item => item.tracking === 'tracked').length, 1);
  const after = graph.reads.find(item => item.tracking === 'snapshot');
  assert(after.reason.includes('await'));
}));

// P11-06 / P11-07
test('generated Stores are catalogued through variables, extends, aliases and reused features', async () => fixture(`
import {signalStore as makeStore, signalStoreFeature, withState, withComputed, withMethods, withProps,
  withHooks, withFeature, patchState} from '@ngrx/signals';
import {computed, inject, Component} from '@angular/core';
export function withShared(){return signalStoreFeature(withState({shared:0}),withComputed(({shared})=>({doubled:computed(()=>shared()*2)})));}
export const reused=signalStoreFeature(withState({extra:''}));
export const BookStore=makeStore(withShared(),reused,withState({count:0}),
  withComputed(({count})=>({doubled:computed(()=>count()+1)})),
  withMethods(store=>({bump(){patchState(store,{count:1});}})),
  withProps(()=>({tag:'books'})),
  withHooks({onInit(){},onDestroy(){}}));
export class SubStore extends makeStore(withState({sub:1})) {}
export const Mystery=makeStore(withState({a:1}),(s:never)=>s);
@Component({selector:'app-root',template:'',providers:[BookStore]}) export class Root {
  store=inject(BookStore);
}
`, ({ context }) => {
  const catalog = catalogSignalStores(context);
  const names = [...catalog.declarations.values()].map(item => item.name).sort();
  assert.deepEqual(names, ['BookStore', 'Mystery', 'SubStore']);
  const book = [...catalog.declarations.values()].find(item => item.name === 'BookStore');
  assert.equal(book.kind, 'variable');
  assert(book.id.includes(`@${context.id}`), 'the Store id carries its context');
  // Reused features are expanded in argument order, whether reached by call or by direct reference.
  assert(book.stateKeys.includes('shared') && book.stateKeys.includes('extra') && book.stateKeys.includes('count'));
  const doubled = book.members.filter(item => item.name === 'doubled');
  assert.equal(doubled.length, 2);
  assert.equal(doubled[0].shadows, null);
  assert(doubled[1].shadows?.includes('signals/withComputed'), 'the later feature shadows the earlier member');
  assert(doubled[1].featureIndex > doubled[0].featureIndex);
  assert(book.members.some(item => item.name === 'bump' && item.kind === 'method'));
  assert(book.members.some(item => item.name === 'tag' && item.kind === 'prop'));
  assert.deepEqual(book.hooks.map(item => item.kind), ['onInit', 'onDestroy']);
  assert.equal(book.status, 'resolved');
  const sub = [...catalog.declarations.values()].find(item => item.name === 'SubStore');
  assert.equal(sub.kind, 'class-extends');
  // An unidentified feature is never transparent.
  const mystery = [...catalog.declarations.values()].find(item => item.name === 'Mystery');
  assert.equal(mystery.status, 'partial');
  assert(mystery.gaps.some(gap => gap.includes('may add or replace members')));
}));

test('withFeature is expanded when resolvable and left as a boundary when not', async () => fixture(`
import {signalStore, signalStoreFeature, withState, withFeature} from '@ngrx/signals';
export const inner=signalStoreFeature(withState({inner:1}));
export const Resolved=signalStore(withState({a:1}),withFeature(()=>inner));
export const Blocked=signalStore(withState({a:1}),withFeature(({a})=>a as never));
`, ({ context }) => {
  const catalog = catalogSignalStores(context);
  const resolved = [...catalog.declarations.values()].find(item => item.name === 'Resolved');
  assert(resolved.stateKeys.includes('inner'));
  assert.equal(resolved.status, 'resolved');
  const blocked = [...catalog.declarations.values()].find(item => item.name === 'Blocked');
  assert.equal(blocked.status, 'partial');
  assert(blocked.features.some(item => item.capability === 'signals/withFeature' && item.status === 'boundary'));
}));

// P11-08 / P11-09
test('destructured signals and captured Store references return to their instance and lifetime', async () => fixture(`
import {signalStore, withState, withMethods, patchState, getState} from '@ngrx/signals';
import {Component, inject} from '@angular/core';
export const CounterStore=signalStore(withState({count:0}),
  withMethods(store=>({bump(){patchState(store,{count:getState(store).count+1});}})));
export const ProvidedOnly=signalStore(withState({idle:true}));
@Component({selector:'app-root',template:'{{count()}}',providers:[CounterStore,ProvidedOnly]})
export class Root {
  store=inject(CounterStore);
  count=this.store.count;
  run(){const {count}=this.store;return count();}
}
`, ({ context, file, t }) => {
  const catalog = catalogSignalStores(context);
  const counter = [...catalog.declarations.values()].find(item => item.name === 'CounterStore');
  const provided = [...catalog.declarations.values()].find(item => item.name === 'ProvidedOnly');
  const find = (predicate) => {
    let found;
    const visit = node => { if (!found && predicate(node)) found = node; t.forEachChild(node, visit); };
    visit(file);
    return found;
  };
  // A destructured state signal returns to its Store instance.
  const destructured = find(node => t.isIdentifier(node) && node.text === 'count' &&
    t.isCallExpression(node.parent) && node.parent.expression === node);
  const reference = resolveStoreReference(context, catalog, destructured);
  assert.equal(reference.kind, 'instance');
  assert.equal(reference.declarationId, counter.id);
  assert.equal(reference.member, 'count');
  // A Store reference captured in a method factory returns to the Store under construction.
  const captured = find(node => t.isIdentifier(node) && node.text === 'store' &&
    t.isCallExpression(node.parent) && node.parent.arguments.includes(node));
  const inFactory = resolveStoreReference(context, catalog, captured);
  assert.equal(inFactory.kind, 'construction-context');
  assert.equal(inFactory.declarationId, counter.id);
  // A provider alone does not create the Store.
  const injected = storeLifetime(catalog, counter.id);
  assert.equal(injected.created, true);
  const notCreated = storeLifetime(catalog, provided.id);
  assert.equal(notCreated.created, false);
  assert(notCreated.conditions.some(condition => condition.includes('no confirmed inject or new')));
  assert(catalog.diagnostics.some(item => item.includes('provided but no inject or new')));
}));

test('withHooks marks start and end conditions rather than results of an operation', async () => fixture(`
import {signalStore, withState, withHooks} from '@ngrx/signals';
export const HookStore=signalStore(withState({a:1}),withHooks({onInit(){},onDestroy(){}}));
`, ({ context }) => {
  const catalog = catalogSignalStores(context);
  const record = [...catalog.declarations.values()][0];
  const lifetime = storeLifetime(catalog, record.id);
  assert.equal(lifetime.start.length, 1);
  assert.equal(lifetime.end.length, 1);
  assert(lifetime.start[0].startsWith('onInit at '));
  assert(lifetime.end[0].startsWith('onDestroy at '));
}));

test('a Store re-exported under another name is the same declaration', async () => fixture({
  'store.ts': `
import {signalStore as make, withState} from '@ngrx/signals';
export const BookStore=make(withState({count:0}));
`,
  'barrel.ts': `export {BookStore as Books} from './store';`,
  'main.ts': `
import {Component, inject} from '@angular/core';
import {Books} from './barrel';
@Component({selector:'app-root',template:'',providers:[Books]}) export class Root { store=inject(Books); }
`,
}, ({ context }) => {
  const catalog = catalogSignalStores(context);
  assert.equal(catalog.declarations.size, 1);
  const record = [...catalog.declarations.values()][0];
  assert.equal(record.name, 'BookStore');
  assert(record.id.includes('/src/store.ts:'), 'the Store id names its declaring file');
  // Both the alias import and the provider entry resolve to the one declaration.
  assert.deepEqual([...new Set(catalog.instances.map(item => item.declarationId))], [record.id]);
  assert.deepEqual(catalog.instances.map(item => item.kind).sort(), ['inject', 'provider']);
  assert.equal(storeLifetime(catalog, record.id).created, true);
  assert.deepEqual(catalog.diagnostics, []);
}));

// R02 / R03 detail: the comparison and the teardown of a derived value or effect.
test('a custom equal and an effect teardown are read, not assumed', async () => fixture(`
import {Component, signal, computed, linkedSignal, effect, EffectRef} from '@angular/core';
export const same=(a:number,b:number)=>a===b;
@Component({selector:'app-root',template:''}) export class Root {
  value=signal(0);
  plain=computed(()=>this.value());
  compared=computed(()=>this.value(),{equal:same});
  mirrored=linkedSignal(()=>this.value());
  ref:EffectRef=effect(cleanup=>{this.value();cleanup(()=>{});});
  stop(){this.ref.destroy();}
}
`, ({ context }) => {
  const graph = analyzeSignals(context);
  const compared = graph.links.find(item => item.to === 'compared');
  assert.equal(compared.equal, 'equal:same');
  assert(compared.conditions.some(item => item.includes('custom equal function')));
  assert.equal(graph.links.find(item => item.to === 'plain').equal, null);
  assert.equal(graph.links.find(item => item.to === 'mirrored').capability, 'angular/linkedSignal');
  const effectNode = graph.effects[0];
  assert.equal(effectNode.cleanups.length, 1);
  assert.equal(effectNode.destroys.length, 1);
  assert.equal(effectNode.reads.length, 1);
}));

// R08: definition and start are separate, and the argument forms differ per API.
test('rxMethod and signalMethod separate their definition from their calls', async () => fixture(`
import {Component, inject, signal} from '@angular/core';
import {signalStore, withState, withMethods, patchState, signalMethod} from '@ngrx/signals';
import {rxMethod} from '@ngrx/signals/rxjs-interop';
import {tap, of} from 'rxjs';
export const LoadStore=signalStore(withState({count:0}),
  withMethods(store=>({
    load: rxMethod<number>(source=>source.pipe(tap(n=>patchState(store,{count:n})))),
    sync: signalMethod<number>(n=>patchState(store,{count:n})),
    unused: rxMethod<number>(source=>source),
  })));
@Component({selector:'app-root',template:''}) export class Root {
  store=inject(LoadStore);
  n=signal(1);
  go(){this.store.load(1);this.store.load(of(2));this.store.load(this.n);this.store.sync(this.n);}
}
`, ({ context }) => {
  const stores = catalogSignalStores(context);
  const graph = analyzeReactiveMethods(context, stores);
  assert.deepEqual(graph.methods.map(item => item.name).sort(), ['load', 'sync', 'unused']);
  const load = graph.methods.find(item => item.name === 'load');
  assert.equal(load.capability, 'signals/rxMethod');
  assert.equal(load.storeId, [...stores.declarations.values()][0].id);
  assert.equal(load.called, true);
  // An uncalled pipeline is defined but never started.
  const unused = graph.methods.find(item => item.name === 'unused');
  assert.equal(unused.called, false);
  assert(graph.diagnostics.some(item => item.includes('defined but never called')));
  const loadCalls = graph.calls.filter(item => item.methodId === load.id);
  assert.deepEqual(loadCalls.map(item => item.argument).sort(), ['observable', 'signal', 'value']);
  assert(loadCalls.find(item => item.argument === 'signal').conditions.some(c => c.includes('restarts on each change')));
  const sync = graph.calls.find(item => item.capability === 'signals/signalMethod');
  assert.equal(sync.argument, 'signal');
  assert(sync.conditions.some(item => item.includes('not supported and is not inferred from rxMethod')));
  assert(graph.calls.every(item => item.gaps.length === 0));
}));
